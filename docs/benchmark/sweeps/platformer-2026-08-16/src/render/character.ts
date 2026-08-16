// The player character: a small fox in a blue jacket, built from the same
// rounded primitives as everything else so it belongs to the same toy world.
//
// The rig is deliberately tiny — six moving parts. What sells a run cycle at
// this scale is the body bob and the counter-swinging limbs, not joint count.
// The model faces -z at rest, which is Three.js's convention, so the scene can
// yaw it with `atan2(dx, dz)` without a correction term.
import { Group, Object3D } from "three";
import type { Materials } from "./materials.js";
import { ball, block, spike, tube } from "./shapes.js";

export interface IFoxRig {
  readonly root: Group;
  /** Drive the run cycle. `speed` is 0..1, `airborne` swaps in a jump pose. */
  readonly pose: (elapsed: number, speed: number, airborne: boolean, rise: number) => void;
}

export function createFox(materials: Materials): IFoxRig {
  const root = new Group();
  root.name = "fox";

  const body = new Group();
  body.position.y = 0.52;
  root.add(body);

  const torso = block(0.44, 0.46, 0.38, materials.jacket, { radius: 0.16 });
  body.add(torso);
  const collar = block(0.46, 0.1, 0.4, materials.cream, { radius: 0.05 });
  collar.position.y = 0.2;
  body.add(collar);
  const belly = block(0.3, 0.3, 0.16, materials.furLight, { radius: 0.12 });
  belly.position.set(0, -0.05, -0.18);
  body.add(belly);
  const pack = block(0.3, 0.28, 0.18, materials.woodDark, { radius: 0.09 });
  pack.position.set(0, 0.02, 0.2);
  body.add(pack);
  const packFlap = block(0.26, 0.1, 0.06, materials.woodLight, { radius: 0.04 });
  packFlap.position.set(0, 0.13, 0.27);
  body.add(packFlap);

  const head = new Group();
  head.position.y = 0.42;
  body.add(head);
  const skull = ball(0.29, materials.fur, { segments: 20 });
  skull.scale.set(1, 0.95, 1.02);
  head.add(skull);
  const muzzle = ball(0.16, materials.furLight, { segments: 16 });
  muzzle.scale.set(0.9, 0.72, 1);
  muzzle.position.set(0, -0.07, -0.22);
  head.add(muzzle);
  const nose = ball(0.06, materials.ink);
  nose.position.set(0, -0.03, -0.34);
  head.add(nose);
  const cheekFur = ball(0.12, materials.furLight);
  cheekFur.scale.set(1.6, 0.8, 0.7);
  cheekFur.position.set(0, -0.12, -0.06);
  head.add(cheekFur);
  for (const side of [-1, 1]) {
    // Big ears, light inside. Dark ear linings read as horns from behind, which
    // is the angle this character is seen from for the whole game.
    const ear = spike(0.15, 0.4, materials.fur, { segments: 10 });
    ear.position.set(side * 0.2, 0.34, 0.01);
    ear.rotation.z = side * 0.34;
    head.add(ear);
    const earInner = spike(0.085, 0.24, materials.furLight, { segments: 8 });
    earInner.position.set(side * 0.215, 0.33, -0.05);
    earInner.rotation.z = side * 0.34;
    head.add(earInner);
    const eye = ball(0.055, materials.ink);
    eye.position.set(side * 0.13, 0.03, -0.24);
    eye.scale.set(0.85, 1.15, 0.7);
    head.add(eye);
  }

  const tail = new Group();
  tail.position.set(0, -0.06, 0.2);
  body.add(tail);
  // A big tail carried high: it is half this character's silhouette from
  // behind, and a small one just reads as a lump on its back.
  let radius = 0.21;
  let offset = 0.14;
  let lift = 0;
  for (let index = 0; index < 5; index += 1) {
    const segment = ball(radius, index === 4 ? materials.white : materials.fur, { segments: 14 });
    segment.position.set(0, lift, offset);
    tail.add(segment);
    offset += radius * 0.72;
    lift += 0.05 + index * 0.012;
    radius *= 0.93;
  }

  const limbs: { readonly node: Group; readonly phase: number; readonly swing: number }[] = [];
  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.13, 0.28, 0);
    root.add(leg);
    const shin = tube(0.075, 0.07, 0.3, materials.cream);
    shin.position.y = -0.15;
    leg.add(shin);
    const foot = ball(0.11, materials.furLight);
    foot.scale.set(1, 0.7, 1.5);
    foot.position.set(0, -0.29, -0.05);
    leg.add(foot);
    limbs.push({ node: leg, phase: side > 0 ? 0 : Math.PI, swing: 1 });

    const arm = new Group();
    arm.position.set(side * 0.25, 0.66, 0);
    root.add(arm);
    const sleeve = tube(0.065, 0.06, 0.26, materials.jacket);
    sleeve.position.y = -0.13;
    arm.add(sleeve);
    const paw = ball(0.085, materials.furLight);
    paw.position.y = -0.28;
    arm.add(paw);
    limbs.push({ node: arm, phase: side > 0 ? Math.PI : 0, swing: 0.8 });
  }

  root.traverse((child: Object3D) => {
    const mesh = child as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
    if (mesh.isMesh !== true) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  const pose = (elapsed: number, speed: number, airborne: boolean, rise: number): void => {
    const cycle = elapsed * (6 + speed * 6);
    const run = Math.min(1, speed);
    if (airborne) {
      // A readable jump silhouette: knees up in front, arms back, tail high.
      for (const limb of limbs) {
        const forward = limb.swing > 0.9 ? 0.9 : -0.7;
        limb.node.rotation.x = forward - Math.min(0.5, Math.max(-0.5, rise)) * 0.35;
      }
      body.position.y = 0.55;
      body.rotation.x = -0.12;
      tail.rotation.x = -0.5;
      tail.rotation.y = 0;
      head.rotation.x = 0.1;
      return;
    }
    for (const limb of limbs) {
      limb.node.rotation.x = Math.sin(cycle + limb.phase) * 0.95 * run * limb.swing;
    }
    // Two bobs per stride, plus a small lean into the run.
    body.position.y = 0.52 + Math.abs(Math.sin(cycle)) * 0.045 * run;
    body.rotation.x = -0.16 * run;
    body.rotation.z = Math.sin(cycle) * 0.06 * run;
    head.rotation.x = 0.1 * run + Math.sin(cycle * 2) * 0.03;
    tail.rotation.x = -0.35 - Math.sin(cycle) * 0.12 * run;
    tail.rotation.y = Math.sin(cycle * 0.5) * 0.35 * (0.4 + run);
  };

  pose(0, 0, false, 0);
  return { root, pose };
}
