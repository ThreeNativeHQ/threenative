import { BoxGeometry, CylinderGeometry, Group, type Material, Mesh } from "three";

export function vehicle(
  materials: ReturnType<typeof import("./materials.js").createMaterials>,
): Group {
  const root = new Group();
  const chassis = new Mesh(new BoxGeometry(2.7, 0.38, 1.6), materials.vehicle);
  chassis.position.y = 0.35;
  chassis.castShadow = true;
  const nose = new Mesh(new BoxGeometry(0.75, 0.2, 1.15), materials.vehicle);
  nose.position.set(1.02, 0.52, 0);
  nose.castShadow = true;
  const cabin = new Mesh(new BoxGeometry(0.9, 0.42, 1.05), materials.glass);
  cabin.position.set(-0.18, 0.68, 0);
  cabin.castShadow = true;
  root.add(chassis, nose, cabin);
  for (const x of [-0.82, 0.82]) {
    for (const z of [-0.86, 0.86]) {
      const wheel = new Mesh(new CylinderGeometry(0.28, 0.28, 0.18, 12), materials.tire);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.2, z);
      wheel.castShadow = true;
      root.add(wheel);
    }
  }
  return root;
}

export function flag(material: Material): Group {
  const root = new Group();
  const pole = new Mesh(new CylinderGeometry(0.035, 0.035, 1.8, 8), material);
  pole.position.y = 0.9;
  const cloth = new Mesh(new BoxGeometry(0.65, 0.28, 0.04), material);
  cloth.position.set(0.3, 1.55, 0);
  root.add(pole, cloth);
  return root;
}
