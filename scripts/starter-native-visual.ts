import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { compareCaptures } from "../packages/runtime-native/conformance/metrics.mjs";
import type { IStarterVisualSnapshot } from "../packages/runtime-native/scripts/starter-visual-cook.js";
import type { FixtureOp, IFixture } from "../packages/three-native/src/fixture-format.js";
import {
  encodeArg,
  encodeFixture,
  parseReply,
} from "../packages/three-native/src/fixture-protocol.js";
import { assertFrameShowsSomething } from "./capture-guard.js";
import {
  VISUAL_FLOOR,
  buildVisualAbBundle,
  renderVisualAbMarkdown,
  scoreVisualAb,
} from "./visual-ab.js";
import { captureTemplate, packageLocalFramework } from "./visual-gate.js";

type Snapshot = IStarterVisualSnapshot;
const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "artifacts/visuals/starter-native");

export function starterSnapshotFixture(snapshot: Snapshot, sceneFile: string): IFixture {
  const ops: FixtureOp[] = [
    { op: "new", id: "scene", class: "Scene", args: [] },
    { op: "gltf", id: "cooked", file: sceneFile },
    { op: "call", id: "scene", method: "add", args: [{ ref: "cooked" }] },
    {
      op: "new",
      id: "camera",
      class: "PerspectiveCamera",
      args: [
        snapshot.camera.fov,
        snapshot.camera.aspect,
        snapshot.camera.near,
        snapshot.camera.far,
      ],
    },
    { op: "set", id: "camera", path: "zoom", value: snapshot.camera.zoom },
  ];
  const vector = (id: string, field: string, values: number[], keys: string[]) => {
    if (values.length !== keys.length || values.some((n) => !Number.isFinite(n)))
      throw new Error(`TN_VISUAL_SNAPSHOT_INVALID: ${id}.${field}`);
    for (const [i, key] of keys.entries())
      ops.push({ op: "set", id, path: `${field}.${key}`, value: values[i] as number });
  };
  for (const [i, texture] of snapshot.world.textures.entries()) {
    if (
      !texture.node ||
      !Number.isSafeInteger(texture.width) ||
      !Number.isSafeInteger(texture.height) ||
      texture.width < 1 ||
      texture.height < 1
    )
      throw new Error("TN_VISUAL_SNAPSHOT_INVALID: sky image");
    const id = `sky${i}`;
    ops.push({
      op: "call",
      id: "cooked",
      method: "getObjectByName",
      args: [texture.node],
      result: `${id}Carrier`,
    });
    ops.push({ op: "set", id: `${id}Carrier`, path: "visible", value: false });
    ops.push({
      op: "call",
      id: `${id}Carrier`,
      method: "material",
      args: [],
      result: `${id}Material`,
    });
    ops.push({ op: "call", id: `${id}Material`, method: "map", args: [], result: id });
    for (const field of [
      "mapping",
      "colorSpace",
      "flipY",
      "wrapS",
      "wrapT",
      "magFilter",
      "minFilter",
    ] as const)
      ops.push({ op: "set", id, path: field, value: texture[field] });
    ops.push({ op: "set", id, path: "needsUpdate", value: true });
  }
  const textureRef = (index: number) => {
    if (!Number.isInteger(index) || !snapshot.world.textures[index])
      throw new Error("TN_VISUAL_SNAPSHOT_INVALID: sky reference");
    return { ref: `sky${index}` };
  };
  const background = snapshot.world.background;
  if (Array.isArray(background)) {
    ops.push({ op: "new", id: "backgroundColor", class: "Color", args: background });
    ops.push({ op: "set", id: "scene", path: "background", value: { ref: "backgroundColor" } });
  } else
    ops.push({
      op: "set",
      id: "scene",
      path: "background",
      value: background === null ? null : textureRef(background),
    });
  ops.push({
    op: "set",
    id: "scene",
    path: "environment",
    value: snapshot.world.environment === null ? null : textureRef(snapshot.world.environment),
  });
  for (const field of [
    "backgroundIntensity",
    "environmentIntensity",
    "backgroundBlurriness",
  ] as const) {
    if (!Number.isFinite(snapshot.world[field]))
      throw new Error(`TN_VISUAL_SNAPSHOT_INVALID: ${field}`);
    ops.push({ op: "set", id: "scene", path: field, value: snapshot.world[field] });
  }
  for (const field of ["backgroundRotation", "environmentRotation"] as const)
    vector("scene", field, snapshot.world[field], ["x", "y", "z"]);
  if (snapshot.world.fog) {
    const fog = snapshot.world.fog;
    if (!["Fog", "FogExp2"].includes(fog.type)) throw new Error("TN_VISUAL_SNAPSHOT_INVALID: fog");
    ops.push({ op: "new", id: "fogColor", class: "Color", args: fog.color });
    ops.push({
      op: "new",
      id: "fog",
      class: fog.type,
      args:
        fog.type === "FogExp2"
          ? [{ ref: "fogColor" }, fog.density]
          : [{ ref: "fogColor" }, fog.near, fog.far],
    });
    ops.push({ op: "set", id: "scene", path: "fog", value: { ref: "fog" } });
  }
  for (const [i, node] of snapshot.nodes.entries()) {
    const id = `node${i}`;
    ops.push({
      op: "call",
      id: "cooked",
      method: "getObjectByName",
      args: [node.name],
      result: id,
    });
    for (const field of ["castShadow", "receiveShadow"] as const)
      ops.push({ op: "set", id, path: field, value: node[field] });
  }
  vector("camera", "position", snapshot.camera.position, ["x", "y", "z"]);
  vector("camera", "quaternion", snapshot.camera.quaternion, ["x", "y", "z", "w"]);
  for (const [i, light] of snapshot.lights.entries()) {
    if (!["DirectionalLight", "AmbientLight"].includes(light.type))
      throw new Error(`TN_VISUAL_LIGHT_UNSUPPORTED: ${light.type}`);
    const id = `light${i}`;
    ops.push({ op: "new", id: `${id}Color`, class: "Color", args: light.color });
    ops.push({ op: "new", id, class: light.type, args: [{ ref: `${id}Color` }, light.intensity] });
    ops.push({ op: "set", id, path: "castShadow", value: light.castShadow });
    for (const [field, value] of Object.entries(light.shadow)) {
      if (!Number.isFinite(value)) throw new Error(`TN_VISUAL_SNAPSHOT_INVALID: ${field}`);
      ops.push({ op: "set", id, path: field, value });
    }
    vector(id, "position", light.position, ["x", "y", "z"]);
    if (light.type === "DirectionalLight") {
      ops.push({ op: "call", id, method: "target", args: [], result: `${id}Target` });
      vector(`${id}Target`, "position", light.target, ["x", "y", "z"]);
      ops.push({ op: "call", id: "scene", method: "add", args: [{ ref: `${id}Target` }] });
    }
    ops.push({ op: "call", id: "scene", method: "add", args: [{ ref: id }] });
  }
  ops.push({ op: "call", id: "camera", method: "updateProjectionMatrix", args: [] });
  return {
    name: "starter-cooked-capture",
    adaptedFrom: "starter at visual-gate startup-ready + 250ms",
    tolerance: { abs: 0 },
    ops,
    render: {
      scene: "scene",
      camera: "camera",
      width: 1280,
      height: 720,
      toneMapping: "none",
      toneMappingExposure: 1,
      outputColorSpace: "srgb",
      shadowMap: snapshot.shadowMap,
    },
    observe: [
      { id: "scene", kind: "pixels", metric: { maxPixelMismatchRatio: 0, maxPerceptualDeltaE: 0 } },
    ],
  };
}

