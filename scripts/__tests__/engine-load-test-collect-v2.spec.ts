import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  type ICityFixture,
  cityCarDistance,
  cityCarLocalPosition,
  cityNodeWorldPosition,
  parseCityFixture,
} from "../../examples/engine-load-test/src/city-fixture.js";
import { makeTempDir, makeTempDirSyncAt } from "../../test-support/temp-dir.js";
import {
  type ICityIntake,
  collectCityPair,
  resolveMachineIdentity,
} from "../engine-load-test/collect-v2.js";
import { buildDraftPlan } from "../engine-load-test/plan.js";
import { readResultRecord } from "../engine-load-test/report-v2.js";

const execFileAsync = promisify(execFile);

/**
 * PRD-449's v2 intake for one archived `bevy-city` smoke pair. The fixture is the same three-node
 * slice the comparator's own spec uses — a root, a road carrying a car, and a mesh under the road —
 * so the oracle the comparator composes is the real one, with no GPU and no retained artifact.
 *
 * These are trust-boundary tests: every check here refuses evidence rather than repairing it, and the
 * happy path proves two immutable schema-2 records land in a real bundle.
 */

const UPSTREAM = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const DIGEST = "a".repeat(64);
/** The CLI route's own root, so the invocation case can resolve repo-relative refs. */
const repoRoot = path.resolve(import.meta.dirname, "../..");
const MEASURED = 600;
const WARMUP = 120;
const SETTLE = 8;
const AT_EXPORT = 12;
const AT_FIRST = AT_EXPORT + SETTLE + WARMUP;
const SPEED = 1.5;
const FRAME_MS = 20;
/** Raw monotonic clocks are fractional, so this whole world is timed the way a real one is. */
const FIRST_MS = 0.5;
const FINAL_MS = FIRST_MS + MEASURED * FRAME_MS + 0.375;
const MEASURE = FINAL_MS - FIRST_MS;
const STATE_FRAMES = [0, 1, 60, 120, 300, 599];
/** Both arms report the same adapter, in the two shapes the two engines expose it. */
const ADAPTER_BEVY = {
  backend: "Vulkan",
  deviceType: "DiscreteGpu",
  driver: "NVIDIA",
  driverInfo: "550.54.14",
  name: "Test GPU 9000",
};
const ADAPTER_TN = {
  architecture: "turing",
  description: "NVIDIA: 550.54.14 550.54.14",
  device: "Test GPU 9000",
  vendor: "nvidia",
};
const BEVY_BINARY = "bevy release binary";
const TN_BUNDLE = "tn production bundle";
const TN_HOST = "tn native host";
const ROAD = [
  ["0.75", "0.0", "0.0"],
  ["5.25", "0.0", "0.0"],
];

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

function mesh(vertices: number, triangles: number) {
  const floats = (values: number[]): string =>
    Buffer.from(new Float32Array(values).buffer).toString("base64");
  const positions: number[] = [];
  for (let index = 0; index < vertices; index += 1) positions.push(index, 0, 0);
  return {
    indexCount: triangles * 3,
    indices: Buffer.from(
      new Uint32Array(Array.from({ length: triangles * 3 }, (_unused, at) => at % vertices)).buffer,
    ).toString("base64"),
    normals: floats(new Array<number>(vertices * 3).fill(0)),
    positions: floats(positions),
    tangents: floats(new Array<number>(vertices * 4).fill(0)),
    triangles,
    uvs: floats(new Array<number>(vertices * 2).fill(0)),
    vertices,
  };
}

