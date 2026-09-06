// Generated for you. Geometry and surface choices for the sailing kit live in this file, and
// ThreeNative does not read it.
//
// The ship is a **lofted hull with a rig**. What used to be here was a lathe cylinder lying on its
// side, a box and one flat plane, and the first frame of the template showed a brown log with a
// sheet of paper propped against it. A hull is a series of cross-sections whose beam and rail
// height change along the keel — that is the whole idea, and `loftHull` below is nineteen lines of
// it. Every dimension is a number in `HULL_STATIONS`; every colour comes from `materials.ts`.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  type Material,
  MathUtils,
  Mesh,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ISailingMaterials } from "./materials.js";

/**
 * One cross-section of the hull, at a station along the keel.
 *
 * `tumblehome` below 1 draws the section in above the widest point, so the deck is narrower than
 * the beam. It is a small number with a large effect: at 1 the hull is a tub, and no amount of rig
 * on top of a tub reads as a ship.
 */
interface IHullStation {
  readonly halfBeam: number;
  readonly keel: number;
  readonly rail: number;
  readonly tumblehome: number;
  readonly z: number;
}

/** Ring resolution. Half the points draw the deck line, half draw the submerged section. */
const RING_SEGMENTS = 22;

/**
 * One point on a station's section, going clockwise from the starboard rail.
 *
 * The first half of the ring is the **deck line**: a straight run at rail height from starboard to
 * port. The second half is the hull proper, bulging to its full beam a little below the rail and
 * drawing in to the keel. Parameterised as one smooth loop instead — which is what this was — the
 * section closes to a point at the top as well as the bottom, and the hull comes out as a
 * symmetrical almond with a ridge down the middle. It photographed exactly like that: a wooden
 * lens floating on its side with the rig apparently pointing sideways out of it.
 */
function ringPoint(station: IHullStation, index: number): [number, number, number] {
  const deckHalf = station.halfBeam * station.tumblehome;
  const t = index / RING_SEGMENTS;
  if (t < 0.5) {
    const u = t / 0.5;
    return [(1 - 2 * u) * deckHalf, station.rail, station.z];
  }
  const u = (t - 0.5) / 0.5;
  const angle = Math.PI * u;
  const across = -Math.cos(angle);
  // `depth` in [0, 1]: 0 at the rail, 1 at the keel. The 1.5 power holds the section full for
  // most of the draught and turns it into a V only near the keel.
  const depth = Math.sin(angle) ** 1.5;
  // 0.55 keeps the topsides fairly upright rather than rounding them off into a barrel.
  const spread = Math.sign(across) * Math.abs(across) ** 0.55;
  // Tumblehome applies only in the top third; below that the section carries its full beam.
  const width = depth < 0.3 ? MathUtils.lerp(station.tumblehome, 1, depth / 0.3) : 1;
  return [
    spread * station.halfBeam * width,
    station.rail - depth * (station.rail - station.keel),
    station.z,
  ];
}

/**
 * Stitch the stations into a closed hull, capped at both ends.
 *
 * Stations are sorted by z first: the winding that makes a face point outwards depends on the sign
 * of the step along the keel, so a list authored bow-first would build the whole hull inside-out
 * and backface culling would then show its interior.
 */
