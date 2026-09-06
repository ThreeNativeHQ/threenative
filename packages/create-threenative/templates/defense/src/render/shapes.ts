import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createMaterials } from "./materials.js";
import { palette } from "./palette.js";

export function board(width = 28, depth = 20): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, 0.2, depth), createMaterials().ground);
  mesh.position.y = -0.1;
  mesh.receiveShadow = true;
  mesh.name = "build-ground";
  return mesh;
}

/**
 * Everything around the board: a plinth under it, terrain out to the horizon, and hills.
 *
 * The board used to hang unsupported in the sky colour. A tower-defence board is a *place* — the
 * route comes from somewhere and leads somewhere — and with nothing around it the frame read as a
 * UI mock-up of a board rather than a sector being defended.
 */
export function surrounds(width = 28, depth = 20): Group {
  const materials = createMaterials();
  const group = new Group();
  group.name = "surrounds";
  // Eighteen hills, a plinth, a rim and a ground plate are one draw each unless they are baked
  // down; nothing here ever moves.
  const parts: Mesh[] = [];

  const plinth = new Mesh(new BoxGeometry(width + 2.4, 1.1, depth + 2.4), materials.terrain);
  plinth.position.y = -0.75;
  plinth.receiveShadow = true;
  parts.push(plinth);
  const rim = new Mesh(new BoxGeometry(width + 3.4, 0.32, depth + 3.4), materials.plating);
  rim.position.y = -1.25;
  rim.receiveShadow = true;
  parts.push(rim);

  const ground = new Mesh(new BoxGeometry(150, 1, 150), materials.terrain);
  ground.position.y = -1.9;
  ground.receiveShadow = true;
  parts.push(ground);

  // Hills on the horizon. Seeded, so two captures of the same build frame the same skyline.
  let seed = 7734;
  const jitter = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2 + jitter() * 0.2;
    const distance = 54 + jitter() * 30;
    const radius = 12 + jitter() * 16;
    const hill = new Mesh(new SphereGeometry(radius, 10, 6), materials.distant);
    hill.position.set(Math.cos(angle) * distance, -radius * 0.62 - 1.4, Math.sin(angle) * distance);
    hill.scale.y = 0.5 + jitter() * 0.35;
    parts.push(hill);
  }

  const byMaterial = new Map<Material, Mesh[]>();
  for (const mesh of parts) {
    const bucket = byMaterial.get(mesh.material as Material);
    if (bucket === undefined) byMaterial.set(mesh.material as Material, [mesh]);
    else bucket.push(mesh);
  }
  for (const [material, meshes] of byMaterial) {
    const geometry = mergeGeometries(
      meshes.map((mesh) => {
        mesh.updateMatrix();
        const placed = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        const cloned = placed.index === null ? placed : placed.toNonIndexed();
        for (const name of Object.keys(cloned.attributes)) {
          if (name !== "position") cloned.deleteAttribute(name);
        }
        return cloned;
      }),
      false,
    );
    if (geometry === null) throw new Error("mergeGeometries returned null baking the surrounds.");
    geometry.computeVertexNormals();
    const merged = new Mesh(geometry, material);
    merged.receiveShadow = true;
    group.add(merged);
  }
  return group;
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

/** A turret: a plinth, an armoured column, a rotating head and a barrel that points somewhere. */
export function tower(): Group {
  const materials = createMaterials();
  const group = new Group();
  const plinth = new Mesh(new CylinderGeometry(0.82, 0.96, 0.24, 8), materials.plating);
  plinth.position.y = 0.12;
  const column = new Mesh(new CylinderGeometry(0.46, 0.6, 0.8, 8), materials.plating);
  column.position.y = 0.62;
  const collar = new Mesh(new TorusGeometry(0.5, 0.07, 6, 12), materials.accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.02;
  const head = new Mesh(new BoxGeometry(0.72, 0.36, 0.86), materials.tower);
  head.position.y = 1.2;
  // A barrel is the whole read: without one a tower is a bollard.
  const barrel = new Mesh(new CylinderGeometry(0.11, 0.13, 0.9, 7), materials.plating);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.24, -0.6);
  const muzzle = new Mesh(new CylinderGeometry(0.16, 0.16, 0.16, 7), materials.accent);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 1.24, -1.02);
  const parts = [plinth, column, collar, head, barrel, muzzle];
  for (const mesh of parts) mesh.castShadow = mesh.receiveShadow = true;
  group.add(...parts);
  return group;
}

/** A walker: a hull, a lit eye and four legs. A sphere with a dot on it had no facing at all. */
export function attacker(): Group {
  const materials = createMaterials();
  const group = new Group();
  const hull = new Mesh(new BoxGeometry(0.6, 0.34, 0.74), materials.attacker);
  hull.position.y = 0.62;
  const dome = new Mesh(new SphereGeometry(0.26, 10, 6), materials.attacker);
  dome.scale.y = 0.7;
  dome.position.y = 0.78;
  const eye = new Mesh(new SphereGeometry(0.11, 8, 6), materials.hostile);
  eye.position.set(0, 0.72, -0.38);
  const parts: Mesh[] = [hull, dome, eye];
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const leg = new Mesh(new CylinderGeometry(0.05, 0.04, 0.5, 5), materials.plating);
    leg.position.set(x * 0.26, 0.27, z * 0.28);
    leg.rotation.z = x * 0.22;
    leg.rotation.x = z * -0.16;
    parts.push(leg);
  }
  for (const mesh of parts) mesh.castShadow = true;
  group.add(...parts);
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

/** The thing being defended: a plinth, a shielded core and three pylons around it. */
export function base(): Group {
  const materials = createMaterials();
  const group = new Group();
  const plinth = new Mesh(new CylinderGeometry(1.5, 1.7, 0.3, 8), materials.plating);
  plinth.position.y = 0.15;
  const collar = new Mesh(new TorusGeometry(1.2, 0.1, 6, 16), materials.accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.34;
  const core = new Mesh(new CylinderGeometry(0.5, 0.78, 1.3, 6), materials.accent);
  core.position.y = 0.95;
  const cap = new Mesh(new SphereGeometry(0.5, 10, 6), materials.accent);
  cap.scale.y = 0.7;
  cap.position.y = 1.6;
  const parts: Mesh[] = [plinth, collar, core, cap];
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    const pylon = new Mesh(new BoxGeometry(0.2, 1.5, 0.2), materials.plating);
    pylon.position.set(Math.cos(angle) * 1.25, 0.75, Math.sin(angle) * 1.25);
    pylon.rotation.y = angle;
    parts.push(pylon);
    const tip = new Mesh(new SphereGeometry(0.15, 8, 5), materials.accent);
    tip.position.set(Math.cos(angle) * 1.25, 1.58, Math.sin(angle) * 1.25);
    parts.push(tip);
  }
  for (const mesh of parts) mesh.castShadow = mesh.receiveShadow = true;
  group.add(...parts);
  return group;
}
