// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// The fox: a rig of rounded primitives plus hand-authored AnimationClips. No
// glTF, no skinning — every limb is a Group whose origin sits at its joint, so
// `legL.rotation[x]` swings from the hip the way a bone would.
//
// Track names are `<Object3D.name>.<property>[<component>]`, which is why every
// animated part is named and why none of those names contain a dot.
import {
  AnimationClip,
  Group,
  NumberKeyframeTrack,
  type Object3D,
  VectorKeyframeTrack,
} from "three";
import type { Materials } from "./materials.js";
import { ball, block, spike, tube } from "./shapes.js";

/** Feet at y=0, eye line around y=1.45. Every offset below assumes that. */
export const FOX_HEIGHT = 1.5;

function joint(name: string, x: number, y: number, z: number): Group {
  const group = new Group();
  group.name = name;
  group.position.set(x, y, z);
  return group;
}

export interface FoxRig {
  readonly root: Group;
  /** Named for the clips below; kept so the controller can tilt the whole body. */
  readonly torso: Group;
}

export function createFoxRig(materials: Materials): FoxRig {
  const root = new Group();
  root.name = "fox";

  const torso = joint("torso", 0, 0.78, 0);
  root.add(torso);

  // Jacket over a cream chest, the two-tone the reference leans on.
  const jacket = block(0.56, 0.62, 0.44, materials.jacket, { radius: 0.16 });
  const chest = block(0.34, 0.34, 0.46, materials.cream, { radius: 0.13 });
  chest.position.set(0, -0.06, 0.03);
  const hood = block(0.52, 0.2, 0.42, materials.jacketDark, { radius: 0.1 });
  hood.position.set(0, 0.3, -0.06);
  torso.add(jacket, chest, hood);

  const pack = block(0.36, 0.4, 0.22, materials.pack, { radius: 0.1 });
  pack.position.set(0, 0.02, -0.31);
  const buckle = block(0.3, 0.08, 0.06, materials.crateBolt, { radius: 0.03 });
  buckle.position.set(0, 0.06, -0.43);
  torso.add(pack, buckle);

  const head = joint("head", 0, 0.52, 0.02);
  const skull = block(0.5, 0.46, 0.46, materials.fur, { radius: 0.18 });
  const muzzle = block(0.26, 0.2, 0.24, materials.cream, { radius: 0.09 });
  muzzle.position.set(0, -0.06, 0.28);
  const nose = ball(0.07, materials.nose, { segments: 10 });
  nose.position.set(0, -0.02, 0.4);
  head.add(skull, muzzle, nose);
  for (const side of [-1, 1]) {
    const eye = ball(0.062, materials.eye, { segments: 10 });
    eye.position.set(side * 0.14, 0.06, 0.24);
    const ear = spike(0.17, 0.44, materials.fur, { segments: 8 });
    ear.position.set(side * 0.19, 0.44, -0.02);
    ear.rotation.z = side * 0.3;
    const inner = spike(0.09, 0.26, materials.nose, { segments: 8 });
    inner.position.set(side * 0.19, 0.46, 0.05);
    inner.rotation.z = side * 0.3;
    head.add(eye, ear, inner);
  }
  torso.add(head);

  for (const [name, side] of [
    ["armL", -1],
    ["armR", 1],
  ] as const) {
    const arm = joint(name, side * 0.34, 0.18, 0);
    const limb = block(0.17, 0.42, 0.19, materials.jacket, { radius: 0.08 });
    limb.position.y = -0.21;
    const paw = ball(0.11, materials.furLight, { segments: 10 });
    paw.position.y = -0.44;
    arm.add(limb, paw);
    torso.add(arm);
  }

  for (const [name, side] of [
    ["legL", -1],
    ["legR", 1],
  ] as const) {
    const leg = joint(name, side * 0.16, 0.5, 0);
    const limb = block(0.2, 0.42, 0.22, materials.furLight, { radius: 0.09 });
    limb.position.y = -0.22;
    const boot = block(0.24, 0.16, 0.34, materials.cream, { radius: 0.07 });
    boot.position.set(0, -0.44, 0.05);
    leg.add(limb, boot);
    root.add(leg);
  }

  // The tail is three shrinking segments on one joint: rotating the joint
  // sweeps the whole thing, and the cream tip sells the fox read instantly.
  const tail = joint("tail", 0, 0.72, -0.26);
  // Curved up and back, not a straight rod: each segment rises faster than the
  // last, so the tail arcs. Banding it read as a caterpillar, so it is one
  // colour with a cream tip — which is the whole fox silhouette from behind.
  let radius = 0.27;
  for (let index = 0; index < 4; index += 1) {
    const segment = ball(radius, index === 3 ? materials.cream : materials.fur, { segments: 12 });
    segment.position.set(0, index * index * 0.07, -0.13 - index * 0.17);
    tail.add(segment);
    radius *= 0.88;
  }
  // Swept up, not out. Level with the ground it reads as a caterpillar the fox
  // is towing; angled up it reads as a tail from every camera position.
  tail.rotation.x = -0.95;
  root.add(tail);

  const scarfEnd = tube(0.05, 0.03, 0.3, materials.jacketDark, { segments: 8 });
  scarfEnd.position.set(0.16, 0.9, -0.2);
  scarfEnd.rotation.x = 0.5;
  root.add(scarfEnd);

  root.traverse((child: Object3D) => {
    child.castShadow = true;
  });

  return { root, torso };
}

