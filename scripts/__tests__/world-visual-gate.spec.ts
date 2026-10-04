import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { buildWorldVisualBundle, runCli, scoreWorldVisualBundle } from "../world-visual-gate.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const write = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

async function fixture() {
  const root = await makeTempDir("world-visual-gate-");
  roots.push(root);
  const png = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i / 4) % 256;
    png.data[i + 1] = (i / 2) % 256;
    png.data[i + 2] = 255 - ((i / 4) % 256);
    png.data[i + 3] = 255;
  }
  const image = PNG.sync.write(png);
  const manifests = ["reference", "candidate"].map((build) => {
    const directory = path.join(root, build);
    mkdirSync(directory);
    write(path.join(directory, "capture.json"), {
      adapter: { vendor: "nvidia", architecture: "turing", description: "NVIDIA RTX 2080" },
      browserArgs: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
      captureMethod: "page.screenshot",
      rendererKind: "webgpu",
      target: "web",
      viewport: { width: 16, height: 16 },
    });
    const frame = (id: string, x = 0) => {
      writeFileSync(path.join(directory, `${id}.png`), image);
      return { id, image: `${id}.png`, position: [x, 2, 0], target: [x, 0, 10] };
    };
    const manifest = {
      schemaVersion: 1,
      world: "test-world",
      build,
      route: "fixed-leg",
      seed: "42",
      nearBandMeters: 25,
      capture: "capture.json",
      landmarks: [{ id: "pine-1", position: [0, 0, 8] }],
      samePose: [frame("forest"), frame("road")],
      walk: [0, 1, 2].map((time) => ({ ...frame(`step-${time}`, time), timeMs: time * 100 })),
    };
    const file = path.join(directory, "world.json");
    write(file, manifest);
    return file;
  });
  return {
    root,
    before: manifests[0] as string,
    after: manifests[1] as string,
    out: path.join(root, "gate"),
  };
}

async function ready() {
  const f = await fixture();
  const built = buildWorldVisualBundle(f.before, f.after, f.out);
  return { ...f, built, bundle: read(path.join(built.bundle, "bundle.json")) };
}

// These are deliberately synthetic unit-test judgments, never real visual acceptance evidence.
function verdicts(f: Awaited<ReturnType<typeof ready>>) {
  return [1, 2, 3].map((critic) => {
    const file = path.join(f.root, `critic-${critic}.json`);
    write(file, {
      critic: `unit-test-${critic}`,
      bundleSha256: f.built.bundleSha256,
      promptSha256: f.bundle.promptSha256,
      samples: f.bundle.samePose.map(({ label }: { label: string }) => ({ label, visuals: 4 })),
      series: f.bundle.walk.map((series: { label: string; frames: { label: string }[] }) => ({
        label: series.label,
        transitions: series.frames.slice(1).map((frame, index) => ({
          from: series.frames[index]?.label,
          to: frame.label,
          events: [],
        })),
      })),
    });
    return file;
  });
}

it("blinds both arms, keeps every walk chronological, and binds the rubric and images", async () => {
  const f = await ready();
  expect(f.bundle.samePose).toHaveLength(6);
  expect(f.bundle.walk).toHaveLength(2);
  expect(
    f.bundle.walk.map((s: { frames: { timeMs: number }[] }) =>
      s.frames.map((frame) => frame.timeMs),
    ),
  ).toEqual([
    [0, 100, 200],
    [0, 100, 200],
  ]);
  expect(f.built.bundleSha256).toMatch(/^[a-f0-9]{64}$/);
  const publicManifest = JSON.stringify(f.bundle);
  for (const secret of ["reference", "candidate", "test-world", "forest", "road", "step-"])
    expect(publicManifest).not.toContain(secret);
  expect(scoreWorldVisualBundle(f.out, verdicts(f)).exitCode).toBe(0);
});

it("bundle-only is unjudged exit 2 and the score CLI distinguishes pass from regression", async () => {
  const f = await fixture();
  expect(runCli(["--before", f.before, "--after", f.after, "--out", f.out])).toBe(2);
  const bundle = read(path.join(f.out, "blind", "bundle.json"));
  const { createHash } = await import("node:crypto");
  const built = {
    bundle: path.join(f.out, "blind"),
    bundleSha256: createHash("sha256")
      .update(readFileSync(path.join(f.out, "blind", "bundle.json")))
      .digest("hex"),
  };
  const files = verdicts({ ...f, built, bundle });
  const args = ["--score", f.out, ...files.flatMap((file) => ["--verdict", file])];
  expect(runCli(args)).toBe(0);
  for (const file of files) {
    const value = read(file);
    for (const sample of value.samples) sample.visuals = 3;
    write(file, value);
  }
  expect(runCli(args)).toBe(1);
});