/** A one-pixel PNG, so the image bytes the fixture reader checks are real. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

/** The exporting arm's document: every field `parseCityFixture` requires, and nothing else. */
function rawFixtureText(seed = 42): string {
  const building = mesh(4, 2);
  const roadMesh = mesh(4, 2);
  return `${JSON.stringify({
    camera: {
      far: "1000.0",
      fovDegrees: "45.0",
      near: "0.1",
      position: ["15.0", "10.0", "20.0"],
      rotation: ["-0.17940316", "0.3105219", "0.059801053", "0.93156564"],
    },
    carFields: [
      "nodeIndex",
      "roadIndex",
      "dir",
      "distanceTraveled",
      "offset",
      "translation",
      "rotation",
      "scale",
    ],
    cars: [
      [
        2,
        0,
        "-1.0",
        "0.2",
        ["4.25", "0", "-0.15"],
        ["4.8", "0", "-0.15"],
        ["0", "0.70710677", "0", "-0.70710677"],
        ["0.15", "0.15", "0.15"],
      ],
    ],
    census: {
      cars: 1,
      groupNodes: 2,
      images: 1,
      materials: 1,
      meshNodes: 2,
      meshes: 2,
      nodes: 4,
      roads: 1,
      trianglesInCensus: 4,
    },
    environment: { background: "bevy-window-clear", shadowMapsEnabled: false },
    family: "bevy-city",
    frameSchedule: {
      carSpeedPerSecond: SPEED,
      frameDelta: 1 / 60,
      measuredFrames: MEASURED,
      settleFrames: SETTLE,
      simulateCarsAtExport: AT_EXPORT,
      stableTicksBeforeExport: SETTLE,
      warmupFrames: WARMUP,
    },
    images: [{ bytes: PNG, height: 1, path: "colormap.png", width: 1 }],
    light: {
      illuminanceLux: "130000.0",
      rotation: ["-0.0487909", "0.3821494", "0.020209853", "0.92259026"],
    },
    licenses: [
      { appliesTo: "kenney", license: "CC0-1.0", note: "separate from bevy's code license" },
    ],
    materials: [
      {
        alphaMode: "Opaque",
        baseColor: ["1.0", "1.0", "1.0", "1.0"],
        baseColorChannel: "0.0",
        baseColorTexture: 0,
        cullMode: "Some(Back)",
        emissive: ["0.0", "0.0", "0.0"],
        emissiveChannel: "0.0",
        emissiveExposureWeight: "0.0",
        emissiveTexture: null,
        metallic: "0.0",
        metallicRoughnessChannel: "0.0",
        metallicRoughnessTexture: null,
        normalChannel: "0.0",
        normalTexture: null,
        occlusionChannel: "0.0",
        occlusionTexture: null,
        perceptualRoughness: "0.5",
        reflectance: "0.5",
        specularTint: ["1.0", "1.0", "1.0", "1.0"],
        unlit: false,
      },
    ],
    meshes: [building, roadMesh],
    nodeFields: [
      "parent",
      "geometryId",
      "materialId",
      "translation",
      "rotation",
      "scale",
      "geometryAsset",
      "materialAsset",
    ],
    nodes: [
      [-1, null, null, ["0", "0", "0"], ["0", "0", "0", "1"], ["1", "1", "1"], null, null],
      [0, null, null, ["11", "0", "8"], ["0", "0", "0", "1"], ["1", "1", "1"], null, null],
      [
        1,
        0,
        0,
        ["4.8", "0", "-0.15"],
        ["0", "0.70710677", "0", "-0.70710677"],
        ["0.15", "0.15", "0.15"],
        "mesh:0",
        "material:0",
      ],
      [
        1,
        1,
        0,
        ["2.75", "0", "0"],
        ["0", "0", "0", "1"],
        ["4.5", "1", "1"],
        "mesh:1",
        "material:0",
      ],
    ],
    probeCars: [0],
    probeNodes: [3],
    profile: "common",
    roadFields: ["start", "end"],
    roads: [ROAD],
    schedule: "bevy-city-fractional-frame-boundary/1",
    schemaVersion: 1,
    seed,
    settings: {
      contactShadowsEnabled: true,
      cpuCulling: true,
      shadowMapsEnabled: true,
      simulateCars: true,
      wireframeEnabled: false,
    },
    size: 8,
    source: {
      adapterSha256: DIGEST,
      commit: UPSTREAM,
      patch: ["disclosed"],
      path: "examples/large_scenes/bevy_city",
      upstreamSha256: DIGEST,
    },
    variant: "moving",
    viewport: {
      deviation: null,
      height: 1050,
      requestedHeight: 1080,
      requestedWidth: 1920,
      scaleFactor: "1.0",
      width: 1920,
    },
  })}\n`;
}

