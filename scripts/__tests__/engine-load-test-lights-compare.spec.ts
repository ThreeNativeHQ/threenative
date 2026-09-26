import { describe, expect, it } from "vitest";
import {
  type ILightsFixture,
  LIGHTS_ACTUAL_LIGHTS,
  LIGHTS_ACTUAL_OBJECTS,
  LIGHTS_CELL,
  lightsAccum,
  lightsBase64,
  lightsCellAxisX,
  lightsCellWorld,
  lightsEnergy,
  lightsRotations,
  parseLightsFixture,
} from "../../examples/engine-load-test/src/lights-fixture.js";
import {
  type ILightsRun,
  compareLightsRuns,
  parseLightsRun,
} from "../engine-load-test/lights-compare.js";

/**
 * The `box-100-omni-10-slow` slice, proved without a GPU: the fixture reader fails closed, the
 * workload oracle reproduces the pinned hierarchy's transforms and light states from the exported
 * bytes, and the comparator refuses a pair for each of the reasons it names.
 */

const ADAPTER = { name: "NVIDIA GeForce RTX 2080", type: "hardware" };
const FIXTURE_HASH = "7aa2df6eeede5c73928a796f17212de3f13e5045e850d0f845a98f0038a8e621";
const BUFFER_SHA = "a5973433c03f81e43d9cd51f5c968b05c6d8e37016c99f3c206cbb70c4b732da";
const SEED = 0x60d07;
const FRAME_DELTA = 1 / 60;

/**
 * The cells the pinned source's `create_scattered` produced for this cell, as the Godot arm exported
 * them. They are this test's independent input: the oracle below is checked against hand-derived
 * numbers, not against a run, so a wrong formula is caught here rather than on a GPU minute.
 */
const MESH_CELL_0 = {
  position: [-0.892612636089325, -0.00556503422558308, -0.890316784381866],
  scale: [0.200000002980232, 1, 0.200000002980232],
} as const;
const LIGHT_CELL_0 = {
  position: [-0.660241961479187, -0.00346543174237013, -0.613115966320038],
  scale: [0.666666686534882, 1, 0.666666686534882],
} as const;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk =
      ((bytes[index] as number) << 16) |
      (((bytes[index + 1] as number) ?? 0) << 8) |
      ((bytes[index + 2] as number) ?? 0);
    out += BASE64_ALPHABET[(chunk >> 18) & 63];
    out += BASE64_ALPHABET[(chunk >> 12) & 63];
    out += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : "=";
  }
  return out;
}

/** A 24-vertex, 36-index box's four channels, sized to the counts the fixture declares. */
function boxChannels() {
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const uvs = new Float32Array(24 * 2);
  const indices = new Uint32Array(36);
  for (let index = 0; index < 36; index += 1) indices[index] = index % 24;
  const bytes = new Uint8Array(
    positions.byteLength + normals.byteLength + uvs.byteLength + indices.byteLength,
  );
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(normals.buffer), positions.byteLength);
  bytes.set(new Uint8Array(uvs.buffer), positions.byteLength + normals.byteLength);
  bytes.set(
    new Uint8Array(indices.buffer),
    positions.byteLength + normals.byteLength + uvs.byteLength,
  );
  return { bytes, indices, normals, positions, uvs };
}

function meshSource() {
  const channels = boxChannels();
  return {
    aabb: { min: [-0.5, -0.5, -0.5], size: [1, 1, 1] },
    bufferSha256: BUFFER_SHA,
    buffers: {
      indices: toBase64(new Uint8Array(channels.indices.buffer)),
      normals: toBase64(new Uint8Array(channels.normals.buffer)),
      positions: toBase64(new Uint8Array(channels.positions.buffer)),
      uvs: toBase64(new Uint8Array(channels.uvs.buffer)),
    },
    indices: 36,
    kind: "BoxMesh",
    triangles: 12,
    vertices: 24,
  };
}

function cell(position: readonly number[], scale: readonly number[]) {
  return { position, scale };
}

function meshGrid(): { position: readonly number[]; scale: readonly number[] }[] {
  return Array.from({ length: LIGHTS_ACTUAL_OBJECTS }, (_, index) =>
    index === 0
      ? cell(MESH_CELL_0.position, MESH_CELL_0.scale)
      : cell([0, -0.005, 0], [0.2, 1, 0.2]),
  );
}

