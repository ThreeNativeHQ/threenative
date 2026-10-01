// Generated for you. This is ordinary Three.js — edit or delete it freely.
//
// Every unit and building, built out of primitives at startup and never authored as a file. One
// geometry per (type, team) per material, so a hundred tanks are one draw per material instead of
// a hundred meshes: `parts(type, team)` is the only thing the rest of the scene ever asks for.
//
// The proportions are the rules table's: a `ranger` is 2.3 m to the crest, a `bunker` is 6.1 m
// across, and every model's footprint matches the collision radius `TYPES[type].r` the simulation
// gives it, so what you see is what the pathfinder refuses to walk through.
import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Shape,
} from "three";
import { STARTS } from "../sim/terrain.js";
import { type EntityType, TYPES } from "../sim/types.js";

export interface IModelPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

export interface IUnitModels {
  /** The merged parts of one model, baked once and shared by every copy of it. */
  readonly parts: (type: EntityType, team: number) => readonly IModelPart[];
  readonly dispose: () => void;
}

const primitiveCache = new Map<string, BufferGeometry>();
const materialCache = new Map<string, Material>();

/** `0xrrggbb` in, a lit material out. Cached, because two hundred tanks share nine materials. */
function material(color: number, emissive = 0, metal = 0.45, rough = 0.65): MeshStandardMaterial {
  const key = `${color}:${emissive}:${metal}:${rough}`;
  const cached = materialCache.get(key);
  if (cached !== undefined) return cached as MeshStandardMaterial;
  const made = new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0 ? 0 : 1.5,
    metalness: metal,
    roughness: rough,
  });
  materialCache.set(key, made);
  return made;
}

/** Unlit: the visor strips and the muzzle glow, which are meant to clip to white. */
function basic(color: number): MeshBasicMaterial {
  const key = `basic${color}`;
  const cached = materialCache.get(key);
  if (cached !== undefined) return cached as MeshBasicMaterial;
  const made = new MeshBasicMaterial({ color });
  materialCache.set(key, made);
  return made;
}

/** A box with its corners cut: the chamfer catches a line of sun and a line of sky, which is what
 * makes a block read as a made object instead of a placeholder. */
function beveledBox(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-0.4, -0.5);
  shape.lineTo(0.4, -0.5);
  shape.lineTo(0.5, -0.4);
  shape.lineTo(0.5, 0.4);
  shape.lineTo(0.4, 0.5);
  shape.lineTo(-0.4, 0.5);
  shape.lineTo(-0.5, 0.4);
  shape.lineTo(-0.5, -0.4);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.035,
    bevelThickness: 0.08,
    depth: 0.84,
    steps: 1,
  });
  geometry.translate(0, 0, -0.42);
  return geometry;
}

function primitive(type: string): BufferGeometry {
  const cached = primitiveCache.get(type);
  if (cached !== undefined) return cached;
  const made =
    type === "box"
      ? beveledBox()
      : type === "cyl"
        ? new CylinderGeometry(1, 1, 1, 12)
        : type === "hex"
          ? new CylinderGeometry(1, 1, 1, 6)
          : type === "cone"
            ? new ConeGeometry(1, 1, 5)
            : type === "sphere"
              ? new IcosahedronGeometry(1, 1)
              : type === "oct"
                ? new OctahedronGeometry(1)
                : new DodecahedronGeometry(1, 0);
  primitiveCache.set(type, made);
  return made;
}

/** One placed primitive. Nine numbers and a material is the whole vocabulary of the artwork. */
type Placed = (
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: Material,
  roll?: number,
) => Mesh;

