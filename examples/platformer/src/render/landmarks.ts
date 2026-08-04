// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// The three silhouettes the reference frame puts behind the playfield: a castle
// keep, a windmill, and an airship drifting past. None of them is reachable and
// none of them collides — they exist so the skyline has landmarks and the world
// reads as bigger than the corridor you can walk.
//
// All three are built to read as *shapes*, not detail: at this distance a
// crenellated parapet is four blocks and a windmill is four blades.
import { Group, type Object3D } from "three";
import type { Materials } from "./materials.js";
import { ball, block, spike, tube } from "./shapes.js";

function unlitProp(object: Object3D): void {
  object.traverse((child) => {
    child.castShadow = false;
    child.receiveShadow = false;
  });
}

/** A keep: three stacked drums, a crenellated crown, and a conical roof. */
export function castle(materials: Materials): Group {
  const group = new Group();
  const keep = block(6, 11, 6, materials.rock, { radius: 0.5 });
  keep.position.y = 5.5;
  group.add(keep);
  const band = block(6.6, 1.1, 6.6, materials.rockDark, { radius: 0.3 });
  band.position.y = 7.4;
  group.add(band);
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const merlon = block(1.1, 1.2, 1.1, materials.rockLit, { radius: 0.18 });
    merlon.position.set(Math.cos(angle) * 2.6, 11.6, Math.sin(angle) * 2.6);
    group.add(merlon);
  }
  const roof = spike(3.4, 5, materials.roof, { segments: 10 });
  roof.position.y = 14.4;
  group.add(roof);
  const finial = ball(0.5, materials.coin, { segments: 10 });
  finial.position.y = 17.2;
  group.add(finial);
  for (const [x, z] of [
    [-4.4, 2.6],
    [4.4, -2.6],
  ] as const) {
    const turret = tube(1.2, 1.5, 8, materials.rockLit, { segments: 10 });
    turret.position.set(x, 4, z);
    const cone = spike(1.7, 3, materials.roof, { segments: 9 });
    cone.position.set(x, 9.4, z);
    group.add(turret, cone);
  }
  for (let index = 0; index < 3; index += 1) {
    const window_ = block(0.8, 1.2, 0.4, materials.gem, { radius: 0.14 });
    window_.position.set(-1.6 + index * 1.6, 6.4, 3.1);
    group.add(window_);
  }
  unlitProp(group);
  return group;
}

/** A windmill: tower, cap, and four blades on a hub that turns. */
export function windmill(materials: Materials): { group: Group; blades: Group } {
  const group = new Group();
  const tower = tube(1.5, 2.6, 8, materials.cream, { segments: 12 });
  tower.position.y = 4;
  const cap = spike(2, 2.6, materials.roof, { segments: 10 });
  cap.position.y = 9.2;
  group.add(tower, cap);

  const blades = new Group();
  for (let index = 0; index < 4; index += 1) {
    const blade = block(0.7, 6.4, 0.25, materials.plank, { radius: 0.1 });
    blade.position.y = 3.2;
    const arm = new Group();
    arm.rotation.z = (index / 4) * Math.PI * 2;
    arm.add(blade);
    blades.add(arm);
  }
  const hub = ball(0.5, materials.plankDark, { segments: 10 });
  blades.add(hub);
  blades.position.set(0, 8.4, 2.4);
  group.add(blades);
  unlitProp(group);
  return { blades, group };
}

/** An airship: envelope, gondola, fins. It drifts; see `Level.update`. */
export function airship(materials: Materials): Group {
  const group = new Group();
  const envelope = ball(3.2, materials.rockLit, { segments: 16 });
  envelope.scale.set(2.4, 1, 1);
  group.add(envelope);
  for (let index = 0; index < 4; index += 1) {
    const rib = tube(3.25, 3.25, 0.16, materials.rockDark, { segments: 16 });
    rib.rotation.z = Math.PI / 2;
    rib.position.x = -4.2 + index * 2.8;
    rib.scale.set(0.92 - Math.abs(index - 1.5) * 0.12, 1, 0.92 - Math.abs(index - 1.5) * 0.12);
    group.add(rib);
  }
  const gondola = block(3.4, 1.2, 1.4, materials.plank, { radius: 0.3 });
  gondola.position.y = -3.4;
  const strut = block(0.2, 1, 0.2, materials.plankDark, { radius: 0.06 });
  strut.position.y = -2.6;
  group.add(gondola, strut);
  for (const side of [-1, 1]) {
    const fin = block(1.6, 0.24, 2.2, materials.roof, { radius: 0.1 });
    fin.position.set(-7, side * 1.2, 0);
    fin.rotation.x = side * 0.5;
    group.add(fin);
  }
  const tail = spike(1.1, 2.4, materials.rockLit, { segments: 10 });
  tail.rotation.z = Math.PI / 2;
  tail.position.x = 8.4;
  group.add(tail);
  unlitProp(group);
  return group;
}
