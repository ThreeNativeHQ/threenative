import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CITY_TOLERANCE,
  type ICityFixture,
  cityCarDistance,
  cityCarLocalPosition,
  cityNodeWorldPosition,
  parseCityFixture,
} from "../../examples/engine-load-test/src/city-fixture.js";
import {
  CITY_ADMITTED_TOLERANCE,
  compareCityRuns,
  parseCityRun,
} from "../engine-load-test/city-compare.js";

/**
 * The comparator's rules, proved without a GPU: the hierarchy's composition, `simulate_cars`' own
 * reset-to-zero recurrence, the census a fixture is only accepted when its arrays agree with, and
 * every way a pair can be refused rather than scored.
 *
 * The fixture below is a three-node slice of the real shape — a root, a road carrying a car, and a
 * mesh under the road — so the parent chain the oracle composes is the chain a flat authoring would
 * get wrong.
 */

const UPSTREAM = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const DIGEST = "a".repeat(64);
const STATE_FRAMES = [0, 1, 60, 120, 300, 599];
const WARMUP = 4;
const SETTLE = 8;
const MEASURED = 600;
/** `simulate_cars` applications at the export, at the first scored frame, and at frame 599. */
const AT_EXPORT = 12;
const AT_FIRST = AT_EXPORT + SETTLE + WARMUP;
const SPEED = 1.5;
const DELTA = 1 / 60;
/** A horizontal road from x=0.75 to x=5.25, so its length is 4.5 exactly. */
const ROAD = [
  ["0.75", "0.0", "0.0"],
  ["5.25", "0.0", "0.0"],
];

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

/** A one-pixel PNG, so the image bytes the reader checks are real. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

function makeRawFixture(overrides: Record<string, unknown> = {}) {
  const building = mesh(4, 2);
  const roadMesh = mesh(4, 2);
  // node 0 root, node 1 the road (a group), node 2 the car under it, node 3 the road's mesh.
  const nodes = [
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
    [1, 1, 0, ["2.75", "0", "0"], ["0", "0", "0", "1"], ["4.5", "1", "1"], "mesh:1", "material:0"],
  ];
  const raw = {
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
      frameDelta: DELTA,
      measuredFrames: MEASURED,
      settleFrames: SETTLE,
      simulateCarsAtExport: AT_EXPORT,
      stableTicksBeforeExport: 8,
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
    nodes,
    probeCars: [0],
    probeNodes: [3],
    profile: "common",
    roadFields: ["start", "end"],
    roads: [ROAD],
    schedule: "bevy-city-fractional-frame-boundary/1",
    schemaVersion: 1,
    seed: 42,
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
    ...overrides,
  };
  return raw;
}

function makeFixture(overrides: Record<string, unknown> = {}): ICityFixture {
  return parseCityFixture(JSON.stringify(makeRawFixture(overrides)));
}

/** The car oracle's own answer for a frame, so a run can be built from the fixture and nothing else. */
function applicationsAt(frame: number): number {
  return AT_FIRST + frame;
}

function makeRun(
  fixture: ICityFixture,
  arm: "bevy-desktop" | "tn-desktop",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adapter: { name: "NVIDIA GeForce RTX 2080" },
    arm,
    authoring: arm === "tn-desktop" ? "default" : undefined,
    boundarySemantics: "render-producing frame boundary",
    census: fixture.census,
    drain: { boundaryFrame: MEASURED, includesUntimedFrames: 1 },
    family: "bevy-city",
    fixture: { hash: DIGEST, nodes: fixture.census.nodes, sourceCommit: UPSTREAM },
    frameSchedule: fixture.frameSchedule,
    lightIntensityMapping: "bevy 130000 lux has no three equivalent; this arm uses intensity 3",
    meanMs: arm === "bevy-desktop" ? 20 : 15,
    profile: "smoke",
    rawSeries: {
      boundaries: Array.from({ length: MEASURED + 1 }, (_unused, index) => ({
        frameId: index,
        monotonicMs: index * 20,
      })),
      finalCompletionMs: MEASURED * 20 + 3,
      schemaVersion: 1,
      unit: "ms",
    },
    settings: fixture.settings,
    simulateCarsApplications: {
      atExport: AT_EXPORT,
      atFirstScoredFrame: AT_FIRST,
    },
    states: STATE_FRAMES.map((frameId) => {
      const applications = applicationsAt(frameId);
      return {
        camera: {
          rotation: fixture.camera.rotation,
          translation: fixture.camera.position,
        },
        cars: fixture.probeCars.map((car) => {
          const local = cityCarLocalPosition(fixture, car, applications);
          const parentIndex = fixture.nodes[fixture.cars[car]?.nodeIndex ?? 0]?.parent ?? -1;
          const parent = fixture.nodes[parentIndex]?.translation ?? [0, 0, 0];
          return {
            distanceTraveled: cityCarDistance(fixture, car, applications),
            index: car,
            // The road is the car's parent, so the world position is the local one plus the road's.
            translation: [
              local.x + (parent[0] as number),
              local.y + (parent[1] as number),
              local.z + (parent[2] as number),
            ],
          };
        }),
        frameId,
        nodes: fixture.probeNodes.map((node) => {
          const position = cityNodeWorldPosition(fixture, node);
          return { index: node, translation: [position.x, position.y, position.z] };
        }),
        simulateCarsApplications: applications,
      };
    }),
    variant: fixture.variant,
    viewport: { height: fixture.viewport.height, width: fixture.viewport.width },
    work:
      arm === "bevy-desktop"
        ? { admittedMeshNodes: null, submittedDrawCalls: null, submittedTriangles: null }
        : { admittedMeshNodes: null, submittedDrawCalls: 2, submittedTriangles: 4 },
    ...overrides,
  };
}