it("fails below the 4/5 candidate floor even when the paired delta is indeterminate", async () => {
  const f = await ready();
  const files = verdicts(f);
  for (const file of files) {
    const v = read(file);
    for (const sample of v.samples) sample.visuals = 3;
    write(file, v);
  }
  const result = scoreWorldVisualBundle(f.out, files);
  expect(result.samePose.rows.every((row) => row.classification === "INDETERMINATE")).toBe(true);
  expect(result.exitCode).toBe(1);
});

it("fails a measured same-pose LOSS even if the candidate still meets the floor", async () => {
  const f = await ready();
  const files = verdicts(f);
  const reveal = read(path.join(f.out, "poses", "reveal.json"));
  const baselineLabels = new Set(
    reveal
      .filter((entry: { arm: string }) => entry.arm.includes("::before"))
      .map((entry: { label: string }) => entry.label),
  );
  for (const file of files) {
    const v = read(file);
    for (const sample of v.samples) if (baselineLabels.has(sample.label)) sample.visuals = 5;
    write(file, v);
  }
  expect(
    scoreWorldVisualBundle(f.out, files).samePose.rows.every(
      (row) => row.classification === "LOSS",
    ),
  ).toBe(true);
  expect(scoreWorldVisualBundle(f.out, files).exitCode).toBe(1);
});

it.each(["appear", "disappear", "lod-swap"])(
  "fails a candidate near-band %s reported by even one critic",
  async (kind) => {
    const f = await ready();
    const files = verdicts(f);
    const v = read(files[0] as string);
    // Both anonymous arms get an event, so this assertion does not need to unblind them.
    for (const series of v.series)
      series.transitions[0].events.push({
        element: "pine beside the road",
        kind,
        distanceMeters: 25,
        description: "Abrupt change without occlusion or leaving the view.",
      });
    write(files[0] as string, v);
    const result = scoreWorldVisualBundle(f.out, files);
    expect(result.exitCode).toBe(1);
    expect(result.popping.some((event) => event.element === "pine beside the road")).toBe(true);
  },
);

it("reports far-band events without treating them as near-band failure", async () => {
  const f = await ready();
  const files = verdicts(f);
  const v = read(files[0] as string);
  for (const series of v.series)
    series.transitions[0].events.push({
      element: "distant pine",
      kind: "lod-swap",
      distanceMeters: 26,
      description: "Coarse silhouette changes.",
    });
  write(files[0] as string, v);
  expect(scoreWorldVisualBundle(f.out, files).exitCode).toBe(0);
});

it.each([
  "missing pose",
  "extra pose",
  "wrong pose",
  "wrong seed",
  "wrong route",
  "wrong near band",
  "reversed time",
  "stationary walk",
  "missing image",
  "blank image",
  "wrong viewport",
  "software adapter",
  "unnamed adapter",
  "missing capture",
  "invalid capture",
])("rejects %s before building", async (kind) => {
  const f = await fixture();
  const m = read(f.after);
  const captureFile = path.join(path.dirname(f.after), "capture.json");
  const capture = read(captureFile);
  const mutations: Record<string, () => void> = {
    "missing pose": () => m.samePose.pop(),
    "extra pose": () => m.samePose.push({ ...m.samePose[0], id: "extra" }),
    "wrong pose": () => {
      m.samePose[0].position[0] = 10;
    },
    "wrong seed": () => {
      m.seed = "other";
    },
    "wrong route": () => {
      m.route = "other";
    },
    "wrong near band": () => {
      m.nearBandMeters = 50;
    },
    "reversed time": () => m.walk.reverse(),
    "stationary walk": () => {
      for (const frame of m.walk) frame.position = [0, 2, 0];
    },
    "missing image": () => rmSync(path.join(path.dirname(f.after), m.walk[0].image)),
    "blank image": () =>
      writeFileSync(
        path.join(path.dirname(f.after), m.walk[0].image),
        PNG.sync.write(new PNG({ width: 16, height: 16 })),
      ),
    "wrong viewport": () => {
      capture.viewport.width = 20;
    },
    "software adapter": () => {
      capture.adapter.architecture = "swiftshader";
    },
    "unnamed adapter": () => {
      capture.adapter = {};
    },
    "invalid capture": () => {
      capture.rendererKind = "webgl";
    },
  };
  mutations[kind]?.();
  write(f.after, m);
  write(captureFile, capture);
  if (kind === "missing capture") rmSync(captureFile);
  expect(() => buildWorldVisualBundle(f.before, f.after, f.out)).toThrow();
});