const place =
  (group: Group, type: string): Placed =>
  (x, y, z, sx, sy, sz, mat, roll = 0) => {
    const mesh = new Mesh(primitive(type), mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.z = roll;
    group.add(mesh);
    return mesh;
  };

/** An extruded footprint: the wings, the bomb bays, anything whose silhouette is a polygon. */
function prism(
  group: Group,
  points: readonly (readonly [number, number])[],
  height: number,
  y: number,
  mat: Material,
): Mesh {
  const key = `prism:${JSON.stringify([points, height])}`;
  let geometry = primitiveCache.get(key);
  if (geometry === undefined) {
    const shape = new Shape();
    points.forEach(([x, z], index) => {
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    geometry = new ExtrudeGeometry(shape, {
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      depth: height,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    primitiveCache.set(key, geometry);
  }
  const mesh = new Mesh(geometry, mat);
  mesh.position.y = y;
  group.add(mesh);
  return mesh;
}

interface IFactionColours {
  readonly armor: Material;
  readonly dark: Material;
  readonly glow: Material;
  readonly gold: Material;
  readonly light: Material;
  readonly plate: Material;
  readonly team: Material;
  readonly trim: Material;
  readonly white: Material;
}

function faction(team: number): IFactionColours {
  const purple = team === 2;
  const enemy = team > 0;
  const own = STARTS[team]?.color ?? 0x69e9ec;
  return {
    armor: material(purple ? 0x5f5475 : enemy ? 0x755348 : 0x425966),
    dark: material(0x17252b),
    glow: basic(own),
    gold: material(0xbca76d),
    light: material(own, own),
    plate: material(purple ? 0x978caf : enemy ? 0xa8806c : 0x8ba5ad),
    team: material(purple ? 0x8f66c7 : enemy ? 0xb44e34 : 0x277e90),
    trim: material(0x2e3a40),
    white: material(0xc4ccc9),
  };
}

/** The artwork. One function, one switch on the type: read it as a shape per unit. */
function compose(type: EntityType, team: number): Group {
  const group = new Group();
  const p = faction(team);
  // The three words the whole model vocabulary is made of: a box, a round post, a hex plinth.
  const boxAt = place(group, "box");
  const post = place(group, "cyl");
  const pillar = place(group, "hex");
  const c = (x: number, y: number, z: number, r: number, h: number, m: Material = p.armor) =>
    post(x, y, z, r, h, r, m);
  const hex = (x: number, y: number, z: number, r: number, h: number, m: Material = p.armor) =>
    pillar(x, y, z, r, h, r, m);
  const b = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    m: Material = p.armor,
    rz = 0,
  ) => boxAt(x, y, z, sx, sy, sz, m, rz);

  if (type === "core") {
    hex(0, 0.32, 0, 5.1, 0.64, p.dark);
    hex(0, 0.72, 0, 4.55, 0.6, p.trim);
    hex(0, 1.55, 0, 3.55, 1.5, p.armor);
    hex(0, 2.53, 0, 3.02, 0.52, p.plate);
    b(0, 3.16, -0.35, 3.55, 1.15, 2.65, p.armor);
    b(0, 3.83, -0.35, 3.8, 0.3, 2.9, p.plate);
    b(0, 3.08, 1.04, 3, 0.43, 0.08, p.glow);
    b(0, 3.25, 1.11, 0.16, 0.7, 0.12, p.dark);
    c(0, 4.15, -0.55, 1.03, 0.65, p.dark);
    c(0, 4.57, -0.55, 0.86, 0.3, p.team);
    c(0, 4.78, -0.55, 0.64, 0.12, p.glow);
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3;
      const x = Math.cos(a) * 3.35;
      const z = Math.sin(a) * 3.35;
      const m = b(x, 1.2, z, 1.9, 1.72, 1.62, p.armor);
      m.rotation.y = -a;
      b(x, 2.1, z, 1.23, 0.12, 1.06, p.team);
      b(x, 1.3, z, 1.3, 0.16, 1.73, p.glow);
    }
    b(0, 0.82, 4.1, 2.8, 0.65, 1.85, p.trim);
    b(0, 1.12, 4.3, 2.65, 0.13, 1.5, p.plate);
    b(0, 1.82, 3.18, 2.1, 1.18, 0.15, p.dark);
    for (let i = 0; i < 5; i += 1) b(0, 1.35 + i * 0.2, 3.3, 1.95, 0.05, 0.08, p.plate);
    for (const x of [-2, 2]) {
      b(x, 3.97, -1.1, 0.22, 1.75, 0.22, p.dark);
      c(x, 4.93, -1.1, 0.15, 0.16, p.glow);
    }
    for (const x of [-1.8, 1.8])
      for (let i = 0; i < 4; i += 1) b(x, 2.86, -1.45 + i * 0.39, 0.7, 0.08, 0.17, p.dark);
  } else if (type === "barracks") {
    b(0, 0.28, 0, 7.2, 0.55, 6.1, p.dark);
    b(0, 1.42, 0, 5.8, 2.3, 4.6, p.armor);
    b(0, 2.8, -0.2, 6.3, 0.55, 4.9, p.plate);
    b(0, 3.16, -0.2, 3.8, 0.3, 3.1, p.team);
    b(0, 1.24, 2.36, 3.7, 1.8, 0.15, p.dark);
    b(0, 2.15, 2.47, 3.8, 0.14, 0.2, p.glow);
    for (const x of [-2.65, 2.65]) {
      b(x, 1.25, 1.8, 0.65, 2.4, 1.6, p.plate);
      b(x, 1.38, 2.62, 0.3, 0.65, 0.07, p.glow);
    }
    for (let i = 0; i < 7; i += 1) b(-1.7 + i * 0.56, 1.35, 2.47, 0.15, 1.45, 0.11, p.trim);
    b(0, 0.51, 3.2, 3.8, 0.22, 1.9, p.plate);
    for (const x of [-1.6, 1.6]) b(x, 0.64, 3.35, 0.18, 0.05, 1.4, p.gold);
    b(-1.8, 3.35, -0.6, 0.3, 0.2, 2.8, p.white);
    for (let i = 0; i < 4; i += 1) b(1.75, 3.36, -1.4 + i * 0.62, 0.85, 0.19, 0.32, p.dark);
    c(2.1, 3.65, -1.6, 0.5, 0.9, p.dark);
    c(2.1, 4.13, -1.6, 0.53, 0.14, p.plate);
  } else if (type === "factory") {
    b(0, 0.28, 0, 8.2, 0.55, 7.2, p.dark);
    b(0, 1.5, -0.35, 7, 2.5, 5.3, p.armor);
    b(0, 2.91, -0.4, 7.3, 0.35, 5.6, p.plate);
    b(0, 1.32, 2.36, 4.8, 2.15, 0.17, p.dark);
    b(0, 2.5, 2.5, 5, 0.15, 0.2, p.glow);
    b(0, 0.55, 3.05, 5, 0.18, 2.2, p.plate);
    for (const x of [-2.8, 2.8]) {
      b(x, 3.28, -0.5, 1.1, 0.4, 4.1, p.team);
      b(x, 4.12, -1.9, 0.4, 2, 0.4, p.dark);
      c(x, 5.21, -1.9, 0.27, 0.13, p.gold);
    }
    for (const x of [-3.63, 3.63])
      for (let i = 0; i < 4; i += 1) b(x, 1.62, -1.85 + i * 1.05, 0.2, 1.7, 0.25, p.trim);
    c(0, 3.36, -1, 1.25, 0.6, p.dark);
    c(0, 3.7, -1, 1, 0.12, p.glow);
  } else if (type === "relay") {
    hex(0, 0.3, 0, 2.4, 0.6, p.dark);
    b(0, 1.15, 0, 3.5, 1.65, 2.65, p.armor);
    b(0, 2.08, 0, 3.75, 0.24, 2.8, p.plate);
    b(0, 2.3, 0, 2.6, 0.18, 1.7, p.team);
    for (const x of [-1.4, 1.4]) b(x, 1.45, 1.4, 0.23, 0.72, 0.1, p.glow);
    b(0, 3.12, 0, 0.32, 1.55, 0.32, p.dark);
    b(0, 4, 0, 1.7, 0.14, 0.14, p.plate);
    c(0, 4.17, 0, 0.17, 0.22, p.glow);
    for (let i = 0; i < 4; i += 1) b(-1.08 + i * 0.72, 2.44, 0, 0.32, 0.09, 1.25, p.dark);
  } else if (type === "refinery") {
    hex(0, 0.36, 0, 3.1, 0.72, p.dark);
    c(0, 1.5, 0, 2.1, 2.1, p.armor);
    c(0, 2.65, 0, 2.34, 0.35, p.plate);
    c(0, 3.15, 0, 1.5, 0.65, p.dark);
    c(0, 3.54, 0, 1.12, 0.16, basic(0xa4ff6b));
    for (let i = 0; i < 4; i += 1) {
      const a = i * Math.PI * 0.5;
      c(Math.sin(a) * 2.05, 1.72, Math.cos(a) * 2.05, 0.6, 2.8, p.trim);
      c(Math.sin(a) * 2.05, 3.17, Math.cos(a) * 2.05, 0.66, 0.12, p.plate);
    }
    for (const x of [-0.8, 0.8]) b(x, 1.5, 2.2, 0.22, 1.2, 0.13, basic(0xb9ec68));
  } else if (type === "turret") {
    hex(0, 0.24, 0, 2.1, 0.48, p.dark);
    hex(0, 0.75, 0, 1.2, 0.6, p.armor);
    c(0, 1.55, 0, 0.58, 1.1, p.trim);
    b(0, 2.18, 0, 2.2, 0.85, 1.7, p.plate);
    b(0, 2.5, 0, 1.3, 0.18, 1.5, p.team);
    for (const x of [-0.7, 0.7]) {
      b(x, 2.18, 1.5, 0.3, 0.28, 2.2, p.dark);
      b(x, 2.18, 2.56, 0.28, 0.25, 0.08, p.glow);
    }
    b(0, 2.66, 0.62, 0.65, 0.25, 0.22, p.glow);
  } else if (type === "ranger") {
    b(0, 1.32, 0, 0.88, 0.76, 0.66, p.armor);
    b(0, 1.55, 0.37, 0.62, 0.36, 0.17, p.plate);
    b(0, 1.95, 0.03, 0.66, 0.56, 0.59, p.plate);
    b(0, 1.99, 0.35, 0.54, 0.14, 0.09, p.glow);
    b(0, 2.26, 0, 0.38, 0.12, 0.36, p.team);
    for (const x of [-0.57, 0.57]) {
      b(x, 1.65, 0.04, 0.43, 0.43, 0.56, p.plate);
      b(x, 1.2, 0.16, 0.23, 0.63, 0.25, p.armor);
    }
    b(0, 1.33, -0.42, 0.68, 0.68, 0.34, p.dark);
    b(-0.22, 1.44, -0.64, 0.12, 0.38, 0.1, p.glow);
    b(0.48, 1.16, 0.71, 0.28, 0.24, 1.28, p.dark);
    b(0.48, 1.19, 1.36, 0.19, 0.16, 0.13, p.plate);
    b(0.48, 1.29, 0.35, 0.21, 0.07, 0.26, p.glow);
    for (const x of [-0.26, 0.26]) {
      b(x, 0.75, 0, 0.33, 0.56, 0.35, p.dark);
      b(x, 0.4, 0.09, 0.39, 0.5, 0.46, p.plate);
      b(x, 0.14, 0.24, 0.4, 0.2, 0.66, p.dark);
    }
  } else if (type === "worker") {
    b(0, 0.74, 0, 1.15, 0.56, 1.27, p.gold);
    b(0, 1.12, 0, 0.79, 0.22, 0.92, p.plate);
    b(0, 0.99, 0.69, 0.74, 0.19, 0.1, p.glow);
    b(0, 0.72, -0.79, 0.9, 0.35, 0.4, p.dark);
    for (const x of [-0.72, 0.72]) {
      b(x, 0.37, 0, 0.42, 0.58, 1.47, p.dark);
      for (const z of [-0.45, 0, 0.45]) {
        const wheel = post(x, 0.38, z, 0.23, 0.23, 0.16, p.trim);
        wheel.rotation.z = Math.PI / 2;
      }
    }
    for (const x of [-0.56, 0.56]) {
      b(x, 0.52, 1, 0.15, 0.16, 0.72, p.plate);
      b(x, 0.54, 1.41, 0.29, 0.17, 0.19, p.dark);
    }
    b(0.43, 1.5, -0.4, 0.07, 0.63, 0.07, p.dark);
  } else if (type === "tank") {
    for (const x of [-1.08, 1.08]) {
      b(x, 0.54, 0, 0.63, 0.85, 3.15, p.dark);
      b(x, 0.98, 0, 0.65, 0.13, 3.28, p.plate);
      for (let i = 0; i < 5; i += 1) {
        const wheel = post(x, 0.53, -1.13 + i * 0.57, 0.31, 0.31, 0.7, p.trim);
        wheel.rotation.z = Math.PI / 2;
      }
      for (let i = 0; i < 8; i += 1) b(x, 0.24, -1.38 + i * 0.39, 0.69, 0.11, 0.16, p.armor);
    }
    b(0, 0.98, 0, 1.65, 0.81, 2.57, p.armor);
    b(0, 1.51, -0.34, 1.8, 0.54, 1.78, p.plate);
    b(0, 1.84, -0.34, 1.31, 0.12, 1.31, p.team);
    b(0, 1.63, 1.52, 0.38, 0.36, 2.8, p.dark);
    b(0, 1.63, 2.92, 0.64, 0.52, 0.54, p.plate);
    b(0, 1.63, 3.21, 0.41, 0.24, 0.07, p.glow);
    for (const x of [-0.55, 0.55]) b(x, 1.15, 1.33, 0.27, 0.16, 0.11, p.glow);
    b(-0.72, 2.13, -0.86, 0.08, 1.1, 0.08, p.dark);
  } else if (type === "hover") {
    b(0, 1.15, 0, 1.6, 0.55, 2.6, p.armor);
    b(0, 1.57, -0.12, 1.25, 0.37, 1.5, p.plate);
    b(0, 1.65, 0.67, 0.96, 0.19, 0.1, p.glow);
    for (const x of [-1.24, 1.24]) {
      b(x, 1.08, -0.1, 0.69, 0.6, 2.6, p.dark);
      b(x, 1.42, -0.1, 0.75, 0.12, 2.8, p.team);
      b(x, 0.71, -0.1, 0.49, 0.08, 2.2, p.glow);
      b(x, 1.2, 1.55, 0.22, 0.21, 1.2, p.plate);
    }
    b(0, 1.23, -1.55, 0.95, 0.29, 0.12, p.glow);
  } else if (type === "fighter") {
    prism(
      group,
      [
        [0, 2.8],
        [0.62, 1],
        [0.5, -2.1],
        [-0.5, -2.1],
        [-0.62, 1],
      ],
      0.54,
      0.5,
      p.armor,
    );
    prism(
      group,
      [
        [-0.42, 0.9],
        [0.42, 0.9],
        [0.38, -0.75],
        [-0.38, -0.75],
      ],
      0.3,
      0.96,
      p.plate,
    );
    b(0, 1.32, 0.5, 0.68, 0.18, 0.95, p.glow);
    b(0, 1.26, -0.25, 0.55, 0.15, 0.45, p.team);
    for (const side of [-1, 1]) {
      prism(
        group,
        [
          [side * 0.45, 0.9],
          [side * 3.25, -0.9],
          [side * 2.8, -1.85],
          [side * 0.45, -1.3],
        ],
        0.23,
        0.52,
        p.plate,
      );
      prism(
        group,
        [
          [side * 0.6, 0.5],
          [side * 2.85, -1],
          [side * 2.65, -1.26],
          [side * 0.65, -0.75],
        ],
        0.07,
        0.78,
        p.team,
      );
      b(side * 1.28, 0.43, -1.45, 0.66, 0.5, 2.1, p.dark);
      b(side * 1.28, 0.45, -2.54, 0.4, 0.28, 0.13, p.glow);
      b(side * 2.55, 0.48, -0.4, 0.15, 0.16, 1.9, p.dark);
      b(side * 2.55, 0.48, 0.6, 0.18, 0.18, 0.24, p.gold);
      b(side * 0.63, 1.36, -1.7, 0.1, 1.3, 0.8, p.team, side * 0.3);
    }
    b(0, 0.56, 2.55, 0.18, 0.15, 0.46, p.white);
  } else if (type === "bomber") {
    prism(
      group,
      [
        [0, 3],
        [1.05, 1.1],
        [1.4, -1.9],
        [0.5, -2.65],
        [-0.5, -2.65],
        [-1.4, -1.9],
        [-1.05, 1.1],
      ],
      0.8,
      0.5,
      p.armor,
    );
    prism(
      group,
      [
        [0, 2.3],
        [0.72, 1.1],
        [0.55, -0.5],
        [-0.55, -0.5],
        [-0.72, 1.1],
      ],
      0.35,
      1.3,
      p.plate,
    );
    b(0, 1.65, 1.1, 1.1, 0.19, 0.75, p.glow);
    b(0, 1.82, 0.2, 0.65, 0.14, 0.5, p.team);
    for (const side of [-1, 1]) {
      prism(
        group,
        [
          [side * 0.85, 1.15],
          [side * 3.8, -0.35],
          [side * 3.65, -2.65],
          [side * 0.8, -1.8],
        ],
        0.43,
        0.63,
        p.plate,
      );
      b(side * 2.45, 0.97, -1.1, 1.35, 0.65, 3.4, p.armor);
      b(side * 2.45, 1.36, -1.15, 1.15, 0.14, 2.7, p.team);
      for (const x of [side * 2.16, side * 2.76]) b(x, 1.01, -2.86, 0.36, 0.28, 0.11, p.glow);
      for (const z of [-0.85, 0.05, 0.95]) {
        b(side * 1.35, 0.18, z, 0.54, 0.48, 0.61, p.dark);
        b(side * 1.35, 0.17, z + 0.35, 0.32, 0.2, 0.08, p.gold);
      }
      b(side * 0.82, 1.87, -1.65, 0.13, 1.23, 0.95, p.team, side * 0.16);
    }
  } else if (type === "flak") {
    for (const side of [-1, 1]) {
      b(side * 0.96, 0.4, 0, 0.53, 0.67, 2.65, p.dark);
      b(side * 0.96, 0.79, 0, 0.56, 0.15, 2.85, p.plate);
    }
    b(0, 0.84, 0, 1.42, 0.78, 2.2, p.armor);
    c(0, 1.37, -0.15, 0.73, 0.32, p.trim);
    for (const side of [-1, 1]) {
      const pod = b(side * 0.68, 1.89, 0.04, 0.92, 0.67, 1.58, p.plate);
      pod.rotation.x = -0.37;
      for (const dx of [-0.22, 0.22])
        for (const dy of [-0.18, 0.18])
          b(side * 0.68 + dx, 1.93 + dy, 0.86, 0.23, 0.22, 0.14, p.dark);
      b(side * 0.68, 2.28, -0.2, 0.67, 0.12, 1.1, p.team);
    }
    b(0, 1.18, 1.19, 0.67, 0.14, 0.09, p.glow);
    b(-0.38, 2.28, -0.83, 0.1, 1.2, 0.1, p.dark);
    c(-0.38, 2.91, -0.83, 0.16, 0.1, p.glow);
  } else if (type === "medic") {
    for (const side of [-1, 1]) {
      b(side * 0.68, 0.39, 0, 0.37, 0.6, 1.6, p.dark);
      b(side * 0.68, 0.74, 0, 0.43, 0.12, 1.72, p.plate);
    }
    b(0, 0.88, 0, 1.17, 0.76, 1.42, p.white);
    b(0, 1.35, -0.18, 0.94, 0.24, 0.87, p.armor);
    b(0, 1.54, -0.18, 0.21, 0.08, 0.62, basic(0x80ffd1));
    b(0, 1.54, -0.18, 0.62, 0.08, 0.21, basic(0x80ffd1));
    b(0, 1.07, 0.77, 0.9, 0.2, 0.07, p.glow);
    b(0.75, 1.27, 0.52, 0.16, 0.16, 0.97, p.trim);
    b(0.75, 1.27, 1.08, 0.24, 0.2, 0.18, basic(0x80ffd1));
    c(-0.49, 1.24, -0.53, 0.2, 0.84, p.team);
  } else if (type === "starport") {
    hex(0, 0.3, 0, 4.85, 0.6, p.dark);
    hex(0, 0.68, 0.4, 4.35, 0.25, p.plate);
    hex(0, 0.85, 0.5, 3.5, 0.12, p.trim);
    hex(0, 0.95, 0.5, 3.22, 0.11, p.team);
    b(-0.92, 1.05, 0.5, 0.16, 0.035, 2.5, p.white);
    b(0.92, 1.05, 0.5, 0.16, 0.035, 2.5, p.white);
    b(0, 1.05, 0.5, 1.95, 0.035, 0.16, p.white);
    for (let i = 0; i < 12; i += 1) {
      const a = (i * Math.PI) / 6;
      const light = b(Math.cos(a) * 3.47, 1.03, 0.5 + Math.sin(a) * 3.47, 0.5, 0.05, 0.09, p.glow);
      light.rotation.y = -a;
    }
    b(-2.9, 1.45, -2.75, 2.8, 2.5, 2.6, p.armor);
    b(-2.9, 2.87, -2.75, 3, 0.31, 2.8, p.plate);
    b(-2.9, 3.51, -2.75, 2.4, 1.05, 2.25, p.dark);
    b(-2.9, 3.57, -1.58, 2.23, 0.42, 0.11, p.glow);
    b(-2.9, 4.13, -2.75, 2.7, 0.23, 2.5, p.plate);
    for (const x of [-3.96, -1.85]) b(x, 3.55, -1.47, 0.14, 0.62, 0.18, p.armor);
    b(2.95, 1.65, -2.72, 2.6, 2.1, 2.4, p.armor);
    b(2.95, 2.88, -2.72, 2.7, 0.3, 2.55, p.plate);
    for (let i = 0; i < 4; i += 1) b(2.24 + i * 0.47, 3.08, -2.72, 0.16, 0.12, 1.75, p.dark);
    for (const x of [-4, 4]) {
      b(x, 1.62, 0.8, 0.26, 2.2, 0.26, p.dark);
      b(x, 2.86, 0.8, 0.31, 0.19, 0.31, p.glow);
    }
    for (const x of [-3.8, 3.8])
      for (let z = -0.5; z < 2; z += 0.55) b(x, 1.02, z, 0.42, 0.04, 0.18, p.gold);
  } else if (type === "bunker") {
    hex(0, 0.35, 0, 3.35, 0.7, p.dark);
    b(0, 0.97, 0, 5.4, 1.3, 4.6, p.trim);
    b(0, 1.7, 0, 4.9, 0.65, 4.05, p.dark);
    b(0, 2.3, -0.15, 5.8, 0.53, 4.9, p.plate);
    b(0, 2.64, -0.15, 4.5, 0.18, 3.6, p.team);
    b(0, 2.81, -0.18, 2.1, 0.18, 1.6, p.armor);
    for (const x of [-2.65, 2.65])
      for (const z of [-1.85, 1.85]) {
        const brace = b(x, 1.3, z, 0.73, 2.1, 0.72, p.armor);
        brace.rotation.z = x > 0 ? -0.13 : 0.13;
      }
    for (const x of [-1.8, -0.6, 0.6, 1.8]) {
      b(x, 1.6, 2.1, 0.89, 0.2, 0.1, p.dark);
      b(x, 1.92, 2.2, 1.06, 0.1, 0.17, p.white);
    }
    b(0, 0.8, -2.4, 1.9, 1.35, 0.16, p.dark);
    b(0, 1.47, -2.52, 1.85, 0.12, 0.09, p.glow);
    for (let i = 0; i < 4; i += 1) b(-0.66 + i * 0.44, 1, -2.55, 0.13, 0.8, 0.06, p.plate);
    c(1.6, 3.04, -1.3, 0.4, 0.5, p.trim);
    b(1.6, 3.5, -1.3, 0.08, 0.63, 0.08, p.dark);
  } else if (type === "antiair") {
    hex(0, 0.3, 0, 2.45, 0.6, p.dark);
    hex(0, 0.76, 0, 1.53, 0.37, p.armor);
    c(0, 1.4, 0, 0.69, 0.95, p.trim);
    b(0, 2, 0, 1.76, 0.7, 1.88, p.armor);
    for (const side of [-1, 1]) {
      const pod = b(side * 1.15, 2.66, 0, 1.42, 1.16, 2.5, p.plate);
      pod.rotation.x = -0.65;
      const top = b(side * 1.15, 3.29, -0.21, 1.18, 0.13, 2.1, p.team);
      top.rotation.x = -0.65;
      for (const dx of [-0.36, 0.36])
        for (const dy of [-0.3, 0.3]) {
          const tube = b(side * 1.15 + dx, 3.15 + dy, 1.02, 0.47, 0.38, 0.16, p.dark);
          tube.rotation.x = -0.65;
        }
    }
    b(0, 3.54, -0.71, 0.16, 1.38, 0.16, p.dark);
    c(0, 4.29, -0.71, 0.33, 0.16, p.glow);
    for (const x of [-1.6, 1.6]) b(x, 0.66, 1.1, 0.15, 0.08, 0.72, p.gold);
  }

  // Reinforced feet, exposed fasteners and hazard-marked aprons, sized from the collision radius
  // the simulation actually uses, so the plinth is exactly as wide as the thing that blocks it.
  if (TYPES[type].building === true) {
    const r = TYPES[type].r;
    for (const x of [-r * 0.64, r * 0.64])
      for (const z of [-r * 0.61, r * 0.61]) {
        b(x, 0.14, z, 0.72, 0.27, 0.72, p.trim);
        c(x, 0.32, z, 0.18, 0.16, p.plate);
        c(x, 0.42, z, 0.08, 0.06, p.dark);
      }
    if (type === "core" || type === "barracks" || type === "factory") {
      for (const side of [-1, 1])
        for (let j = 0; j < 4; j += 1) {
          b(side * r * 0.74, 1.5, -0.9 + j * 0.55, 0.12, 0.52, 0.25, p.dark);
          b(side * r * 0.755, 1.85, -0.9 + j * 0.55, 0.07, 0.06, 0.25, p.plate);
        }
      for (let j = 0; j < 6; j += 1) {
        const x = (j - 2.5) * 0.48;
        b(x, 0.65, r * 0.88, 0.28, 0.035, 0.65, j % 2 === 1 ? p.dark : p.gold, -0.03);
      }
      for (const x of [-r * 0.65, r * 0.65]) {
        c(x, 0.65, r * 0.71, 0.16, 0.28, p.trim);
        c(x, 0.83, r * 0.71, 0.09, 0.11, p.glow);
      }
    }
    if (type === "factory")
      for (const x of [-2.5, 2.5]) {
        c(x, 3.45, 0.65, 0.58, 0.2, p.dark);
        for (let i = 0; i < 5; i += 1) b(x - 0.4 + i * 0.2, 3.57, 0.65, 0.07, 0.05, 0.8, p.plate);
      }
    if (type === "refinery")
      for (let i = 0; i < 3; i += 1) c(0, 1 + i * 0.5, 0, 2.12, 0.07, p.trim);
  }
  return group;
}

/** Concatenate every opaque mesh by material, world transforms baked: one draw per material. */
function bake(group: Group): IModelPart[] {
  group.updateMatrixWorld(true);
  const buckets = new Map<Material, BufferGeometry[]>();
  group.traverse((child) => {
    if ((child as Mesh).isMesh !== true) return;
    const mesh = child as Mesh;
    const material = mesh.material as Material;
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    source.applyMatrix4(mesh.matrixWorld);
    const list = buckets.get(material);
    if (list === undefined) buckets.set(material, [source]);
    else list.push(source);
  });
  const parts: IModelPart[] = [];
  for (const [material, geometries] of buckets) {
    let total = 0;
    for (const geometry of geometries) total += geometry.getAttribute("position").count;
    const merged = new BufferGeometry();
    for (const [name, width] of [
      ["position", 3],
      ["normal", 3],
      ["uv", 2],
    ] as const) {
      const array = new Float32Array(total * width);
      let offset = 0;
      for (const geometry of geometries) {
        const attribute = geometry.getAttribute(name);
        if (attribute === undefined) continue;
        array.set(attribute.array as Float32Array, offset);
        offset += attribute.array.length;
      }
      merged.setAttribute(
        name,
        new (name === "uv" ? Float32BufferAttribute : BufferAttribute)(array, width) as never,
      );
    }
    merged.computeBoundingSphere();
    parts.push({ geometry: merged, material });
    for (const geometry of geometries) geometry.dispose();
  }
  return parts;
}

/**
 * Compose, bake and cache every (type, team) the simulation can spawn.
 *
 * Cached because the artwork is the same for the hundredth tank as for the first, and because a
 * `game.goto("play")` rebuilds this from source rather than from a file on disk.
 */
export function createUnitModels(): IUnitModels {
  const cache = new Map<string, readonly IModelPart[]>();
  return {
    parts: (type, team) => {
      const key = `${type}:${team}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const parts = bake(compose(type, team));
      cache.set(key, parts);
      return parts;
    },
    dispose: () => {
      for (const parts of cache.values()) for (const part of parts) part.geometry.dispose();
      cache.clear();
    },
  };
}