describe("bevy-city fixture reader", () => {
  it("accepts the exported shape and re-reads the f32s the arm wrote", () => {
    const fixture = makeFixture();
    expect(fixture.census.nodes).toBe(4);
    expect(fixture.census.meshNodes).toBe(2);
    expect(fixture.census.trianglesInCensus).toBe(4);
    // The exporting arm writes the shortest decimal that round-trips the f32, and the reader
    // re-narrows it, so the value is exactly the one Bevy used.
    expect(fixture.nodes[1]?.translation[0]).toBe(11);
    expect(fixture.cars[0]?.offset).toEqual([4.25, 0, Math.fround(-0.15)]);
  });

  it("composes the hierarchy's own chain, so a flat authoring lands somewhere else", () => {
    const fixture = makeFixture();
    // node 3 sits at (2.75, 0, 0) under a road at (11, 0, 8), so its world position composes both.
    const world = cityNodeWorldPosition(fixture, 3);
    expect(world.x).toBeCloseTo(13.75, 6);
    expect(world.z).toBeCloseTo(8, 6);
    const car = cityNodeWorldPosition(fixture, 2);
    expect(car.x).toBeCloseTo(15.8, 6);
  });

  it("models `simulate_cars`' reset to zero rather than a modulo", () => {
    const fixture = makeFixture();
    // The car crosses the 4.5m road before 180 applications; a modulo retains a different offset.
    const beforeReset = cityCarDistance(fixture, 0, AT_EXPORT + 170);
    expect(beforeReset).toBeCloseTo(0.2 + 170 * 0.025, 4);
    const afterReset = cityCarDistance(fixture, 0, AT_EXPORT + 180);
    expect(afterReset).toBeCloseTo(0.2, 5);
  });

  it("refuses a fixture whose census disagrees with the arrays it counts", () => {
    const raw = makeRawFixture();
    expect(() =>
      parseCityFixture(
        JSON.stringify({
          ...raw,
          census: { ...raw.census, meshNodes: 3 },
        }),
      ),
    ).toThrow(/census.meshNodes/);
    expect(raw.census.meshNodes).toBe(2);
  });

  it("refuses a parent index outside the census, and a UV channel three cannot address", () => {
    expect(() =>
      parseCityFixture(
        JSON.stringify({
          ...makeRawFixture(),
          nodes: [
            [9, null, null, ["0", "0", "0"], ["0", "0", "0", "1"], ["1", "1", "1"], null, null],
          ],
        }),
      ),
    ).toThrow(/parent is outside the census/);
    const widened = makeRawFixture();
    const material = widened.materials[0]?.baseColorChannel;
    expect(material).toBe("0.0");
    expect(() =>
      parseCityFixture(
        JSON.stringify({
          ...makeRawFixture(),
          materials: [{ ...widened.materials[0], baseColorChannel: "2.0" }],
        }),
      ),
    ).toThrow(/no uv2/);
  });

  it("refuses a variant that disagrees with the scene's own Simulate Cars setting", () => {
    expect(() =>
      parseCityFixture(JSON.stringify({ ...makeRawFixture(), variant: "static" })),
    ).toThrow(/Simulate Cars/);
  });
});