export function renderStarterArm(
  driver: string,
  fixture: IFixture,
  png: string,
  graph?: string,
): Buffer {
  if (existsSync(png)) throw new Error(`TN_VISUAL_NATIVE_CAPTURE_EXISTS: ${png}`);
  const env = { ...process.env };
  env.TN_FIXTURE_POST_GRAPH = undefined;
  if (graph !== undefined) env.TN_FIXTURE_POST_GRAPH = graph;
  const run = spawnSync(driver, [], {
    cwd: ROOT,
    env,
    input: `${encodeFixture(fixture, png).join("\n")}\n`,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || run.status !== 0)
    throw new Error(`TN_VISUAL_NATIVE_DRIVER_FAILED: ${run.error?.message ?? run.stderr}`);
  const replies = run.stdout.trim().split("\n").filter(Boolean).map(parseReply);
  if (
    replies.some((reply) => reply.kind !== "obs") ||
    replies.length !== 1 ||
    replies[0]?.kind !== "obs" ||
    replies[0].observation !== "pixels" ||
    replies[0].index !== 0 ||
    replies[0].value !== encodeArg(png) ||
    !existsSync(png)
  )
    throw new Error(`TN_VISUAL_NATIVE_CAPTURE_MISSING: ${run.stdout}`);
  const contents = readFileSync(png);
  const stats = assertFrameShowsSomething(contents, "starter-native");
  if (stats.width !== 1280 || stats.height !== 720)
    throw new Error("TN_VISUAL_NATIVE_CAPTURE_SIZE");
  return contents;
}

export async function persistStarterComparison(
  out: string,
  legacy: Buffer,
  native: Buffer,
  dropped: Buffer,
) {
  for (const [arm, content] of [
    ["legacy", legacy],
    ["native-engine", native],
    ["no-post", dropped],
  ] as const) {
    const stats = assertFrameShowsSomething(content, arm);
    if (stats.width !== 1280 || stats.height !== 720)
      throw new Error("TN_VISUAL_NATIVE_CAPTURE_SIZE");
    await mkdir(path.join(out, arm), { recursive: true });
    await writeFile(path.join(out, arm, "starter.png"), content);
  }
  const metrics = {
    supportingOnly: true,
    nativeVsLegacy: compareCaptures(legacy, native),
    droppedVsLegacy: compareCaptures(legacy, dropped),
    droppedVsNative: compareCaptures(native, dropped),
  };
  await writeFile(path.join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  const normal = buildVisualAbBundle(
    path.join(out, "legacy"),
    path.join(out, "native-engine"),
    path.join(out, "ab"),
    undefined,
    1,
  );
  const red = buildVisualAbBundle(
    path.join(out, "legacy"),
    path.join(out, "no-post"),
    path.join(out, "red"),
    undefined,
    1,
  );
  // This only rejects an insensitive control; these metrics never certify the positive arm.
  if (
    metrics.droppedVsNative.pixelMismatchRatio === 0 ||
    metrics.droppedVsNative.perceptualDeltaE === 0
  )
    throw new Error("TN_VISUAL_POST_DROP_INSENSITIVE: removing the graph did not change the frame");
  return { normal, red, metrics };
}

async function replaceCanvas(page: Page, png: Buffer): Promise<Buffer> {
  await page.evaluate(
    async (src) => {
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("TN_VISUAL_CANVAS_MISSING");
      if (canvas.clientWidth !== 1280 || canvas.clientHeight !== 720)
        throw new Error("TN_VISUAL_CANVAS_SIZE");
      const bounds = canvas.getBoundingClientRect();
      const image = new Image();
      image.src = src;
      await image.decode();
      image.dataset.tnVisualReadback = "true";
      Object.assign(image.style, {
        position: "fixed",
        top: `${bounds.top}px`,
        left: `${bounds.left}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        pointerEvents: "none",
        zIndex: getComputedStyle(canvas).zIndex,
      });
      document.querySelector('[data-tn-visual-readback="true"]')?.remove();
      canvas.style.visibility = "hidden";
      canvas.after(image);
    },
    `data:image/png;base64,${png.toString("base64")}`,
  );
  return page.screenshot({ type: "png" });
}

export async function loadStarterVisualPage(page: Page, bundle: string): Promise<void> {
  try {
    // addInitScript wraps its content in a function, hiding esbuild's IIFE global.
    await page.addScriptTag({ path: bundle });
    const ready = await page.evaluate(
      () =>
        typeof Reflect.get(globalThis, "TnStarterVisual")?.prepareStarterSnapshot === "function",
    );
    if (!ready) throw new Error("prepareStarterSnapshot export is missing");
  } catch (error) {
    throw new Error(
      `TN_STARTER_VISUAL_PAGE_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function runStarterNativeVisual(args: readonly string[]) {
  const value = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    const result = args[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`${flag} requires a path`);
    return path.resolve(result);
  };
  const out = value("--out", DEFAULT_OUT);
  const driver = value(
    "--driver",
    path.join(ROOT, "packages/runtime-native/build/tn-linux/tn-native-engine-render-driver"),
  );
  if (!existsSync(driver)) throw new Error(`TN_VISUAL_NATIVE_DRIVER_MISSING: ${driver}`);
  if (existsSync(out))
    throw new Error(
      `TN_VISUAL_OUTPUT_EXISTS: choose a fresh --out (keeps captures and verdicts together): ${out}`,
    );
  await mkdir(out, { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "tn-starter-native-"));
  let result: Awaited<ReturnType<typeof persistStarterComparison>> | undefined;
  try {
    const packages = await packageLocalFramework(temporary);
    const bundle = path.join(temporary, "starter-visual.js");
    try {
      // esbuild is a runtime-native dependency; the workspace root does not install it.
      await promisify(execFile)(
        path.join(ROOT, "packages/runtime-native/node_modules/.bin/esbuild"),
        [
          path.join(ROOT, "packages/runtime-native/scripts/starter-visual-page.ts"),
          "--bundle",
          "--platform=browser",
          "--format=iife",
          "--global-name=TnStarterVisual",
          `--outfile=${bundle}`,
        ],
      );
    } catch (error) {
      throw new Error("TN_STARTER_VISUAL_PAGE_UNAVAILABLE: bundle build failed", { cause: error });
    }
    await captureTemplate(
      "starter",
      temporary,
      packages,
      5300,
      async (page) => {
        await loadStarterVisualPage(page, bundle);
        const snapshot: Snapshot = await page.evaluate("TnStarterVisual.prepareStarterSnapshot()");
        const sceneFile = path.join(out, "starter.gltf");
        const graphFile = path.join(out, "starter-post.json");
        await writeFile(sceneFile, JSON.stringify(snapshot.gltf));
        await writeFile(graphFile, JSON.stringify(snapshot.postGraph));
        const fixture = starterSnapshotFixture(snapshot, sceneFile);
        await writeFile(path.join(out, "scene-fixture.json"), JSON.stringify(fixture, null, 2));
        const legacy = await page.screenshot({ type: "png" });
        const native = renderStarterArm(
          driver,
          fixture,
          path.join(out, "native-frame.png"),
          graphFile,
        );
        const dropped = renderStarterArm(driver, fixture, path.join(out, "no-post-frame.png"));
        // Same page/HUD/CSS; replace only the world canvas with the native readback.
        const nativePage = await replaceCanvas(page, native);
        const droppedPage = await replaceCanvas(page, dropped);
        result = await persistStarterComparison(out, legacy, nativePage, droppedPage);
        await writeFile(
          path.join(out, "capture.json"),
          `${JSON.stringify(
            {
              capturePoint: "visual-gate startup-ready + 250ms; simulation then paused",
              size: [1280, 720],
              rendered:
                "Real paused starter geometry/skin pose and glTF materials/textures; original sky/environment, fog, lights, shadow settings and world camera. Original DOM HUD retained. The installed authored graph is exported; red omits only that graph.",
              tier: snapshot.tier,
              materialTransport:
                "glTF; custom material/vertex nodes are not serialized by GLTFExporter. Legacy stays intact so missing cooked appearance remains visible to the judge.",
              ...result,
            },
            null,
            2,
          )}\n`,
        );
        return nativePage;
      },
      async (page) => {
        await page.route(/\/src\/render\/postprocessing\.(?:ts|js)(?:\?.*)?$/u, async (route) => {
          const response = await route.fetch();
          const body = await response.text();
          const hooked = observeStarterGraph(body);
          await route.fulfill({ response, body: hooked });
        });
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  if (!result) throw new Error("TN_VISUAL_NATIVE_CAPTURE_MISSING");
  return { out, ...result };
}

/** Observe the original Vite module's installation; never rebuild a different starter graph. */
export function observeStarterGraph(source: string): string {
  const setup = /function setupPost\([\s\S]*?\)\s*\{/u;
  if (!setup.test(source)) throw new Error("TN_VISUAL_POST_CAPTURE_HOOK_MISSING");
  return source.replace(
    setup,
    `$&
    const visualInstall = renderer.setOutputNode.bind(renderer);
    renderer.setOutputNode = (node, worldPass) => {
      const receipt = visualInstall(node, worldPass);
      globalThis.__tnVisualGraph = node;
      return receipt;
    };`,
  );
}

export async function scoreStarterNativeVisual(out: string, args: readonly string[]) {
  const files = (flag: string) =>
    args.flatMap((arg, i) => (arg === flag ? [args[i + 1] ?? ""] : []));
  const raters = Number(args[args.indexOf("--raters") + 1] ?? 3);
  if (args.includes("--raters") && (!Number.isSafeInteger(raters) || raters < 1))
    throw new Error("TN_VISUAL_NATIVE_RATERS_INVALID");
  const normal = scoreVisualAb(
    path.join(out, "ab/reveal.json"),
    files("--verdict"),
    args.includes("--raters") ? raters : 3,
  );
  const red = scoreVisualAb(
    path.join(out, "red/reveal.json"),
    files("--red-verdict"),
    args.includes("--raters") ? raters : 3,
  );
  for (const [arm, score] of [
    ["ab", normal],
    ["red", red],
  ] as const) {
    await writeFile(path.join(out, arm, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
    await writeFile(path.join(out, arm, "score.md"), renderVisualAbMarkdown(score));
  }
  if (
    [normal, red].some((score) => score.rows.length !== 1 || score.rows[0]?.template !== "starter")
  )
    throw new Error("TN_VISUAL_NATIVE_SCORE_UNPAIRED");
  const pass =
    normal.rows.every((row) => row.after >= VISUAL_FLOOR && row.classification !== "LOSS") &&
    red.rows.every((row) => row.classification === "LOSS");
  await writeFile(
    path.join(out, "score.json"),
    `${JSON.stringify({ pass, normal, red }, null, 2)}\n`,
  );
  if (!pass)
    throw new Error(
      "TN_VISUAL_NATIVE_SCORE_FAILED: native floor/regression or no-post red control failed",
    );
  return { pass, normal, red };
}
