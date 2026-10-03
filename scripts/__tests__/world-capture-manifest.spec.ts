import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, expect, it } from "vitest";
import type { IStandalonePlaytestReport } from "../../packages/playtest/src/runner/shared.js";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { buildWorldVisualBundle } from "../world-visual-gate.js";

const repo = path.resolve(import.meta.dirname, "../..");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const write = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const labels = [
  "phase477-pose-start",
  ...Array.from({ length: 32 }, (_, i) => `phase477-walk-${String(i + 1).padStart(2, "0")}`),
  "phase477-pose-end",
];

async function fixture() {
  const root = await makeTempDir("world-capture-manifest-");
  roots.push(root);
  const capture = {
    adapter: { vendor: "nvidia", description: "NVIDIA RTX 2080" },
    browserArgs: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
    captureMethod: "page.screenshot" as const,
    rendererKind: "webgpu" as const,
    target: "web",
    viewport: { width: 16, height: 16 },
  };
  const landmarks = [
    { id: "yard_crate_a", position: [-100, 1, 0] },
    { id: "yard_crate_b", position: [-30, 1, -20] },
  ];
  // Synthetic runner-shaped data for schema integration only, never actual capture evidence.
  const report = {
    pass: true,
    runtime: "web",
    target: "web",
    scenario: "phase477-world-capture",
    capture,
    assertionResults: [{ id: "diagnostics", pass: true }],
    diagnostics: [],
    observations: {
      console: [],
      hud: {},
      network: [],
      resources: {},
      componentSeries: labels.map((label, i) => {
        const step = Math.min(i, 32);
        const x = Math.min(-160 + (step * 64) / 6, 180);
        return {
          label,
          tick: 11 * i,
          snapshots: {
            world: {
              cameraPosition: [x, 24, 0],
              cameraTarget: [x + 40, 10, 0],
              flyTimeMs: (step * 1_000) / 6,
              landmarks,
            },
          },
        };
      }),
    },
  } satisfies Pick<
    IStandalonePlaytestReport,
    | "pass"
    | "runtime"
    | "target"
    | "scenario"
    | "capture"
    | "assertionResults"
    | "diagnostics"
    | "observations"
  >;
  const png = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i / 4) % 256;
    png.data[i + 1] = 100;
    png.data[i + 2] = 255 - ((i / 4) % 256);
    png.data[i + 3] = 255;
  }
  write(path.join(root, "report.json"), report);
  write(path.join(root, "capture.json"), capture);
  for (const label of labels) writeFileSync(path.join(root, `${label}.png`), PNG.sync.write(png));
  return { root, report, capture };
}
function run(root: string, ...flags: string[]) {
  return spawnSync(
    path.join(repo, "node_modules/.bin/tsx"),
    ["scripts/world-capture-manifest.ts", root, "unit-test-build", "30", ...flags],
    { cwd: repo, encoding: "utf8" },
  );
}
/** Rewrites the synthetic WorldProbe route as another game's capture, at the same sample count. */
function asOtherWorld(report: ReturnType<typeof read>, xAt: (i: number) => number) {
  report.scenario = "machinefall-world-capture";
  for (const [i, sample] of report.observations.componentSeries.entries()) {
    sample.snapshots.world.cameraPosition = [xAt(i), 6, 0];
    sample.snapshots.world.cameraTarget = [xAt(i) + 12, 3, 0];
  }
  return report;
}

it("extracts actual observed values and feeds the gate without rewriting captured artifacts", async () => {
  const f = await fixture();
  const before = readFileSync(path.join(f.root, "capture.json"));
  const result = run(f.root);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const file = path.join(f.root, "world-capture.json");
  const manifest = read(file);
  expect(manifest.walk).toHaveLength(33);
  expect(manifest.samePose.map((frame: { id: string }) => frame.id)).toEqual([
    labels[0],
    labels[8],
    labels[16],
    labels[24],
  ]);
  expect(manifest.walk[8]).toMatchObject({
    position: f.report.observations.componentSeries[8]?.snapshots.world.cameraPosition,
    timeMs: f.report.observations.componentSeries[8]?.snapshots.world.flyTimeMs,
  });
  expect(readFileSync(path.join(f.root, "capture.json"))).toEqual(before);
  // Both synthetic arms exercise importer/gate schema interoperability, not visual acceptance.
  const out = path.join(f.root, "gate");
  expect(buildWorldVisualBundle(file, file, out).bundleSha256).toMatch(/^[a-f0-9]{64}$/);
});

it.each([
  "failed",
  "wrong-target",
  "missing-label",
  "nonfinite-pose",
  "truncated-route",
  "changed-landmark",
  "different-capture",
])("rejects %s evidence", async (defect) => {
  const f = await fixture();
  const report = read(path.join(f.root, "report.json"));
  const samples = report.observations.componentSeries;
  if (defect === "failed") report.pass = false;
  if (defect === "wrong-target") report.target = "desktop";
  if (defect === "missing-label") samples.splice(8, 1);
  if (defect === "nonfinite-pose") samples[8].snapshots.world.cameraPosition[0] = null;
  if (defect === "truncated-route") samples.at(-1).snapshots.world.cameraPosition[0] = 160;
  if (defect === "changed-landmark") samples[8].snapshots.world.landmarks[0].position[0] = 99;
  if (defect === "different-capture") report.capture.adapter.description = "another adapter";
  write(path.join(f.root, "report.json"), report);
  const result = run(f.root);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("TN_WORLD_CAPTURE_INVALID");
});

it("refuses to overwrite an existing manifest", async () => {
  const f = await fixture();
  const file = path.join(f.root, "world-capture.json");
  writeFileSync(file, "previous evidence");
  expect(run(f.root).status).toBe(2);
  expect(readFileSync(file, "utf8")).toBe("previous evidence");
});

it("imports another game's route under the names it names", async () => {
  const f = await fixture();
  const report = asOtherWorld(read(path.join(f.root, "report.json")), (i) => Math.min(i, 32));
  write(path.join(f.root, "report.json"), report);
  const flags = ["--scenario", "machinefall-world-capture", "--world", "Machinefall"];
  // The defaults must not silently accept another game's capture.
  expect(run(f.root).status).toBe(2);
  const result = run(f.root, ...flags);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const manifest = read(path.join(f.root, "world-capture.json"));
  expect(manifest.world).toBe("Machinefall");
  expect(manifest.route).toBe("machinefall-world-capture");
  expect(manifest.walk).toHaveLength(33);
  expect(manifest.samePose.map((frame: { id: string }) => frame.id)).toEqual([
    labels[0],
    labels[8],
    labels[16],
    labels[24],
  ]);
});

it("rejects another game's capture whose walk never moves", async () => {
  const f = await fixture();
  const report = asOtherWorld(read(path.join(f.root, "report.json")), () => 5);
  write(path.join(f.root, "report.json"), report);
  const result = run(f.root, "--scenario", "machinefall-world-capture", "--world", "Machinefall");
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Machinefall route never moved");
});
