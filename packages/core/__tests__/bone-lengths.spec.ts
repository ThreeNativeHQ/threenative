import {
  type AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";
import { boneLengthDeviations, boneLengths } from "../src/bone-lengths.js";

/**
 * A three-bone chain pointing up +Y. `hip` has no bone parent, so its own entry is absent;
 * `spine` and `head` carry the two measured parent→child lengths, 0.5 and 0.4.
 */
function chainRig(): Bone {
  const hip = new Bone();
  hip.name = "hip";
  hip.position.set(0, 1, 0);
  const spine = new Bone();
  spine.name = "spine";
  spine.position.set(0, 0.5, 0);
  const head = new Bone();
  head.name = "head";
  head.position.set(0, 0.4, 0);
  hip.add(spine);
  spine.add(head);
  return hip;
}

/** A scale keyframe on `spine` mid-clip: the rigged equivalent of stretching one bone. */
function spineStretchClip(): AnimationClip {
  return {
    name: "stretch",
    duration: 1,
    tracks: [
      // Two full keyframes per track: four values per quaternion, three per vector.
      new VectorKeyframeTrack("hip.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new VectorKeyframeTrack("spine.scale", [0, 1], [1, 1, 1, 2, 2, 2]),
    ],
  } as AnimationClip;
}

describe("boneLengths", () => {
  it("measures every parent→child bone distance in world space", () => {
    const rig = chainRig();
    const snapshot = boneLengths(rig);
    expect(snapshot.bones).toBe(3);
    expect(snapshot.lengths.spine).toBeCloseTo(0.5, 10);
    expect(snapshot.lengths.head).toBeCloseTo(0.4, 10);
    // `hip` has no bone parent, so there is no length to hold it to.
    expect(snapshot.lengths.hip).toBeUndefined();
  });

  it("throws when the root carries no bones", () => {
    expect(() => boneLengths(new Group())).toThrow(/no bones/);
  });
});

describe("boneLengthDeviations", () => {
  it("reports a rigid pose as rigid — any rotation of any bone", () => {
    const rig = chainRig();
    const bind = boneLengths(rig);
    const spine = rig.getObjectByName("spine") as Bone;
    const head = rig.getObjectByName("head") as Bone;
    spine.rotation.set(0.7, 0, 0);
    head.rotation.set(0, 1.2, 0);
    const report = boneLengthDeviations(rig, bind);
    expect(report.rigid).toBe(true);
    expect(report.deviations).toHaveLength(0);
    expect(report.maxDeviation).toBeLessThan(1e-9);
  });

  it("cancels a uniform ancestor scale shared by both measurements", () => {
    const rig = chainRig();
    const wrapper = new Group();
    wrapper.add(rig);
    wrapper.scale.setScalar(0.16);
    const bind = boneLengths(wrapper);
    (rig.getObjectByName("head") as Bone).rotation.y = 2;
    const report = boneLengthDeviations(wrapper, bind);
    expect(report.rigid).toBe(true);
  });

  it("names the bone whose parent→child distance a pose broke, worst first", () => {
    const rig = chainRig();
    const bind = boneLengths(rig);
    const head = rig.getObjectByName("head") as Bone;
    head.position.set(0.9, 0.4, 0);
    const report = boneLengthDeviations(rig, bind);
    expect(report.rigid).toBe(false);
    expect(report.worst?.bone).toBe("head");
    expect(report.worst?.bindLength).toBeCloseTo(0.4, 10);
    expect(report.worst?.posedLength).toBeCloseTo(Math.hypot(0.9, 0.4), 10);
    expect(report.deviations.map((entry) => entry.bone)).toEqual(["head"]);
  });

  it("names the stretched bone when a clip scales it mid-pose", () => {
    const rig = chainRig();
    const wrapper = new Group();
    wrapper.add(rig);
    const bind = boneLengths(wrapper);
    const mixer = new AnimationMixer(wrapper);
    mixer.clipAction(spineStretchClip()).play();
    // Halfway through the one-second clip: a looping sample at exactly `duration` wraps to 0.
    mixer.update(0.5);
    const report = boneLengthDeviations(wrapper, bind);
    mixer.stopAllAction();
    mixer.uncacheRoot(wrapper);
    // Scaling `spine` moves its child: the spine→head distance is what broke.
    expect(report.rigid).toBe(false);
    expect(report.worst?.bone).toBe("head");
    expect(report.worst?.ratio).toBeCloseTo(1.5, 6);
  });

  it("throws when a bone exists on one side of the comparison only", () => {
    const rig = chainRig();
    const bind = boneLengths(rig);
    rig.getObjectByName("head")?.removeFromParent();
    expect(() => boneLengthDeviations(rig, bind)).toThrow(/head/);
  });
});
