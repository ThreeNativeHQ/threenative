import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  loadStarterVisualPage,
  observeStarterGraph,
  persistStarterComparison,
  renderStarterArm,
  runStarterNativeVisual,
  scoreStarterNativeVisual,
  starterSnapshotFixture,
} from "../starter-native-visual.js";
import { scoreVisualAb } from "../visual-ab.js";

const spawned = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: spawned,
}));

const snapshot = {
  gltf: {},
  lights: [
    {
      type: "DirectionalLight",
      color: [1, 0.9, 0.8],
      intensity: 4.5,
      position: [3, 4, 5],
      target: [0, 0, 0],
      castShadow: true,
      shadow: { "shadow.camera.far": 80, "shadow.mapSize.x": 4096 },
    },
  ],
  tier: "high",
  shadowMap: true,
  toneMapping: 4,
  toneMappingExposure: 1,
  nodes: [{ name: "ground", castShadow: false, receiveShadow: true }],
  world: {
    textures: [
      {
        node: "tn-sky-0",
        width: 1,
        height: 1,
        mapping: 303,
        colorSpace: "srgb",
        flipY: true,
        wrapS: 1001,
        wrapT: 1001,
        magFilter: 1006,
        minFilter: 1008,
      },
    ],
    background: 0,
    environment: 0,
    backgroundIntensity: 2.5,
    environmentIntensity: 2.5,
    backgroundBlurriness: 0,
    backgroundRotation: [0.1, 0.4, 0],
    environmentRotation: [0.1, 0.4, 0],
    fog: { type: "FogExp2", color: [0.5, 0.6, 0.7], near: 1, far: 1000, density: 0.003 },
  },
  postGraph: { version: 1 as const, root: 0, nodes: [] },
  camera: {
    fov: 60,
    aspect: 1280 / 720,
    near: 0.1,
    far: 1000,
    zoom: 1,
    position: [-3, 5, 8],
    quaternion: [0, 0, 0, 1],
  },
};
function frame(shift = 0): Buffer {
  const png = new PNG({ width: 1280, height: 720 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (((i / 4) % 1280) + shift) % 256;
    png.data[i + 1] = (Math.floor(i / 4 / 1280) + shift) % 256;
    png.data[i + 2] = 100;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("starter native visual arm", () => {
  it("loads the IIFE as a script so its export survives Playwright's init-script scope", async () => {
    const context = createContext({});
    const bundle = "var TnStarterVisual = { prepareStarterSnapshot() {} };";
    runInContext(`(() => { ${bundle} })();`, context);
    expect(runInContext("typeof TnStarterVisual", context)).toBe("undefined");
    const page = {
      addScriptTag: vi.fn(async () => runInContext(bundle, context)),
      evaluate: vi.fn(async (check: () => boolean) =>
        runInContext(`(${check.toString()})()`, context),
      ),
    };
    await loadStarterVisualPage(page as unknown as Page, "starter-visual.js");
    expect(page.addScriptTag).toHaveBeenCalledWith({ path: "starter-visual.js" });
    expect(runInContext("typeof TnStarterVisual.prepareStarterSnapshot", context)).toBe("function");
  });
  it("fails closed when the bundle cannot load or lacks its snapshot export", async () => {
    const context = createContext({});
    const page = {
      addScriptTag: vi.fn().mockRejectedValueOnce(new Error("bundle load failed")),
      evaluate: vi.fn(async (check: () => boolean) =>
        runInContext(`(${check.toString()})()`, context),
      ),
    };
    await expect(loadStarterVisualPage(page as unknown as Page, "missing.js")).rejects.toThrow(
      "TN_STARTER_VISUAL_PAGE_UNAVAILABLE: bundle load failed",
    );
    expect(page.evaluate).not.toHaveBeenCalled();
    page.addScriptTag.mockResolvedValueOnce(undefined);
    await expect(loadStarterVisualPage(page as unknown as Page, "empty.js")).rejects.toThrow(
      "TN_STARTER_VISUAL_PAGE_UNAVAILABLE: prepareStarterSnapshot export is missing",
    );
  });
  it("keeps the existing output guard before any build or capture", async () => {
    const out = await makeTempDir("tn-visual-existing-");
    const driver = path.join(out, "driver");
    await writeFile(driver, "unused");
    await expect(runStarterNativeVisual(["--out", out, "--driver", driver])).rejects.toThrow(
      "TN_VISUAL_OUTPUT_EXISTS",
    );
  });
  it("observes the real post installation without replacing its scene or receipt", () => {
    const install = vi.fn(() => "receipt");
    const source =
      observeStarterGraph(`function setupPost(renderer, scene, camera, environment = {}) {
      return renderer.setOutputNode(environment.node, scene);
    }`);
    const invoke = new Function(`${source}; return setupPost;`)();
    const renderer = { setOutputNode: install };
    const scene = {};
    const graph = {};
    expect(invoke(renderer, scene, {}, { node: graph })).toBe("receipt");
    expect(Reflect.get(globalThis, "__tnVisualGraph")).toBe(graph);
    expect(install).toHaveBeenCalledWith(graph, scene);
    Reflect.deleteProperty(globalThis, "__tnVisualGraph");
    expect(() => observeStarterGraph("no setup function")).toThrow("HOOK_MISSING");
  });
  it("keeps the actual camera/light values and uses the strict fixture path at gate size", () => {
    const fixture = starterSnapshotFixture(snapshot, "/tmp/starter.gltf");
    expect(fixture.render).toMatchObject({
      width: 1280,
      height: 720,
      toneMapping: "aces",
      toneMappingExposure: 1,
    });
    expect(() =>
      starterSnapshotFixture({ ...snapshot, toneMapping: 5 }, "/tmp/starter.gltf"),
    ).toThrow("TN_VISUAL_TONE_MAPPING_UNSUPPORTED");
    expect(fixture.ops).toContainEqual({ op: "gltf", id: "cooked", file: "/tmp/starter.gltf" });
    expect(fixture.ops).toContainEqual({ op: "set", id: "camera", path: "position.x", value: -3 });
    expect(fixture.ops).toContainEqual({
      op: "new",
      id: "light0",
      class: "DirectionalLight",
      args: [{ ref: "light0Color" }, 4.5],
    });
    expect(() =>
      starterSnapshotFixture(
        { ...snapshot, camera: { ...snapshot.camera, position: [Number.NaN, 0, 0] } },
        "x",
      ),
    ).toThrow("SNAPSHOT_INVALID");
  });
  it("carries sky, environment, fog and shadow flags without weakening the legacy arm", () => {
    const ops = starterSnapshotFixture(snapshot, "scene.gltf").ops;
    expect(ops).toContainEqual({
      op: "call",
      id: "cooked",
      method: "getObjectByName",
      args: ["tn-sky-0"],
      result: "sky0Carrier",
    });
    expect(ops).toContainEqual({ op: "set", id: "sky0Carrier", path: "visible", value: false });
    expect(ops).toContainEqual({
      op: "call",
      id: "sky0Material",
      method: "map",
      args: [],
      result: "sky0",
    });
    for (const field of ["background", "environment"])
      expect(ops).toContainEqual({ op: "set", id: "scene", path: field, value: { ref: "sky0" } });
    expect(ops).toContainEqual({ op: "set", id: "scene", path: "fog", value: { ref: "fog" } });
    expect(ops).toContainEqual({ op: "set", id: "node0", path: "receiveShadow", value: true });
    expect(ops).toContainEqual({ op: "set", id: "light0", path: "shadow.camera.far", value: 80 });
    expect(() =>
      starterSnapshotFixture({ ...snapshot, world: { ...snapshot.world, environment: 7 } }, "x"),
    ).toThrow("SNAPSHOT_INVALID");
    expect(() =>
      starterSnapshotFixture(
        {
          ...snapshot,
          world: {
            ...snapshot.world,
            textures: [
              {
                ...(snapshot.world.textures[0] as (typeof snapshot.world.textures)[number]),
                width: 0,
              },
            ],
          },
        },
        "x",
      ),
    ).toThrow("SNAPSHOT_INVALID");
  });
  it("requires a driver receipt, refuses stale files, and clears inherited post for the red arm", async () => {
    const root = await makeTempDir("tn-visual-driver-");
    const capture = path.join(root, "capture.png");
    const fixture = starterSnapshotFixture(snapshot, "scene.gltf");
    spawned.mockImplementation(() => {
      writeFileSync(capture, frame());
      return { status: 0, stdout: `obs 0 pixels s:${encodeURIComponent(capture)}\n`, stderr: "" };
    });
    renderStarterArm("driver", fixture, capture, "actual-post.json");
    expect(spawned.mock.lastCall?.[2].env.TN_FIXTURE_POST_GRAPH).toBe("actual-post.json");
    expect(() => renderStarterArm("driver", fixture, capture)).toThrow("CAPTURE_EXISTS");
    const redCapture = path.join(root, "red.png");
    spawned.mockImplementation(() => {
      writeFileSync(redCapture, frame());
      return {
        status: 0,
        stdout: `obs 0 pixels s:${encodeURIComponent(redCapture)}\n`,
        stderr: "",
      };
    });
    renderStarterArm("driver", fixture, redCapture);
    expect(spawned.mock.lastCall?.[2].env.TN_FIXTURE_POST_GRAPH).toBeUndefined();
    expect(spawned.mock.lastCall?.[2].input).toContain("render scene camera 1280 720");
    spawned.mockReturnValue({ status: 0, stdout: "unsupported - refused\n", stderr: "" });
    expect(() => renderStarterArm("driver", fixture, path.join(root, "missing.png"))).toThrow(
      "TN_VISUAL_NATIVE_CAPTURE_MISSING",
    );
    spawned.mockReturnValue({ status: 1, stdout: "", stderr: "graph refused" });
    expect(() => renderStarterArm("driver", fixture, path.join(root, "failed.png"))).toThrow(
      "TN_VISUAL_NATIVE_DRIVER_FAILED",
    );
  });
  it("feeds native and no-post into the unchanged blind scorer; pixels only support the verdict", async () => {
    const root = await makeTempDir("tn-visual-score-");
    const result = await persistStarterComparison(root, frame(), frame(), frame(80));
    expect(result.metrics.supportingOnly).toBe(true);
    expect(result.metrics.nativeVsLegacy.pixelMismatchRatio).toBe(0);
    const verdicts: string[] = [];
    for (let rater = 0; rater < 3; rater++) {
      const file = path.join(root, `rater-${rater}.json`);
      const reveal = JSON.parse(await readFile(result.red.reveal, "utf8")) as {
        arm: string;
        label: string;
      }[];
      await writeFile(
        file,
        JSON.stringify({
          samples: reveal.map(({ arm, label }) => ({
            label,
            visuals: arm === "starter::after" ? 2 : 4,
          })),
        }),
      );
      verdicts.push(file);
    }
    const positive: string[] = [];
    const reveal = JSON.parse(await readFile(result.normal.reveal, "utf8")) as { label: string }[];
    for (let rater = 0; rater < 3; rater++) {
      const file = path.join(root, `positive-${rater}.json`);
      await writeFile(
        file,
        JSON.stringify({ samples: reveal.map(({ label }) => ({ label, visuals: 4 })) }),
      );
      positive.push(file);
    }
    const args = [
      ...positive.flatMap((file) => ["--verdict", file]),
      ...verdicts.flatMap((file) => ["--red-verdict", file]),
    ];
    await expect(scoreStarterNativeVisual(root, args)).resolves.toMatchObject({ pass: true });
    expect(JSON.parse(await readFile(path.join(root, "score.json"), "utf8")).pass).toBe(true);
    await expect(scoreStarterNativeVisual(root, args.slice(2))).rejects.toThrow("RATER_SHORTFALL");
    const score = scoreVisualAb(result.red.reveal, verdicts, 3);
    expect(score.rows[0]).toMatchObject({ classification: "LOSS", before: 4, after: 2 });
    await expect(
      persistStarterComparison(path.join(root, "insensitive"), frame(), frame(), frame()),
    ).rejects.toThrow("DROP_INSENSITIVE");
  });
});
