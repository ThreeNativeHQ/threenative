import { BoxGeometry, CylinderGeometry, Group, Mesh, type Object3D, SphereGeometry } from "three";
import { createMaterials } from "./materials.js";

export function board(width = 28, depth = 20): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, 0.2, depth), createMaterials().ground);
  mesh.position.y = -0.1;
  mesh.receiveShadow = true;
  mesh.name = "build-ground";
  return mesh;
}

export function routeSegment(length: number, width: number): Object3D {
  const materials = createMaterials();
  const group = new Group();
  const road = new Mesh(new BoxGeometry(length, 0.14, width), materials.route);
  road.position.y = 0.04;
  road.receiveShadow = true;
  group.add(road);
  for (const side of [-1, 1]) {
    const edge = new Mesh(new BoxGeometry(length, 0.04, 0.08), materials.accent);
    edge.position.set(0, 0.13, side * (width / 2 - 0.12));
    group.add(edge);
  }
  return group;
}

export function tower(): Group {
  const materials = createMaterials();
  const group = new Group();
  const base = new Mesh(new CylinderGeometry(0.78, 0.92, 0.22, 8), materials.shadow);
  base.position.y = 0.12;
  const body = new Mesh(new CylinderGeometry(0.52, 0.62, 0.86, 8), materials.tower);
  body.position.y = 0.61;
  const head = new Mesh(new BoxGeometry(0.8, 0.22, 0.8), materials.accent);
  head.position.y = 1.12;
  for (const mesh of [base, body, head]) mesh.castShadow = mesh.receiveShadow = true;
  group.add(base, body, head);
  return group;
}

export function attacker(): Group {
  const materials = createMaterials();
  const group = new Group();
  const body = new Mesh(new SphereGeometry(0.42, 12, 8), materials.attacker);
  body.scale.y = 0.86;
  body.position.y = 0.55;
  body.castShadow = true;
  const core = new Mesh(new SphereGeometry(0.14, 10, 6), materials.accent);
  core.position.set(0, 0.58, -0.34);
  core.castShadow = true;
  group.add(body, core);
  return group;
}

export function base(): Group {
  const materials = createMaterials();
  const group = new Group();
  const plinth = new Mesh(new CylinderGeometry(1.4, 1.6, 0.24, 8), materials.shadow);
  plinth.position.y = 0.12;
  const beacon = new Mesh(new CylinderGeometry(0.74, 0.92, 1.2, 8), materials.accent);
  beacon.position.y = 0.72;
  plinth.castShadow = plinth.receiveShadow = true;
  beacon.castShadow = beacon.receiveShadow = true;
  group.add(plinth, beacon);
  return group;
}
