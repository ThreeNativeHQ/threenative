import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { createMaterials } from "./materials.js";
import { palette } from "./palette.js";

export function board(width = 28, depth = 20): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, 0.2, depth), createMaterials().ground);
  mesh.position.y = -0.1;
  mesh.receiveShadow = true;
  mesh.name = "build-ground";
  return mesh;
}

export function buildTiles(width = 28, depth = 20, size = 2): Group {
  const group = new Group();
  group.name = "build-tiles";
  const geometry = new BoxGeometry(size, 0.02, size);
  const columns = Math.floor(width / size);
  const rows = Math.floor(depth / size);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const tile = new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: palette.accent,
          depthWrite: false,
          emissive: palette.accent,
          emissiveIntensity: 0,
          opacity: 0,
          roughness: 0.7,
          transparent: true,
        }),
      );
      tile.name = `build-tile-${column}-${row}`;
      tile.position.set((column + 0.5) * size - width / 2, 0.01, (row + 0.5) * size - depth / 2);
      tile.visible = false;
      group.add(tile);
    }
  }
  return group;
}

export function setTileHighlighted(tile: Object3D, highlighted: boolean): void {
  if (!(tile instanceof Mesh) || !(tile.material instanceof MeshStandardMaterial)) return;
  tile.visible = highlighted;
  tile.material.emissiveIntensity = highlighted ? 0.8 : 0;
  tile.material.opacity = highlighted ? 0.42 : 0;
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

export function commander(): Group {
  const materials = createMaterials();
  const group = new Group();
  const base = new Mesh(new CylinderGeometry(0.55, 0.7, 0.16, 8), materials.shadow);
  base.position.y = 0.08;
  const ring = new Mesh(new TorusGeometry(0.5, 0.06, 8, 16), materials.route);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  const beacon = new Mesh(new SphereGeometry(0.3, 12, 8), materials.accent);
  beacon.position.y = 0.5;
  for (const mesh of [base, ring, beacon]) mesh.castShadow = mesh.receiveShadow = true;
  group.add(base, ring, beacon);
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
