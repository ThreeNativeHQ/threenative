import { readFileSync } from "node:fs";
import { Bone } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import {
  createDirectionWeights,
  createSpeedWeights,
} from "../../../examples/abyss-framework/src/render/locomotion-weights.js";
import { SkeletalMesh3D } from "../src/index.js";

vi.mock("@threenative/core", async () => import("../src/index.js"));

const speeds = [
  { clip: "Idle_Loop", speed: 0 },
  { clip: "Walk_Loop", speed: 1 },
  { clip: "Jog_Fwd_Loop", speed: 3 },
] as const;
const directions = [
  { clip: "a", point: [0, 0] },
  { clip: "b", point: [1, 0] },
  { clip: "c", point: [1, 1] },
  { clip: "d", point: [0, 1] },
] as const;
const triangles = [
  [0, 1, 2],
  [0, 2, 3],
] as const;
const weights = (entries: readonly { weight: number }[]) => entries.map((entry) => entry.weight);

function expectNormalized(entries: readonly { weight: number }[]) {
  expect(entries.every(({ weight }) => Number.isFinite(weight) && weight >= 0)).toBe(true);
  expect(entries.reduce((sum, { weight }) => sum + weight, 0)).toBeCloseTo(1, 6);
}

describe("game-owned speed evaluation", () => {
  it("interpolates sorted intervals and explicitly clamps both endpoints", () => {
    const evaluate = createSpeedWeights(speeds);
    expect(weights(evaluate(-1))).toEqual([1, 0, 0]);
    expect(weights(evaluate(0.5))).toEqual([0.5, 0.5, 0]);
    expect(weights(evaluate(1))).toEqual([0, 1, 0]);
    expect(weights(evaluate(2))).toEqual([0, 0.5, 0.5]);
    expect(weights(evaluate(4))).toEqual([0, 0, 1]);
    const trace = Array.from({ length: 81 }, (_, index) => index / 20 - 0.5);
    const replay = trace.map(evaluate);
    expect(trace.map(evaluate)).toEqual(replay);
    replay.forEach(expectNormalized);
  });

  it("supports a single authored fallback sample", () => {
    expect(createSpeedWeights([speeds[0]])(5)).toEqual([{ clip: "Idle_Loop", weight: 1 }]);
  });

  it("rejects empty, unsorted, duplicate and non-finite authored samples", () => {
    for (const samples of [
      [],
      [speeds[1], speeds[0]],
      [speeds[0], { clip: "other", speed: 0 }],
      [speeds[0], { clip: "Idle_Loop", speed: 1 }],
      [{ clip: "", speed: 0 }],
      [{ clip: "idle", speed: Number.NaN }],
      [{ clip: "idle", speed: Number.POSITIVE_INFINITY }],
    ])
      expect(() => createSpeedWeights(samples)).toThrow();
    const evaluate = createSpeedWeights(speeds);
    expect(() => evaluate(Number.NaN)).toThrow();
    expect(() => evaluate(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("freezes authored samples so later game edits cannot change an existing evaluator", () => {
    const samples = [
      { clip: "idle", speed: 0 },
      { clip: "walk", speed: 1 },
    ];
    const evaluate = createSpeedWeights(samples);
    const changed = samples[1];
    if (changed === undefined) throw new Error("Missing authored sample.");
    changed.speed = 4;
    expect(weights(evaluate(0.5))).toEqual([0.5, 0.5]);
  });
});

describe("game-owned declared directional domain", () => {
  it("uses barycentric weights at vertices, interiors and shared boundaries", () => {
    const evaluate = createDirectionWeights(directions, triangles);
    expect(weights(evaluate([1, 0]))).toEqual([0, 1, 0, 0]);
    expect(weights(evaluate([0.75, 0.25]))).toEqual([0.25, 0.5, 0.25, 0]);
    expect(weights(evaluate([0.25, 0.75]))).toEqual([0.25, 0, 0.25, 0.5]);
    expect(weights(evaluate([0.5, 0.5]))).toEqual([0.5, 0, 0.5, 0]);
  });

  it("projects outside points onto the nearest declared boundary, never extrapolates", () => {
    const evaluate = createDirectionWeights(directions, triangles);
    expect(weights(evaluate([2, 0.5]))).toEqual([0, 0.5, 0.5, 0]);
    expect(weights(evaluate([-1, -1]))).toEqual([1, 0, 0, 0]);
    expect(weights(evaluate([0.5, 2]))).toEqual([0, 0, 0.5, 0.5]);
    for (let x = -2; x <= 2; x += 0.125) {
      const point = [x, 0.3] as const;
      expect(evaluate(point)).toEqual(evaluate(point));
      expectNormalized(evaluate(point));
    }
  });

  it("rejects duplicate, degenerate, invalid and overlapping domains", () => {
    expect(() => createDirectionWeights([], [])).toThrow();
    expect(() => createDirectionWeights(directions, [])).toThrow();
    expect(() => createDirectionWeights(directions, [[0, 1, 9]])).toThrow();
    expect(() => createDirectionWeights(directions, [[0, 1, 1]])).toThrow();
    expect(() =>
      createDirectionWeights(directions, [
        [0, 1, 2],
        [0, 1, 3],
      ]),
    ).toThrow();
    expect(() =>
      createDirectionWeights(directions, [
        [0, 1, 2],
        [2, 1, 0],
      ]),
    ).toThrow();
    expect(() =>
      createDirectionWeights(
        [
          { clip: "a", point: [0, 0] },
          { clip: "b", point: [1, 0] },
          { clip: "c", point: [2, 0] },
        ],
        [[0, 1, 2]],
      ),
    ).toThrow();
    expect(() =>
      createDirectionWeights(
        [directions[0], { clip: "b", point: [0, 0] }, directions[2]],
        [[0, 1, 2]],
      ),
    ).toThrow();
    expect(() =>
      createDirectionWeights(
        [directions[0], { clip: "a", point: [1, 0] }, directions[2]],
        [[0, 1, 2]],
      ),
    ).toThrow();
    expect(() =>
      createDirectionWeights(
        [directions[0], directions[1], { clip: "c", point: [Number.NaN, 1] }],
        [[0, 1, 2]],
      ),
    ).toThrow();
    const evaluate = createDirectionWeights(directions, triangles);
    expect(() => evaluate([Number.POSITIVE_INFINITY, 0])).toThrow();
  });

  it("rejects malformed JSON coordinates and triangle tuples before evaluation", () => {
    for (const point of ["[0]", "[0,0,99]", "[null,0]"]) {
      const samples = JSON.parse(
        `[ {"clip":"a","point":${point}}, {"clip":"b","point":[1,0]}, {"clip":"c","point":[0,1]} ]`,
      );
      expect(() => createDirectionWeights(samples, [[0, 1, 2]])).toThrow();
    }
    for (const triangles of ["[[0,1]]", "[[0,1,2,99]]", "[[0,null,2]]"]) {
      expect(() => createDirectionWeights(directions.slice(0, 3), JSON.parse(triangles))).toThrow();
    }
  });

  it("rejects a contained triangle regardless of declaration order", () => {
    const samples = [
      { clip: "a", point: [0, 0] },
      { clip: "b", point: [4, 0] },
      { clip: "c", point: [0, 4] },
      { clip: "d", point: [1, 1] },
      { clip: "e", point: [2, 1] },
      { clip: "f", point: [1, 2] },
    ] as const;
    expect(() =>
      createDirectionWeights(samples, [
        [0, 1, 2],
        [3, 4, 5],
      ]),
    ).toThrow();
    expect(() =>
      createDirectionWeights(samples, [
        [3, 4, 5],
        [0, 1, 2],
      ]),
    ).toThrow();
  });

  it("accepts either authored triangle winding and snapshots the domain", () => {
    const samples = directions.map(({ clip, point }) => ({
      clip,
      point: [...point] as [number, number],
    }));
    const evaluate = createDirectionWeights(samples, [
      [2, 1, 0],
      [3, 2, 0],
    ]);
    const changed = samples[1];
    if (changed === undefined) throw new Error("Missing authored sample.");
    changed.point[0] = 100;
    expect(weights(evaluate([0.75, 0.25]))).toEqual([0.25, 0.5, 0.25, 0]);
  });
});

it("feeds actual mannequin speed weights through the repaired authoritative player", async () => {
  const bytes = readFileSync(
    new URL("../../create-threenative/template-assets/assets/mannequin.glb", import.meta.url),
  );
  const model = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const player = new SkeletalMesh3D({
    source: model.scene,
    clips: model.animations,
    requiredClips: speeds.map(({ clip }) => clip),
    strideSync: false,
  });
  const bones: Bone[] = [];
  player.root.traverse((node) => {
    if (node instanceof Bone) bones.push(node);
  });
  expect(bones.length).toBeGreaterThan(60);
  const evaluate = createSpeedWeights(speeds);
  player.playWeighted(evaluate(0));
  for (const speed of [0.5, 1, 2, 3, 1, 0.5, 0]) {
    const actions = speeds.map(({ clip }) => player.mixer.clipAction(player.clip(clip)));
    const liveTimes = actions.map((action) =>
      action.isScheduled() && action.getEffectiveWeight() > 0 ? action.time : undefined,
    );
    player.update(0);
    const pose = bones.map((bone) => ({
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone().normalize(),
    }));
    player.playWeighted(evaluate(speed), { transition: 0.25 });
    player.update(0);
    bones.forEach((bone, index) => {
      const before = pose[index];
      if (before === undefined) throw new Error("Missing sampled bone.");
      expect(bone.position.distanceTo(before.position)).toBeLessThan(1e-6);
      expect(bone.quaternion.clone().normalize().angleTo(before.quaternion)).toBeLessThan(1e-6);
    });
    actions.forEach((action, index) => {
      if (liveTimes[index] !== undefined) expect(action.time).toBe(liveTimes[index]);
    });
    for (let frame = 0; frame < 4; frame++) {
      player.playWeighted(evaluate(speed), { transition: 0.25 });
      player.update(0.0625);
      expectNormalized(
        actions.map((action) => ({
          weight: action.isScheduled() ? action.getEffectiveWeight() : 0,
        })),
      );
      expect(actions.every((action) => Number.isFinite(action.time))).toBe(true);
    }
    weights(evaluate(speed)).forEach((weight, index) =>
      expect(actions[index]?.isScheduled() ? actions[index]?.getEffectiveWeight() : 0).toBeCloseTo(
        weight,
        6,
      ),
    );
  }
  expect(player.mixer.stats.actions.inUse).toBe(1);
  player.dispose();
  expect(player.mixer.stats.actions.total).toBe(0);
});
