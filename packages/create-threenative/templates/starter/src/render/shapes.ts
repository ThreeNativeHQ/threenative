// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Rounded, cached primitives — the single highest-leverage thing in this
// folder. A sharp BoxGeometry reads as Minecraft; the same box with a 0.14
// corner radius reads as a toy, and that soft corner-wrap is most of what
// separates a stack of boxes from something that looks designed.
//
// Nothing here is textured, on purpose. Surface variety comes from alternating
// palette entries across a run of meshes, never from a bitmap: `CanvasTexture`
// samples BLACK under `WebGPURenderer`, which is a trap worth knowing about
// before you spend an afternoon painting one.
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  type Material,
  MathUtils,
  Mesh,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const roundedCache = new Map<string, BufferGeometry>();

/**
 * A box with rounded edges: every vertex of a segmented box pushed outward
 * from the clamped "inner" box by `radius`, then welded so normals interpolate
 * smoothly across the seams instead of faceting at them.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.14,
  segments = 3,
): BufferGeometry {
  const key = `${width},${height},${depth},${radius},${segments}`;
  const cached = roundedCache.get(key);
  if (cached !== undefined) return cached;

  const limit = Math.min(radius, width / 2 - 1e-3, height / 2 - 1e-3, depth / 2 - 1e-3);
  const geometry = new BoxGeometry(width, height, depth, segments, segments, segments);
  // No UVs and no normals: both are rebuilt after welding, and a geometry with
  // stale UVs is a geometry someone will eventually try to texture.
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");

  const position = geometry.attributes.position;
  if (position === undefined) throw new Error("Rounded box lost its position attribute.");
  const inner = new Vector3(width / 2 - limit, height / 2 - limit, depth / 2 - limit);
  const vertex = new Vector3();
  const clamped = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    clamped.set(
      MathUtils.clamp(vertex.x, -inner.x, inner.x),
      MathUtils.clamp(vertex.y, -inner.y, inner.y),
      MathUtils.clamp(vertex.z, -inner.z, inner.z),
    );
    vertex.sub(clamped);
    const length = vertex.length();
    if (length > 1e-6) vertex.multiplyScalar(limit / length);
    position.setXYZ(index, vertex.x + clamped.x, vertex.y + clamped.y, vertex.z + clamped.z);
  }

  const welded = mergeVertices(geometry, 1e-4);
  welded.computeVertexNormals();
  roundedCache.set(key, welded);
  return welded;
}

export interface IShapeOptions {
  readonly castShadow?: boolean;
  readonly radius?: number;
  readonly receiveShadow?: boolean;
  readonly segments?: number;
}

function shadowed(mesh: Mesh, options: IShapeOptions): Mesh {
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  return mesh;
}

/** The workhorse: a rounded box that casts and receives shadows. */
export function block(
  width: number,
  height: number,
  depth: number,
  material: Material,
  options: IShapeOptions = {},
): Mesh {
  const geometry = roundedBox(width, height, depth, options.radius ?? 0.14, options.segments ?? 3);
  return shadowed(new Mesh(geometry, material), options);
}

export function ball(radius: number, material: Material, options: IShapeOptions = {}): Mesh {
  const segments = options.segments ?? 16;
  const geometry = new SphereGeometry(radius, segments, Math.max(6, Math.round(segments / 2)));
  return shadowed(new Mesh(geometry, material), options);
}

export function tube(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: Material,
  options: IShapeOptions = {},
): Mesh {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, options.segments ?? 16);
  return shadowed(new Mesh(geometry, material), options);
}

export interface IHeroMaterials {
  readonly accent: Material;
  readonly body: Material;
  readonly dark: Material;
}

/**
 * The player character.
 *
 * A `roundedBox(0.6, 1, 0.6)` in one cream colour is what stood here, and it is the first thing a
 * new project shows anyone: a featureless pill. The hero is the one object in a starter scene that
 * has to look deliberate, because everything else — the ledge, the crate, the flag — is obviously
 * scaffolding and reads fine as scaffolding.
 *
 * Authored **centred on y = 0** so `normaliseToMetres(model, { axis: "height", metres: 1.1 })`
 * scales it without moving the feet off the collision capsule.
 *
 * The returned value is a `Mesh`, not a `Group`, because `Player.visual` is one and both
 * `GroundSnap` and `preparePlayerConventions` are written against it. Children hang off it.
 */