/** One arm's own raw record, built from the fixture and nothing else. */
function rawRun(
  fixture: ICityFixture,
  arm: "bevy-desktop" | "tn-desktop",
  fixturePath: string,
  fixtureHash: string,
  build: Record<string, unknown>,
  adapter: Record<string, unknown>,
  fixtureRef: string,
): Record<string, unknown> {
  const parentIndex = fixture.nodes[fixture.cars[0]?.nodeIndex ?? 0]?.parent ?? -1;
  const parent = fixture.nodes[parentIndex]?.translation ?? [0, 0, 0];
  return {
    adapter,
    arm,
    ...(arm === "tn-desktop" ? { authoring: "default" } : {}),
    boundarySemantics: "render-producing frame boundary after update, submission and GPU wait",
    ...(arm === "bevy-desktop"
      ? { build: { features: "bevy default", profile: "release", type: "rust" } }
      : {}),
    census: fixture.census,
    drain: { boundaryFrame: MEASURED, includesUntimedFrames: 1 },
    ...(arm === "bevy-desktop" ? { engine: { name: "bevy", version: "0.19.0" } } : {}),
    family: "bevy-city",
    fixture: {
      ...(arm === "bevy-desktop" ? { path: fixturePath } : {}),
      hash: fixtureHash,
      nodes: fixture.census.nodes,
      sourceCommit: UPSTREAM,
    },
    frameSchedule: fixture.frameSchedule,
    identity: {
      authoring: "default",
      build,
      display: ":0",
      fixture: fixtureRef,
      profile: "smoke",
      source: {
        adapter: { path: "benchmark/bevy-prd449/city", sha256: DIGEST },
        bevy: { commit: UPSTREAM, sha256: DIGEST },
        tn: { commit: "b".repeat(40), dirty: false },
      },
    },
    ...(arm === "tn-desktop"
      ? {
          lightIntensityMapping:
            "bevy 130000 lux has no three equivalent; this arm uses intensity 3",
          threeRevision: "185",
        }
      : {}),
    meanMs: arm === "bevy-desktop" ? 20 : 15,
    profile: "smoke",
    rawSeries: {
      boundaries: Array.from({ length: MEASURED + 1 }, (_unused, index) => ({
        frameId: index,
        monotonicMs: FIRST_MS + index * FRAME_MS,
      })),
      finalCompletionMs: FINAL_MS,
      schemaVersion: 1,
      unit: "ms",
    },
    settings: fixture.settings,
    simulateCarsApplications: { atExport: AT_EXPORT, atFirstScoredFrame: AT_FIRST },
    states: STATE_FRAMES.map((frameId) => {
      const applications = AT_FIRST + frameId;
      const local = cityCarLocalPosition(fixture, 0, applications);
      return {
        camera: { rotation: fixture.camera.rotation, translation: fixture.camera.position },
        cars: [
          {
            distanceTraveled: cityCarDistance(fixture, 0, applications),
            index: 0,
            translation: [
              local.x + (parent[0] as number),
              local.y + (parent[1] as number),
              local.z + (parent[2] as number),
            ],
          },
        ],
        frameId,
        nodes: fixture.probeNodes.map((node) => {
          const world = cityNodeWorldPosition(fixture, node);
          return { index: node, translation: [world.x, world.y, world.z] };
        }),
        simulateCarsApplications: applications,
      };
    }),
    variant: fixture.variant,
    viewport: { height: fixture.viewport.height, width: fixture.viewport.width },
    // The counterpart arm also discarded the export settle frames, and records that it did.
    warmupFrames: arm === "tn-desktop" ? WARMUP + SETTLE : WARMUP,
    work:
      arm === "bevy-desktop"
        ? { admittedMeshNodes: null, submittedDrawCalls: null, submittedTriangles: null }
        : { admittedMeshNodes: null, submittedDrawCalls: 2, submittedTriangles: 4 },
  };
}

interface IWorld {
  bundle: string;
  fixturePath: string;
  input: ICityIntake;
  root: string;
}

