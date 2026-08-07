import { AmbientLight, DirectionalLight, Group, HemisphereLight } from "three";

export function createLighting(): Group {
  const group = new Group();
  group.add(new HemisphereLight(0xbbeaff, 0x486b3c, 2.25));
  group.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xfff2c8, 4.2);
  sun.position.set(-9, 16, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -15;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  group.add(sun);
  const rim = new DirectionalLight(0x70d8ff, 1.8);
  rim.position.set(12, 9, -18);
  group.add(rim);
  return group;
}
