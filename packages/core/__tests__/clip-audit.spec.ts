import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { clipBoneCoverage, clipPoseError, clipTrackBindings } from "../src/clip-audit.js";
import { boneContact } from "../src/skeleton.js";

const CHAIN = ["Hips", "Spine", "Arm", "Hand"] as const;

/** The eight phases `clipPoseError` samples a one-second clip at, so no key needs interpolating. */
const TIMES = Array.from({ length: 8 }, (_, index) => (index + 0.5) / 8);

interface IRig {
  readonly root: Group;
  readonly bones: readonly Bone[];
  /** Each bone's authored local rotation, so a sampling pass can put the rig back. */
  readonly bind: ReadonlyMap<string, Quaternion>;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the fixture has no ${what}`);
  return value;
}

function boneOf(rigged: IRig, name: string): Bone {
  return must(
    rigged.bones.find((bone) => bone.name === name),
    `bone ${name}`,
  );
}

/**
 * A four-bone chain pointing up +Y, with an optional pure twist in `Arm`'s bind pose.
 *
 * The twist is about the bone's own axis, so both rigs place every bone at exactly the same
 * point at rest: a check that compares bone directions cannot see the difference at all.
 */
function rig(twistDegrees: number): IRig {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 3, 0], 3));
  geometry.setAttribute("skinIndex", new Float32BufferAttribute([0, 0, 0, 0, 3, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());

  const bones: Bone[] = [];
  let parent: Bone | undefined;
  for (const name of CHAIN) {
    const bone = new Bone();
    bone.name = name;
    if (parent === undefined) mesh.add(bone);
    else {
      bone.position.y = 1;
      parent.add(bone);
    }
    bones.push(bone);
    parent = bone;
  }
  must(
    bones.find((bone) => bone.name === "Arm"),
    "bone Arm",
  ).quaternion.setFromAxisAngle(new Vector3(0, 1, 0), (twistDegrees * Math.PI) / 180);

  const root = new Group();
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return {
    root,
    bones,
    bind: new Map(bones.map((bone) => [bone.name, bone.quaternion.clone()])),
  };
}

function toBindPose(rigged: IRig): void {
  for (const bone of rigged.bones)
    bone.quaternion.copy(must(rigged.bind.get(bone.name), bone.name));
}

function worldRotations(rigged: IRig): Map<string, Quaternion> {
  rigged.root.updateMatrixWorld(true);
  return new Map(
    rigged.bones.map((bone) => [bone.name, bone.getWorldQuaternion(new Quaternion())]),
  );
}

function restRotations(rigged: IRig): Map<string, Quaternion> {
  toBindPose(rigged);
  return worldRotations(rigged);
}

/** The source animation: the spine leans 40 degrees about X across one second. */
function sourceClip(): AnimationClip {
  const lean = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (40 * Math.PI) / 180);
  const track = new QuaternionKeyframeTrack(
    "Spine.quaternion",
    [0, 1],
    [0, 0, 0, 1, lean.x, lean.y, lean.z, lean.w],
  );
  return new AnimationClip("Lean", 1, [track]);
}

/** World rotations of every bone of `rigged` under `clip`, sampled at `TIMES`. */
function sampleWorld(rigged: IRig, clip: AnimationClip): Map<string, Quaternion>[] {
  const mixer = new AnimationMixer(rigged.root);
  mixer.clipAction(clip).play();
  const frames: Map<string, Quaternion>[] = [];
  let elapsed = 0;
  for (const time of TIMES) {
    mixer.update(time - elapsed);
    elapsed = time;
    frames.push(worldRotations(rigged));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rigged.root);
  toBindPose(rigged);
  return frames;
}

/**
 * Write a clip that puts each of `target`'s bones at the world rotation `worldFor` asks for.
 *
 * `retarget: "delta"` is the correct conversion — it preserves each bone's rotation *relative to
 * its own rig's bind pose*. `retarget: "world"` is the defect: it copies the source's absolute
 * world rotation onto a rig whose bind pose is not the same one.
 */
function retargetedClip(
  source: IRig,
  target: IRig,
  clip: AnimationClip,
  retarget: "delta" | "world",
  property = "quaternion",
): AnimationClip {
  const sourceRest = restRotations(source);
  const targetRest = restRotations(target);
  const frames = sampleWorld(source, clip);
  const values = new Map<string, number[]>(CHAIN.map((name) => [name, []]));

  for (const frame of frames) {
    let parent = new Quaternion();
    for (const name of CHAIN) {
      const world = must(frame.get(name), name).clone();
      const wanted =
        retarget === "world"
          ? world
          : world
              .multiply(must(sourceRest.get(name), name).clone().invert())
              .multiply(must(targetRest.get(name), name));
      const local = parent.clone().invert().multiply(wanted);
      parent = wanted;
      must(values.get(name), name).push(local.x, local.y, local.z, local.w);
    }
  }

  const tracks = CHAIN.map(
    (name) =>
      new QuaternionKeyframeTrack(`${name}.${property}`, TIMES, must(values.get(name), name)),
  );
  return new AnimationClip(`${clip.name}-${retarget}`, 1, tracks);
}

/** The bone-direction error a check that ignores twist would report, in degrees. */
function directionErrorDegrees(source: IRig, target: IRig, clip: AnimationClip): number {
  const sourceFrames = sampleWorld(source, clip);
  const targetFrames = sampleWorld(target, retargetedClip(source, target, clip, "world"));
  let worst = 0;
  for (let frame = 0; frame < TIMES.length; frame += 1) {
    for (const name of CHAIN) {
      const forward = new Vector3(0, 1, 0);
      const measured = forward
        .clone()
        .applyQuaternion(must(must(targetFrames[frame], "frame").get(name), name));
      const expected = forward
        .clone()
        .applyQuaternion(must(must(sourceFrames[frame], "frame").get(name), name));
      worst = Math.max(worst, (measured.angleTo(expected) * 180) / Math.PI);
    }
  }
  return worst;
}

describe("clipPoseError", () => {
  it("scores a correct retarget at zero across a bind-pose difference", () => {
    const source = rig(0);
    const target = rig(90);
    const clip = sourceClip();

    const report = clipPoseError(
      { root: target.root, clip: retargetedClip(source, target, clip, "delta") },
      { root: source.root, clip },
    );

    expect(report.samples).toBe(8);
    expect(report.bones).toHaveLength(4);
    expect(report.meanDegrees).toBeLessThan(0.5);
    expect(report.maxDegrees).toBeLessThan(0.5);
  });

  it("catches a bind-convention roll that a bone-direction check reports as perfect", () => {
    const source = rig(0);
    const target = rig(90);
    const clip = sourceClip();

    expect(directionErrorDegrees(source, target, clip)).toBeLessThan(0.5);

    const report = clipPoseError(
      { root: target.root, clip: retargetedClip(source, target, clip, "world") },
      { root: source.root, clip },
    );

    expect(report.maxDegrees).toBeGreaterThan(45);
    const rolled = report.bones.filter((bone) => bone.meanDegrees > 45).map(({ bone }) => bone);
    expect(rolled.sort()).toEqual(["Arm", "Hand"]);
    for (const bone of report.bones) {
      expect(bone.meanDegrees).toBeCloseTo(
        bone.bone === "Hips" || bone.bone === "Spine" ? 0 : 90,
        3,
      );
    }
  });

  it("leaves both rigs in the transforms they arrived with", () => {
    const source = rig(0);
    const target = rig(90);
    const clip = sourceClip();
    const retargeted = retargetedClip(source, target, clip, "delta");
    boneOf(target, "Spine").quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.25);
    const before = new Map(target.bones.map((bone) => [bone.name, bone.quaternion.clone()]));

    clipPoseError({ root: target.root, clip: retargeted }, { root: source.root, clip });

    for (const bone of target.bones) {
      expect(bone.quaternion.angleTo(must(before.get(bone.name), bone.name))).toBeLessThan(1e-6);
    }
  });

  it("refuses a sample count that measures nothing", () => {
    const source = rig(0);
    const clip = sourceClip();
    expect(() =>
      clipPoseError({ root: source.root, clip }, { root: source.root, clip }, { samples: 0 }),
    ).toThrow(/samples must be a positive integer/);
  });

  it("names a bone the mapping asks for and the rig does not have", () => {
    const source = rig(0);
    const clip = sourceClip();
    expect(() =>
      clipPoseError(
        { root: source.root, clip },
        { root: source.root, clip },
        { bones: { Tail: "Tail" } },
      ),
    ).toThrow(/has no bone named 'Tail'/);
  });
});

describe("clipTrackBindings", () => {
  it("reports every track that resolves", () => {
    const source = rig(0);
    const target = rig(90);
    const clip = retargetedClip(source, target, sourceClip(), "delta");

    const report = clipTrackBindings(target.root, clip);

    expect(report.tracks).toBe(4);
    expect(report.bound).toBe(4);
    expect(report.unbound).toEqual([]);
  });

  it("names the tracks of a clip that binds nothing", () => {
    const source = rig(0);
    const target = rig(90);
    const clip = retargetedClip(source, target, sourceClip(), "delta", "undefined");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const report = clipTrackBindings(target.root, clip);

    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
    expect(report.bound).toBe(0);
    expect(report.unbound.map(({ track }) => track)).toEqual([
      "Hips.undefined",
      "Spine.undefined",
      "Arm.undefined",
      "Hand.undefined",
    ]);
    expect(must(report.unbound[0], "first unbound track").node).toBe("Hips");
    expect(must(report.unbound[0], "first unbound track").reason).toContain("Hips.undefined");
  });

  it("names a track whose node is missing", () => {
    const target = rig(90);
    const clip = new AnimationClip("Ghost", 1, [
      new QuaternionKeyframeTrack("Tail.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);

    const report = clipTrackBindings(target.root, clip);

    expect(report.unbound).toHaveLength(1);
    expect(must(report.unbound[0], "first unbound track").node).toBeNull();
    expect(must(report.unbound[0], "first unbound track").reason).toContain("No target node found");
  });

  it("refuses a clip with no tracks", () => {
    const target = rig(0);
    expect(() => clipTrackBindings(target.root, new AnimationClip("Empty", 1, []))).toThrow(
      /has no tracks/,
    );
  });
});

describe("clipBoneCoverage", () => {
  it("names the bones a partial clip leaves to the previous clip", () => {
    const target = rig(0);

    const report = clipBoneCoverage(target.root, sourceClip());

    expect(report.bones).toBe(4);
    expect(report.driven).toEqual(["Spine"]);
    expect(report.undriven).toEqual(["Hips", "Arm", "Hand"]);
  });

  it("counts a track that binds nothing as driving nothing", () => {
    const source = rig(0);
    const target = rig(90);
    const clip = retargetedClip(source, target, sourceClip(), "delta", "undefined");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const report = clipBoneCoverage(target.root, clip);

    errors.mockRestore();
    expect(report.driven).toEqual([]);
    expect(report.undriven).toEqual(["Hips", "Spine", "Arm", "Hand"]);
  });

  it("refuses a root with no bones", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    expect(() => clipBoneCoverage(root, sourceClip())).toThrow(/has no bones/);
  });
});

describe("boneContact", () => {
  it("measures the gap between a bone and the object it should be touching", () => {
    const target = rig(0);
    const keyboard = new Mesh(new BoxGeometry(0.4, 0.02, 0.15), new MeshBasicMaterial());
    keyboard.name = "keyboard";
    keyboard.position.set(0, 3.2, 0);
    keyboard.updateMatrixWorld(true);

    const report = boneContact(target.root, "Hand", keyboard);

    expect(report.bone).toBe("Hand");
    expect(report.target).toBe("keyboard");
    expect(report.inside).toBe(false);
    // The hand sits at y = 3 and the keyboard's underside at y = 3.19.
    expect(report.distance).toBeCloseTo(0.19, 5);
    expect(report.bonePosition[1]).toBeCloseTo(3, 5);
  });

  it("reports zero for a bone inside the object", () => {
    const target = rig(0);
    const seat = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    seat.name = "seat";
    seat.updateMatrixWorld(true);

    const report = boneContact(target.root, "Hips", seat);

    expect(report.distance).toBe(0);
    expect(report.inside).toBe(true);
  });

  it("names the bones available when the one asked for is missing", () => {
    const target = rig(0);
    const seat = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    expect(() => boneContact(target.root, "Tail", seat)).toThrow(/Available bones: Hips, Spine/);
  });
});
