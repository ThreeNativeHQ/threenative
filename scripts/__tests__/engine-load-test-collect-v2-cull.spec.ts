import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  CULL_PROBE_INDICES,
  CULL_RNG_SEED,
  CULL_UPSTREAM_COMMIT,
  type ICullFixture,
  type ICullTopology,
  cullMeshBufferBytes,
  cullMeshChannels,
  cullProbe,
  cullVariant,
  parseCullFixture,
} from "../../examples/engine-load-test/src/cull-fixture.js";
import { makeTempDir, makeTempDirSyncAt } from "../../test-support/temp-dir.js";
import { type ICullIntake, collectCullPair } from "../engine-load-test/collect-v2-cull.js";
import { buildDraftPlan } from "../engine-load-test/plan.js";
import { readResultRecord } from "../engine-load-test/report-v2.js";

const execFileAsync = promisify(execFile);

/**
 * PRD-449's v2 intake for an archived `godot-culling.basic_cull` pair, in the shape the real archived
 * pair has: 600 measured frames over 120 warmup, a 601-boundary `rawSeries` on both arms, the Godot
 * adapter exposing its driver as an array while the counterpart arm's is one string, the Godot arm's
 * occlusion culling disabled in a staged project, its `warmupMs` still a start clock beside the
 * `warmupDurationMs` the fixed adapter adds, and one adapter script, one Godot binary and two
 * counterpart build components under content-addressed archives.
 *
 * The fixture is synthetic — 10,000 placements and five real primitive buffers the fixture's own
 * reader decodes and checks — so the pair is built here rather than carried, and the probes come from
 * the fixture's own closed-form oracle, so the two arms are not asserting agreement by hand. No GPU is
 * involved and none is claimed: these are trust-boundary tests, and every check refuses evidence
 * rather than repairing it.
 */

const repoRoot = path.resolve(import.meta.dirname, "../..");
const MEASURED = 600;
const WARMUP = 120;
const DIGEST = "a".repeat(64);
const TN_COMMIT = "3a11562799ab5a885a91052f9e91629ee9d70366";
const OCCLUSION_OFF = "occlusion_culling/use_occlusion_culling=false";
const KINDS = ["BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh", "PrismMesh"] as const;
/** The real pair's two arms' own clocks: fractional monotonic boundaries and a final drain past the
 *  last one, which is what completed work is defined over. */
const CLOCK = {
  godot: { first: 2065.905, last: 2995.753, final: 2995.784 },
  tn: { first: 3271.664768, last: 13446.936477, final: 13450.644973 },
};
const GPU = "NVIDIA GeForce RTX 2080";
/** Godot's `driverInfo` array against the counterpart's description string: the same driver, one side
 *  also reporting a Windows sub-version. */
const DRIVER_GODOT = ["nvidia", "615.71.09"];
const DRIVER_TN = "NVIDIA: 615.71.09 615.71.9.0";
const GODOT_BINARY = "godot export template binary";
const TN_HOST = "tn native host binary";
const TN_BUNDLE = "tn production bundle bytes";
const ADAPTER_SCRIPT = "// the pinned adapter arm, as an archived source file\n";
const COVERED = 0.0878086419753086;
const STATE_FRAMES = [0, 300, 599];
/** The Godot arm's `warmupMs` in the raw shape that predates timing the phase: the clock reading
 *  taken when the warmup began, so a value no elapsed time can equal. */
const WARMUP_CLOCK = 24517.881;

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const measure = (clock: { final: number; first: number }): number => clock.final - clock.first;