/** A complete little campaign: draft plan, fixture bytes, both raw records and their build locks. */
async function writeWorld(root?: string): Promise<IWorld> {
  const base = root ?? (await makeTempDir("tn-collect-v2-"));
  // Refs inside the archived records resolve against the intake root: the temporary root in the unit
  // cases, the repository root when the CLI's own route is driven, which takes a tree under it.
  const subtree = root === undefined ? "" : path.relative(repoRoot, base);
  const bundle = path.join(base, "bundle");
  const artifacts = path.join(base, "artifacts");
  await mkdir(path.join(artifacts, "builds"), { recursive: true });
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, "plan.json"), `${JSON.stringify(buildDraftPlan(), null, 2)}\n`);
  const fixtureText = rawFixtureText();
  const fixturePath = path.join(artifacts, "city-fixture.json");
  await writeFile(fixturePath, fixtureText);
  const fixture = parseCityFixture(fixtureText);
  const archive = async (bytes: string, original: string) => {
    const digest = sha256(bytes);
    await writeFile(path.join(artifacts, "builds", digest), bytes);
    return {
      archived: path.join(subtree, "artifacts/builds", digest),
      bytes: Buffer.byteLength(bytes),
      path: original,
      sha256: digest,
    };
  };
  const fixtureHash = sha256(fixtureText);
  const fixtureRef = path.join(subtree, "artifacts/city-fixture.json");
  const arms = {
    bevy: rawRun(
      fixture,
      "bevy-desktop",
      fixturePath,
      fixtureHash,
      { bevyBinary: await archive(BEVY_BINARY, "sources/prd449_city") },
      ADAPTER_BEVY,
      fixtureRef,
    ),
    tn: rawRun(
      fixture,
      "tn-desktop",
      fixturePath,
      fixtureHash,
      {
        nativeHost: await archive(TN_HOST, "build/tn-linux/mystral"),
        tnBundle: await archive(TN_BUNDLE, "dist/city.js"),
      },
      ADAPTER_TN,
      fixtureRef,
    ),
  };
  for (const [name, record] of Object.entries(arms))
    await writeFile(path.join(artifacts, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return {
    bundle,
    fixturePath,
    input: {
      bevyRaw: path.join(artifacts, "bevy.json"),
      block: 1,
      bundleDir: bundle,
      firstArm: "bevy-desktop",
      machine: { id: "bench-box", os: "linux" },
      root: base,
      session: 1,
      tnRaw: path.join(artifacts, "tn.json"),
    },
    root: base,
  };
}

async function readRun(bundle: string, runId: string) {
  const parsed = readResultRecord(
    JSON.parse(await readFile(path.join(bundle, "runs", `${runId}.json`), "utf8")),
  );
  if (parsed.schemaVersion !== 2) throw new Error("expected a v2 record");
  return parsed.record;
}

/** Rewrites one archived record in place, the way an operator's hand-edit of raw would. */
async function editRaw(
  world: IWorld,
  arm: "bevy" | "tn",
  change: (raw: Record<string, unknown>) => void,
): Promise<void> {
  const target = path.join(world.input.root, "artifacts", `${arm}.json`);
  const raw = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
  change(raw);
  await writeFile(target, `${JSON.stringify(raw, null, 2)}\n`);
}

describe("v2 intake for an archived bevy-city pair", () => {
  it("writes two immutable schema-2 records and a visibly partial bundle", async () => {
    const world = await writeWorld();
    const result = await collectCityPair(world.input);
    expect(result.cell).toBe("bevy-city.small-moving.8.default.common");
    expect(result.comparability).toBe("qualified");
    expect(result.runIds).toHaveLength(2);
    expect(result.partial).toBe(true);
    const bevyId = result.runIds.find((id) => id.startsWith("bevy-desktop")) as string;
    const tnId = result.runIds.find((id) => id.startsWith("tn-desktop")) as string;
    expect(bevyId).toMatch(/^bevy-desktop-city-[0-9a-f]{64}$/u);
    const bevy = await readRun(world.bundle, bevyId);
    const tn = await readRun(world.bundle, tnId);
    // Arm order is the operator's declaration, and the plan's arm array runs the other way for this
    // cell — so reading order off the plan would put tn-desktop first and be contradicted here.
    expect(bevy.order).toBe(0);
    expect(tn.order).toBe(1);
    for (const run of [bevy, tn])
      expect(run.arm.flags.executionOrderBasis).toMatch(
        /operator-declared legacy smoke order: the operator states bevy-desktop ran first/u,
      );
    // Only the Bevy arm's record names a build profile. An absent one is unknown, never release, and
    // the profile flag beside it says none was recorded.
    expect(bevy.arm.build.type).toBe("release");
    expect(bevy.arm.flags.buildProfile).toBe("release");
    expect(tn.arm.build.type).toBe("unknown");
    expect(tn.arm.flags.buildProfile).toBe("not recorded");
    for (const run of [bevy, tn]) {
      // Comparable and still not publication-valid: the two questions stay separate.
      expect(run.comparability).toBe("qualified");
      expect(run.comparabilityReason).toContain("identical fixture bytes");
      expect(run.outcome.runStatus).toBe("invalid");
      expect(run.outcome.reason).toMatch(/preflight/iu);
      expect(run.machine.preflight.passed).toBe(false);
      expect(run.machine.preflight.reason).toMatch(/thermal/iu);
      expect(run.machine.gpu).toBe("Test GPU 9000");
      expect(run.machine.lane).toBe("physical-hardware");
      expect(run.timing.measuredFrames).toBe(MEASURED);
      expect(run.timing.rawSeries).not.toBeNull();
      expect(run.fixture.conformance).toBe("pass");
      expect(run.fixture.hash).toBe(sha256(rawFixtureText()));
      // Completed work is the final completion observation, and the record says which one.
      expect(run.durationMs.measure).toBe(MEASURE);
      expect(run.metrics.find((metric) => metric.name === "completed-work-mean-ms")?.value).toBe(
        MEASURE / MEASURED,
      );
      expect(run.durationMs.startup).toBeNull();
      expect(run.durationMs.warmup).toBeNull();
      expect(run.durationMs.warmupReason).toMatch(/warmup frames/u);
      // No GPU timestamp samples were retained, which is a null with a reason and never a zero.
      expect(run.metrics.find((metric) => metric.name === "gpu-ms")).toMatchObject({
        reason: expect.stringMatching(/GPU timestamp/iu),
        value: null,
      });
      // The limited source-hash scope is stated, not implied.
      expect(run.arm.flags.sourceHashScope).toMatch(/identity\.source/u);
      expect(run.sourceHash).toBe(
        sha256(
          JSON.stringify({
            adapter: { path: "benchmark/bevy-prd449/city", sha256: DIGEST },
            bevy: { commit: UPSTREAM, sha256: DIGEST },
            tn: { commit: "b".repeat(40), dirty: false },
          }),
        ),
      );
      expect(run.planHash).toBe(
        sha256(await readFile(path.join(world.bundle, "plan.json"), "utf8")),
      );
      expect(run.campaignHash).toBe(result.campaignHash);
    }
    // The exact archived build bytes, and a digest a reader can recompute from the disclosed parts.
    expect(bevy.arm.build.hash).toBe(sha256(BEVY_BINARY));
    expect(bevy.arm.version).toBe("0.19.0");
    // The component names are disclosed here; the definition flag beside it describes the method.
    expect(tn.arm.flags.buildComponents).toBe(
      `nativeHost=${sha256(TN_HOST)}:${TN_HOST.length},tnBundle=${sha256(TN_BUNDLE)}:${TN_BUNDLE.length}`,
    );
    expect(tn.arm.build.hash).not.toBe(sha256(TN_BUNDLE));
    expect(tn.arm.flags.buildHashDefinition).toMatch(/name=sha256:byteCount/u);
    expect(bevy.arm.flags.buildHashDefinition).toBeUndefined();
    expect(bevy.timing.warmupFrames).toBe(WARMUP);
    // The counterpart arm also discarded the settle frames, and states its own count against the
    // preregistered one rather than claiming 120.
    expect(tn.timing.warmupFrames).toBe(WARMUP + SETTLE);
    expect(tn.arm.flags.warmupFramesBasis).toContain(`${WARMUP + SETTLE} frames discarded`);
    const html = await readFile(path.join(world.bundle, "report.html"), "utf8");
    expect(html).toContain("PARTIAL");
    expect(html).toContain(bevyId);
    expect(html).toContain(tnId);
    const results = JSON.parse(await readFile(path.join(world.bundle, "results.json"), "utf8"));
    expect(results.runs).toHaveLength(2);
    expect(results.publicationGaps).toEqual(
      expect.arrayContaining(["sources.lock.json", "machine.json"]),
    );
    // A second intake of the same evidence is the same immutable run, refused rather than rewritten.
    await expect(collectCityPair(world.input)).rejects.toThrow(/already holds run/u);
    await expect(collectCityPair({ ...world.input, block: 2 })).rejects.toThrow(
      /already holds run/u,
    );
  });

  it("refuses an archived build whose bytes no longer match the recorded digest", async () => {
    const world = await writeWorld();
    await writeFile(
      path.join(path.dirname(world.fixturePath), "builds", sha256(BEVY_BINARY)),
      "rebuilt",
    );
    await expect(collectCityPair(world.input)).rejects.toThrow(/archived build/u);
  });

  it("refuses fixture bytes that are not the ones the counterpart arm read", async () => {
    const world = await writeWorld();
    await writeFile(world.fixturePath, rawFixtureText(43));
    await expect(collectCityPair(world.input)).rejects.toThrow(/fixture hash/u);
  });

  it("admits a legacy absolute ref inside the root and refuses every ref that leaves it", async () => {
    const outside = await makeTempDir("tn-collect-v2-outside-");
    const digest = sha256(BEVY_BINARY);
    const strayArchive = path.join(outside, digest);
    await writeFile(strayArchive, BEVY_BINARY);
    await writeFile(path.join(outside, "city-fixture.json"), rawFixtureText());

    /** One world whose bevy archive ref is `ref`, with a stray link planted inside the root. */
    const worldWithArchive = async (ref: (realRoot: string) => string): Promise<IWorld> => {
      const world = await writeWorld();
      const realRoot = await realpath(world.input.root);
      await mkdir(path.join(realRoot, "artifacts", "builds", "stray"), { recursive: true });
      await symlink(strayArchive, path.join(realRoot, "artifacts", "builds", "stray", digest));
      await editRaw(world, "bevy", (raw) => {
        const build = (raw.identity as { build: { bevyBinary: { archived: string } } }).build;
        build.bevyBinary.archived = ref(realRoot);
      });
      return world;
    };

    for (const wayOut of [
      // Absolute is a legacy shape, not a violation; landing outside the root is the violation.
      (realRoot: string) => path.join(outside, digest),
      (realRoot: string) => path.relative(realRoot, strayArchive),
      // The ref's own name sits at its content address; only where it points can refuse it.
      (realRoot: string) => `artifacts/builds/stray/${digest}`,
    ]) {
      const world = await worldWithArchive(wayOut);
      await expect(collectCityPair(world.input)).rejects.toThrow(/outside the supplied root/u);
    }

    // The same bytes named by the absolute path a legacy record really wrote, inside the root.
    const admitted = await worldWithArchive((realRoot) =>
      path.join(realRoot, "artifacts", "builds", digest),
    );
    expect((await collectCityPair(admitted.input)).runIds).toHaveLength(2);

    // The fixture is read, so its ref is contained the same way.
    const escapedFixture = await writeWorld();
    await editRaw(escapedFixture, "bevy", (raw) => {
      (raw.fixture as { path: string }).path = path.join(outside, "city-fixture.json");
    });
    await expect(collectCityPair(escapedFixture.input)).rejects.toThrow(
      /outside the supplied root/u,
    );
  });

  it("refuses a dirty checkout, another GPU, a software adapter and a short schedule", async () => {
    const world = await writeWorld();
    const original = {
      bevy: await readFile(path.join(world.input.root, "artifacts", "bevy.json"), "utf8"),
      tn: await readFile(path.join(world.input.root, "artifacts", "tn.json"), "utf8"),
    };
    const mutate = async (
      arm: "bevy" | "tn",
      change: (raw: Record<string, unknown>) => void,
      pattern: RegExp,
    ) => {
      const target = path.join(world.input.root, "artifacts", `${arm}.json`);
      const raw = JSON.parse(original[arm]) as Record<string, unknown>;
      change(raw);
      await writeFile(target, `${JSON.stringify(raw, null, 2)}\n`);
      await expect(collectCityPair(world.input)).rejects.toThrow(pattern);
      await writeFile(target, original[arm]);
    };
    await mutate(
      "tn",
      (raw) => {
        const identity = raw.identity as { source: { tn: { dirty: boolean } } };
        identity.source.tn.dirty = true;
      },
      /dirty/u,
    );
    await mutate(
      "tn",
      (raw) => {
        (raw.adapter as { device: string }).device = "Test GPU 8000";
      },
      /adapter/u,
    );
    await mutate(
      "bevy",
      (raw) => {
        (raw.adapter as { name: string }).name = "llvmpipe";
      },
      /software adapter/u,
    );
    await mutate(
      "tn",
      (raw) => {
        (raw.frameSchedule as { measuredFrames: number }).measuredFrames = 300;
      },
      /600/iu,
    );
    // A fractional clock is admitted above; a negative one still is not, and the comparator's own
    // non-negative reader is what sees this one.
    await mutate(
      "tn",
      (raw) => {
        (raw.rawSeries as { finalCompletionMs: number }).finalCompletionMs = -1;
      },
      /final completion/u,
    );
    await mutate(
      "bevy",
      (raw) => {
        raw.identity = undefined;
      },
      /identity/u,
    );
    await mutate(
      "bevy",
      (raw) => {
        const fixture = raw.fixture as { path: string };
        fixture.path = path.join(world.input.root, "artifacts", "other-city-fixture.json");
      },
      /fixture/u,
    );
  });

  it("refuses a bundle whose plan has no cell for the pair's own size and motion", async () => {
    const world = await writeWorld();
    const plan = buildDraftPlan();
    await writeFile(
      path.join(world.bundle, "plan.json"),
      `${JSON.stringify(
        { status: "draft", cells: plan.cells.filter((cell) => cell.family !== "bevy-city") },
        null,
        2,
      )}\n`,
    );
    await expect(collectCityPair(world.input)).rejects.toThrow(/0 bevy-city cells/u);
  });

  it("refuses any first arm but the two City arms, and never falls back to the plan's arm array", async () => {
    const world = await writeWorld();
    for (const firstArm of ["godot-desktop", "", undefined, 3] as const)
      await expect(
        collectCityPair({ ...world.input, firstArm: firstArm as never }),
      ).rejects.toThrow(/firstArm/u);
    // The plan lists tn-desktop ahead of bevy-desktop, so an intake that read order from it would
    // disagree with the declaration the operator is being asked to make.
    const cell = buildDraftPlan().cells.find(
      (entry) => entry.family === "bevy-city" && entry.id.includes("small-moving"),
    );
    expect(cell?.arms.indexOf("tn-desktop")).toBeLessThan(cell?.arms.indexOf("bevy-desktop") ?? 0);
    // The other declaration is equally admissible, and inverts the recorded order.
    const tnFirst = await writeWorld();
    const result = await collectCityPair({ ...tnFirst.input, firstArm: "tn-desktop" });
    const bevy = await readRun(
      tnFirst.bundle,
      result.runIds.find((id) => id.startsWith("bevy-desktop")) as string,
    );
    expect(bevy.order).toBe(1);
  });
});

describe("the v2 intake through its own CLI route", () => {
  const cli = path.join(repoRoot, "node_modules/.bin/tsx");
  const relative = (absolute: string) => path.relative(repoRoot, absolute);

  /** The route as an operator types it, with every path repo-relative like the real invocation. */
  const capture = async (
    args: string[],
  ): Promise<{ code: number; stderr: string; stdout: string }> => {
    try {
      const done = await execFileAsync(
        cli,
        [path.join(repoRoot, "scripts/engine-load-test/cli.ts"), ...args],
        { cwd: repoRoot },
      );
      return { code: 0, stderr: done.stderr, stdout: done.stdout };
    } catch (error) {
      const failed = error as { code?: number; stderr: string; stdout: string };
      return { code: failed.code ?? 1, stderr: failed.stderr, stdout: failed.stdout };
    }
  };

  it("imports an archived pair into a real bundle, reports it partial and names no winner", async () => {
    const root = await makeTempDirSyncAt(
      path.join(repoRoot, "artifacts/engine-load-test/collect-v2-cli-"),
    );
    const world = await writeWorld(root);
    await writeFile(
      path.join(world.bundle, "machine.json"),
      `${JSON.stringify(
        {
          cpu: "Test CPU 8",
          date: "2026-09-26",
          driver: "550.54.14",
          gpu: "Test GPU 9000",
          id: "bench-box",
          lane: "physical-hardware",
          os: "linux",
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
    );
    const { code, stderr, stdout } = await capture([
      "--collect-city-pair",
      relative(world.bundle),
      "--bevy-run",
      relative(world.input.bevyRaw),
      "--tn-run",
      relative(world.input.tnRaw),
      "--first-arm",
      "bevy-desktop",
      "--block",
      "1",
      "--session",
      "1",
      "--machine-json",
      relative(path.join(world.bundle, "machine.json")),
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain(relative(world.bundle));
    expect(stdout).toContain("bevy-city.small-moving.8.default.common");
    expect(stdout).toMatch(/bevy-desktop-city-[0-9a-f]{64}/u);
    expect(stdout).toMatch(/tn-desktop-city-[0-9a-f]{64}/u);
    // Partial, so the exit code says so — and no verdict is printed with it.
    expect(stdout).toContain("PARTIAL");
    expect(stdout).toContain("no winner claimed");
    expect(stdout).not.toMatch(/faster|slower|winner is/iu);
    expect(code).toBe(2);
    const runs = (await readdir(path.join(world.bundle, "runs"))).filter((name) =>
      name.endsWith(".json"),
    );
    expect(runs).toHaveLength(2);
    const bevy = await readRun(
      world.bundle,
      runs.find((name) => name.startsWith("bevy-desktop"))?.replace(/\.json$/u, "") as string,
    );
    const tn = await readRun(
      world.bundle,
      runs.find((name) => name.startsWith("tn-desktop"))?.replace(/\.json$/u, "") as string,
    );
    for (const run of [bevy, tn]) {
      expect(run.outcome.runStatus).toBe("invalid");
      expect(run.arm.flags.executionOrderBasis).toMatch(/operator-declared/u);
    }
    expect(bevy.order).toBe(0);
    expect(tn.order).toBe(1);
    expect(bevy.arm.build.type).toBe("release");
    expect(tn.arm.build.type).toBe("unknown");
  });

  it("names every argument it needs instead of guessing one", async () => {
    const { code, stderr } = await capture(["--collect-city-pair"]);
    expect(code).toBe(2);
    expect(stderr).toContain("TN_BENCH_V2_COLLECT_ARGS");
    expect(stderr).toContain("--first-arm");
  });
});

describe("machine identity for the v2 intake", () => {
  it("takes the id and OS from explicit arguments, and refuses to guess them", async () => {
    expect(await resolveMachineIdentity({ machineId: "bench-box", machineOs: "linux" })).toEqual({
      id: "bench-box",
      os: "linux",
    });
    await expect(resolveMachineIdentity({ machineId: "bench-box" })).rejects.toThrow(
      /machine identity/iu,
    );
    const world = await writeWorld();
    const file = path.join(world.input.root, "machine.json");
    await writeFile(file, `${JSON.stringify({ id: "bench-box" })}\n`);
    await expect(resolveMachineIdentity({ machineJson: file })).rejects.toThrow(
      /machine\.json\.os/u,
    );
    await writeFile(file, `${JSON.stringify({ id: "bench-box", os: "linux" })}\n`);
    expect(await resolveMachineIdentity({ machineJson: file })).toEqual({
      id: "bench-box",
      os: "linux",
    });
  });
});