function lightGrid(): { position: readonly number[]; scale: readonly number[] }[] {
  return Array.from({ length: LIGHTS_ACTUAL_LIGHTS }, (_, index) =>
    index === 0
      ? cell(LIGHT_CELL_0.position, LIGHT_CELL_0.scale)
      : cell([0.2, -0.02, 0.2], [2 / 3, 1, 2 / 3]),
  );
}

const ACCUM_SEEDS = [76.133143901825, 80.5, 84.25, 88, 91.75, 12.5, 40, 60, 93.6157882213593];

function fixtureSource(): Record<string, unknown> {
  return {
    camera: {
      basisX: [1, 0, 0],
      basisY: [0, 0.696706712245941, -0.717356085777283],
      basisZ: [0, 0.717356085777283, 0.696706712245941],
      far: 4000,
      fovDegrees: 75,
      near: 0.0500000007450581,
      position: [0, 0.300000011920929, 1],
    },
    cell: LIGHTS_CELL,
    environment: {
      ambientColor: [0, 0, 0],
      ambientEnergy: 1,
      ambientSource: "2",
      backgroundColor: [1, 1, 1],
      backgroundMode: "color",
    },
    lightGrid: { accumSeeds: ACCUM_SEEDS, cells: lightGrid(), rotaterSpeed: 0.1 },
    lights: {
      actual: LIGHTS_ACTUAL_LIGHTS,
      attenuation: 0.100000001490116,
      color: [1, 1, 1],
      kind: "omni",
      localPosition: [0, 0.00999999977648258, 0],
      openingEnergy: 5,
      range: 0.100000001490116,
      requested: 10,
      shadowEnabled: false,
    },
    meshGrid: { cells: meshGrid(), rotaterSpeed: -0.1 },
    meshModel: { position: [0, -0.025000000372529, 0], scale: [1, 0.0500000007450581, 1] },
    meshes: [meshSource()],
    rngSeed: SEED,
    schedule: {
      advanceOrder: "advance-then-render",
      energyScale: 5,
      frameDelta: FRAME_DELTA,
      lightSpeed: 1,
    },
    schemaVersion: 1,
    sourceCommit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
    viewport: { height: 1080, width: 1920 },
  };
}

function fixture(overrides: Record<string, unknown> = {}): ILightsFixture {
  return parseLightsFixture(JSON.stringify({ ...fixtureSource(), ...overrides }));
}

describe("the lights/meshes fixture reader", () => {
  it("carries the requested and actual counts of a squared generator", () => {
    const read = fixture();
    expect(read.lights.requested).toBe(10);
    expect(read.lights.actual).toBe(9);
    expect(read.meshGrid.cells).toHaveLength(100);
    expect(read.lightGrid.cells).toHaveLength(9);
  });

  it("refuses a fixture whose actual light count is not this cell's nine", () => {
    const source = fixtureSource();
    const lights = { ...(source.lights as Record<string, unknown>), actual: 10 };
    expect(() => fixture({ lights })).toThrow(/TN_BENCH_LIGHTS_FIXTURE_LIGHTS/);
  });

  it("refuses a fixture whose two grids turn the same way", () => {
    expect(() =>
      fixture({ lightGrid: { accumSeeds: ACCUM_SEEDS, cells: lightGrid(), rotaterSpeed: -0.1 } }),
    ).toThrow(/TN_BENCH_LIGHTS_FIXTURE_ROTATION_SENSE/);
  });

  it("refuses a mesh buffer whose decoded length contradicts its own count", () => {
    const mesh = meshSource();
    expect(() => fixture({ meshes: [{ ...mesh, vertices: 25 }] })).toThrow(
      /TN_BENCH_CULL_FIXTURE_BUFFERS/,
    );
  });

  it("refuses a buffer index past the vertex array rather than reading memory the mesh lacks", () => {
    const channels = boxChannels();
    channels.indices[0] = 24;
    const broken = {
      ...meshSource(),
      buffers: {
        ...meshSource().buffers,
        indices: toBase64(new Uint8Array(channels.indices.buffer)),
      },
    };
    expect(() => fixture({ meshes: [broken] })).toThrow(/index 24 is past 24 vertices/);
  });
});