/** One primitive's four channels, its counts, and the digest `cullMeshBufferBytes` lays down. */
function primitive(kind: string, vertices: number): ICullTopology {
  const positions = new Float32Array(vertices * 3);
  for (let index = 0; index < vertices; index += 1) {
    positions[index * 3] = index / 3;
    positions[index * 3 + 1] = index / 7;
    positions[index * 3 + 2] = -(index / 5);
  }
  const normals = new Float32Array(vertices * 3).fill(1 / Math.sqrt(3));
  const uvs = new Float32Array(vertices * 2);
  for (let index = 0; index < vertices; index += 1) uvs[index * 2] = index / vertices;
  const indices = new Uint32Array((vertices / 3) * 3);
  for (let index = 0; index < indices.length; index += 1) indices[index] = index % vertices;
  const channels = { indices, normals, positions, uvs };
  const raw = (view: Float32Array | Uint32Array): string =>
    Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("base64");
  const topology: ICullTopology = {
    aabb: { min: [0, 0, 0], size: [1, 1, 1] },
    albedo: [0, 0, 0],
    bufferSha256: sha256(
      cullMeshBufferBytes({ indices: indices.length, kind, vertices }, channels),
    ),
    buffers: {
      indices: raw(indices),
      normals: raw(normals),
      positions: raw(positions),
      uvs: raw(uvs),
    },
    indices: indices.length,
    kind,
    triangles: indices.length / 3,
    vertices,
  };
  // The fixture's own reader accepts the buffer, so a refusal later cannot be a length or range check
  // standing in for the identity check.
  cullMeshChannels(topology);
  return topology;
}

const MESHES = KINDS.map((kind, index) => primitive(kind, 24 + index * 3));

/** The exporting arm's fixture document: 10,000 authored placements and five real buffers. */
function fixtureText(): string {
  return `${JSON.stringify({
    camera: { far: 200, fovDegrees: 75, lookAt: [0, 0, 0], near: 0.05, position: [0, 0, 0] },
    cullingSha256: DIGEST,
    directional: { positionX: null, present: false, rotation: null, shadow: null },
    environment: {
      ambientSource: "sky",
      backgroundMode: "sky",
      clearColor: "0,0,0,1",
      groundBottom: [0.1, 0.1, 0.08],
      groundHorizon: [0.35, 0.35, 0.32],
      skyHorizon: [0.6, 0.7, 0.9],
      skyTop: [0.25, 0.45, 0.85],
    },
    lights: {
      instances: 0,
      omni: 0,
      omniShadowMode: null,
      placements: [],
      range: null,
      spot: 0,
    },
    meshes: MESHES,
    objects: 10000,
    placements: Array.from({ length: 10000 }, (_unused, index) => [
      ((index % 25) - 12) * 1.5,
      Math.floor(index / 25) * 0.5,
      ((Math.floor(index / 625) % 4) - 2) * 12,
    ]),
    rngSeed: CULL_RNG_SEED,
    schemaVersion: 2,
    sourceCommit: CULL_UPSTREAM_COMMIT,
    viewport: { height: 1080, width: 1920 },
  })}\n`;
}

/** The pair's shared state samples, from the fixture's own closed-form oracle rather than by hand. */
function states(fixture: ICullFixture): unknown[] {
  return STATE_FRAMES.map((frameId) => ({
    frameId,
    probes: CULL_PROBE_INDICES.map((index) => {
      const probe = cullProbe(fixture, cullVariant("basic_cull"), index, frameId);
      return { axisX: probe.axisX, index, origin: probe.origin };
    }),
    timeAccum: (frameId + 1) * (1 / 60) * 4,
  }));
}

function captures(): unknown[] {
  return [null, 0, 0].map((changedPixels, frameId) => ({
    backgroundLuma: 0,
    changedPixels,
    coveredFraction: COVERED,
    frameId,
    meanLuma: 0.0689,
    name: "frame",
    scored: true,
  }));
}

/** The retained frame boundaries and the final completion observation, as both real records kept them. */
function rawSeries(clock: { final: number; first: number; last: number }): Record<string, unknown> {
  const step = (clock.last - clock.first) / MEASURED;
  return {
    boundaries: Array.from({ length: MEASURED + 1 }, (_unused, index) => ({
      frameId: index,
      monotonicMs: clock.first + step * index,
    })),
    finalCompletionMs: clock.final,
    schemaVersion: 1,
    unit: "ms",
  };
}

/** The two arms' identical rendered census, so the comparator's conformance is a real agreement. */
function topology(arm: "godot" | "tn"): unknown[] {
  return MESHES.map((mesh) => ({
    albedo: mesh.albedo,
    bufferSha256: mesh.bufferSha256,
    kind: mesh.kind,
    ...(arm === "godot"
      ? { indices: mesh.indices, triangles: mesh.triangles, vertices: mesh.vertices }
      : {
          tnIndices: mesh.indices,
          tnTriangles: mesh.triangles,
          tnVertices: mesh.vertices,
        }),
  }));
}