function swing(part: string, times: number[], radians: number[]): NumberKeyframeTrack {
  return new NumberKeyframeTrack(`${part}.rotation[x]`, times, radians);
}

function lift(part: string, times: number[], base: [number, number, number], heights: number[]) {
  return new VectorKeyframeTrack(
    `${part}.position`,
    times,
    heights.flatMap((height) => [base[0], base[1] + height, base[2]]),
  );
}

/**
 * idle / run / jump / dash / hurt. Kept deliberately short and loud: a
 * platformer reads its own animation at a glance or the feel is wrong, and
 * subtle is invisible at this camera distance.
 */
export function createFoxClips(): AnimationClip[] {
  const breathe = [0, 0.6, 1.2];
  const stride = [0, 0.15, 0.3, 0.45, 0.6];

  const idle = new AnimationClip("idle", 1.2, [
    lift("torso", breathe, [0, 0.78, 0], [0, 0.045, 0]),
    lift("head", breathe, [0, 0.52, 0.02], [0, 0.03, 0]),
    swing("tail", breathe, [0.1, -0.25, 0.1]),
    swing("armL", breathe, [0.06, -0.1, 0.06]),
    swing("armR", breathe, [-0.06, 0.1, -0.06]),
  ]);

  const run = new AnimationClip("run", 0.6, [
    swing("legL", stride, [0.95, 0, -0.95, 0, 0.95]),
    swing("legR", stride, [-0.95, 0, 0.95, 0, -0.95]),
    swing("armL", stride, [-1.05, 0, 1.05, 0, -1.05]),
    swing("armR", stride, [1.05, 0, -1.05, 0, 1.05]),
    lift("torso", stride, [0, 0.78, 0], [0, 0.09, 0, 0.09, 0]),
    swing("tail", stride, [-0.5, -0.72, -0.5, -0.72, -0.5]),
    swing("head", stride, [0.12, 0.05, 0.12, 0.05, 0.12]),
  ]);

  const jump = new AnimationClip("jump", 0.5, [
    swing("legL", [0, 0.18, 0.5], [-0.2, 1.15, 0.85]),
    swing("legR", [0, 0.18, 0.5], [-0.2, 0.55, 0.3]),
    swing("armL", [0, 0.18, 0.5], [-2.1, -2.5, -2.3]),
    swing("armR", [0, 0.18, 0.5], [-2.1, -2.5, -2.3]),
    swing("tail", [0, 0.25, 0.5], [-0.9, -1.2, -0.9]),
    lift("torso", [0, 0.25, 0.5], [0, 0.78, 0], [0.06, 0.02, 0.06]),
  ]);

  const dash = new AnimationClip("dash", 0.3, [
    swing("legL", [0, 0.15, 0.3], [1.5, 1.2, 1.5]),
    swing("legR", [0, 0.15, 0.3], [1.2, 1.5, 1.2]),
    swing("armL", [0, 0.3], [1.9, 1.9]),
    swing("armR", [0, 0.3], [1.9, 1.9]),
    swing("tail", [0, 0.15, 0.3], [-1.4, -1.15, -1.4]),
    swing("torso", [0, 0.3], [0.55, 0.55]),
  ]);

  const hurt = new AnimationClip("hurt", 0.4, [
    swing("torso", [0, 0.2, 0.4], [-0.5, -0.2, -0.5]),
    swing("armL", [0, 0.2, 0.4], [-1.6, -2.2, -1.6]),
    swing("armR", [0, 0.2, 0.4], [-1.6, -2.2, -1.6]),
    swing("legL", [0, 0.2, 0.4], [-0.6, -0.3, -0.6]),
    swing("legR", [0, 0.2, 0.4], [-0.6, -0.3, -0.6]),
  ]);

  return [idle, run, jump, dash, hurt];
}
