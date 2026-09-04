import { BoxGeometry, Group, Mesh, SphereGeometry } from "three";
import { palette, toon } from "./palette.js";

export interface CharacterRig {
  readonly arms: [Group, Group];
  readonly legs: [Group, Group];
  readonly root: Group;
  readonly torso: Group;
}

function limb(side: number, y: number): Group {
  const joint = new Group();
  joint.position.set(side * 0.18, y, 0);
  const mesh = new Mesh(new BoxGeometry(0.2, 0.42, 0.2), toon(palette.furLight));
  mesh.position.y = -0.21;
  mesh.castShadow = true;
  joint.add(mesh);
  return joint;
}

export function createCharacterRig(): CharacterRig {
  const root = new Group();
  const torso = new Group();
  torso.position.y = 0.72;
  root.add(torso);
  const jacket = new Mesh(new BoxGeometry(0.62, 0.62, 0.46), toon(palette.jacket));
  jacket.castShadow = true;
  torso.add(jacket);
  const head = new Mesh(new SphereGeometry(0.32, 12, 8), toon(palette.fur));
  head.position.y = 0.55;
  head.castShadow = true;
  torso.add(head);
  const nose = new Mesh(new SphereGeometry(0.07, 8, 6), toon(palette.eye));
  nose.position.set(0, 0.5, 0.3);
  torso.add(nose);
  const arms: [Group, Group] = [limb(-1, 0.2), limb(1, 0.2)];
  const legs: [Group, Group] = [limb(-1, 0.48), limb(1, 0.48)];
  torso.add(...arms);
  root.add(...legs);
  return { arms, legs, root, torso };
}

export function animateCharacter(
  rig: CharacterRig,
  state: string,
  time: number,
  speed: number,
): void {
  const swing = state === "run" ? Math.sin(time * 15) * 0.8 : 0;
  rig.legs[0].rotation.z = swing;
  rig.legs[1].rotation.z = -swing;
  rig.arms[0].rotation.z = -swing * 0.7;
  rig.arms[1].rotation.z = swing * 0.7;
  rig.torso.position.y = 0.72 + (state === "idle" ? Math.sin(time * 3) * 0.025 : 0);
  rig.root.rotation.y += (speed > 0.1 ? 0.04 : 0) * Math.sign(speed);
}