function loftHull(input: readonly IHullStation[]): BufferGeometry {
  const stations = [...input].sort((a, b) => a.z - b.z);
  const positions: number[] = [];
  const push = (point: readonly [number, number, number]): void => {
    positions.push(point[0], point[1], point[2]);
  };
  for (let s = 0; s < stations.length - 1; s += 1) {
    const near = stations[s];
    const far = stations[s + 1];
    if (near === undefined || far === undefined) continue;
    for (let i = 0; i < RING_SEGMENTS; i += 1) {
      const next = (i + 1) % RING_SEGMENTS;
      const a = ringPoint(near, i);
      const b = ringPoint(far, i);
      const c = ringPoint(far, next);
      const d = ringPoint(near, next);
      push(a);
      push(c);
      push(b);
      push(a);
      push(d);
      push(c);
    }
  }
  const cap = (station: IHullStation, forwards: boolean): void => {
    const centre: [number, number, number] = [0, (station.rail + station.keel) / 2, station.z];
    for (let i = 0; i < RING_SEGMENTS; i += 1) {
      const next = (i + 1) % RING_SEGMENTS;
      push(centre);
      push(ringPoint(station, forwards ? next : i));
      push(ringPoint(station, forwards ? i : next));
    }
  };
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (first !== undefined) cap(first, false);
  if (last !== undefined) cap(last, true);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Bow at -Z, stern at +Z, y = 0 at the design waterline.
 *
 * The waterline matters beyond looks: `Ship.ts` writes `Buoyancy3D` hull points against this
 * origin, so moving y = 0 here silently changes how the ship floats.
 *
 * Read down `rail` and the sheer is visible — high at both ends, lowest in the waist. Read down
 * `halfBeam` and so is the plan: a fine entry, full amidships, drawn in to a narrow transom.
 */
const HULL_STATIONS: readonly IHullStation[] = [
  { halfBeam: 0.1, keel: -0.34, rail: 0.78, tumblehome: 0.95, z: -3.2 },
  { halfBeam: 0.34, keel: -0.5, rail: 0.66, tumblehome: 0.88, z: -2.6 },
  { halfBeam: 0.66, keel: -0.6, rail: 0.55, tumblehome: 0.84, z: -1.8 },
  { halfBeam: 0.86, keel: -0.65, rail: 0.48, tumblehome: 0.82, z: -0.8 },
  { halfBeam: 0.94, keel: -0.66, rail: 0.46, tumblehome: 0.82, z: 0.2 },
  { halfBeam: 0.91, keel: -0.63, rail: 0.5, tumblehome: 0.83, z: 1.2 },
  { halfBeam: 0.78, keel: -0.55, rail: 0.66, tumblehome: 0.85, z: 2.1 },
  { halfBeam: 0.62, keel: -0.44, rail: 0.84, tumblehome: 0.9, z: 2.8 },
  { halfBeam: 0.5, keel: -0.3, rail: 0.9, tumblehome: 0.96, z: 3.2 },
];

/** Rail height at a station, for hanging the wale and the gunwale on the same curve. */
function railAt(z: number): number {
  let previous = HULL_STATIONS[0];
  if (previous === undefined) return 0.5;
  for (const station of HULL_STATIONS) {
    if (station.z >= z) {
      const span = station.z - previous.z;
      const t = span === 0 ? 0 : (z - previous.z) / span;
      return MathUtils.lerp(previous.rail, station.rail, t);
    }
    previous = station;
  }
  return previous.rail;
}

function halfBeamAt(z: number): number {
  let previous = HULL_STATIONS[0];
  if (previous === undefined) return 0.5;
  for (const station of HULL_STATIONS) {
    if (station.z >= z) {
      const span = station.z - previous.z;
      const t = span === 0 ? 0 : (z - previous.z) / span;
      return MathUtils.lerp(previous.halfBeam, station.halfBeam, t);
    }
    previous = station;
  }
  return previous.halfBeam;
}

/**
 * A sail with a belly in it.
 *
 * A `PlaneGeometry` is the wrong shape for canvas under load and it shows: flat, it catches the
 * key light as one even value and reads as card. Bulging the grid on its own normal gives the
 * gradient across the cloth that says "this is full of wind", and it is one `sin` per axis.
 */
function belliedSail(width: number, height: number, belly: number, taper = 1): BufferGeometry {
  const columns = 8;
  const rows = 6;
  const positions: number[] = [];
  const at = (u: number, v: number): [number, number, number] => {
    // `taper` narrows the head, which is the difference between a square course and a lateen.
    const spread = MathUtils.lerp(1, taper, v);
    return [
      (u - 0.5) * width * spread,
      (v - 0.5) * height,
      Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * belly,
    ];
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u0 = column / columns;
      const u1 = (column + 1) / columns;
      const v0 = row / rows;
      const v1 = (row + 1) / rows;
      const a = at(u0, v0);
      const b = at(u1, v0);
      const c = at(u1, v1);
      const d = at(u0, v1);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function piece(geometry: BufferGeometry, material: Material, shadow = true): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  return mesh;
}

/**
 * Collects rigid pieces and emits one mesh per material.
 *
 * A ship authored as a hundred and thirty little meshes is a hundred and thirty draw calls, and
 * with the shadow pass that put the production-performance playtest at eight hundred against a
 * budget of a hundred and twenty. None of the hull, rig or trim ever moves relative to the ship,
 * so baking them costs nothing: the six materials stay separate and separately editable. Anything
 * a game might want to animate — the sails, the pennant — is added outside this and stays its own
 * transform.
 */
class RigidAssembly {
  readonly #byMaterial = new Map<Material, Mesh[]>();

  add(mesh: Mesh): void {
    const bucket = this.#byMaterial.get(mesh.material as Material);
    if (bucket === undefined) this.#byMaterial.set(mesh.material as Material, [mesh]);
    else bucket.push(mesh);
  }

  attachTo(root: Group): void {
    for (const [material, meshes] of this.#byMaterial) {
      const geometry = mergeGeometries(
        meshes.map((mesh) => {
          mesh.updateMatrix();
          // `mergeGeometries` refuses a mix of indexed and non-indexed inputs, and a lofted hull is
          // non-indexed while every Three.js primitive is indexed.
          const placed = mesh.geometry.clone().applyMatrix4(mesh.matrix);
          const cloned = placed.index === null ? placed : placed.toNonIndexed();
          for (const name of Object.keys(cloned.attributes)) {
            if (name !== "position") cloned.deleteAttribute(name);
          }
          return cloned;
        }),
        false,
      );
      if (geometry === null) throw new Error("mergeGeometries returned null for a ship part.");
      geometry.computeVertexNormals();
      const merged = new Mesh(geometry, material);
      merged.castShadow = meshes[0]?.castShadow ?? true;
      merged.receiveShadow = true;
      root.add(merged);
    }
  }
}

/** A mast with its yard, sail, shrouds and truck. Returns the group so a game can reach the sail. */
function mast(
  materials: ISailingMaterials,
  rigid: RigidAssembly,
  options: {
    readonly height: number;
    readonly sail: BufferGeometry;
    readonly sailY: number;
    readonly yardWidth: number;
    readonly yardY: number;
    readonly z: number;
  },
): Group {
  const group = new Group();
  const foot = railAt(options.z) - 0.1;
  const pole = piece(new CylinderGeometry(0.035, 0.055, options.height, 7), materials.spar);
  pole.position.set(0, foot + options.height / 2, options.z);
  rigid.add(pole);

  const yard = piece(new CylinderGeometry(0.03, 0.03, options.yardWidth, 6), materials.spar);
  yard.rotation.z = Math.PI / 2;
  yard.position.set(0, options.yardY, options.z);
  rigid.add(yard);

  const canvas = piece(options.sail, materials.sail, true);
  canvas.position.set(0, options.sailY, options.z + 0.06);
  canvas.name = "sail";
  group.add(canvas);

  // Shrouds: one line authored, placed to both rails. Without them the masts look stuck on.
  const head = foot + options.height * 0.92;
  for (const side of [-1, 1]) {
    for (const aft of [-0.9, 0.9]) {
      const anchorZ = options.z + aft;
      const beam = halfBeamAt(anchorZ) * 0.86;
      const anchorY = railAt(anchorZ);
      const drop = head - anchorY;
      const run = Math.hypot(side * beam, aft);
      const shroud = piece(
        new CylinderGeometry(0.009, 0.009, Math.hypot(drop, run), 4),
        materials.cordage,
        false,
      );
      shroud.position.set((side * beam) / 2, (head + anchorY) / 2, (options.z + anchorZ) / 2);
      shroud.rotation.z = Math.atan2(side * beam, drop);
      shroud.rotation.x = -Math.atan2(aft, drop);
      rigid.add(shroud);
    }
  }
  return group;
}

export function createShipModel(materials: ISailingMaterials): Group {
  const ship = new Group();
  const rigid = new RigidAssembly();

  // blockout: the hull itself.
  rigid.add(piece(loftHull(HULL_STATIONS), materials.hull));

  // A planked weather deck, set below the rail so the gunwale stands proud of it.
  for (let index = 0; index < 9; index += 1) {
    const z = MathUtils.lerp(-2.5, 2.6, index / 8);
    const plank = piece(new BoxGeometry(halfBeamAt(z) * 1.62, 0.05, 0.56), materials.deck);
    plank.position.set(0, railAt(z) + 0.02, z);
    rigid.add(plank);
  }

  // Gunwale and wale strakes, both following the sheer. Two curves, twelve boxes, and the hull
  // stops being a smooth blob.
  for (let index = 0; index < 24; index += 1) {
    const z = MathUtils.lerp(-2.9, 3.1, index / 23);
    const beam = halfBeamAt(z);
    for (const side of [-1, 1]) {
      const rail = piece(new BoxGeometry(0.07, 0.12, 0.3), materials.trim);
      rail.position.set(side * beam * 0.9, railAt(z) + 0.05, z);
      rigid.add(rail);
      const wale = piece(new BoxGeometry(0.055, 0.08, 0.3), materials.trim);
      wale.position.set(side * beam * 1.0, railAt(z) - 0.34, z);
      rigid.add(wale);
    }
  }

  // Sterncastle: a raised deck aft with a rail around it, and the beakhead forward.
  const castle = piece(new BoxGeometry(1.06, 0.62, 1.5), materials.hull);
  castle.position.set(0, 0.92, 2.4);
  rigid.add(castle);
  const castleDeck = piece(new BoxGeometry(1.14, 0.07, 1.58), materials.deck);
  castleDeck.position.set(0, 1.26, 2.4);
  rigid.add(castleDeck);
  for (const side of [-1, 1]) {
    const rail = piece(new BoxGeometry(0.07, 0.22, 1.58), materials.trim);
    rail.position.set(side * 0.55, 1.4, 2.4);
    rigid.add(rail);
    const window = piece(new BoxGeometry(0.04, 0.16, 0.22), materials.trim);
    window.position.set(side * 0.54, 0.98, 2.8);
    rigid.add(window);
  }
  const transomRail = piece(new BoxGeometry(1.16, 0.22, 0.07), materials.trim);
  transomRail.position.set(0, 1.4, 3.15);
  rigid.add(transomRail);

  const beak = piece(new ConeGeometry(0.2, 0.9, 6), materials.hull);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.16, -3.5);
  rigid.add(beak);

  // Bowsprit, raked up over the beakhead.
  const bowsprit = piece(new CylinderGeometry(0.03, 0.05, 2.1, 6), materials.spar);
  bowsprit.rotation.x = Math.PI / 2 - 0.38;
  bowsprit.position.set(0, 0.98, -3.5);
  rigid.add(bowsprit);

  // Rudder and tiller, hung on the transom.
  const rudder = piece(new BoxGeometry(0.07, 0.86, 0.34), materials.hull);
  rudder.position.set(0, -0.24, 3.34);
  rigid.add(rudder);
  const tiller = piece(new CylinderGeometry(0.025, 0.025, 0.7, 5), materials.spar);
  tiller.rotation.x = Math.PI / 2 - 0.25;
  tiller.position.set(0, 1.42, 2.9);
  rigid.add(tiller);

  // The rig: two square courses of falling size and a raked lateen on the mizzen.
  ship.add(
    mast(materials, rigid, {
      height: 3.2,
      sail: belliedSail(1.5, 1.35, 0.4),
      sailY: 2.45,
      yardWidth: 1.7,
      yardY: 3.15,
      z: -1.55,
    }),
  );
  ship.add(
    mast(materials, rigid, {
      height: 4.3,
      sail: belliedSail(1.85, 1.8, 0.5),
      sailY: 3.05,
      yardWidth: 2.1,
      yardY: 3.98,
      z: 0.1,
    }),
  );

  // Crow's nest on the main.
  const nest = piece(new CylinderGeometry(0.26, 0.2, 0.24, 9), materials.deck);
  nest.position.set(0, 4.16, 0.1);
  rigid.add(nest);

  // Mizzen: a lateen yard raked steeply, with a triangular sail hung from it.
  const mizzen = piece(new CylinderGeometry(0.03, 0.045, 2.4, 6), materials.spar);
  mizzen.position.set(0, 1.9, 1.9);
  rigid.add(mizzen);
  const lateenYard = piece(new CylinderGeometry(0.025, 0.025, 3.1, 5), materials.spar);
  lateenYard.rotation.x = 0.85;
  lateenYard.position.set(0, 2.5, 1.9);
  rigid.add(lateenYard);
  const lateen = piece(belliedSail(1.15, 2.3, 0.3, 0.12), materials.sail);
  lateen.rotation.x = 0.85;
  lateen.rotation.y = Math.PI / 2;
  lateen.position.set(0.1, 2.4, 1.95);
  lateen.name = "lateen";
  ship.add(lateen);

  // Pennant at the main truck: the one part of the silhouette that is meant to be seen moving.
  const pennant = piece(belliedSail(0.62, 0.2, 0.05, 0.25), materials.trim, false);
  pennant.position.set(0.34, 4.6, 0.1);
  pennant.name = "pennant";
  ship.add(pennant);

  rigid.attachTo(ship);
  return ship;
}

/** A course marker: a float with a banded topmark and a small flag. */
export function createBuoy(materials: ISailingMaterials): Group {
  const buoy = new Group();
  const rigid = new RigidAssembly();
  const body = new Mesh(new CylinderGeometry(0.2, 0.26, 0.66, 10), materials.buoy);
  body.position.y = 0.16;
  body.castShadow = true;
  const band = new Mesh(new CylinderGeometry(0.22, 0.22, 0.13, 10), materials.trim);
  band.position.y = 0.28;
  band.castShadow = true;
  const cap = new Mesh(new SphereGeometry(0.23, 10, 7), materials.buoy);
  cap.position.y = 0.51;
  cap.scale.y = 0.6;
  cap.castShadow = true;
  const pole = new Mesh(new CylinderGeometry(0.025, 0.025, 0.7, 5), materials.spar);
  pole.position.y = 0.85;
  const flag = new Mesh(belliedSail(0.4, 0.24, 0.05, 0.4), materials.trim);
  flag.rotation.y = Math.PI / 2;
  flag.position.set(0, 1.04, 0.17);
  for (const part of [body, band, cap, pole, flag]) rigid.add(part);
  rigid.attachTo(buoy);
  return buoy;
}

/**
 * A headland: a beach shelf, a rock mass and a stand of palms.
 *
 * The island this replaces sat at y = -0.88 with a height of 1.5, so its crown was thirteen
 * centimetres *below* the waterline and the frame contained no land at all. The sea needs
 * something with a horizon behind it or there is no sense of a passage being sailed.
 */
export function createIsland(materials: ISailingMaterials): Group {
  const island = new Group();
  const rigid = new RigidAssembly();
  const beach = new Mesh(new CylinderGeometry(9.5, 11.5, 1.6, 22), materials.sand);
  beach.position.y = -0.4;
  beach.scale.z = 0.72;
  beach.receiveShadow = true;
  rigid.add(beach);

  const headland = new Mesh(new SphereGeometry(4.6, 14, 9), materials.island);
  headland.position.set(-1.4, 0.1, -1.2);
  headland.scale.set(1, 0.62, 0.78);
  headland.castShadow = true;
  headland.receiveShadow = true;
  rigid.add(headland);
  const knoll = new Mesh(new SphereGeometry(2.7, 12, 8), materials.island);
  knoll.position.set(3.4, 0.1, 1.1);
  knoll.scale.set(1, 0.5, 0.85);
  knoll.castShadow = true;
  rigid.add(knoll);

  // A stand of palms, placed by a seeded jitter so two captures frame the same headland.
  let seed = 41;
  const jitter = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2 + jitter();
    const radius = 3 + jitter() * 3.5;
    const height = 1.9 + jitter() * 1.1;
    const trunk = new Mesh(new CylinderGeometry(0.09, 0.15, height, 5), materials.spar);
    trunk.position.set(Math.cos(angle) * radius, 0.9 + height / 2, Math.sin(angle) * radius * 0.7);
    trunk.rotation.z = (jitter() - 0.5) * 0.24;
    trunk.castShadow = true;
    rigid.add(trunk);
    for (let frond = 0; frond < 5; frond += 1) {
      const blade = new Mesh(new ConeGeometry(0.24, 1.5, 4), materials.foliage);
      blade.position.copy(trunk.position);
      blade.position.y += height / 2 + 0.1;
      blade.rotation.z = Math.PI / 2 - 0.5;
      blade.rotation.y = (frond / 5) * Math.PI * 2;
      blade.translateY(0.6);
      blade.castShadow = true;
      rigid.add(blade);
    }
  }

  rigid.attachTo(island);
  island.position.set(-13, 0, -17);
  return island;
}
