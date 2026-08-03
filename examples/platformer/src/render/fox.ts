// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
// The fox from the reference: orange fur, blue hooded jacket, small pack, and a
// banded brush of a tail. No asset pipeline and no skinning — named child
// groups posed by quaternion tracks, which is all this silhouette needs.
import {
  AnimationClip,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  Euler,
  Group,
  Mesh,
  Quaternion,
  QuaternionKeyframeTrack,
  SphereGeometry,
  TorusGeometry,
  VectorKeyframeTrack,
} from "three";
import type { Materials } from "./materials.js";

/** Feet sit at the rig's origin; the collider's centre is FOX_RISE above them. */
export const FOX_RISE = 0.55;

function swing(name: string, times: readonly number[], anglesX: readonly number[]) {
  const values: number[] = [];
  const quaternion = new Quaternion();
  const euler = new Euler();
  for (const angle of anglesX) {
    quaternion.setFromEuler(euler.set(angle, 0, 0));
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  return new QuaternionKeyframeTrack(`${name}.quaternion`, [...times], values);
}

function bob(name: string, times: readonly number[], heights: readonly number[], base: number) {
  const values = heights.flatMap((height) => [0, base + height, 0]);
  return new VectorKeyframeTrack(`${name}.position`, [...times], values);
}

/** An arm: blue sleeve down to a cream paw. */
function arm(materials: Materials, x: number, y: number): Group {
  const group = new Group();
  group.position.set(x, y, 0);
  const sleeve = new Mesh(new CapsuleGeometry(0.085, 0.16, 4, 8), materials.foxCoat);
  sleeve.position.y = -0.1;
  sleeve.castShadow = true;
  const forearm = new Mesh(new CapsuleGeometry(0.075, 0.1, 4, 8), materials.foxFur);
  forearm.position.y = -0.26;
  const paw = new Mesh(new SphereGeometry(0.095, 8, 6), materials.cream);
  paw.position.y = -0.36;
  paw.castShadow = true;
  group.add(sleeve, forearm, paw);
  return group;
}

/** A leg: orange thigh into a chunky cream boot. */
function leg(materials: Materials, x: number, y: number): Group {
  const group = new Group();
  group.position.set(x, y, 0);
  const thigh = new Mesh(new CapsuleGeometry(0.1, 0.18, 4, 8), materials.foxFur);
  thigh.position.y = -0.12;
  thigh.castShadow = true;
  const boot = new Mesh(new SphereGeometry(0.13, 10, 8), materials.cream);
  boot.scale.set(1, 0.85, 1.35);
  boot.position.set(0, -0.3, 0.04);
  boot.castShadow = true;
  group.add(thigh, boot);
  return group;
}

export interface FoxRig {
  readonly clips: AnimationClip[];
  readonly rig: Group;
}

export function createFoxRig(materials: Materials): FoxRig {
  const rig = new Group();
  // Yaw first, then pitch: the double-jump flip rides on rotation.x and must
  // not fight the facing yaw the controller writes every tick.
  rig.rotation.order = "YXZ";
  rig.position.y = -FOX_RISE;
  rig.scale.setScalar(1.15);

  const body = new Group();
  body.name = "body";
  body.position.y = 0.6;

  const torso = new Mesh(new CapsuleGeometry(0.23, 0.22, 6, 14), materials.foxCoat);
  torso.castShadow = true;
  const belly = new Mesh(new SphereGeometry(0.2, 12, 10), materials.cream);
  belly.scale.set(0.8, 0.9, 0.55);
  belly.position.set(0, -0.06, 0.16);
  const hem = new Mesh(new TorusGeometry(0.22, 0.045, 8, 16), materials.foxCoatDark);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = -0.19;
  const hood = new Mesh(new SphereGeometry(0.19, 12, 10), materials.foxCoatDark);
  hood.scale.set(1, 0.75, 0.7);
  hood.position.set(0, 0.16, -0.16);
  body.add(torso, belly, hem, hood);

  // The pack, with two straps over the shoulders.
  const pack = new Mesh(new BoxGeometry(0.3, 0.32, 0.18), materials.pack);
  pack.position.set(0, 0.02, -0.28);
  pack.castShadow = true;
  const flap = new Mesh(new BoxGeometry(0.32, 0.12, 0.2), materials.foxCoatDark);
  flap.position.set(0, 0.14, -0.28);
  body.add(pack, flap);
  for (const side of [-1, 1]) {
    const strap = new Mesh(new BoxGeometry(0.05, 0.34, 0.05), materials.foxCoatDark);
    strap.position.set(side * 0.13, 0.04, 0.19);
    strap.rotation.x = -0.18;
    body.add(strap);
  }

  const head = new Group();
  head.name = "head";
  head.position.set(0, 0.34, 0.02);
  const skull = new Mesh(new SphereGeometry(0.26, 16, 14), materials.foxFur);
  skull.castShadow = true;
  const cheeks = new Mesh(new SphereGeometry(0.16, 12, 10), materials.cream);
  cheeks.scale.set(1.15, 0.8, 1);
  cheeks.position.set(0, -0.07, 0.17);
  const snout = new Mesh(new SphereGeometry(0.085, 10, 8), materials.cream);
  snout.position.set(0, -0.04, 0.25);
  const nose = new Mesh(new SphereGeometry(0.045, 8, 6), materials.dark);
  nose.position.set(0, 0.005, 0.31);
  head.add(skull, cheeks, snout, nose);
  for (const side of [-1, 1]) {
    const ear = new Mesh(new ConeGeometry(0.1, 0.26, 7), materials.foxFur);
    ear.position.set(side * 0.15, 0.26, -0.02);
    ear.rotation.z = side * 0.2;
    ear.castShadow = true;
    const tip = new Mesh(new ConeGeometry(0.06, 0.1, 7), materials.dark);
    tip.position.set(side * 0.17, 0.36, -0.02);
    tip.rotation.z = side * 0.2;
    const eye = new Mesh(new SphereGeometry(0.042, 10, 8), materials.dark);
    eye.position.set(side * 0.1, 0.05, 0.22);
    const brow = new Mesh(new SphereGeometry(0.05, 8, 6), materials.foxFurDark);
    brow.scale.set(1, 0.35, 0.5);
    brow.position.set(side * 0.1, 0.12, 0.21);
    head.add(ear, tip, eye, brow);
  }
  body.add(head);

  // The brush: five spheres, banded orange-cream-orange with a cream tip.
  const tail = new Group();
  tail.name = "tail";
  tail.position.set(0, -0.04, -0.22);
  const bands: readonly [number, number, number, boolean][] = [
    [0.04, 0.1, 0.17, false],
    [0.16, 0.28, 0.2, false],
    [0.32, 0.46, 0.195, true],
    [0.5, 0.62, 0.17, false],
    [0.66, 0.74, 0.14, true],
  ];
  for (const [y, z, radius, cream] of bands) {
    const segment = new Mesh(
      new SphereGeometry(radius, 12, 10),
      cream ? materials.cream : materials.foxFur,
    );
    segment.position.set(0, y, -z);
    segment.castShadow = true;
    tail.add(segment);
  }
  body.add(tail);

  const legLeft = leg(materials, -0.12, 0.4);
  legLeft.name = "legLeft";
  const legRight = leg(materials, 0.12, 0.4);
  legRight.name = "legRight";
  const armLeft = arm(materials, -0.26, 0.72);
  armLeft.name = "armLeft";
  const armRight = arm(materials, 0.26, 0.72);
  armRight.name = "armRight";
  rig.add(body, legLeft, legRight, armLeft, armRight);

  const idle = new AnimationClip("idle", 2, [
    bob("body", [0, 1, 2], [0, 0.04, 0], 0.6),
    swing("tail", [0, 0.66, 1.33, 2], [0.1, 0.3, -0.05, 0.1]),
    swing("head", [0, 1, 2], [0.04, -0.06, 0.04]),
    swing("legLeft", [0, 2], [0, 0]),
    swing("legRight", [0, 2], [0, 0]),
    swing("armLeft", [0, 1, 2], [0.12, -0.04, 0.12]),
    swing("armRight", [0, 1, 2], [-0.04, 0.12, -0.04]),
  ]);

  const run = new AnimationClip("run", 0.42, [
    bob("body", [0, 0.105, 0.21, 0.315, 0.42], [0, 0.06, 0, 0.06, 0], 0.6),
    swing("legLeft", [0, 0.21, 0.42], [1.1, -1.1, 1.1]),
    swing("legRight", [0, 0.21, 0.42], [-1.1, 1.1, -1.1]),
    swing("armLeft", [0, 0.21, 0.42], [-1, 1, -1]),
    swing("armRight", [0, 0.21, 0.42], [1, -1, 1]),
    swing("tail", [0, 0.21, 0.42], [-0.35, 0.05, -0.35]),
    swing("head", [0, 0.21, 0.42], [-0.12, -0.04, -0.12]),
  ]);

  const jump = new AnimationClip("jump", 0.6, [
    bob("body", [0, 0.3, 0.6], [0.03, 0.07, 0.03], 0.6),
    swing("legLeft", [0, 0.3, 0.6], [0.85, 1.05, 0.85]),
    swing("legRight", [0, 0.3, 0.6], [-0.5, -0.3, -0.5]),
    swing("armLeft", [0, 0.3, 0.6], [-1.7, -1.9, -1.7]),
    swing("armRight", [0, 0.3, 0.6], [-1.6, -1.4, -1.6]),
    swing("tail", [0, 0.3, 0.6], [-0.7, -0.5, -0.7]),
    swing("head", [0, 0.3, 0.6], [0.1, 0.16, 0.1]),
  ]);

  return { clips: [idle, jump, run], rig };
}