describe("the pinned workload's own closed forms", () => {
  it("advances one frame per rendered frame, with the grids turning opposite ways", () => {
    const read = fixture();
    expect(lightsRotations(read, 0)).toEqual({
      lightRotationY: 0.1 / 60,
      meshRotationY: -0.1 / 60,
    });
    expect(lightsRotations(read, 599).lightRotationY).toBeCloseTo((0.1 * 600) / 60, 12);
    expect(lightsRotations(read, 599).meshRotationY).toBeCloseTo((-0.1 * 600) / 60, 12);
  });

  it("places a light from its exported accum, energy and toggle rule", () => {
    const read = fixture();
    // `Lighter.accum` advances by `delta * speed * 2` per rendered frame, from the arm's first
    // advance, and `energy` is `sin(accum) * 5` with the flag taken from its sign.
    expect(lightsAccum(read, 0, 0)).toBeCloseTo((ACCUM_SEEDS[0] as number) + 1 / 30, 12);
    expect(lightsAccum(read, 0, 599)).toBeCloseTo((ACCUM_SEEDS[0] as number) + 20, 12);
    const state = lightsEnergy(read, 0, 0);
    expect(state.energy).toBeCloseTo(Math.sin((ACCUM_SEEDS[0] as number) + 1 / 30) * 5, 12);
    expect(state.visible).toBe(state.energy > 0);
    // Seed 0's sine is negative, so this one is a hidden light and the rule must say so.
    expect(lightsEnergy(read, 0, 0).visible).toBe(true);
  });

  it("turns the whole cell about the rotater, not just the offset under it", () => {
    const read = fixture();
    // `world = R(theta) * (cellPosition + cellScale * nodeOffset)`, hand-computed for frame 0:
    // theta = 0.1/60 rad, cell = (-0.660242, -0.003465, -0.613116), offset (0, 0.01, 0), and the
    // 2/3 x/z cell scale leaves a y-only offset alone.
    const cos = Math.cos(0.1 / 60);
    const sin = Math.sin(0.1 / 60);
    const x = -0.660241961479187;
    const y = -0.00346543174237013 + 0.01;
    const z = -0.613115966320038;
    // Nine decimals, not fifteen: the cell positions are the pinned scene's own float32 values read
    // back through 17 digits, so agreement is float32-exact and the declared tolerance is 1e-4 m.
    const origin = lightsCellWorld(read, "light", 0, 0);
    expect(origin[0]).toBeCloseTo(x * cos + z * sin, 9);
    expect(origin[1]).toBeCloseTo(y, 9);
    expect(origin[2]).toBeCloseTo(z * cos - x * sin, 9);
    // The two errors that were actually made: scaling the cell's own position, and forgetting the
    // rotater sits above the grid. Both move x by more than the declared 1e-4 m tolerance.
    expect(Math.abs((origin[0] as number) - (x * (2 / 3) + z * (2 / 3) * sin))).toBeGreaterThan(
      1e-4,
    );
    expect(Math.abs((origin[0] as number) - (x * cos + z * sin - 0.001022))).toBeGreaterThan(1e-4);
  });

  it("scales a mesh's world X axis by its own scale and no other", () => {
    const read = fixture();
    // The mesh cell's 0.2 x scale times the model's own x scale of 1, turned by the negative rotater.
    const axis = lightsCellAxisX(read, "mesh", 0, 0);
    expect(axis[0]).toBeCloseTo(Math.cos(0.1 / 60) * 0.2, 7);
    expect(axis[1]).toBe(0);
    expect(axis[2]).toBeCloseTo(Math.sin(0.1 / 60) * 0.2, 7);
    // The light grid is 2/3 across and turns the other way, so the same column has the other sign.
    const light = lightsCellAxisX(read, "light", 0, 0);
    expect(light[0]).toBeCloseTo(Math.cos(0.1 / 60) * (2 / 3), 7);
    expect(light[2]).toBeCloseTo(-Math.sin(0.1 / 60) * (2 / 3), 7);
  });

  it("encodes base64 the way the pinned arm decodes it", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 141, 384]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37) % 256);
      // Round-trip through the same decoder the fixture reader uses, so an encoder that drops or
      // reorders a byte cannot pass as a capture that decodes.
      expect(atobLike(lightsBase64(bytes))).toEqual([...bytes]);
    }
  });
});