interface IWorld {
  bundle: string;
  fixturePath: string;
  input: ICullIntake;
  projectPath: string;
  root: string;
}

/** A complete little campaign: draft plan, fixture bytes, both raw records and every archived build. */
async function writeWorld(root?: string): Promise<IWorld> {
  const base = root ?? (await makeTempDir("tn-collect-v2-cull-"));
  // Refs inside the archived records resolve against the intake root: the temporary root in the unit
  // cases, the repository root when the CLI's own route is driven, which takes a tree under it.
  const subtree = root === undefined ? "" : path.relative(repoRoot, base);
  const bundle = path.join(base, "bundle");
  const artifacts = path.join(base, "artifacts");
  const buildDir = path.join(artifacts, "builds");
  await mkdir(buildDir, { recursive: true });
  await mkdir(path.join(base, "benchmark", "godot-prd449"), { recursive: true });
  await mkdir(path.join(artifacts, "sources", "godot-benchmarks-cull-off"), { recursive: true });
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, "plan.json"), `${JSON.stringify(buildDraftPlan(), null, 2)}\n`);

  const adapterPath = path.join(base, "benchmark", "godot-prd449", "culling_arm.gd");
  await writeFile(adapterPath, ADAPTER_SCRIPT);
  // The staged project whose bytes disable occlusion culling, and whose digest the record names.
  const projectText = `[application]\nconfig/name="godot-benchmarks"\n[rendering]\n${OCCLUSION_OFF}\n`;
  const projectPath = path.join(artifacts, "sources", "godot-benchmarks-cull-off", "project.godot");
  await writeFile(projectPath, projectText);

  const archive = async (bytes: string, original: string) => {
    const digest = sha256(bytes);
    await writeFile(path.join(buildDir, digest), bytes);
    return {
      archived: path.join(subtree, "artifacts", "builds", digest),
      bytes: Buffer.byteLength(bytes),
      path: original,
      sha256: digest,
    };
  };

  const text = fixtureText();
  const fixturePath = path.join(artifacts, "cull-fixture.json");
  await writeFile(fixturePath, text);
  const fixtureHash = sha256(text);
  const fixture = parseCullFixture(text);
  const fixtureRef = path.join(subtree, "artifacts", "cull-fixture.json");
  const godotClock = CLOCK.godot;
  const tnClock = CLOCK.tn;
  const arms = {
    godot: {
      adapter: {
        apiVersion: "1.4.351",
        driverInfo: DRIVER_GODOT,
        msaa3D: 0,
        name: GPU,
        occlusionCulling: false,
        renderingDriver: "vulkan",
        renderingMethod: "forward_plus",
        type: "hardware",
        vsync: 0,
      },
      arm: "godot-desktop",
      authoring: "rendering-server-rid",
      authoringNote:
        "upstream culling.gd creates 10,000 low-level RenderingServer instance RIDs, not one Node3D per rendered object, so this is a renderer-server workload",
      captures: captures(),
      drain: "measurement-boundary-completion",
      dynamic: { enabled: false, frameDelta: 1 / 60, rotate: false, rids: 10000, target: "none" },
      engine: { version: "4.7.1.stable" },
      family: "godot-culling",
      fixture: {
        hash: fixtureHash,
        objects: 10000,
        path: fixturePath,
        rngSeed: CULL_RNG_SEED,
        schemaVersion: 2,
        viewport: { height: 1080, width: 1920 },
      },
      frameIntervalMs: Array.from(
        { length: MEASURED },
        (_unused, index) => measure(godotClock) / MEASURED + index * 0.0001,
      ),
      frames: MEASURED,
      lights: {
        directional: 0,
        omni: 0,
        omniShadowMode: null,
        requested: 0,
        shadowed: false,
        spot: 0,
      },
      meanMs: measure(godotClock) / MEASURED,
      profile: "smoke",
      rawSeries: rawSeries(godotClock),
      states: states(fixture),
      topology: topology("godot"),
      unshaded: true,
      variant: "basic_cull",
      viewport: { height: 1080, width: 1920 },
      warmupDurationMs: 1548.729,
      warmupFrames: WARMUP,
      // The clock reading an older raw published under this name, before the adapter timed the phase:
      // an absolute value that must never reach the record as a duration.
      warmupMs: WARMUP_CLOCK,
      work: { drawCalls: 71, frameId: 300, objectsInFrame: 3549, videoMemUsed: 175979904 },
    },
    tn: {
      adapter: {
        architecture: "turing",
        description: DRIVER_TN,
        device: GPU,
        vendor: "nvidia",
      },
      arm: "tn-desktop",
      authoring: "scene-node-independent",
      captures: captures(),
      dynamic: { enabled: false, frameDelta: 1 / 60, rotate: false, rids: 0, target: "none" },
      family: "godot-culling",
      fixture: {
        hash: fixtureHash,
        objects: 10000,
        sourceCommit: CULL_UPSTREAM_COMMIT,
        viewport: { height: 1080, width: 1920 },
      },
      lights: {
        directional: 0,
        omni: 0,
        omniShadowMode: null,
        requested: 0,
        shadowed: false,
        spot: 0,
      },
      meanMs: measure(tnClock) / MEASURED,
      presentMode: "immediate",
      profile: "smoke",
      rawSeries: rawSeries(tnClock),
      states: states(fixture),
      threeRevision: "185",
      topology: topology("tn"),
      unshaded: true,
      variant: "basic_cull",
      viewport: { height: 1080, width: 1920 },
      warmupFrames: WARMUP,
      warmupMs: 2759.501771,
    },
  } satisfies Record<string, Record<string, unknown>>;

  // Each arm's identity, with the archived bytes its record names and the staged project re-hashed.
  (arms.godot as Record<string, unknown>).identity = {
    build: { godotBinary: await archive(GODOT_BINARY, "../../../.local/bin/godot") },
    display: ":0",
    fixture: fixtureRef,
    source: {
      adapter: {
        path: path.join(subtree, "benchmark", "godot-prd449", "culling_arm.gd"),
        sha256: sha256(ADAPTER_SCRIPT),
      },
      commit: CULL_UPSTREAM_COMMIT,
      fixture: fixtureRef,
      occlusionCulling: {
        applied: OCCLUSION_OFF,
        effective: false,
        projectSha256: sha256(projectText),
        staged: path.join(subtree, "artifacts", "sources", "godot-benchmarks-cull-off"),
        upstreamProjectSha256: DIGEST,
      },
    },
  };
  (arms.tn as Record<string, unknown>).identity = {
    build: {
      nativeHost: await archive(TN_HOST, "packages/runtime-native/build/tn-linux/mystral"),
      tnBundle: await archive(
        TN_BUNDLE,
        "examples/engine-load-test/dist/engine-load-test-cull-desktop.js",
      ),
    },
    display: ":0",
    fixture: fixtureRef,
    source: {
      commit: CULL_UPSTREAM_COMMIT,
      fixture: fixtureRef,
      tn: { commit: TN_COMMIT, dirty: false },
    },
  };

  for (const [name, record] of Object.entries(arms))
    await writeFile(path.join(artifacts, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return {
    bundle,
    fixturePath,
    input: {
      block: 1,
      bundleDir: bundle,
      firstArm: "godot-desktop",
      godotRaw: path.join(artifacts, "godot.json"),
      machine: { id: "bench-box", os: "linux" },
      root: base,
      session: 1,
      tnRaw: path.join(artifacts, "tn.json"),
    },
    projectPath,
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
  arm: "godot" | "tn",
  change: (raw: Record<string, unknown>) => void,
): Promise<void> {
  const target = path.join(world.root, "artifacts", `${arm}.json`);
  const raw = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
  change(raw);
  await writeFile(target, `${JSON.stringify(raw, null, 2)}\n`);
}

describe("v2 intake for an archived godot-culling pair", () => {
  it("writes two immutable schema-2 records from the real pair's shape, and keeps the occlusion-off adaptation as a verified reason", async () => {
    const world = await writeWorld();
    const result = await collectCullPair(world.input);
    expect(result.cell).toBe("godot-culling.basic_cull.10000.default.common");
    expect(result.comparability).toBe("qualified");
    expect(result.partial).toBe(true);
    const godotId = result.runIds.find((id) => id.startsWith("godot-desktop")) as string;
    const tnId = result.runIds.find((id) => id.startsWith("tn-desktop")) as string;
    expect(godotId).toMatch(/^godot-desktop-cull-[0-9a-f]{64}$/u);
    const godot = await readRun(world.bundle, godotId);
    const tn = await readRun(world.bundle, tnId);
    // Arm order is the operator's declaration, and the plan's arm array runs the other way for this
    // cell — so reading order off the plan would put tn-desktop first and be contradicted here.
    expect(godot.order).toBe(0);
    expect(tn.order).toBe(1);
    expect(tn.arm.flags.executionOrderBasis).toMatch(
      /operator-declared legacy smoke order: the operator states godot-desktop ran first/u,
    );
    expect(godot.arm.engine).toBe("godot");
    expect(godot.arm.version).toBe("4.7.1.stable");
    expect(godot.arm.backend).toBe("vulkan");
    // The counterpart arm names no engine version and no backend, and none is borrowed from Godot.
    expect(tn.arm.version).toBe("unrecorded");
    expect(tn.arm.backend).toBe("unrecorded");
    expect(tn.arm.flags.unrecordedBasis).toMatch(/borrowed from the counterpart arm/u);
    // Neither arm names a build type, so neither is `release`; the profile flag says none was recorded.
    expect(godot.arm.build.type).toBe("unknown");
    expect(tn.arm.build.type).toBe("unknown");
    expect(tn.arm.flags.buildProfile).toBe("not recorded");
    for (const run of [godot, tn]) {
      // Qualified and still not publication-valid: the two questions stay separate.
      expect(run.comparability).toBe("qualified");
      expect(run.outcome.runStatus).toBe("invalid");
      expect(run.outcome.reason).toMatch(/preflight/iu);
      expect(run.machine.preflight.passed).toBe(false);
      expect(run.machine.preflight.reason).toMatch(/thermal/iu);
      expect(run.machine.gpu).toBe(GPU);
      expect(run.machine.lane).toBe("physical-hardware");
      expect(run.timing.measuredFrames).toBe(MEASURED);
      expect(run.timing.warmupFrames).toBe(WARMUP);
      expect(run.timing.rawSeries).not.toBeNull();
      expect(run.fixture.conformance).toBe("pass");
      expect(run.fixture.hash).toBe(sha256(fixtureText()));
      // The primary metric is the real completed work over the retained boundaries, not a mean the
      // record states on its own: 601 boundaries and a final drain past the last one.
      expect(run.durationMs.measure).toBe(
        run.arm.id === "godot-desktop" ? measure(CLOCK.godot) : measure(CLOCK.tn),
      );
      expect(run.metrics.find((metric) => metric.name === "completed-work-mean-ms")?.value).toBe(
        run.durationMs.measure / MEASURED,
      );
      expect(run.metrics.find((metric) => metric.name === "gpu-ms")).toMatchObject({
        reason: expect.stringMatching(/GPU timestamp/iu),
        value: null,
      });
      expect(run.arm.flags.sourceHashScope).toMatch(/identity\.source/u);
      expect(run.planHash).toBe(
        sha256(await readFile(path.join(world.bundle, "plan.json"), "utf8")),
      );
      expect(run.campaignHash).toBe(result.campaignHash);
      // A real timed warmup phase, so it is a number with no "not recorded" beside it.
      expect(run.durationMs.warmup).toBe(run.arm.id === "godot-desktop" ? 1548.729 : 2759.501771);
      expect(run.durationMs.warmupReason).toBeNull();
      expect(run.durationMs.startup).toBeNull();
      expect(run.durationMs.startupReason).toMatch(/no separate startup phase/u);
    }
    // The Godot arm publishes an absolute warmup start clock under `warmupMs`, so the record's warmup
    // came from the field that means a duration and never from the one that looks like a timed phase.
    expect(godot.durationMs.warmup).not.toBe(WARMUP_CLOCK);
    // The driver match is version-based, because one arm publishes an array and the other a string.
    expect(godot.arm.flags.adapterDriver).toBe(DRIVER_GODOT.join(" "));
    expect(tn.arm.flags.adapterDriver).toBe(DRIVER_TN);
    // The family keeps its two qualifications, and the occlusion-off adaptation with them: named
    // rather than left for a reader to infer from a ratio.
    expect(godot.comparabilityReason).toMatch(/RenderingServer instance RIDs/u);
    expect(godot.comparabilityReason).toMatch(/shaded environments differ/u);
    expect(godot.comparabilityReason).toMatch(/occlusion culling was explicitly turned off/u);
    const occlusion = JSON.parse(godot.arm.flags.occlusionCulling as string) as Record<
      string,
      unknown
    >;
    expect(occlusion).toMatchObject({ applied: OCCLUSION_OFF, effective: false });
    expect(occlusion.verifiedStagedProject).toMatch(/re-hashed here/u);
    // The counterpart renderer has no occlusion culling to disable, and no field that would confirm
    // or deny it — stated as unobserved rather than asserted off.
    expect(tn.arm.flags.occlusionCulling).toMatch(/no occlusion-culling field/u);
    // The exact archived build bytes, and a digest a reader can recompute from the disclosed parts.
    expect(godot.arm.build.hash).toBe(sha256(GODOT_BINARY));
    expect(godot.arm.flags.buildComponents).toBe(
      `godotBinary=${sha256(GODOT_BINARY)}:${GODOT_BINARY.length}`,
    );
    expect(tn.arm.flags.buildComponents).toBe(
      `nativeHost=${sha256(TN_HOST)}:${TN_HOST.length},tnBundle=${sha256(TN_BUNDLE)}:${TN_BUNDLE.length}`,
    );
    expect(tn.arm.build.hash).not.toBe(sha256(TN_BUNDLE));
    expect(tn.arm.flags.buildHashDefinition).toMatch(/name=sha256:byteCount/u);
    expect(godot.arm.flags.buildHashDefinition).toBeUndefined();
    // The present mode is what the comparator's cadence rule turns on: recorded where the host
    // published one, and named as unstated where it did not.
    expect(tn.arm.flags.presentMode).toBe("immediate");
    expect(godot.arm.flags.presentMode).toMatch(/not recorded by this arm/u);
    // The imported evidence: both raw records, both series, the fixture and the rerun comparison.
    const checksums = godot.checksums as Record<string, string>;
    const comparisonRef = `evidence/cull-comparison-${Object.keys(checksums)
      .find((ref) => ref.startsWith("evidence/cull-comparison-"))
      ?.split("-")
      .pop()}`;
    expect(Object.keys(checksums).sort()).toEqual(
      [
        comparisonRef,
        `evidence/cull-fixture-${sha256(fixtureText()).slice(0, 12)}.json`,
        `raw/${godotId}-run.json`,
        `raw/${godotId}-series.json`,
      ].sort(),
    );
    for (const [ref, digest] of Object.entries(checksums))
      expect(sha256(await readFile(path.join(world.bundle, ref)))).toBe(digest);
    const comparison = JSON.parse(
      await readFile(path.join(world.bundle, comparisonRef), "utf8"),
    ) as { outcome: { comparability: string; problems: string[] } };
    // The comparator really was rerun here, and it is the same qualified verdict the archived file holds.
    expect(comparison.outcome).toMatchObject({ comparability: "qualified", problems: [] });
    const html = await readFile(path.join(world.bundle, "report.html"), "utf8");
    expect(html).toContain("PARTIAL");
    expect(html).toContain(godotId);
    expect(html).toContain(tnId);
    // A second intake of the same evidence is the same immutable run, refused rather than rewritten.
    await expect(collectCullPair(world.input)).rejects.toThrow(/already holds run/u);
    await expect(collectCullPair({ ...world.input, block: 2 })).rejects.toThrow(
      /already holds run/u,
    );
  });

  it("records a Godot warmup as null with its reason when the raw predates timing the phase", async () => {
    // The archived pair this intake reads was recorded before the adapter timed its warmup, so its
    // `warmupMs` is the clock reading taken when the warmup began. Dropping the field the fixed
    // adapter added reproduces that raw exactly, and the clock is still there under the old name.
    const world = await writeWorld();
    await editRaw(world, "godot", (raw) => {
      // Absent from the serialised raw, which is the whole of an older record's difference.
      raw.warmupDurationMs = undefined;
    });
    const result = await collectCullPair(world.input);
    const godot = await readRun(
      world.bundle,
      result.runIds.find((id) => id.startsWith("godot-desktop")) as string,
    );
    const tn = await readRun(
      world.bundle,
      result.runIds.find((id) => id.startsWith("tn-desktop")) as string,
    );
    // Unverified is null with a reason, never the start clock wearing a duration's field name.
    expect(godot.durationMs.warmup).toBeNull();
    expect(godot.durationMs.warmupReason).toMatch(/start clock as `warmupMs`/u);
    // The counterpart arm measured its own warmup in the same pair, and that number is unaffected.
    expect(tn.durationMs.warmup).toBe(2759.501771);
    expect(tn.durationMs.warmupReason).toBeNull();
    // Nothing else about the pair moves: a missing duration is a null, not a refusal to import.
    expect(result.comparability).toBe("qualified");
    expect(result.partial).toBe(true);
    expect(godot.timing.rawSeries).not.toBeNull();
    expect(godot.durationMs.measure).toBe(measure(CLOCK.godot));
    expect(godot.timing.warmupFrames).toBe(WARMUP);
  });

  it("refuses a tampered archived build, a tampered staged Godot project and fixture bytes the counterpart did not read", async () => {
    // Each case starts from a fresh world, because a refused intake writes nothing and must not
    // leave a half-imported bundle behind for the next case to trip over.
    const built = await writeWorld();
    await writeFile(path.join(built.root, "artifacts", "builds", sha256(GODOT_BINARY)), "rebuilt");
    await expect(collectCullPair(built.input)).rejects.toThrow(/archived build/u);

    const staged = await writeWorld();
    await writeFile(staged.projectPath, "[rendering]\n");
    await expect(collectCullPair(staged.input)).rejects.toThrow(/staged Godot project/u);

    // The record keeps claiming occlusion-off, and the staged project is re-hashed so its digest
    // still matches — so only reading the bytes can catch that the line is gone.
    const relined = await writeWorld();
    const stripped = "[rendering]\n";
    await editRaw(relined, "godot", (raw) => {
      const source = (raw.identity as { source: Record<string, unknown> }).source;
      (source.occlusionCulling as Record<string, unknown>).projectSha256 = sha256(stripped);
    });
    await writeFile(relined.projectPath, stripped);
    await expect(collectCullPair(relined.input)).rejects.toThrow(/no longer sets/u);

    // A pair whose Godot arm left occlusion culling on is a different task, and is refused rather
    // than qualified.
    const effective = await writeWorld();
    await editRaw(effective, "godot", (raw) => {
      const source = (raw.identity as { source: Record<string, unknown> }).source;
      (source.occlusionCulling as Record<string, unknown>).effective = true;
    });
    await expect(collectCullPair(effective.input)).rejects.toThrow(
      /occlusion culling as effective/u,
    );

    const fixture = await writeWorld();
    // One sky colour component moved: still a fixture the reader accepts, and not the bytes either
    // arm recorded.
    await writeFile(fixture.fixturePath, fixtureText().replace('"skyTop":[0.25', '"skyTop":[0.35'));
    await expect(collectCullPair(fixture.input)).rejects.toThrow(/fixture hash/u);

    // A ref that walks out of the root is refused before the bytes are ever opened.
    const outside = await makeTempDir("tn-collect-v2-cull-outside-");
    const stray = path.join(outside, sha256(GODOT_BINARY));
    await writeFile(stray, GODOT_BINARY);
    const escaped = await writeWorld();
    const realRoot = await realpath(escaped.root);
    await mkdir(path.join(realRoot, "artifacts", "builds", "stray"), { recursive: true });
    await editRaw(escaped, "godot", (raw) => {
      const build = (raw.identity as { build: { godotBinary: { archived: string } } }).build;
      build.godotBinary.archived = path.relative(realRoot, stray);
    });
    await expect(collectCullPair(escaped.input)).rejects.toThrow(/outside the supplied root/u);
    await rm(outside, { recursive: true, force: true });
  });

  it("refuses a dirty checkout, another GPU, a driver mismatch and a non-qualified pair", async () => {
    const world = await writeWorld();
    const original = {
      godot: await readFile(path.join(world.root, "artifacts", "godot.json"), "utf8"),
      tn: await readFile(path.join(world.root, "artifacts", "tn.json"), "utf8"),
    };
    const mutate = async (
      arm: "godot" | "tn",
      change: (raw: Record<string, unknown>) => void,
      pattern: RegExp,
    ) => {
      const target = path.join(world.root, "artifacts", `${arm}.json`);
      const raw = JSON.parse(original[arm]) as Record<string, unknown>;
      change(raw);
      await writeFile(target, `${JSON.stringify(raw, null, 2)}\n`);
      await expect(collectCullPair(world.input)).rejects.toThrow(pattern);
      await writeFile(target, original[arm]);
    };
    await mutate(
      "tn",
      (raw) => {
        (raw.identity as { source: { tn: { dirty: boolean } } }).source.tn.dirty = true;
      },
      /dirty/u,
    );
    await mutate(
      "tn",
      (raw) => {
        (raw.adapter as { device: string }).device = "NVIDIA GeForce RTX 3060";
      },
      /different adapters/u,
    );
    await mutate(
      "godot",
      (raw) => {
        (raw.adapter as { driverInfo: string[] }).driverInfo = ["nvidia", "550.54.14"];
      },
      /different driver versions/u,
    );
    await mutate(
      "godot",
      (raw) => {
        (raw.adapter as { type: string }).type = "software";
        (raw.adapter as { name: string }).name = "llvmpipe";
      },
      /software adapter/u,
    );
    // One arm's own mesh buffer digest moved: the pair stops being the same work, so the comparator
    // withholds the ratio and this intake refuses rather than qualifying it.
    await mutate(
      "tn",
      (raw) => {
        const first = (raw.topology as { bufferSha256: string }[])[0] as { bufferSha256: string };
        first.bufferSha256 = DIGEST;
      },
      /did not qualify this pair/u,
    );
    await mutate(
      "tn",
      (raw) => {
        (raw.rawSeries as { boundaries: unknown[] }).boundaries.length = 300;
      },
      /only the 600-frame smoke schedule/u,
    );
    await mutate(
      "godot",
      (raw) => {
        (raw.identity as { source: { commit: string } }).source.commit = "0".repeat(40);
      },
      /rather than the pinned/u,
    );
    // Arm order is the operator's declaration, and never read from the plan's arm array.
    for (const firstArm of ["bevy-desktop", "", undefined, 3] as const)
      await expect(
        collectCullPair({ ...world.input, firstArm: firstArm as never }),
      ).rejects.toThrow(/firstArm/u);
  });
});

describe("the godot-culling v2 intake through its own CLI route", () => {
  const cli = path.join(repoRoot, "node_modules/.bin/tsx");
  const relative = (absolute: string) => path.relative(repoRoot, absolute);

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

  it("imports the pair into a real bundle, reports it partial and names no winner", async () => {
    const root = await makeTempDirSyncAt(
      path.join(repoRoot, "artifacts/engine-load-test/collect-v2-cull-cli-"),
    );
    const world = await writeWorld(root);
    const machine = path.join(world.bundle, "machine.json");
    await writeFile(
      machine,
      `${JSON.stringify(
        {
          cpu: "Test CPU 8",
          date: "2026-09-26",
          driver: "615.71.09",
          gpu: GPU,
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
      "--collect-cull-pair",
      relative(world.bundle),
      "--godot-run",
      relative(world.input.godotRaw),
      "--tn-run",
      relative(world.input.tnRaw),
      "--first-arm",
      "godot-desktop",
      "--block",
      "1",
      "--session",
      "1",
      "--machine-json",
      relative(machine),
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain(relative(world.bundle));
    expect(stdout).toContain("godot-culling.basic_cull.10000.default.common");
    expect(stdout).toMatch(/godot-desktop-cull-[0-9a-f]{64}/u);
    expect(stdout).toMatch(/tn-desktop-cull-[0-9a-f]{64}/u);
    expect(stdout).toContain("comparability qualified");
    expect(stdout).toContain("occlusion culling verified off");
    // Partial, so the exit code says so — and no verdict is printed with it.
    expect(stdout).toContain("PARTIAL");
    expect(stdout).toContain("no winner claimed");
    expect(stdout).not.toMatch(/faster|slower|winner is/iu);
    expect(code).toBe(2);
  });

  it("names every argument it needs instead of guessing one", async () => {
    const { code, stderr } = await capture(["--collect-cull-pair"]);
    expect(code).toBe(2);
    expect(stderr).toContain("TN_BENCH_V2_COLLECT_ARGS");
    expect(stderr).toContain("--godot-run");
    expect(stderr).toContain("--first-arm");
  });
});