describe("bevy-city comparison", () => {
  it("accepts a matched pair, and reports the ratio as an observation rather than a verdict", () => {
    const fixture = makeFixture();
    const comparison = compareCityRuns(
      fixture,
      parseCityRun(makeRun(fixture, "bevy-desktop")),
      parseCityRun(makeRun(fixture, "tn-desktop")),
    );
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    expect(comparison.conformance.withinTolerance).toBe(true);
    expect(comparison.carMotion.maxDistanceDelta).toBeLessThan(CITY_TOLERANCE.translationAbs);
    expect(comparison.carMotion.observed).toEqual({ bevy: true, tn: true });
    expect(comparison.ratio?.ratio).toBeCloseTo(20 / 15, 6);
    expect(comparison.ratio?.verdict).toBe("insufficient");
    expect(comparison.census.nodes).toBe(4);
    // The picture differences are named rather than assumed away.
    expect(comparison.disclosed.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a car that missed the recurrence, in either arm", () => {
    const fixture = makeFixture();
    const run = makeRun(fixture, "bevy-desktop");
    const states = run.states as { cars: { distanceTraveled: number; translation: number[] }[] }[];
    const car = states[2]?.cars[0] as { distanceTraveled: number; translation: number[] };
    car.translation[0] = (car.translation[0] as number) + 0.01;
    const comparison = compareCityRuns(
      fixture,
      parseCityRun(run),
      parseCityRun(makeRun(fixture, "tn-desktop")),
    );
    expect(
      comparison.outcome.problems.some((code) =>
        code.startsWith("TN_BENCH_CITY_CAR_STATE_OUT_OF_TOLERANCE:bevy"),
      ),
    ).toBe(true);
    expect(comparison.carMotion.withinTolerance).toBe(false);
    expect(comparison.ratio).toBeNull();
  });

  it("refuses a car whose distance is one application behind, the wrap this family can hide", () => {
    const fixture = makeFixture();
    const run = makeRun(fixture, "bevy-desktop");
    const states = run.states as { cars: { distanceTraveled: number }[] }[];
    const car = states[2]?.cars[0] as { distanceTraveled: number };
    car.distanceTraveled = cityCarDistance(fixture, 0, applicationsAt(60) - 1);
    const comparison = compareCityRuns(
      fixture,
      parseCityRun(run),
      parseCityRun(makeRun(fixture, "tn-desktop")),
    );
    expect(
      comparison.outcome.problems.some((code) =>
        code.startsWith("TN_BENCH_CITY_CAR_DISTANCE_OUT_OF_TOLERANCE:bevy"),
      ),
    ).toBe(true);
  });

  it("refuses a node whose world position a flat authoring would have produced", () => {
    const fixture = makeFixture();
    const run = makeRun(fixture, "tn-desktop");
    const states = run.states as { nodes: { translation: number[] }[] }[];
    const probe = states[1]?.nodes[0] as { translation: number[] };
    // The local translation instead of the composed world one: the mistake a counterpart arm makes
    // when it authors the exported nodes as siblings instead of children.
    probe.translation[0] = 2.75;
    const comparison = compareCityRuns(
      fixture,
      parseCityRun(makeRun(fixture, "bevy-desktop")),
      parseCityRun(run),
    );
    expect(comparison.outcome.problems).toContain("TN_BENCH_CITY_STATE_OUT_OF_TOLERANCE");
    expect(comparison.conformance.perArm.tn.nodeMaxDelta).toBeGreaterThan(
      CITY_TOLERANCE.translationAbs,
    );
    expect(comparison.conformance.perArm.bevy.nodeMaxDelta).toBeLessThan(
      CITY_TOLERANCE.translationAbs,
    );
  });

  it("refuses a static arm whose cars moved, and a moving arm whose cars did not", () => {
    const moving = makeFixture();
    const still = makeRun(moving, "bevy-desktop", {
      states: [(makeRun(moving, "bevy-desktop").states as unknown[])[0]],
    });
    expect(
      compareCityRuns(moving, parseCityRun(still), parseCityRun(makeRun(moving, "tn-desktop")))
        .outcome.problems,
    ).toContain("TN_BENCH_CITY_CAR_MOTION_NOT_OBSERVED");

    // A static fixture: the scene's own `Simulate Cars` setting is off, so the exported car keeps the
    // translation it was spawned with, and the arms must both hold still.
    const staticFixture = makeFixture({
      cars: [
        [
          2,
          0,
          "-1.0",
          "0.2",
          ["4.25", "0", "-0.15"],
          ["0", "0", "0.6"],
          ["0", "0.70710677", "0", "-0.70710677"],
          ["0.15", "0.15", "0.15"],
        ],
      ],
      settings: {
        contactShadowsEnabled: true,
        cpuCulling: true,
        shadowMapsEnabled: true,
        simulateCars: false,
        wireframeEnabled: false,
      },
      variant: "static",
    });
    const staticRun = makeRun(staticFixture, "bevy-desktop");
    const staticStates = staticRun.states as { cars: { translation: number[] }[] }[];
    const held = staticStates[3]?.cars[0] as { translation: [number, number, number] };
    expect(held.translation[0]).toBeCloseTo(11, 6);
    expect(held.translation[2]).toBeCloseTo(8.6, 6);
    held.translation = [held.translation[0] + 1, held.translation[1], held.translation[2]];
    expect(
      compareCityRuns(
        staticFixture,
        parseCityRun(staticRun),
        parseCityRun(makeRun(staticFixture, "tn-desktop")),
      ).outcome.problems,
    ).toContain("TN_BENCH_CITY_STATIC_ARM_MOVED");
  });

  it("refuses a pair whose two arms disagree about the frame count, the viewport or the drain", () => {
    const fixture = makeFixture();
    const short = makeRun(fixture, "tn-desktop", {
      drain: null,
      rawSeries: {
        boundaries: [
          { frameId: 0, monotonicMs: 0 },
          { frameId: 1, monotonicMs: 20 },
        ],
        finalCompletionMs: 40,
        schemaVersion: 1,
        unit: "ms",
      },
      viewport: { height: 1080, width: 1920 },
    });
    const problems = compareCityRuns(
      fixture,
      parseCityRun(makeRun(fixture, "bevy-desktop")),
      parseCityRun(short),
    ).outcome.problems;
    expect(problems).toContain("TN_BENCH_CITY_FRAME_COUNT_MISMATCH:tn");
    expect(problems).toContain("TN_BENCH_CITY_DRAIN_ABSENT:tn");
    expect(problems).toContain("TN_BENCH_CITY_VIEWPORT_MISMATCH:tn");
  });

  it("refuses a run that reports no completed work and a mean of zero", () => {
    const fixture = makeFixture();
    expect(() => parseCityRun({ ...makeRun(fixture, "tn-desktop"), meanMs: 0 })).toThrow(
      /completed-work mean of zero/,
    );
  });

  it("refuses a draw counter of zero, which is a missing metric in a zero's clothes", () => {
    const fixture = makeFixture();
    const run = makeRun(fixture, "bevy-desktop", {
      work: { admittedMeshNodes: null, submittedDrawCalls: 0, submittedTriangles: null },
    });
    expect(
      compareCityRuns(fixture, parseCityRun(run), parseCityRun(makeRun(fixture, "tn-desktop")))
        .outcome.problems,
    ).toContain("TN_BENCH_CITY_DRAW_COUNTER_ZERO");
  });

  it("keeps an unavailable admitted count as null and names the admitted tolerance", () => {
    const fixture = makeFixture();
    const comparison = compareCityRuns(
      fixture,
      parseCityRun(makeRun(fixture, "bevy-desktop")),
      parseCityRun(makeRun(fixture, "tn-desktop")),
    );
    expect(comparison.admitted.bevy).toBeNull();
    expect(comparison.admitted.tn).toBeNull();
    expect(comparison.admitted.canonical).toBe(2);
    expect(comparison.admitted.tolerance).toBe(
      Math.max(1, Math.round(2 * CITY_ADMITTED_TOLERANCE)),
    );
  });

  it("refuses a run with no sampled state at all", () => {
    const fixture = makeFixture();
    expect(() => parseCityRun({ ...makeRun(fixture, "tn-desktop"), states: [] })).toThrow(
      /no sampled state/,
    );
  });
});

/**
 * The retained real pair, read as a regression pin. It is skipped rather than failed when the
 * artifacts are absent, because `artifacts/` is local build output; when they are there, this is the
 * check that the comparator still accepts what the arms actually reported.
 */
describe("retained bevy-city evidence", () => {
  const read = (name: string): unknown => {
    try {
      return JSON.parse(
        readFileSync(new URL(`../../artifacts/engine-load-test/${name}`, import.meta.url), "utf8"),
      ) as unknown;
    } catch {
      return null;
    }
  };
  it("compares the retained moving pair without refusing it", () => {
    const bevy = read("city-size8-moving-bevy.json");
    const tn = read("city-size8-moving-tn-desktop.json");
    const fixtureText = read("city-size8-moving-600f-bevy-fixture.json");
    if (typeof bevy !== "object" || bevy === null) return;
    if (typeof tn !== "object" || tn === null) return;
    if (typeof fixtureText !== "string") return;
    const fixture = parseCityFixture(fixtureText);
    const comparison = compareCityRuns(fixture, parseCityRun(bevy), parseCityRun(tn));
    expect(comparison.outcome.problems).toEqual([]);
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.census.nodes).toBe(fixture.census.nodes);
  });
});
