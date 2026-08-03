import { AmbientLight, Group, PointLight } from "three";

export function createLighting(): Group {
  const rig = new Group();
  rig.add(new AmbientLight(0x17344a, 1.4));
  const lamp = new PointLight(0xffd27a, 2.5, 420);
  lamp.position.set(0, 0, 90);
  rig.add(lamp);
  return rig;
}
