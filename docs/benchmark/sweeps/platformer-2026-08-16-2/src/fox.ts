import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  SphereGeometry,
} from "three/webgpu";
import { PALETTE } from "./palette.js";
import { matte } from "./props.js";

export interface IFoxRig {
  root: Group;
  body: Group;
  legLeft: Group;
  legRight: Group;
  armLeft: Group;
  armRight: Group;
  tail: Group;
  head: Group;
}

function part(
  geometry: BoxGeometry | SphereGeometry | CapsuleGeometry | ConeGeometry,
  color: Color,
): Mesh {
  const mesh = new Mesh(geometry, matte(color, 0.78));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Rounded toy fox in a blue jacket — the reference's silhouette, built from primitives. */
export function makeFox(): IFoxRig {
  const root = new Group();
  const body = new Group();
  root.add(body);

  const torso = part(new CapsuleGeometry(0.28, 0.3, 6, 14), PALETTE.jacket);
  torso.position.y = 0.62;
  body.add(torso);

  const belly = part(new SphereGeometry(0.24, 14, 12), PALETTE.furLight);
  belly.position.set(0, 0.55, 0.14);
  belly.scale.set(0.85, 1.0, 0.6);
  body.add(belly);

  const backpack = part(new BoxGeometry(0.34, 0.34, 0.2), new Color("#2a5fa8"));
  backpack.position.set(0, 0.68, -0.3);
  body.add(backpack);
  const strap = part(new BoxGeometry(0.1, 0.12, 0.08), PALETTE.woodLight);
  strap.position.set(0, 0.68, -0.41);
  body.add(strap);

  const head = new Group();
  head.position.set(0, 1.02, 0.02);
  body.add(head);

  const skull = part(new SphereGeometry(0.33, 18, 14), PALETTE.furOrange);
  skull.scale.set(1, 0.94, 1.02);
  head.add(skull);

  const muzzle = part(new SphereGeometry(0.2, 14, 12), PALETTE.furLight);
  muzzle.position.set(0, -0.06, 0.24);
  muzzle.scale.set(0.9, 0.72, 0.9);
  head.add(muzzle);

  const nose = part(new SphereGeometry(0.06, 10, 8), new Color("#2b1d16"));
  nose.position.set(0, -0.02, 0.42);
  head.add(nose);

  for (const side of [-1, 1]) {
    const ear = part(new ConeGeometry(0.14, 0.34, 10), PALETTE.furOrange);
    ear.position.set(side * 0.19, 0.3, -0.02);
    ear.rotation.z = side * 0.25;
    head.add(ear);
    const earInner = part(new ConeGeometry(0.08, 0.2, 8), new Color("#2b1d16"));
    earInner.position.set(side * 0.19, 0.32, 0.03);
    earInner.rotation.z = side * 0.25;
    head.add(earInner);

    const eye = part(new SphereGeometry(0.055, 10, 8), new Color("#221610"));
    eye.position.set(side * 0.14, 0.05, 0.28);
    head.add(eye);

    const cheek = part(new SphereGeometry(0.09, 10, 8), PALETTE.furLight);
    cheek.position.set(side * 0.27, -0.02, 0.1);
    cheek.scale.set(0.7, 0.8, 0.9);
    head.add(cheek);
  }

  const tail = new Group();
  tail.position.set(0, 0.6, -0.28);
  body.add(tail);
  const tailBase = part(new CapsuleGeometry(0.14, 0.28, 6, 12), PALETTE.furOrange);
  tailBase.rotation.x = 1.1;
  tailBase.position.set(0, 0.02, -0.16);
  tail.add(tailBase);
  const tailMid = part(new SphereGeometry(0.17, 12, 10), PALETTE.furOrange);
  tailMid.position.set(0, 0.06, -0.36);
  tail.add(tailMid);
  const tailTip = part(new SphereGeometry(0.16, 12, 10), PALETTE.furLight);
  tailTip.position.set(0, 0.14, -0.55);
  tail.add(tailTip);

  const legLeft = new Group();
  const legRight = new Group();
  const armLeft = new Group();
  const armRight = new Group();

  const limbs: Array<[Group, number, boolean]> = [
    [legLeft, -1, false],
    [legRight, 1, false],
    [armLeft, -1, true],
    [armRight, 1, true],
  ];
  for (const [group, side, isArm] of limbs) {
    group.position.set(side * (isArm ? 0.29 : 0.14), isArm ? 0.74 : 0.36, 0);
    body.add(group);
    const limb = part(
      new CapsuleGeometry(isArm ? 0.09 : 0.1, isArm ? 0.2 : 0.22, 5, 10),
      isArm ? PALETTE.jacket : PALETTE.furOrange,
    );
    limb.position.y = -0.16;
    group.add(limb);
    const end = part(new SphereGeometry(isArm ? 0.1 : 0.12, 10, 8), PALETTE.furLight);
    end.position.set(0, -0.32, isArm ? 0 : 0.04);
    if (!isArm) end.scale.set(1, 0.8, 1.3);
    group.add(end);
  }

  root.scale.setScalar(1.0);
  return { root, body, legLeft, legRight, armLeft, armRight, tail, head };
}

/** Run cycle, jump tuck, and idle bob — driven by speed and airborne state. */
export function animateFox(
  rig: IFoxRig,
  time: number,
  speed: number,
  grounded: boolean,
  verticalVelocity: number,
): void {
  const running = Math.min(1, speed / 6);
  const cycle = time * 11;

  if (!grounded) {
    const tuck = verticalVelocity > 0 ? -0.9 : 0.5;
    rig.legLeft.rotation.x = tuck;
    rig.legRight.rotation.x = tuck * 0.55;
    rig.armLeft.rotation.x = -2.1;
    rig.armRight.rotation.x = -1.7;
    rig.body.position.y = 0;
    rig.body.rotation.x = verticalVelocity > 0 ? -0.12 : 0.1;
  } else {
    const swing = Math.sin(cycle) * (0.15 + running * 0.85);
    rig.legLeft.rotation.x = swing;
    rig.legRight.rotation.x = -swing;
    rig.armLeft.rotation.x = -swing * 0.9;
    rig.armRight.rotation.x = swing * 0.9;
    rig.body.position.y = Math.abs(Math.sin(cycle)) * 0.06 * running + Math.sin(time * 2.2) * 0.012;
    rig.body.rotation.x = running * 0.18;
  }

  rig.armLeft.rotation.z = 0.12;
  rig.armRight.rotation.z = -0.12;
  rig.tail.rotation.x = Math.sin(cycle * 0.5) * 0.18 - running * 0.35;
  rig.tail.rotation.z = Math.sin(cycle * 0.5 + 1) * 0.12;
  rig.head.rotation.x = -running * 0.1 + Math.sin(time * 2) * 0.02;
}
