import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { roundedBox } from "./shapes.js";

const colours = {
  beacon: 0x52e1d5,
  canopy: 0x264d49,
  clock: 0xffce67,
  stone: 0x96a8c0,
  tower: 0x8f603d,
  trunk: 0x50382e,
} as const;

function shadow(mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tree(x: number, z: number, scale: number): Group {
  const group = new Group();
  const trunkMaterial = new MeshStandardMaterial({ color: colours.trunk, roughness: 0.92 });
  const canopyMaterial = new MeshBasicMaterial({ color: colours.canopy });
  const trunk = shadow(new Mesh(new CylinderGeometry(0.24, 0.32, 1.8, 10), trunkMaterial));
  trunk.position.y = 0.9;
  const canopy = shadow(new Mesh(new SphereGeometry(1.55, 18, 12), canopyMaterial));
  canopy.position.y = 2.15;
  canopy.scale.set(1, 1.08, 0.72);
  group.add(trunk, canopy);
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  return group;
}

function beacon(x: number, z: number): Group {
  const group = new Group();
  const stone = new MeshStandardMaterial({ color: colours.stone, roughness: 0.72 });
  const glow = new MeshStandardMaterial({
    color: colours.beacon,
    emissive: colours.beacon,
    emissiveIntensity: 1.8,
    roughness: 0.25,
  });
  const plinth = shadow(new Mesh(roundedBox(0.72, 0.62, 0.72, 0.08), stone));
  plinth.position.set(0.32, 0.31, 0);
  const marker = shadow(new Mesh(new SphereGeometry(0.22, 16, 10), glow));
  marker.position.set(-0.28, 0.18, 0.16);
  group.add(plinth, marker);
  group.position.set(x, 0, z);
  return group;
}

function clockTower(): Group {
  const group = new Group();
  const wood = new MeshStandardMaterial({ color: colours.tower, roughness: 0.78 });
  const gold = new MeshStandardMaterial({
    color: colours.clock,
    emissive: 0x6e3f0a,
    emissiveIntensity: 0.48,
    roughness: 0.38,
  });
  const body = shadow(new Mesh(roundedBox(1.9, 3.7, 1.05, 0.1), wood));
  body.position.y = 1.85;
  const roof = shadow(new Mesh(new ConeGeometry(1.65, 1.35, 4), gold));
  roof.position.y = 4.35;
  roof.rotation.y = Math.PI / 4;
  const face = shadow(new Mesh(new CylinderGeometry(0.5, 0.5, 0.1, 32), gold));
  face.position.set(0, 2.58, 0.57);
  face.rotation.x = Math.PI / 2;
  const rim = shadow(new Mesh(new TorusGeometry(0.5, 0.06, 10, 32), gold));
  rim.position.copy(face.position);
  const handMaterial = new MeshStandardMaterial({ color: 0x473227, roughness: 0.6 });
  const hour = shadow(new Mesh(roundedBox(0.08, 0.34, 0.06, 0.02), handMaterial));
  hour.position.set(-0.07, 2.66, 0.64);
  hour.rotation.z = -0.5;
  const minute = shadow(new Mesh(roundedBox(0.07, 0.44, 0.06, 0.02), handMaterial));
  minute.position.set(0.12, 2.7, 0.65);
  minute.rotation.z = 0.72;
  group.add(body, roof, face, rim, hour, minute);
  group.position.z = -5.1;
  return group;
}

/** The reference-specific scene kit. Delete the MCP and this remains ordinary Three.js. */
export function createForestHub(): Group {
  const hub = new Group();
  hub.add(
    clockTower(),
    tree(-5.25, -4.8, 1.2),
    tree(5.25, -4.8, 1.16),
    tree(-4.35, -1.45, 0.84),
    tree(4.35, -1.45, 0.86),
    beacon(-3.1, -1.35),
    beacon(3.1, -1.55),
  );
  hub.position.x = -2;
  return hub;
}