export function hero(materials: IHeroMaterials): Mesh {
  const parts = new Map<Material, Mesh[]>();
  const add = (mesh: Mesh): Mesh => {
    const bucket = parts.get(mesh.material as Material);
    if (bucket === undefined) parts.set(mesh.material as Material, [mesh]);
    else bucket.push(mesh);
    return mesh;
  };

  const torso = add(new Mesh(roundedBox(0.44, 0.42, 0.32, 0.13, 2), materials.body));
  torso.position.y = 0.06;
  const head = add(new Mesh(roundedBox(0.36, 0.32, 0.32, 0.13, 2), materials.body));
  head.position.y = 0.42;
  const visor = add(new Mesh(roundedBox(0.28, 0.1, 0.06, 0.03, 1), materials.dark));
  visor.position.set(0, 0.37, -0.16);
  const brim = add(new Mesh(roundedBox(0.46, 0.05, 0.42, 0.02, 1), materials.accent));
  brim.position.y = 0.52;
  const crown = add(new Mesh(roundedBox(0.3, 0.16, 0.28, 0.08, 2), materials.accent));
  crown.position.y = 0.6;
  const scarf = add(new Mesh(roundedBox(0.42, 0.1, 0.34, 0.05, 1), materials.accent));
  scarf.position.y = 0.19;
  const tail = add(new Mesh(roundedBox(0.12, 0.26, 0.08, 0.04, 1), materials.accent));
  tail.position.set(0.02, 0.06, 0.19);
  tail.rotation.x = 0.5;
  const pack = add(new Mesh(roundedBox(0.28, 0.28, 0.16, 0.07, 2), materials.dark));
  pack.position.set(0, 0.06, 0.2);

  for (const side of [-1, 1]) {
    const arm = add(new Mesh(roundedBox(0.12, 0.3, 0.14, 0.055, 1), materials.body));
    arm.position.set(side * 0.28, 0.02, 0);
    arm.rotation.z = side * -0.16;
    const hand = add(new Mesh(roundedBox(0.12, 0.11, 0.13, 0.05, 1), materials.dark));
    hand.position.set(side * 0.31, -0.15, 0);
    const leg = add(new Mesh(roundedBox(0.15, 0.3, 0.16, 0.06, 1), materials.dark));
    leg.position.set(side * 0.12, -0.36, 0);
    const boot = add(new Mesh(roundedBox(0.17, 0.1, 0.22, 0.045, 1), materials.accent));
    boot.position.set(side * 0.12, -0.51, -0.02);
  }

  // Merged down to one mesh per material: fifteen little boxes is fifteen draw calls for one
  // character, and with the shadow pass that is thirty. The three materials stay separate, so the
  // hat, the pack and the body are still repainted from `materials.ts` alone.
  const meshes: Mesh[] = [];
  for (const [material, group] of parts) {
    const geometry = mergeGeometries(
      group.map((mesh) => {
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
    if (geometry === null) throw new Error("mergeGeometries returned null building the hero.");
    geometry.computeVertexNormals();
    const merged = new Mesh(geometry, material);
    merged.castShadow = true;
    merged.receiveShadow = true;
    meshes.push(merged);
  }
  const root = meshes[0];
  if (root === undefined) throw new Error("The hero produced no geometry.");
  for (const extra of meshes.slice(1)) root.add(extra);
  return root;
}

export function spike(
  radius: number,
  height: number,
  material: Material,
  options: IShapeOptions = {},
): Mesh {
  const geometry = new ConeGeometry(radius, height, options.segments ?? 14);
  return shadowed(new Mesh(geometry, material), options);
}

// A hand-rolled seeded PRNG used to live here, and it was a line-for-line copy of the
// `createRandom` the framework already exports — same multiplier, same increment, same
// sequence. It is gone. Nothing in this folder may import a framework package (that is what
// keeps `src/render/` portable Three.js), so a scene builds the seeded source and hands it
// down: see `createScenery` below and its caller in `src/scenes/Play.ts`.
//
// Never `Math.random` for anything the world is built from. The world has to be byte-identical
// on every reload or a screenshot diff cannot tell a bug from a reroll, and `ctx.random` is
// what a playtest reads to prove the level was seeded at all.
