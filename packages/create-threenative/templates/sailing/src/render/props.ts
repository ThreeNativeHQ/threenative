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
 * **Freeboard is the number that matters here.** The rails used to sit 0.46 above the waterline
 * against a 0.66 draught, which after normalising to the template's 4.6 m convention is 29 cm of
 * hull showing and 41 cm submerged — the ship photographed as though it were sinking, decks awash,
 * and no amount of buoyancy tuning could raise it because the hull genuinely was that shape. The
 * rails now stand about twice the draught, which is what a caravel looks like.
 *
 * The waterline matters beyond looks: `Ship.ts` writes `Buoyancy3D` hull points against this
 * origin, so moving y = 0 here silently changes how the ship floats.
 *
 * Read down `rail` and the sheer is visible — high at both ends, lowest in the waist. Read down
 * `halfBeam` and so is the plan: a fine entry, full amidships, drawn in to a narrow transom.
 */
const HULL_STATIONS: readonly IHullStation[] = [
  { halfBeam: 0.1, keel: -0.4, rail: 1.16, tumblehome: 0.95, z: -3.2 },
  { halfBeam: 0.34, keel: -0.56, rail: 1.02, tumblehome: 0.88, z: -2.6 },
  { halfBeam: 0.66, keel: -0.66, rail: 0.89, tumblehome: 0.84, z: -1.8 },
  { halfBeam: 0.86, keel: -0.72, rail: 0.82, tumblehome: 0.82, z: -0.8 },
  { halfBeam: 0.94, keel: -0.73, rail: 0.8, tumblehome: 0.82, z: 0.2 },
  { halfBeam: 0.91, keel: -0.7, rail: 0.84, tumblehome: 0.83, z: 1.2 },
  { halfBeam: 0.78, keel: -0.61, rail: 1, tumblehome: 0.85, z: 2.1 },
  { halfBeam: 0.62, keel: -0.5, rail: 1.18, tumblehome: 0.9, z: 2.8 },
  { halfBeam: 0.5, keel: -0.36, rail: 1.24, tumblehome: 0.96, z: 3.2 },
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

/**
 * A swallow-tailed pennant, the tail cut back to the middle of the hoist instead of squared off.
 *
 * The notch is the whole difference: a rectangular flag reads as a card, and at the chase camera's
 * distance the shape is all there is. Cutting the last fifth of the fly into two points turns the
 * same four columns of canvas into the shape a player has seen on every ship ever drawn.
 */
function swallowtail(width: number, height: number, belly: number): BufferGeometry {
  const positions: number[] = [];
  // The notch: past 0.8 of the length the fly narrows to a point, so the tail is two points.
  const fly = (u: number, v: number): number => (u < 0.8 ? v : v * (1 - (u - 0.8) * 5));
  const at = (u: number, v: number): [number, number, number] => [
    u * width,
    (v - 0.5) * height,
    Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * belly,
  ];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const u0 = column / 4;
      const u1 = (column + 1) / 4;
      const v0 = row / 3;
      const v1 = (row + 1) / 3;
      const corners = [
        at(u0, fly(u0, v0)),
        at(u1, fly(u1, v0)),
        at(u1, fly(u1, v1)),
        at(u0, fly(u0, v1)),
      ];
      for (const triangle of [
        [0, 1, 2],
        [0, 2, 3],
      ] as const) {
        for (const index of triangle) {
          const corner = corners[index] as [number, number, number];
          positions.push(...corner);
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One sail, authored flat, ready for `SoftBody3D` to put the wind in it.
 *
 * `belliedSail` bakes the belly into the vertices, which is the right answer for a sail that will
 * never move and the wrong one for a sail that will: a baked curve is the same curve in a flat
 * calm and a gale, and this game already shows the player a wind percentage counting down. Cloth
 * gets the belly from the simulation instead, so the canvas fills as the wind rises and goes slack
 * as it dies — which is the one thing the whole passage turns on and the only part of the ship
 * that ever said it.
 *
 * The grid is flat and a good deal finer than `belliedSail`'s: springs are built from the
 * triangles, so the tessellation *is* the cloth's resolution, and six rows of canvas bends like a
 * garage door.
 */
function sailCloth(
  width: number,
  height: number,
  taper: number,
  belly: number,
): { geometry: BufferGeometry; pinned: number[] } {
  // The cloth's own resolution. Springs are built from the triangles, so this grid is how many
  // springs the canvas has: at ten by eight a course bends in four visible facets and reads as a
  // folded card rather than as a sheet of sailcloth. Fourteen by ten still solves in a fraction of
  // a millisecond and gives the belly eight segments to curve through.
  const columns = 14;
  const rows = 10;
  const positions: number[] = [];
  const pinned: number[] = [];
  const at = (u: number, v: number): [number, number, number] => {
    // `taper` narrows the **foot**, which is the difference between a square course and a lateen.
    //
    // The other way round — the way `belliedSail` reads it, because that sail hangs from its
    // centre — puts the narrow end at the head, and the head is the edge bent to the yard: the
    // mizzen came out as a wedge suspended from a point and widening downwards, which is a lateen
    // upside down.
    const spread = MathUtils.lerp(taper, 1, v);
    // The cut carries a belly, and that is what gives the cloth room to move.
    //
    // Springs hold *distances*, so a sail cut dead flat and bent at its head and both clews can
    // only fill by stretching, and the solver answers a stretch with a restoring force: at any
    // stiffness that keeps the canvas its own size, the wind cannot get into it at all. Cutting
    // the belly in gives the interior slack it can spend — the sail deepens as the wind rises and
    // sags back towards its cut as the wind dies, without a single spring leaving its rest length.
    return [
      (u - 0.5) * width * spread,
      (v - 1) * height,
      Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * belly,
    ];
  };
  const push = (u: number, v: number): void => {
    const index = positions.length / 3;
    positions.push(...at(u, v));
    // The head, bent to the yard, and nothing else.
    //
    // Pinning the clews as well is what a set course actually has, and it was tried both ways.
    // Held at three edges the canvas has nowhere to put the wind but into its own slack, and it
    // gathers: the courses came back as lumps balled against the masts rather than as sails. Hung
    // from the head alone the sail swings, which is a motion the springs never resist, and it
    // reads as a square rig running before the wind — which is the passage this game is.
    if (v === 1) pinned.push(index);
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u0 = column / columns;
      const u1 = (column + 1) / columns;
      const v0 = row / rows;
      const v1 = (row + 1) / rows;
      push(u0, v0);
      push(u1, v0);
      push(u1, v1);
      push(u0, v0);
      push(u1, v1);
      push(u0, v1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return { geometry, pinned };
}

/**
 * Where each sail hangs in the ship model's own space, and how big it is.
 *
 * The cloth cannot be a child of the hull: `SoftBody3D` detaches itself permanently the moment it
 * is removed from the scene, and `ctx.add` is what attaches it to the renderer — so parenting it
 * to the ship after adding would tear it down on the same frame. It lives at the scene root and
 * `Ship` carries each one to its yard every frame instead. These are the yards.
 */
export const SHIP_SAILS = [
  // Fore course, bent to the fore yard.
  { belly: 0.3, height: 1.62, pitch: 0, taper: 1, width: 2.1, x: 0, y: 3.42, yaw: 0, z: -1.49 },
  // Main course, bent to the main yard. The deepest cut of the three, because it is the sail the
  // chase camera looks at most and the one whose belly has to read as canvas under load.
  { belly: 0.42, height: 2.05, pitch: 0, taper: 1, width: 2.7, x: 0, y: 4.42, yaw: 0, z: 0.16 },
  // The mizzen lateen: fore-and-aft, so it is turned side-on and raked with its yard. Its wind
  // therefore pushes it to leeward rather than aft, which falls out of the rotation for free —
  // `SoftBody3D` takes wind in the cloth's own local space.
  {
    belly: 0.3,
    height: 2.15,
    pitch: 0.85,
    taper: 0.24,
    width: 1.55,
    x: 0.08,
    y: 3.62,
    yaw: Math.PI / 2,
    z: 1.95,
  },
] as const;

/** The cloth meshes for `SHIP_SAILS`, in the same order. */
export function createSails(materials: ISailingMaterials): {
  mesh: Mesh;
  pinned: number[];
}[] {
  return SHIP_SAILS.map((sail) => {
    const { geometry, pinned } = sailCloth(sail.width, sail.height, sail.taper, sail.belly);
    const mesh = new Mesh(geometry, materials.sail);
    mesh.castShadow = true;
    mesh.name = "sail-cloth";
    return { mesh, pinned };
  });
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

/**
 * Where a mast's stays land: `[isForestay, z, y]` on the ship's own lines.
 *
 * The forestay of each mast runs forward to the deck under the mast ahead of it and the main's runs
 * all the way to the bowsprit head; every mast's backstays run aft to the quarterdeck rail. The
 * numbers are the model's own — a rail height and a bowsprit head — so retuning `HULL_STATIONS`
 * moves the rig with it.
 */
function staysOf(z: number): readonly (readonly [boolean, number, number])[] {
  const bowsprit = { y: 1.36 + 1.0, z: -4.4 };
  const quarterdeck = { y: 1.79, z: 3.2 };
  const isFore = z < -0.5;
  const stay: [boolean, number, number] = isFore
    ? [true, -2.3, railAt(-2.3) + 0.1]
    : [true, bowsprit.z, bowsprit.y];
  return [stay, [false, quarterdeck.z, quarterdeck.y]];
}

/** A mast with its yard, sail, shrouds and truck. Returns the group so a game can reach the sail. */
function mast(
  materials: ISailingMaterials,
  rigid: RigidAssembly,
  options: {
    readonly height: number;
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

  // No canvas here any more. The sails are cloth and live at the scene root — see `SHIP_SAILS`.

  // Stays: the standing rigging that runs fore and aft, which is most of what the eye reads as
  // "a rig" at this distance. The shrouds below only say "a mast is held up"; a forestay running
  // to the bowsprit head and a backstay running to the transom are what say "this is a ship", and
  // they are four lines of geometry in a material that already exists.
  const head = foot + options.height * 0.92;
  for (const [forward, anchorZ, anchorY] of staysOf(options.z)) {
    const drop = head - anchorY;
    const run = options.z - anchorZ;
    const stay = piece(
      new CylinderGeometry(0.008, 0.008, Math.hypot(drop, run), 4),
      materials.cordage,
      false,
    );
    stay.position.set(0, (head + anchorY) / 2, (options.z + anchorZ) / 2);
    stay.rotation.x = Math.atan2(run, drop);
    rigid.add(stay);
    if (forward) continue;
    // Backstays are doubled and spread to the quarterdeck rails, which is what a real ship does
    // and what stops the mastheads reading as pins stuck into a deck.
    for (const side of [-1, 1]) {
      const beam = halfBeamAt(anchorZ) * 0.9;
      const spread = piece(
        new CylinderGeometry(0.007, 0.007, Math.hypot(drop, run + Math.abs(side * beam)), 4),
        materials.cordage,
        false,
      );
      spread.position.set((side * beam) / 2, (head + anchorY) / 2, (options.z + anchorZ) / 2);
      spread.rotation.z = Math.atan2(side * beam, drop);
      spread.rotation.x = -Math.atan2(run, drop);
      rigid.add(spread);
    }
  }

  // Shrouds: one line authored, placed to both rails. Without them the masts look stuck on.
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
    // Ratlines: the rungs between the fore and aft shroud of each side.
    //
    // They are what a mast looks like from a hundred metres, and they are the one piece of rigging
    // whose absence is louder than its presence. Four per side, every two cylinders merged into
    // the cordage mesh the shrouds are already in, so the whole ladder costs no draw call.
    const beam = halfBeamAt(options.z) * 0.86;
    const railY = railAt(options.z);
    const drop = head - railY;
    for (let rung = 1; rung <= 4; rung += 1) {
      const t = rung / 5.4;
      const rise = head - drop * t;
      // The shrouds splay fore and aft, so the rung runs across the pair at the same height.
      const reach = Math.abs(beam) * (1 - t);
      const rafter = piece(new CylinderGeometry(0.007, 0.007, reach * 2, 4), materials.cordage, false);
      rafter.rotation.z = Math.PI / 2;
      rafter.position.set(side * (Math.abs(beam) - reach), rise, options.z);
      rigid.add(rafter);
    }
  }
  return group;
}

/**
 * The planking: a course of dark seams running the length of the topsides.
 *
 * A lofted hull is one smooth surface of revolution, and at the chase camera's distance the only
 * thing that tells the eye it is looking at *timber* rather than at a brown solid is a line
 * following the sheer. Six seams, in the darkest cordage the model owns, cost six boxes per side
 * and no draw calls at all — `RigidAssembly` bakes them into the cordage mesh this model already
 * has. They are seams and not planks on purpose: at eight metres a strake is two pixels, and a
 * plank wide enough to see would be a ledge the ship does not have.
 */
function planking(materials: ISailingMaterials, rigid: RigidAssembly): void {
  for (const [index, drop] of [0.18, 0.32, 0.46].entries()) {
    for (let step = 0; step < 24; step += 1) {
      const z = MathUtils.lerp(-2.9, 3.1, step / 23);
      // The seam follows the tumblehome, so it draws in as the rail does instead of running out
      // past the hull and hanging in the air over the water.
      const beam = halfBeamAt(z) * (0.99 - index * 0.008);
      for (const side of [-1, 1]) {
        // Longer than the gap between them, so the strakes overlap into a line. At 0.3 long on a
        // 0.26 step they read as a row of dark dashes — a weave, not timber.
        const seam = piece(new BoxGeometry(0.012, 0.014, 0.36), materials.cordage, false);
        seam.position.set(side * beam, railAt(z) - drop, z);
        rigid.add(seam);
      }
    }
  }
}

/** The hull, the weather deck, the rails and the planking: everything below the wale. */
function hullAndDeck(materials: ISailingMaterials, rigid: RigidAssembly): void {
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
      // The wale is dark timber, not accent. It is a strake a hand's width deep running the whole
      // length of the hull on both sides, and painting it the accent red put so much red on the
      // ship that the frame read as a red crate with a deck on it. A caravel's sheer line is a dark
      // band under a bright cap rail, and that contrast is what makes the hull read as a hull.
      const wale = piece(new BoxGeometry(0.055, 0.08, 0.3), materials.cordage);
      wale.position.set(side * beam * 1.0, railAt(z) - 0.34, z);
      rigid.add(wale);
    }
  }
  planking(materials, rigid);
}

/** The quarterdeck and everything standing on it, which is the whole of the ship's aft. */
function quarterdeck(materials: ISailingMaterials, rigid: RigidAssembly): void {
  // Sterncastle: a raised deck aft, and the things that stand on it.
  //
  // It used to be a box, a deck plate and two rails — an empty tray at the back of the ship, which
  // is the one part of a caravel the chase camera looks straight into. A quarterdeck carries a
  // lantern, a binnacle, a helm, a companionway and stowage, and each of those is three boxes.
  const castle = piece(new BoxGeometry(1.12, 0.78, 1.7), materials.hull);
  castle.position.set(0, 1.32, 2.4);
  rigid.add(castle);
  const castleDeck = piece(new BoxGeometry(1.2, 0.08, 1.78), materials.deck);
  castleDeck.position.set(0, 1.75, 2.4);
  rigid.add(castleDeck);

  // A balustered rail around the quarterdeck rather than two slabs: the gaps are the read.
  for (const [x, z, along] of [
    [-0.58, 2.4, true],
    [0.58, 2.4, true],
    [0, 3.24, false],
  ] as const) {
    const cap = piece(
      along ? new BoxGeometry(0.08, 0.08, 1.78) : new BoxGeometry(1.24, 0.08, 0.08),
      materials.trim,
    );
    cap.position.set(x, 2.12, z);
    rigid.add(cap);
    const count = along ? 7 : 5;
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const baluster = piece(new BoxGeometry(0.06, 0.3, 0.06), materials.hull);
      baluster.position.set(
        along ? x : MathUtils.lerp(-0.56, 0.56, t),
        1.94,
        along ? MathUtils.lerp(1.56, 3.24, t) : z,
      );
      rigid.add(baluster);
    }
  }

  // Quarter windows in the transom, and a wale across it.
  for (const x of [-0.34, 0, 0.34]) {
    const window = piece(new BoxGeometry(0.24, 0.28, 0.06), materials.cordage);
    window.position.set(x, 1.36, 3.28);
    rigid.add(window);
  }
  const transomWale = piece(new BoxGeometry(1.18, 0.09, 0.07), materials.trim);
  transomWale.position.set(0, 1.66, 3.28);
  rigid.add(transomWale);

  // The stern lantern on the taffrail — the single most recognisable thing on the back of a ship.
  const lanternPost = piece(new CylinderGeometry(0.035, 0.045, 0.34, 6), materials.spar);
  lanternPost.position.set(0, 2.28, 3.2);
  rigid.add(lanternPost);
  const lantern = piece(new CylinderGeometry(0.11, 0.14, 0.24, 6), materials.trim);
  lantern.position.set(0, 2.56, 3.2);
  rigid.add(lantern);
  const lanternCap = piece(new ConeGeometry(0.16, 0.14, 6), materials.trim);
  lanternCap.position.set(0, 2.74, 3.2);
  rigid.add(lanternCap);

  // Binnacle and whipstaff, where the helmsman stands.
  const binnacle = piece(new BoxGeometry(0.3, 0.34, 0.26), materials.deck);
  binnacle.position.set(0, 1.96, 2.62);
  rigid.add(binnacle);
  const whipstaff = piece(new CylinderGeometry(0.035, 0.045, 0.8, 6), materials.spar);
  whipstaff.rotation.x = -0.22;
  whipstaff.position.set(0, 2.14, 2.16);
  rigid.add(whipstaff);

  // A companionway down off the quarterdeck, and stowage in the waist.
  const companion = piece(new BoxGeometry(0.5, 0.26, 0.36), materials.deck);
  companion.position.set(0, 1.9, 1.68);
  rigid.add(companion);
  const companionRoof = piece(new BoxGeometry(0.56, 0.06, 0.42), materials.trim);
  companionRoof.position.set(0, 2.05, 1.68);
  rigid.add(companionRoof);
  const hatch = piece(new BoxGeometry(0.56, 0.1, 0.6), materials.deck);
  hatch.position.set(0, railAt(-0.6) + 0.06, -0.6);
  rigid.add(hatch);
  const hatchRim = piece(new BoxGeometry(0.64, 0.06, 0.68), materials.trim);
  hatchRim.position.set(0, railAt(-0.6) + 0.13, -0.6);
  rigid.add(hatchRim);
  for (const [x, z] of [
    [-0.42, 0.9],
    [0.42, 0.86],
    [-0.36, -1.3],
  ] as const) {
    const barrel = piece(new CylinderGeometry(0.17, 0.15, 0.36, 8), materials.spar);
    barrel.position.set(x, railAt(z) + 0.2, z);
    rigid.add(barrel);
    const band = piece(new CylinderGeometry(0.18, 0.18, 0.05, 8), materials.trim);
    band.position.set(x, railAt(z) + 0.2, z);
    rigid.add(band);
  }
}

/** The beakhead, the bowsprit, and the rudder hung on the transom. */
function stemAndStern(materials: ISailingMaterials, rigid: RigidAssembly, ship: Group): void {
  const beak = piece(new ConeGeometry(0.2, 0.9, 6), materials.hull);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.42, -3.5);
  rigid.add(beak);

  // Bowsprit, raked up over the beakhead.
  const bowsprit = piece(new CylinderGeometry(0.03, 0.05, 2.1, 6), materials.spar);
  bowsprit.rotation.x = Math.PI / 2 - 0.38;
  bowsprit.position.set(0, 1.36, -3.5);
  rigid.add(bowsprit);

  // Rudder and tiller, hung on the transom.
  //
  // The rudder is the one part of the hull that is **not** in the merged assembly, and it is out
  // of it on purpose: `RigidAssembly` bakes every part's matrix into one mesh per material, which
  // is the right trade for a ship whose planks never move and the wrong one for the single piece
  // that has to answer the helm. It hangs off its own named group instead, pivoted at the head of
  // the stern post, and `Ship` turns it.
  //
  // It was also 1.02 long and centred on the waterline, which put its top at y = 0.49 against a
  // transom whose wale sits at 1.66: from astern — the only angle the chase camera ever offers —
  // it read as a loose plank floating alongside the ship rather than as a rudder hung on it.
  const rudderPivot = new Group();
  rudderPivot.name = "rudder";
  rudderPivot.position.set(0, 1.2, 3.24);
  // Long enough to reach from the wale to a little below the keel, and no longer: at 1.85 it hung
  // a clear third of its length under the hull and read from astern as a loose board being towed.
  // Its lower edge stops a centimetre or two **above** the design waterline. That is the whole of
  // "the keel and rudder hang visibly below it": a blade whose foot is 18 cm under, on a boat whose
  // own 55 cm of freeboard stands 10 m from the lens, hangs in front of the sea behind it whenever
  // the water astern is a little low — and it read as a loose board being towed. A rudder that stops
  // at the waterline loses nothing and cannot be seen below it.
  const blade = piece(new BoxGeometry(0.09, 1.3, 0.3), materials.hull);
  blade.position.set(0, -0.52, 0.06);
  rudderPivot.add(blade);
  const pintle = piece(new CylinderGeometry(0.055, 0.055, 0.62, 6), materials.trim);
  pintle.position.set(0, -0.12, -0.04);
  rudderPivot.add(pintle);
  ship.add(rudderPivot);
  const tiller = piece(new CylinderGeometry(0.025, 0.025, 0.7, 5), materials.spar);
  tiller.rotation.x = Math.PI / 2 - 0.25;
  tiller.position.set(0, 2.0, 2.72);
  rigid.add(tiller);
}

/**
 * The rig: two square-rigged masts and the mizzen, as a caravel carries them.
 *
 * The proportions are the whole read. The masts stood at 3.2 and 4.3 model units against a hull 6.4
 * long — a mast half a hull-length high, which is a punt with poles on it. A caravel's mainmast
 * stands about its own hull-length, and that height is what puts the courses out where the lens can
 * see canvas rather than spars. `yardAt` is the fraction of the mast the yard is bent to, which is
 * what sets how much of the mast is bare pole above the canvas.
 */
const RIG = [
  { height: 4.7, yardAt: 0.6, yardWidth: 2.35, z: -1.55 },
  { height: 6.1, yardAt: 0.62, yardWidth: 2.95, z: 0.1 },
] as const;

export function createShipModel(materials: ISailingMaterials): Group {
  const ship = new Group();
  const rigid = new RigidAssembly();
  hullAndDeck(materials, rigid);
  quarterdeck(materials, rigid);
  stemAndStern(materials, rigid, ship);

  // The rig: two square courses of falling size and a raked lateen on the mizzen.
  for (const mastSpec of RIG) {
    ship.add(
      mast(materials, rigid, {
        height: mastSpec.height,
        yardWidth: mastSpec.yardWidth,
        yardY: railAt(mastSpec.z) - 0.1 + mastSpec.height * mastSpec.yardAt,
        z: mastSpec.z,
      }),
    );
  }

  // Crow's nest on the main, two thirds up it.
  const mainFoot = railAt(RIG[1].z) - 0.1;
  const mainTop = mainFoot + RIG[1].height;
  const nest = piece(new CylinderGeometry(0.3, 0.23, 0.3, 9), materials.deck);
  nest.position.set(0, mainFoot + RIG[1].height * 0.68, RIG[1].z);
  rigid.add(nest);
  // A fighting top under it, so the nest sits on something.
  const top = piece(new CylinderGeometry(0.34, 0.34, 0.05, 9), materials.spar);
  top.position.set(0, mainFoot + RIG[1].height * 0.68 - 0.17, RIG[1].z);
  rigid.add(top);

  // Mizzen: a lateen yard raked steeply, with a triangular sail hung from it.
  const mizzen = piece(new CylinderGeometry(0.03, 0.045, 3.1, 6), materials.spar);
  mizzen.position.set(0, 2.9, 1.9);
  rigid.add(mizzen);
  const lateenYard = piece(new CylinderGeometry(0.025, 0.025, 3.4, 5), materials.spar);
  lateenYard.rotation.x = 0.85;
  lateenYard.position.set(0, 3.4, 1.9);
  rigid.add(lateenYard);
  // The mizzen's own shrouds, so the third mast is held up like the other two rather than standing
  // on the deck like a broom.
  for (const side of [-1, 1]) {
    for (const aft of [-0.8, 0.8]) {
      const anchorZ = 1.9 + aft;
      const beam = halfBeamAt(anchorZ) * 0.84;
      const drop = 4.1 - railAt(anchorZ);
      const shroud = piece(
        new CylinderGeometry(0.008, 0.008, Math.hypot(drop, aft), 4),
        materials.cordage,
        false,
      );
      shroud.position.set((side * beam) / 2, (4.1 + railAt(anchorZ)) / 2, (1.9 + anchorZ) / 2);
      shroud.rotation.z = Math.atan2(side * beam, drop);
      shroud.rotation.x = -Math.atan2(aft, drop);
      rigid.add(shroud);
    }
  }

  // Pennant at the main truck: the one part of the silhouette that is meant to be seen moving, and
  // a swallowtail rather than a rectangle, because a rectangle is the shape of a card on a stick.
  //
  // It used to be 1.25 m long and hung 64 cm out from the truck, in the darkest red the model owns,
  // against a bright sky — and at the chase camera's distance that combination photographs as a
  // dark quadrilateral floating near the horizon with nothing visibly holding it up. It is the
  // *thing the owner pointed at*. Half the length, its hoist against the masthead itself, and the
  // pale canvas red rather than the rails' oxblood, so it reads as a flag on a mast rather than as
  // a slab in the sky.
  const pennant = piece(swallowtail(0.9, 0.3, 0.1), materials.pennant, false);
  pennant.position.set(0.04, mainTop - 0.12, RIG[1].z);
  pennant.name = "pennant";
  ship.add(pennant);

  rigid.attachTo(ship);
  return ship;
}

/** A course marker: a float with a banded topmark and a small flag. */
/**
 * A spar buoy: a float, a mast and a flag, standing about three and a half metres out of the sea.
 *
 * It used to stand 1.2 m, which is the height of a real harbour mark and completely wrong for
 * this game. The course now runs a hundred and twenty metres around a headland, and at thirty
 * metres — the gap between two marks — a 1.2 m buoy was four pixels of red against a moving sea
 * and the player had nothing to steer towards. A mark you cannot see is not a mark.
 */
export function createBuoy(materials: ISailingMaterials): Group {
  const buoy = new Group();
  const rigid = new RigidAssembly();
  const body = new Mesh(new CylinderGeometry(0.34, 0.44, 1.1, 12), materials.buoy);
  body.position.y = 0.2;
  body.castShadow = true;
  const band = new Mesh(new CylinderGeometry(0.37, 0.37, 0.22, 12), materials.trim);
  band.position.y = 0.42;
  band.castShadow = true;
  const cap = new Mesh(new SphereGeometry(0.38, 12, 8), materials.buoy);
  cap.position.y = 0.78;
  cap.scale.y = 0.6;
  cap.castShadow = true;
  const pole = new Mesh(new CylinderGeometry(0.05, 0.06, 2.6, 6), materials.spar);
  pole.position.y = 2.05;
  pole.castShadow = true;
  const flag = new Mesh(belliedSail(1.05, 0.62, 0.12, 0.4), materials.trim);
  flag.rotation.y = Math.PI / 2;
  flag.position.set(0, 2.85, 0.44);
  flag.castShadow = true;
  for (const part of [body, band, cap, pole, flag]) rigid.add(part);
  rigid.attachTo(buoy);
  return buoy;
}

/**
 * A headland: a beach that meets the water in a ring, a rock mass and a stand of palms.
 *
 * The island this replaces sat at y = -0.88 with a height of 1.5, so its crown was thirteen
 * centimetres *below* the waterline and the frame contained no land at all. The sea needs
 * something with a horizon behind it or there is no sense of a passage being sailed.
 *
 * The beach is the other half of that sentence. It used to be a 9.5 m sand **disc** lying flat with
 * its top face 40 cm proud of the water — a pale pancake floating beside the island, which is the
 * thing the owner pointed at. What a beach is, and what the frame needs, is a slope: a skirt that
 * starts as a dune under the palms and runs out under the surface, so the line where sand meets
 * water is a *ring* the swell runs over. The radius below is jittered per segment so the ring is a
 * shoreline and not a compass circle.
 */
export function createIsland(materials: ISailingMaterials): Group {
  const island = new Group();
  const rigid = new RigidAssembly();
  // A cone frustum from a 3.4 m dune at 0.6 m above the water out to a 8.6 m shelf 2.2 m below it,
  // so the waterline sits about 5 m out and everything past that is under the sea. The first cut was
  // twice this and read as a sandbank two boat-lengths across rather than as a beach.
  const beach = new Mesh(new CylinderGeometry(3.4, 8.6, 2.8, 30, 1, true), materials.sand);
  const shore = beach.geometry.getAttribute("position") as BufferAttribute;
  // Jitter the rim only: the top ring is under the palms and the bottom ring is underwater, so the
  // ring that shows is the one that moves. A seeded walk, so two captures frame the same island.
  let seed = 7;
  const jitter = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let index = 0; index < shore.count; index += 1) {
    const y = shore.getY(index);
    if (y > 0.9) continue;
    const stretch = 1 + (jitter() - 0.5) * 0.34;
    shore.setX(index, shore.getX(index) * stretch);
    shore.setZ(index, shore.getZ(index) * stretch);
  }
  shore.needsUpdate = true;
  beach.geometry.computeVertexNormals();
  // The dune's own cap, so the top is sand rather than a hole.
  const dune = new Mesh(new CylinderGeometry(3.4, 3.9, 0.9, 30), materials.sand);
  beach.position.y = -0.2;
  beach.scale.z = 0.78;
  beach.receiveShadow = true;
  rigid.add(beach);
  dune.position.y = 1.25;
  dune.scale.z = 0.78;
  dune.receiveShadow = true;
  rigid.add(dune);

  const headland = new Mesh(new SphereGeometry(3.7, 14, 9), materials.island);
  headland.position.set(-1.2, 1.1, -1.1);
  headland.scale.set(1, 0.72, 0.8);
  headland.castShadow = true;
  headland.receiveShadow = true;
  rigid.add(headland);
  const knoll = new Mesh(new SphereGeometry(2.2, 12, 8), materials.island);
  knoll.position.set(2.6, 0.95, 1.1);
  knoll.scale.set(1, 0.58, 0.85);
  knoll.castShadow = true;
  rigid.add(knoll);
  // A darker rock at the water's edge on one side, which is the half of an island the swell has
  // been working on and the reason its silhouette is not a dome.
  const stack = new Mesh(new SphereGeometry(1.3, 9, 7), materials.rock);
  stack.position.set(-4.2, 0.1, 2.2);
  stack.scale.set(1, 1.35, 0.9);
  stack.castShadow = true;
  rigid.add(stack);

  // A stand of palms, placed by a seeded jitter so two captures frame the same headland.
  seed = 41;
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2 + jitter();
    const radius = 0.9 + jitter() * 2.0;
    const height = 1.9 + jitter() * 1.1;
    const trunk = new Mesh(new CylinderGeometry(0.1, 0.17, height, 5), materials.spar);
    trunk.position.set(Math.cos(angle) * radius, 1.55 + height / 2, Math.sin(angle) * radius * 0.7);
    trunk.rotation.z = (jitter() - 0.5) * 0.24;
    trunk.castShadow = true;
    rigid.add(trunk);
    for (let frond = 0; frond < 5; frond += 1) {
      const blade = new Mesh(new ConeGeometry(0.22, 1.4, 4), materials.foliage);
      blade.position.copy(trunk.position);
      blade.position.y += height / 2 + 0.12;
      blade.rotation.z = Math.PI / 2 - 0.5;
      blade.rotation.y = (frond / 5) * Math.PI * 2;
      blade.translateY(0.56);
      blade.castShadow = true;
      rigid.add(blade);
    }
  }

  rigid.attachTo(island);
  island.position.set(-15, 0, -19);
  return island;
}