it.each([
  "missing score",
  "extra score",
  "duplicate score",
  "missing transition",
  "extra transition",
  "duplicate transition",
  "reversed transition",
  "missing series",
  "invalid event",
  "stale hash",
  "stale rubric",
  "duplicate critic",
])("rejects %s instead of reporting a pass", async (kind) => {
  const f = await ready();
  const files = verdicts(f);
  const v = read(files[0] as string);
  if (kind === "missing score") v.samples.pop();
  if (kind === "extra score") v.samples.push({ label: "extra", visuals: 4 });
  if (kind === "duplicate score") v.samples.push(v.samples[0]);
  if (kind === "missing transition") v.series[0].transitions.pop();
  if (kind === "extra transition")
    v.series[0].transitions.push({ from: "other", to: "nope", events: [] });
  if (kind === "duplicate transition") v.series[0].transitions.push(v.series[0].transitions[0]);
  if (kind === "reversed transition") v.series[0].transitions.reverse();
  if (kind === "missing series") v.series.pop();
  if (kind === "invalid event")
    v.series[0].transitions[0].events.push({ element: "tree", kind: "maybe", distanceMeters: -1 });
  if (kind === "stale hash") v.bundleSha256 = "a".repeat(64);
  if (kind === "stale rubric") v.promptSha256 = "b".repeat(64);
  if (kind === "duplicate critic") v.critic = "unit-test-2";
  write(files[0] as string, v);
  expect(() => scoreWorldVisualBundle(f.out, files)).toThrow();
});

it("requires exactly three independent critic files, including realpath aliases", async () => {
  const f = await ready();
  const files = verdicts(f);
  expect(() => scoreWorldVisualBundle(f.out, files.slice(1))).toThrow();
  expect(() =>
    scoreWorldVisualBundle(f.out, [files[0] as string, files[0] as string, files[2] as string]),
  ).toThrow();
  const alias = path.join(f.root, "alias.json");
  symlinkSync(files[0] as string, alias);
  expect(() =>
    scoreWorldVisualBundle(f.out, [files[0] as string, alias, files[2] as string]),
  ).toThrow();
});

it.each(["source image", "source metadata", "blind image", "private reveal", "rubric"])(
  "rejects mutated %s after bundling",
  async (kind) => {
    const f = await ready();
    const files = verdicts(f);
    const file =
      kind === "source image"
        ? path.join(path.dirname(f.after), "forest.png")
        : kind === "source metadata"
          ? f.after
          : kind === "private reveal"
            ? path.join(f.out, "poses", "reveal.json")
            : kind === "rubric"
              ? path.join(f.built.bundle, "rubric.md")
              : path.join(f.built.bundle, f.bundle.samePose[0].image);
    writeFileSync(file, "changed");
    expect(() => scoreWorldVisualBundle(f.out, files)).toThrow();
  },
);

it("does not silently reuse a populated bundle directory", async () => {
  const f = await ready();
  expect(() => buildWorldVisualBundle(f.before, f.after, f.out)).toThrow();
});

it("maps scored pose rows back to the source IDs only after judging", async () => {
  const f = await ready();
  const result = scoreWorldVisualBundle(f.out, verdicts(f));
  expect(result.samePose.rows.map(({ template }) => template).sort()).toEqual(["forest", "road"]);
});

it("binds the external verdict files in the final score", async () => {
  const f = await ready();
  const files = verdicts(f);
  const result = scoreWorldVisualBundle(f.out, files);
  expect(result.verdicts).toHaveLength(3);
  expect(result.verdicts.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
});

it("removes a stale success report when subsequent scoring becomes invalid", async () => {
  const f = await ready();
  const files = verdicts(f);
  const args = ["--score", f.out, ...files.flatMap((file) => ["--verdict", file])];
  expect(runCli(args)).toBe(0);
  const scoreFile = path.join(f.out, "score.json");
  expect(read(scoreFile).verdict).toBe("pass");
  writeFileSync(files[0] as string, "invalid");
  expect(runCli(args)).toBe(2);
  expect(() => readFileSync(scoreFile)).toThrow();
});

it.each([
  {
    vendor: " unknown ",
    architecture: "",
    device: "unavailable",
    description: "none",
    features: "float32-filterable",
    "limit.maxBindGroups": "4",
  },
  { features: "float32-filterable", "limit.maxBindGroups": "4" },
])("does not mistake adapter feature/limit metadata for a hardware name", async (adapter) => {
  const f = await fixture();
  const captureFile = path.join(path.dirname(f.after), "capture.json");
  const capture = read(captureFile);
  capture.adapter = adapter;
  write(captureFile, capture);
  expect(() => buildWorldVisualBundle(f.before, f.after, f.out)).toThrow(/named hardware adapter/);
});

it.each(["near band", "walk coverage", "pose pixels"])(
  "rejects changed public %s even if critics rebind their verdicts",
  async (kind) => {
    const f = await ready();
    if (kind === "near band") f.bundle.nearBandMeters = 0;
    if (kind === "walk coverage") for (const series of f.bundle.walk) series.frames.pop();
    if (kind === "pose pixels") f.bundle.samePose[0].image = f.bundle.samePose[1].image;
    const bundleFile = path.join(f.built.bundle, "bundle.json");
    write(bundleFile, f.bundle);
    const { createHash } = await import("node:crypto");
    f.built.bundleSha256 = createHash("sha256").update(readFileSync(bundleFile)).digest("hex");
    expect(() => scoreWorldVisualBundle(f.out, verdicts(f))).toThrow();
  },
);
