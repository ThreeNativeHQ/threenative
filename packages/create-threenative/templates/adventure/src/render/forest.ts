// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The Whispering Woods: everything that never moves. The ground is `groundHeight` from the rules
// sampled into a mesh, so what you see under the hero's boots is what the rules stand her on; the
// trees, stones, bridge and lanterns are placed from `layout.ts`, so a trunk you cannot walk through
// is a trunk you can see. All of it is authored as ordinary meshes, then baked to one draw per
// material by `tools.merge`; the leaves, grass and ferns are instanced.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Sprite,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import { type ILayout, LAKE, LANTERNS, mulberry32 } from "../logic/layout.js";
import {
  BRIDGE,
  PATHS,
  STAIR,
  bridgeDeck,
  groundHeight,
  pathDistance,
  smooth,
  terrainHeight,
} from "../logic/terrain.js";
import { ADDITIVE, type IForestMaterials } from "./materials.js";
import { noise } from "./textures.js";
import type { IRenderTools } from "./tools.js";

export interface IForest {
  /** Everything static, ready to `ctx.add`. */
  readonly root: Group;
  /** Glow sprites that breathe; `update` moves them. */
  readonly update: (time: number) => void;
}

type Pt = readonly [number, number, number];

export function createForest(
  tools: IRenderTools,
  mats: IForestMaterials,
  layout: ILayout,
  options: { mobile: boolean },
): IForest {
  const root = new Group();
  const stat = new Group();
  const rand = mulberry32(2026);
  const r = (a: number, b: number): number => a + (b - a) * rand();
  const glows: Sprite[] = [];

  const add = (
    geometry: BufferGeometry,
    material: Material,
    x = 0,
    y = 0,
    z = 0,
    scale?: Pt,
    rotY = 0,
  ): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (scale) mesh.scale.set(...scale);
    mesh.rotation.y = rotY;
    stat.add(mesh);
    return mesh;
  };
  const up = new Vector3(0, 1, 0);
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  /** A tapered rod between two points. */
  const rod = (material: Material, a: Pt, b: Pt, r1: number, r2 = r1, sides = 9): Mesh => {
    tmpA.set(...a);
    tmpB.set(...b);
    const dir = tmpB.clone().sub(tmpA);
    const mesh = add(new CylinderGeometry(r2, r1, dir.length(), sides), material);
    mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    return mesh;
  };
  const curve = (
    material: Material,
    points: readonly Pt[],
    radius: number,
    segments = 18,
    sides = 6,
  ): Mesh =>
    add(
      new TubeGeometry(
        new CatmullRomCurve3(points.map((p) => new Vector3(...p))),
        segments,
        radius,
        sides,
        false,
      ),
      material,
    );
  const glow = (
    x: number,
    y: number,
    z: number,
    color: number,
    size: number,
    opacity = 0.45,
  ): Sprite => {
    const sprite = new Sprite(
      new SpriteNodeMaterial({ color, map: mats.glowMap, opacity, ...ADDITIVE }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    root.add(sprite);
    glows.push(sprite);
    return sprite;
  };

  // --- ground: the rules' own height, tinted by the footpaths -------------------------------------------
  const ground = new PlaneGeometry(
    130,
    130,
    options.mobile ? 110 : 150,
    options.mobile ? 110 : 150,
  );
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -10);
  const position = ground.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const tint = new Color();
  const dirt = new Color(0.62, 0.58, 0.44);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const edge = Math.max(Math.abs(x) - 29, Math.abs(z + 6) - 35, 0);
    position.setY(
      i,
      groundHeight(x, z) +
        edge * 0.1 +
        noise(((x + 65) / 130) % 1, ((z + 75) / 130) % 1, 11) * edge * 0.26,
    );
    const path = 1 - smooth(1.5, 3.4, pathDistance(x, z));
    const n = noise(((x + 65) / 130) % 1, ((z + 75) / 130) % 1, 90);
    tint.setRGB(0.22 + n * 0.09, 0.4 + n * 0.1, 0.12 + n * 0.04).lerp(dirt, path * 0.9);
    colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  ground.setAttribute("color", new BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  const floor = new Mesh(ground, mats.ground);
  floor.receiveShadow = true;
  root.add(floor);

  // --- flagstones wandering along the paths ---------------------------------------------------------------
  const slabBase = new CylinderGeometry(1, 1.04, 0.1, 7, 1);
  for (let i = 0; i < 2600; i += 1) {
    const path = PATHS[i % PATHS.length] as (typeof PATHS)[number];
    const j = Math.floor(r(1, path.length));
    const a = path[j - 1] as readonly [number, number];
    const b = path[j] as readonly [number, number];
    const t = rand();
    const x = a[0] + (b[0] - a[0]) * t + r(-1.05, 1.05);
    const z = a[1] + (b[1] - a[1]) * t + r(-0.85, 0.85);
    if ((x > 4.5 && x < 11.5 && z < 3.5 && z > -10.6) || (x < -16 && z > -0.5 && z < 9)) continue;
    const g = slabBase.clone();
    const v = g.getAttribute("position");
    const phase = rand() * 5;
    for (let k = 0; k < v.count; k += 1) {
      const d = 1 + Math.sin(Math.atan2(v.getZ(k), v.getX(k)) * 3 + phase) * 0.12;
      v.setX(k, v.getX(k) * d);
      v.setZ(k, v.getZ(k) * d);
    }
    g.computeVertexNormals();
    add(
      g,
      mats.stone,
      x,
      groundHeight(x, z) + 0.038,
      z,
      [r(0.3, 0.52), 1, r(0.22, 0.4)],
      r(0, 6.28),
    );
  }

  // --- the great stair: soil risers, a mossy log on each step's front edge, stakes and boulders -------------
  for (let i = 0; i < STAIR.steps; i += 1) {
    const z = STAIR.z0 - (i + 0.5) * STAIR.depth;
    const y = (i + 1) * STAIR.rise + 0.025;
    add(new BoxGeometry(6.4, 0.3, STAIR.depth + 0.04), mats.soil, 8, y - 0.17, z);
    const logGeometry = new CylinderGeometry(0.19, 0.19, 6.6, 12, 6);
    logGeometry.rotateZ(Math.PI / 2);
    const lp = logGeometry.getAttribute("position");
    for (let k = 0; k < lp.count; k += 1) {
      const wobble = 1 + Math.sin(lp.getX(k) * 1.7 + i) * 0.06;
      lp.setY(k, lp.getY(k) * wobble);
      lp.setZ(k, lp.getZ(k) * wobble);
    }
    logGeometry.computeVertexNormals();
    add(logGeometry, mats.darkWood, 8, y - 0.165, z + 0.2);
    for (let m = 0; m < 3; m += 1)
      add(
        new SphereGeometry(1, 10, 6),
        mats.moss,
        8 + r(-3, 3),
        y - 0.005,
        z + r(-0.1, 0.25),
        [r(0.4, 1), 0.05, r(0.12, 0.2)],
        r(0, 3),
      );
    for (const side of [-1, 1]) {
      add(
        new CylinderGeometry(0.06, 0.07, 0.5, 7),
        mats.darkWood,
        8 + side * 3.35,
        y - 0.28,
        z + 0.2,
      );
      add(new SphereGeometry(1, 10, 7), mats.darkStone, 8 + side * r(3.1, 3.7), y - 0.14, z, [
        r(0.4, 0.75),
        r(0.22, 0.4),
        r(0.4, 0.65),
      ]);
    }
  }
  for (let z = -12; z >= -20; z -= 2.5) {
    const x = 12.4;
    const h = groundHeight(x, z);
    rod(mats.wood, [x, h, z], [x + 0.06, h + 1.05, z], 0.085, 0.066);
    if (z > -19)
      rod(mats.wood, [x, h + 0.82, z], [x, groundHeight(x, z - 2.5) + 0.82, z - 2.5], 0.058, 0.057);
  }

  // --- trees ---------------------------------------------------------------------------------------------------
  const canopy: {
    c: Color;
    rx: number;
    ry: number;
    rz: number;
    s: number;
    x: number;
    y: number;
    z: number;
  }[] = [];
  const addCanopy = (x: number, y: number, z: number, radius: number, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const a = r(0, Math.PI * 2);
      const b = r(-0.55, 0.65);
      const rr = radius * Math.sqrt(rand());
      canopy.push({
        c: new Color().setHSL(r(0.2, 0.25), r(0.12, 0.26), r(0.42, 0.72)),
        rx: r(-1.2, 1.2),
        ry: r(0, 6.28),
        rz: r(-0.7, 0.7),
        s: r(2.7, 4.7),
        x: x + Math.cos(a) * rr,
        y: y + b * radius,
        z: z + Math.sin(a) * rr,
      });
    }
  };
  const blobs = tools.batch(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mats.blob);
  const tree = (x: number, z: number, radius: number, h: number, hero: boolean): void => {
    const y = terrainHeight(x, z);
    const trunk = new CylinderGeometry(radius * 0.43, radius, h, 12, 12);
    const v = trunk.getAttribute("position");
    for (let k = 0; k < v.count; k += 1) {
      const yy = v.getY(k) + h / 2;
      const a = Math.atan2(v.getZ(k), v.getX(k));
      const s = 1 + 0.1 * Math.sin(a * 7 + yy * 0.3) + 0.06 * Math.cos(a * 11 - yy * 0.6);
      v.setX(k, v.getX(k) * s + Math.sin(yy * 0.22 + x) * radius * 0.3);
      v.setZ(k, v.getZ(k) * s + Math.sin(yy * 0.16 + z) * radius * 0.26);
    }
    trunk.computeVertexNormals();
    add(trunk, mats.bark, x, y + h / 2, z);
    const roots = hero ? 11 : 5;
    for (let k = 0; k < roots; k += 1) {
      const a = (k / roots) * Math.PI * 2 + r(-0.2, 0.2);
      const d = radius * r(2.7, 4.3);
      const end: Pt = [
        x + Math.cos(a) * d,
        terrainHeight(x + Math.cos(a) * d, z + Math.sin(a) * d) + 0.02,
        z + Math.sin(a) * d,
      ];
      curve(
        mats.bark,
        [
          [x + Math.cos(a) * radius * 0.45, y + radius * 0.6, z + Math.sin(a) * radius * 0.45],
          [x + Math.cos(a) * radius * 1.3, y + 0.18, z + Math.sin(a) * radius * 1.3],
          end,
        ],
        radius * 0.17,
        13,
        7,
      );
    }
    for (let j = 0; j < (hero ? 11 : 6); j += 1) {
      const a = j * 2.4 + x;
      const startY = y + h * r(0.48, 0.79);
      const reach = h * r(0.2, 0.34);
      const mid: Pt = [
        x + Math.cos(a) * reach * 0.65,
        startY + h * 0.15,
        z + Math.sin(a) * reach * 0.65,
      ];
      const end: Pt = [
        x + Math.cos(a) * reach,
        startY + h * r(0.23, 0.35),
        z + Math.sin(a) * reach,
      ];
      curve(mats.bark, [[x, startY, z], mid, end], radius * r(0.19, 0.29), 14, 7);
      for (const k of [-1, 1]) {
        const e: Pt = [
          end[0] + Math.cos(a + k) * reach * 0.6,
          end[1] + r(0.8, 2.1),
          end[2] + Math.sin(a + k) * reach * 0.6,
        ];
        rod(mats.bark, mid, e, radius * 0.13, 0.04, 7);
        addCanopy(e[0], e[1] + 0.1, e[2], hero ? 3.6 : 2.7, hero ? 11 : 6);
      }
      addCanopy(end[0], end[1] + 0.9, end[2], hero ? 4 : 3, hero ? 14 : 7);
    }
    addCanopy(x, y + h + 0.5, z, h * 0.23, hero ? 33 : 15);
    if (radius > 0.9)
      blobs.place({
        position: [x, groundHeight(x, z) + 0.025, z],
        scale: [radius * 5.2, 1, radius * 5.2],
      });
  };
  for (const t of layout.trees) tree(t.x, t.z, t.r, t.h, t.hero);
  // Far trunks form a receding forest instead of a hard boundary.
  for (const t of layout.farTrunks) {
    const y = terrainHeight(t.x, t.z);
    add(new CylinderGeometry(0.22, 0.55, t.h, 7), mats.bark, t.x, y + t.h / 2, t.z);
    addCanopy(t.x, y + t.h, t.z, 5.5, 8);
  }
  // Understory: low clusters of bright foliage over and beside the footpaths, at head-of-the-stair
  // height, so the canopy is in the frame instead of forty metres above it.
  for (let placed = 0; placed < 70; ) {
    const x = r(-30, 30);
    const z = r(-32, 22);
    const d = pathDistance(x, z);
    if (d < 3.2 || d > 14 || layout.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.2))
      continue;
    addCanopy(x, groundHeight(x, z) + r(5.5, 10.5), z, r(2.2, 3.4), 7);
    placed += 1;
  }
  const leaves = tools.batch(new PlaneGeometry(1, 1), mats.leaf);
  for (const c of canopy)
    leaves.place({
      position: [c.x, c.y, c.z],
      rotation: [c.rx, c.ry, c.rz],
      scale: [c.s, c.s * 0.95, 1],
    });
  const canopyMesh = leaves.build({
    castShadow: true,
    name: "canopy",
    parent: root,
    receiveShadow: true,
  });
  canopy.forEach((c, i) => canopyMesh?.setColorAt(i, c.c));
  if (canopyMesh?.instanceColor) canopyMesh.instanceColor.needsUpdate = true;

  // --- the log bridge over the brook ------------------------------------------------------------------------------
  for (let x = BRIDGE.x0; x <= BRIDGE.x1; x += 0.27) {
    const h = bridgeDeck(x);
    rod(
      mats.wood,
      [x, h - 0.11, BRIDGE.z - 1.55],
      [x + r(-0.035, 0.035), h - 0.11, BRIDGE.z + 1.55],
      r(0.115, 0.15),
      r(0.115, 0.15),
      8,
    );
  }
  for (const side of [-1, 1]) {
    const z = BRIDGE.z + side * 1.37;
    curve(
      mats.bark,
      [
        [-24, 3.06, z],
        [-20, 3.4, z],
        [-15.5, 3.55, z],
        [-11, 3.4, z],
        [-7, 3.06, z],
      ],
      0.24,
      28,
      9,
    );
    const rail: Pt[] = [];
    for (let x = -23.6; x < -6.8; x += 2.4) {
      const h = bridgeDeck(x);
      rod(mats.wood, [x, h - 0.08, z], [x + r(-0.1, 0.1), h + 1, z], 0.065, 0.045);
      rail.push([x, h + 0.89, z]);
    }
    curve(mats.rope, rail, 0.024, 40, 5);
  }

  // --- the hollow in the elder oak, with a round lit window --------------------------------------------------------
  {
    const [x, z] = [-9, -20];
    const y = terrainHeight(x, z);
    add(new SphereGeometry(1, 24, 16), mats.black, x, y + 1.17, z + 1.99, [0.92, 1.24, 0.17]);
    const arch: Pt[] = [];
    for (let j = 0; j <= 20; j += 1) {
      const a = (j / 20) * Math.PI;
      arch.push([x + Math.cos(a), y + 0.52 + Math.sin(a) * 1.82, z + 2.11]);
    }
    curve(mats.wood, arch, 0.115, 30, 8);
    for (let j = -3; j <= 3; j += 1)
      rod(
        mats.darkWood,
        [x + j * 0.22, y + 0.12, z + 2.02],
        [x + j * 0.22, y + 1.9 - Math.abs(j) * 0.08, z + 2.02],
        0.115,
        0.11,
      );
    add(new TorusGeometry(0.35, 0.065, 10, 32), mats.wood, x - 0.7, y + 3.33, z + 1.88);
    add(new CircleGeometry(0.3, 32), mats.glow, x - 0.7, y + 3.33, z + 1.89);
    rod(mats.wood, [x - 1, y + 3.33, z + 1.93], [x - 0.4, y + 3.33, z + 1.93], 0.024);
    rod(mats.wood, [x - 0.7, y + 3.05, z + 1.93], [x - 0.7, y + 3.61, z + 1.93], 0.024);
    glow(x - 0.7, y + 3.3, z + 2, 0xffb766, 2.4, 0.5);
  }

  // --- lantern posts; the first five carry a real light ------------------------------------------------------------
  LANTERNS.forEach(([x, z, h], index) => {
    const y = groundHeight(x, z);
    rod(mats.bark, [x, y - 0.1, z], [x + 0.1, y + h, z + 0.03], 0.076, 0.032);
    curve(
      mats.wood,
      [
        [x + 0.08, y + h - 0.2, z],
        [x + 0.44, y + h + 0.13, z],
        [x + 0.71, y + h - 0.14, z],
      ],
      0.027,
      14,
      6,
    );
    rod(mats.brass, [x + 0.7, y + h - 0.13, z], [x + 0.7, y + h - 0.4, z], 0.011);
    const sy = y + h - 0.54;
    const profile = [
      [0.02, -0.22],
      [0.13, -0.12],
      [0.17, 0.04],
      [0.12, 0.17],
      [0.04, 0.21],
    ].map(([px, py]) => new Vector2(px, py));
    add(new LatheGeometry(profile, 12), mats.glow, x + 0.7, sy, z);
    add(new ConeGeometry(0.2, 0.18, 7), mats.moss, x + 0.7, sy + 0.24, z);
    add(
      new TorusGeometry(0.14, 0.013, 5, 18).rotateX(Math.PI / 2),
      mats.brass,
      x + 0.7,
      sy + 0.13,
      z,
    );
    glow(x + 0.7, sy, z, 0xffcc79, 1.8, 0.6);
    if (index < 5) {
      const light = new PointLight(0xffbf70, 6, 9, 2);
      light.position.set(x + 0.7, sy, z);
      root.add(light);
    }
  });

  // --- rocks -----------------------------------------------------------------------------------------------------------
  const rockGeometry = (x: number, z: number): BufferGeometry => {
    const g = new IcosahedronGeometry(1, 2);
    const p = g.getAttribute("position");
    for (let j = 0; j < p.count; j += 1) {
      const n =
        0.9 +
        0.14 *
          noise(
            (((p.getX(j) * 0.11 + x / 70 + 2) % 1) + 1) % 1,
            (((p.getZ(j) * 0.11 + z / 70 + 2) % 1) + 1) % 1,
            7,
          );
      p.setXYZ(j, p.getX(j) * n, p.getY(j) * n, p.getZ(j) * n);
    }
    g.computeVertexNormals();
    return g;
  };
  const rock = (x: number, z: number, radius: number): void => {
    const h = groundHeight(x, z);
    add(
      rockGeometry(x, z),
      mats.darkStone,
      x,
      h + radius * 0.15,
      z,
      [radius, radius * 0.65, radius * 0.85],
      r(0, 6.28),
    );
    if (radius > 0.7)
      add(
        new SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.42),
        mats.moss,
        x,
        h + radius * 0.13,
        z,
        [radius * 0.85, radius * 0.58, radius * 0.72],
        r(0, 6.28),
      );
  };
  for (const item of layout.rocks) rock(item.x, item.z, item.r);
  for (let i = 0; i < 17; i += 1) {
    const a = r(0, 6.28);
    const x = LAKE.x + Math.cos(a) * (LAKE.rx - 0.1);
    const z = LAKE.z + Math.sin(a) * (LAKE.rz - 0.2);
    if (pathDistance(x, z) > 2) rock(x, z, r(0.35, 0.75));
  }

  // --- water ---------------------------------------------------------------------------------------------------------------
  const water = new Mesh(new CircleGeometry(1, 80).rotateX(-Math.PI / 2), mats.water);
  water.position.set(LAKE.x, -0.5, LAKE.z);
  water.scale.set(LAKE.rx, 1, LAKE.rz);
  water.renderOrder = 1;
  root.add(water);

  // --- flowers and mushrooms along the path margins -----------------------------------------------------------------------------
  for (let i = 0; i < 125; i += 1) {
    const x = r(-26, 26);
    const z = r(-28, 19);
    const d = pathDistance(x, z);
    if (d < 2.1 || d > 5.4 || groundHeight(x, z) < -0.4) continue;
    const y = groundHeight(x, z);
    const h = r(0.22, 0.46);
    rod(mats.stem, [x, y, z], [x + 0.05, y + h, z], 0.008, 0.005, 4);
    for (let j = 0; j < 5; j += 1) {
      const a = (j / 5) * Math.PI * 2;
      add(
        new SphereGeometry(1, 6, 4),
        i % 3 === 0 ? mats.flower : mats.purple,
        x + Math.cos(a) * 0.069,
        y + h,
        z + Math.sin(a) * 0.069,
        [0.073, 0.033, 0.052],
        a,
      );
    }
    add(new SphereGeometry(0.035, 7, 5), mats.brass, x, y + h + 0.015, z);
  }
  for (let i = 0; i < 54; i += 1) {
    const x = r(-27, 27);
    const z = r(-29, 17);
    if (pathDistance(x, z) < 2.8) continue;
    const y = groundHeight(x, z);
    const s = r(0.5, 1.25);
    rod(mats.pale, [x, y, z], [x, y + 0.23 * s, z], 0.035 * s, 0.028 * s, 7);
    add(
      new SphereGeometry(1, 10, 6, 0, 6.28, 0, Math.PI * 0.53),
      mats.mushroom,
      x,
      y + 0.23 * s,
      z,
      [0.17 * s, 0.095 * s, 0.17 * s],
    );
  }

  // --- bake the static meshes: one draw per material ------------------------------------------------------------------------------
  const noShadow = new Set<Material>([
    mats.flower,
    mats.purple,
    mats.stem,
    mats.mushroom,
    mats.pale,
    mats.glow,
  ]);
  for (const mesh of tools.merge(stat, "forest")) {
    mesh.castShadow = !noShadow.has(mesh.material as Material);
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  blobs.build({ name: "trunk-shadows", parent: root });

  // --- instanced meadow: grass blades and radial ferns -----------------------------------------------------------------------------
  const blade: number[] = [];
  const bladeNormal: number[] = [];
  const bladeColor: number[] = [];
  const bladeUv: number[] = [];
  for (let k = 0; k < 4; k += 1) {
    const ang = k * 2.2;
    const baseX = Math.cos(ang) * 0.075;
    const baseZ = Math.sin(ang) * 0.075;
    const height = 0.48 + (k % 3) * 0.095;
    const w = 0.055;
    for (let j = 0; j < 3; j += 1) {
      const a = j / 3;
      const b = (j + 1) / 3;
      const point = (t: number, side: number): Pt => [
        baseX + Math.cos(ang) * side * w * (1 - t) + Math.sin(ang) * t * t * 0.18,
        t * height,
        baseZ + Math.sin(ang) * side * w * (1 - t) + Math.cos(ang) * t * t * 0.18,
      ];
      for (const q of [
        point(a, -1),
        point(a, 1),
        point(b, -1),
        point(a, 1),
        point(b, 1),
        point(b, -1),
      ]) {
        blade.push(...q);
        bladeNormal.push(Math.sin(ang) * 0.4, 0.7, Math.cos(ang) * 0.4);
        const t = q[1] / height;
        bladeColor.push(0.3 + t * 0.26, 0.44 + t * 0.26, 0.15 + t * 0.1);
        bladeUv.push(0, t);
      }
    }
  }
  const bladeGeometry = new BufferGeometry();
  bladeGeometry.setAttribute("position", new Float32BufferAttribute(blade, 3));
  bladeGeometry.setAttribute("normal", new Float32BufferAttribute(bladeNormal, 3));
  bladeGeometry.setAttribute("color", new Float32BufferAttribute(bladeColor, 3));
  bladeGeometry.setAttribute("uv", new Float32BufferAttribute(bladeUv, 2));
  const meadow = tools.batch(bladeGeometry, mats.grass);
  const wanted = options.mobile ? 8500 : 18500;
  for (let placed = 0; placed < wanted; ) {
    const x = r(-35, 35);
    const z = r(-36, 25);
    const dist = pathDistance(x, z);
    if (dist < 1.6 || (dist < 2.5 && rand() < 0.6) || (x > 4.5 && x < 11.5 && z < 3.7 && z > -10.5))
      continue;
    const y = groundHeight(x, z);
    if (y < -0.55) continue;
    const s = r(0.45, 1.05);
    meadow.place({
      position: [x, y - 0.03, z],
      rotation: [0, r(0, 6.28), 0],
      scale: [s, s * r(0.55, 0.9), s],
    });
    placed += 1;
  }
  meadow.build({ name: "grass", parent: root, receiveShadow: true });
  const fronds = tools.batch(new PlaneGeometry(1, 1.4).translate(0, 0.7, 0), mats.fern);
  const scratch = new Object3D();
  const matrix = new Matrix4();
  for (let i = 0; i < (options.mobile ? 270 : 540); i += 1) {
    const x = r(-30, 30);
    const z = r(-32, 21);
    if (pathDistance(x, z) < 2.6 || groundHeight(x, z) < -0.4) continue;
    const s = r(0.45, 1.05);
    for (let j = 0; j < 6; j += 1) {
      scratch.position.set(x, groundHeight(x, z), z);
      scratch.rotation.set(-r(0.4, 1.1), (j / 6) * Math.PI * 2 + r(-0.1, 0.1), 0, "YXZ");
      scratch.scale.setScalar(s);
      scratch.updateMatrix();
      fronds.add(matrix.copy(scratch.matrix));
    }
  }
  fronds.build({ name: "ferns", parent: root, receiveShadow: true });

  return {
    root,
    update: (time) => {
      glows.forEach((sprite, i) => {
        (sprite.material as SpriteNodeMaterial).opacity = 0.44 + Math.sin(time * 2.1 + i) * 0.07;
      });
    },
  };
}
