import { Bone, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { attachToBone, skeletonBones } from "../src/index.js";

function rig(): Object3D {
  const root = new Object3D();
  const hips = new Bone();
  hips.name = "Hips";
  const spine = new Bone();
  spine.name = "Spine";
  const hand = new Bone();
  hand.name = "RightHand";
  const fingers = new Bone();
  fingers.name = "RightHandIndex1";
  hips.add(spine);
  spine.add(hand);
  hand.add(fingers);
  root.add(hips);
  return root;
}

describe("skeleton helpers", () => {
  it("lists bones in traversal order and ignores an unskinned object", () => {
    expect(skeletonBones(rig())).toEqual(["Hips", "Spine", "RightHand", "RightHandIndex1"]);
    expect(skeletonBones(new Object3D())).toEqual([]);
  });

  it.each([
    ["uniform", [0.01, 0.01, 0.01] as const],
    ["non-uniform", [0.01, 0.02, 0.04] as const],
  ] as const)("cancels %s accumulated world scale", (_label, scale) => {
    const root = rig();
    root.scale.set(scale[0], scale[1], scale[2]);
    const child = new Object3D();

    expect(attachToBone(root, "RightHand", child)).toBe(child);
    expect(child.parent).toBe(root.getObjectByName("RightHand"));
    root.updateMatrixWorld(true);

    const worldScale = new Vector3();
    child.getWorldScale(worldScale);
    expect(worldScale.x).toBeCloseTo(1);
    expect(worldScale.y).toBeCloseTo(1);
    expect(worldScale.z).toBeCloseTo(1);
  });

  it("preserves world scale for the rotated FPS rifle grip", () => {
    const root = rig();
    root.scale.set(0.01, 0.02, 0.04);
    const hand = root.getObjectByName("RightHand");
    if (hand === undefined) throw new Error("test rig is missing RightHand");
    hand.rotation.x = -Math.PI / 2;
    const child = new Object3D();
    child.rotation.x = -Math.PI / 2;

    attachToBone(root, "RightHand", child);
    root.updateMatrixWorld(true);

    const worldScale = new Vector3();
    child.getWorldScale(worldScale);
    expect(worldScale.x).toBeCloseTo(1);
    expect(worldScale.y).toBeCloseTo(1);
    expect(worldScale.z).toBeCloseTo(1);
  });

  it("names available bones when attachment fails", () => {
    expect(() => attachToBone(rig(), "NoSuchBone", new Object3D())).toThrow(
      /NoSuchBone.*RightHand/,
    );
  });
});
