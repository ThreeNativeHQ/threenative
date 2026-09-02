import {
  type AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  type Quaternion,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";
import { reconcileMirroredClips } from "../src/assets.js";

/**
 * A bind facing +Z: hip at the origin, spine and head chained forward on +Z, left/right bones
 * split on X. The mirrored variants of the same tracks are what an exporter writes when it
 * converts a rig's bind but not its clips (PRD-324: the whole pack walked backwards).
 */
function forwardRig(): Group {
  const rig = new Group();
  const hip = new Bone();
  hip.name = "hip";
  const spine = new Bone();
  spine.name = "spine";
  spine.position.set(0, 0.1, 0.4);
  const head = new Bone();
  head.name = "head";
  head.position.set(0, 0.05, 0.3);
  const left = new Bone();
  left.name = "leg-L";
  left.position.set(0.2, 0, 0.1);
  const right = new Bone();
  right.name = "leg-R";
  right.position.set(-0.2, 0, 0.1);
  hip.add(spine, left, right);
  spine.add(head);
  rig.add(hip);
  rig.updateMatrixWorld(true);
  return rig;
}

function identityQuatTrack(name: string, bind: Quaternion): VectorKeyframeTrack {
  return new VectorKeyframeTrack(
    `${name}.quaternion`,
    [0, 1],
    [bind.x, bind.y, bind.z, bind.w, bind.x, bind.y, bind.z, bind.w],
  );
}

function bindQuatTrack(rig: Group, name: string): VectorKeyframeTrack {
  const bone = rig.getObjectByName(name);
  if (bone === undefined) throw new Error(`fixture bone ${name} missing`);
  return identityQuatTrack(name, bone.quaternion);
}

/** Every track holding the bind pose exactly — a healthy file's clip. */
function healthyClip(rig: Group): AnimationClip {
  return {
    name: "healthy",
    duration: 1,
    tracks: [
      new VectorKeyframeTrack("spine.position", [0, 1], [0, 0.1, 0.4, 0, 0.1, 0.4]),
      new VectorKeyframeTrack("head.position", [0, 1], [0, 0.05, 0.3, 0, 0.05, 0.3]),
      new VectorKeyframeTrack("leg-L.position", [0, 1], [0.2, 0, 0.1, 0.2, 0, 0.1]),
      new VectorKeyframeTrack("leg-R.position", [0, 1], [-0.2, 0, 0.1, -0.2, 0, 0.1]),
      bindQuatTrack(rig, "spine"),
      bindQuatTrack(rig, "head"),
      bindQuatTrack(rig, "leg-L"),
      bindQuatTrack(rig, "leg-R"),
    ],
  } as AnimationClip;
}

/** The same clip with every track z-mirrored: positions negate Z, quaternions negate X and Y. */
function mirroredClip(rig: Group): AnimationClip {
  const healthy = healthyClip(rig);
  for (const track of healthy.tracks) {
    if (track.name.endsWith(".position")) {
      const values = track.values;
      for (let index = 2; index < values.length; index += 3) {
        values[index] = -(values[index] ?? 0);
      }
    } else if (track.name.endsWith(".quaternion")) {
      const values = track.values;
      for (let index = 0; index < values.length; index += 4) {
        values[index] = -(values[index] ?? 0);
        values[index + 1] = -(values[index + 1] ?? 0);
      }
    }
  }
  healthy.name = "mirrored";
  return healthy;
}

describe("reconcileMirroredClips", () => {
  it("detects and repairs a clip set whose tracks are z-mirrored against the bind", () => {
    const rig = forwardRig();
    const clip = mirroredClip(rig);
    expect(reconcileMirroredClips(rig, [clip])).toBe(true);
    const spine = clip.tracks.find((track) => track.name === "spine.position");
    expect(spine?.values[2]).toBeCloseTo(0.4, 6);
    const headQuat = clip.tracks.find((track) => track.name === "head.quaternion");
    const bind = rig.getObjectByName("head")!.quaternion;
    expect(headQuat?.values[0]).toBeCloseTo(bind.x, 6);
    expect(headQuat?.values[1]).toBeCloseTo(bind.y, 6);
  });

  it("leaves a healthy clip set untouched, byte for byte", () => {
    const rig = forwardRig();
    const clip = healthyClip(rig);
    const before = clip.tracks.map((track) => [...track.values]);
    expect(reconcileMirroredClips(rig, [clip])).toBe(false);
    for (const [index, track] of clip.tracks.entries()) {
      expect([...track.values]).toEqual(before[index]);
    }
  });

  it("put the head back in front of the pelvis when the repaired clip plays", () => {
    const rig = forwardRig();
    const clip = mirroredClip(rig);
    reconcileMirroredClips(rig, [clip]);
    const mixer = new AnimationMixer(rig);
    mixer.clipAction(clip).play();
    mixer.update(0.5);
    rig.updateMatrixWorld(true);
    const head = rig.getObjectByName("head")!.getWorldPosition(new Vector3());
    const pelvis = rig.getObjectByName("spine")!.getWorldPosition(new Vector3());
    expect(head.z).toBeGreaterThan(pelvis.z);
    // Left stays left: the mirror is undone, not turned into a yaw that swaps sides.
    const left = rig.getObjectByName("leg-L")!.getWorldPosition(new Vector3());
    const right = rig.getObjectByName("leg-R")!.getWorldPosition(new Vector3());
    expect(left.x).toBeGreaterThan(right.x);
    mixer.stopAllAction();
    mixer.uncacheRoot(rig);
  });

  it("refuses to act on a vote it cannot stand behind — one bone cannot carry it", () => {
    const rig = forwardRig();
    const clip = healthyClip(rig);
    // Keep only one position track, mirrored: a single vote is not the pack-wide signature.
    clip.tracks = clip.tracks.filter((track) => track.name === "spine.position");
    const values = clip.tracks[0]!.values;
    for (let index = 2; index < values.length; index += 3) values[index] = -(values[index] ?? 0);
    const before = clip.tracks.map((track) => [...track.values]);
    expect(reconcileMirroredClips(rig, [clip])).toBe(false);
    for (const [index, track] of clip.tracks.entries()) {
      expect([...track.values]).toEqual(before[index]);
    }
  });

  it("fails closed on a rig with no bones", () => {
    const clip = {
      name: "empty",
      duration: 1,
      tracks: [new VectorKeyframeTrack("box.position", [0, 1], [0, 0, 1, 0, 0, 1])],
    } as AnimationClip;
    expect(reconcileMirroredClips(new Group(), [clip])).toBe(false);
  });
});