function atobLike(text: string): number[] {
  const padded = text.replace(/=+$/, "");
  const out: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of padded) {
    accumulator = (accumulator << 6) | BASE64_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 0xff);
    }
  }
  return out;
}

/** One captured frame; `null` changed pixels is the first frame, `0` an unchanged later one. */
function captures(changed: (number | null)[], coveredFraction = 0.91): unknown[] {
  return changed.map((value, frameId) => ({
    backgroundLuma: 1,
    changedPixels: value,
    coveredFraction,
    frameId,
    meanLuma: 0.1,
    name: "frame",
    scored: true,
  }));
}

/** The same silhouette with a different shaded mean, which is the disclosure this family needs. */
function shadedCaptures(
  changed: (number | null)[],
  coveredFraction: number,
  meanLuma: number,
): unknown[] {
  return captures(changed, coveredFraction).map((entry) => ({
    ...(entry as Record<string, unknown>),
    meanLuma,
  }));
}

function state(frameId: number, over: Record<string, unknown> = {}): unknown {
  const read = fixture();
  const meshRot = -0.1 * (frameId + 1) * FRAME_DELTA;
  const lightRot = 0.1 * (frameId + 1) * FRAME_DELTA;
  const lightProbe = (index: number) => {
    const { energy, visible } = lightsEnergy(read, index, frameId);
    return {
      accum: lightsAccum(read, index, frameId),
      axisX: [...lightsCellAxisX(read, "light", index, frameId)],
      energy,
      index,
      origin: [...lightsCellWorld(read, "light", index, frameId)],
      visible,
    };
  };
  const meshProbe = (index: number) => ({
    axisX: [...lightsCellAxisX(read, "mesh", index, frameId)],
    index,
    origin: [...lightsCellWorld(read, "mesh", index, frameId)],
  });
  const probes = [lightProbe(0), lightProbe(4), lightProbe(8)];
  return {
    elapsedFrames: frameId + 1,
    frameId,
    lightProbes: probes,
    // Frame 599's sine crossings put one of the three probes behind, which is what makes the pair
    // exercise the "energy is compared only where both arms agree the light is lit" rule.
    lightsVisible: probes.filter((probe) => probe.visible).length,
    lightRotationY: lightRot,
    meshProbes: [meshProbe(0), meshProbe(49), meshProbe(99)],
    meshRotationY: meshRot,
    ...over,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adapter: ADAPTER,
    arm: "godot-desktop",
    authoring: "scene-node-meshinstance3d",
    captures: captures([null, 480]),
    cell: LIGHTS_CELL,
    census: {
      actualMeshInstances: 100,
      actualOmniLights: 9,
      actualSpotLights: 0,
      requestedLights: 10,
      requestedObjects: 100,
    },
    drain: "measurement-boundary-completion",
    effective: { latticeSamples: 32400, lightsAffectFrame: true, lightsChangedSamples: 1099 },
    environment: {
      ambientColor: [0, 0, 0],
      ambientEnergy: 1,
      ambientSource: "2",
      backgroundColor: [1, 1, 1],
      backgroundMode: "color",
    },
    family: "godot-lights-meshes",
    fixture: {
      hash: FIXTURE_HASH,
      rngSeed: SEED,
      schemaVersion: 1,
      sourceCommit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
      viewport: { height: 1080, width: 1920 },
    },
    frameIntervalMs: [0.87, 0.9],
    lights: {
      actual: 9,
      attenuation: 0.100000001490116,
      color: [1, 1, 1],
      kind: "omni",
      openingEnergy: 5,
      range: 0.100000001490116,
      requested: 10,
      shadowEnabled: false,
    },
    meanMs: 0.87,
    mesh: {
      bufferSha256: BUFFER_SHA,
      indices: 36,
      kind: "BoxMesh",
      triangles: 12,
      vertices: 24,
    },
    motion: { changedSampledPixels: 480, observed: true },
    profile: "smoke",
    states: [state(0), state(1)],
    updateSchedule: {
      advanceOrder: "advance-then-render",
      energyScale: 5,
      frameDelta: FRAME_DELTA,
      lightRotaterSpeed: 0.1,
      lightSpeed: 1,
      meshRotaterSpeed: -0.1,
    },
    ...overrides,
  };
}

function tnRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const boundaries = [{ frameId: 0, monotonicMs: 0 }];
  for (let frameId = 1; frameId <= 2; frameId += 1)
    boundaries.push({ frameId, monotonicMs: 0.5 * frameId });
  return run({
    adapter: { architecture: "tier-0", description: "NVIDIA GeForce RTX 2080", vendor: "nvidia" },
    arm: "tn-desktop",
    authoring: "scene-node-mesh",
    // The counterpart host paces its frame loop at 60 Hz, so a mean under 1 ms is the present, not
    // the work. `intervals` below is the uncapped series a real run records instead.
    frameIntervalMs: undefined,
    meanMs: 0.5,
    rawSeries: { boundaries, finalCompletionMs: 1, schemaVersion: 1, unit: "ms" },
    ...overrides,
  });
}

function parse(overrides: Record<string, unknown> = {}): ILightsRun {
  return parseLightsRun(run(overrides));
}

function parseTn(overrides: Record<string, unknown> = {}): ILightsRun {
  return parseLightsRun(tnRun(overrides));
}

describe("the lights/meshes comparator", () => {
  it("accepts a pair that agrees on everything it compares, and says what it compared", () => {
    const comparison = compareLightsRuns(parseTn(), parse());
    expect(comparison.outcome.problems).toEqual([]);
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    expect(comparison.conformance.bufferHashesEqual).toBe(true);
    expect(comparison.conformance.censusEqual).toBe(true);
    expect(comparison.conformance.oppositeRotationsObserved).toEqual({ light: true, mesh: true });
    expect(comparison.evidence).toEqual({
      lightsAffectFrame: { godot: true, tn: true },
      nonBlankCaptures: { godot: true, tn: true },
      observedMotion: { godot: true, tn: true },
    });
    expect(comparison.comparedMetrics.join(" ")).toContain("silhouette covered-fraction");
    expect(comparison.ratio).not.toBeNull();
  });

  it("records the shaded mean luma without gating on it, and never calls it a compared pixel", () => {
    // Two shaded pipelines put different values on the same light energy, and §6.2 forbids a
    // universal pixel-equality threshold between different PBR implementations.
    // Same silhouette, a different shaded value on the same light energy — which is what two
    // different forward renderers do, and what must not fail the pair.
    const comparison = compareLightsRuns(
      parseTn({ captures: shadedCaptures([null, 480], 0.91, 0.42) }),
      parse({ captures: shadedCaptures([null, 480], 0.91, 0.11) }),
    );
    expect(comparison.outcome.problems).toEqual([]);
    expect(comparison.disclosed.shadedPixelsCompared).toBe(false);
    expect(comparison.disclosed.meanLumaDelta).toHaveLength(2);
    expect(comparison.disclosed.meanLumaDelta[0]?.tn).toBeCloseTo(0.42, 6);
  });

  it("refuses a pair whose mesh buffers differ while every count stays identical", () => {
    const comparison = compareLightsRuns(
      parseTn(),
      parse({ mesh: { ...(run().mesh as object), bufferSha256: "b".repeat(64) } }),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems).toContainEqual(
      expect.stringContaining("TN_BENCH_LIGHTS_BUFFER_HASH_MISMATCH"),
    );
    expect(comparison.ratio).toBeNull();
  });

  it("refuses a pair whose requested-versus-actual census disagrees", () => {
    const comparison = compareLightsRuns(
      parseTn(),
      parse({
        census: {
          actualMeshInstances: 100,
          actualOmniLights: 16,
          actualSpotLights: 0,
          requestedLights: 10,
          requestedObjects: 100,
        },
      }),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems.join(" ")).toContain("TN_BENCH_LIGHTS_CENSUS_MISMATCH");
  });

  it("refuses a frame one arm sampled and the other did not", () => {
    const comparison = compareLightsRuns(parseTn(), parse({ states: [state(0)] }));
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems.join(" ")).toContain("TN_BENCH_LIGHTS_UPDATE_UNOBSERVED");
  });

  it("refuses a state that moved further than the preregistered tolerance, and holds the tolerance", () => {
    const moved = state(0, { meshRotationY: -0.1 / 60 + 0.01 });
    expect(compareLightsRuns(parseTn(), parse({ states: [moved, state(1)] })).outcome.valid).toBe(
      false,
    );
    // 2e-5 rad is inside the declared 1e-3 and must be accepted, so the band is a bound and not a
    // zero: refusing it would make every future pair unusable.
    const inside = state(0, { meshRotationY: -0.1 / 60 + 2e-5 });
    expect(compareLightsRuns(parseTn(), parse({ states: [inside, state(1)] })).outcome.valid).toBe(
      true,
    );
  });

  it("refuses a light-count disagreement the per-light probes cannot see", () => {
    // Every probed light agrees, so a comparator that only walked the probes would pass this: the
    // count is a separate statement about the whole light set, and the six unprobed lights are where
    // a disagreement would hide.
    const first = state(0);
    const second = state(1);
    const inflated = { ...(second as Record<string, unknown>), lightsVisible: 9 };
    const comparison = compareLightsRuns(
      parseTn({ states: [first, inflated] }),
      parse({ states: [first, second] }),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems).toContain("TN_BENCH_LIGHTS_VISIBLE_COUNT_MISMATCH");
  });

  it("refuses grids that stopped turning opposite ways even with the speeds declared opposite", () => {
    // The declared schedule is the rotaters' own speed; the observed evidence is the sampled
    // rotations. A pair whose grids stand still is not the workload, whatever its schedule claims.
    const held = [state(0), state(1)].map((entry) => ({
      ...(entry as Record<string, unknown>),
      lightRotationY: 0.1 / 60,
      meshRotationY: -0.1 / 60,
    }));
    const comparison = compareLightsRuns(parseTn({ states: held }), parse({ states: held }));
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems).toContain("TN_BENCH_LIGHTS_GRID_ROTATION_NOT_OPPOSITE");
    expect(comparison.conformance.oppositeRotationsObserved).toEqual({ light: false, mesh: false });
  });

  it("refuses a light whose visibility the two arms disagree about", () => {
    const read = parse();
    const first = read.states[0];
    const second = read.states[1];
    if (first === undefined || second === undefined) throw new Error("no states");
    const flipped = {
      ...second,
      lightProbes: second.lightProbes.map((probe) => ({ ...probe, visible: !probe.visible })),
    };
    const comparison = compareLightsRuns(parseTn(), parse({ states: [first, flipped] }));
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems.join(" ")).toContain("TN_BENCH_LIGHTS_VISIBILITY_MISMATCH");
  });

  it("refuses a frozen light set over a sample set long enough to have toggled", () => {
    // A toggle is a crossing of `sin(accum) * 5`, so the pinned `Lighter` flips one every pi/2 of
    // accum — every 47 rendered frames. A pair whose states all carry the same light state over 600
    // frames is frozen, and the comparator says so instead of passing two quiet pictures.
    const frozen = Array.from({ length: 6 }, (_, index) =>
      state(0, { frameId: index === 0 ? 0 : index * 100, elapsedFrames: index * 100 + 1 }),
    );
    const comparison = compareLightsRuns(parseTn(), parse({ states: frozen }));
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems.join(" ")).toContain("TN_BENCH_LIGHTS_UPDATE_UNOBSERVED");
  });

  it("refuses a pair with no visual evidence, in either arm", () => {
    expect(
      compareLightsRuns(
        parseTn(),
        parse({
          effective: { latticeSamples: 32400, lightsAffectFrame: false, lightsChangedSamples: 0 },
        }),
      ).outcome.problems,
    ).toContain("TN_BENCH_LIGHTS_NOT_EFFECTIVE");
    expect(
      compareLightsRuns(parseTn(), parse({ captures: captures([null, 0], 0) })).outcome.problems,
    ).toContain("TN_BENCH_LIGHTS_CAPTURE_BLANK");
    expect(
      compareLightsRuns(parseTn(), parse({ motion: { changedSampledPixels: -1, observed: false } }))
        .outcome.problems,
    ).toContain("TN_BENCH_LIGHTS_CAPTURE_MOTION_UNOBSERVED");
    expect(
      compareLightsRuns(parseTn(), parse({ motion: { changedSampledPixels: 0, observed: true } }))
        .outcome.problems,
    ).toContain("TN_BENCH_LIGHTS_FRAME_FROZEN");
  });

  it("refuses a picture the two arms disagree on beyond the preregistered silhouette bound", () => {
    // The retained Godot frame covered 0.909846 of the lattice. A counterpart at 0.5 is far outside
    // the declared 0.01, and both frames are non-blank and both moved — a difference a count
    // comparison cannot see.
    const inside = compareLightsRuns(
      parseTn({ captures: captures([null, 480], 0.909845679012346) }),
      parse({ captures: captures([null, 480], 0.905) }),
    );
    expect(inside.outcome.problems).toEqual([]);
    const apart = compareLightsRuns(
      parseTn({ captures: captures([null, 480], 0.909845679012346) }),
      parse({ captures: captures([null, 480], 0.5) }),
    );
    expect(apart.outcome.valid).toBe(false);
    expect(apart.outcome.problems.join(" ")).toContain("TN_BENCH_LIGHTS_COVERAGE_DIVERGED");
    expect(apart.ratio).toBeNull();
  });

  it("refuses a pair whose frame delta or rotater sense differs", () => {
    expect(
      compareLightsRuns(
        parseTn(),
        parse({
          updateSchedule: {
            advanceOrder: "advance-then-render",
            energyScale: 5,
            frameDelta: 1 / 30,
            lightRotaterSpeed: 0.1,
            lightSpeed: 1,
            meshRotaterSpeed: -0.1,
          },
        }),
      ).outcome.problems,
    ).toContain("TN_BENCH_LIGHTS_FRAME_DELTA_MISMATCH");
    expect(
      compareLightsRuns(
        parseTn(),
        parse({ updateSchedule: { ...(run().updateSchedule as object), meshRotaterSpeed: 0.1 } }),
      ).outcome.problems,
    ).toContain("TN_BENCH_LIGHTS_ROTATION_SENSE");
  });

  it("refuses a wall metric that does not say what it measured, and a pair whose two disagree", () => {
    // The frame series stays, so the record still has frame-level evidence; what it does not have is
    // any statement of what its mean measured.
    const undeclared: Record<string, unknown> = {
      ...tnRun(),
      drain: undefined,
      rawSeries: undefined,
      frameIntervalMs: [0.4, 0.5],
    };
    expect(parseLightsRun(undeclared).wallSemantics).toBeNull();
    expect(
      compareLightsRuns(parseLightsRun(undeclared), parse()).outcome.problems.join(" "),
    ).toContain("TN_BENCH_LIGHTS_TN_WALL_SEMANTICS_UNDECLARED");
    const comparison = compareLightsRuns(parseTn(), parse({ drain: "submission-paced" }));
    expect(comparison.outcome.problems.join(" ")).toContain(
      "TN_BENCH_LIGHTS_WALL_SEMANTICS_MISMATCH",
    );
  });

  it("refuses an arm whose frames all landed on the host's 60 Hz tick", () => {
    const capped = Array.from({ length: 600 }, () => 1000 / 60);
    const comparison = compareLightsRuns(
      parseTn({ frameIntervalMs: capped }),
      parse({ frameIntervalMs: capped }),
    );
    expect(comparison.outcome.problems.join(" ")).toContain("TN_BENCH_LIGHTS_GODOT_CADENCE_CAPPED");
  });

  it("does not accuse real work that happens to cost about one tick", () => {
    // The 2080's own retained 100-box interval series spreads over 0.9-1.2 ms at a 0.87 ms mean; every
    // one of those frames is "near" 16.667 ms, and proximity alone must not be read as a present.
    const real = Array.from({ length: 600 }, (_, index) => 0.9 + (index % 30) * 0.01);
    expect(compareLightsRuns(parseTn({ frameIntervalMs: real }), parse()).outcome.problems).toEqual(
      [],
    );
  });

  it("refuses a record whose family, cell or census is malformed before comparing anything", () => {
    expect(() => parseLightsRun({ ...run(), family: "godot-culling" })).toThrow(
      /TN_BENCH_LIGHTS_RUN_MALFORMED/,
    );
    expect(() => parseLightsRun({ ...run(), cell: "box-1000" })).toThrow(
      /TN_BENCH_LIGHTS_RUN_MALFORMED/,
    );
    expect(() =>
      parseLightsRun({ ...run(), mesh: { ...(run().mesh as object), bufferSha256: "nope" } }),
    ).toThrow(/buffer SHA-256/);
    expect(() => parseLightsRun({ ...run(), effective: { lightsAffectFrame: true } })).toThrow(
      /non-negative integer/,
    );
  });
});
