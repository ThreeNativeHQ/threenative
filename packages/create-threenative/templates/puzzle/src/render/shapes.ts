// Generated for you: ordinary Three.js. Every shape in this kit is built from box, cylinder,
// sphere and torus primitives, so the game ships with no downloaded asset and nothing to license.
// Replace any of these with a loaded model when you have one; nothing here is framework API.
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { createMaterials } from "./materials.js";

export const CRATE_SIZE = 1.1;
export const BALL_RADIUS = 0.42;
export const GOAL_RADIUS = 1.15;

function solid(mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** The floor slab. Its collider comes from `buildStaticColliders`, not from a hand-written box. */
export function floorSlab(width: number, depth: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, 0.4, depth), createMaterials().floor);
  mesh.position.y = -0.2;
  mesh.receiveShadow = true;
  mesh.name = "room-floor";
  return mesh;
}

export function wallSlab(width: number, height: number, depth: number): Mesh {
  const mesh = solid(new Mesh(new BoxGeometry(width, height, depth), createMaterials().wall));
  mesh.name = "room-wall";
  return mesh;
}

/** The shallow rise the ball has to be helped over. Deliberately too steep to roll unaided. */
export function ramp(width: number, rise: number, run: number): Mesh {
  const mesh = solid(new Mesh(new BoxGeometry(width, rise, run), createMaterials().wall));
  mesh.name = "room-ramp";
  return mesh;
}

export function crate(): Mesh {
  const mesh = solid(
    new Mesh(new BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE), createMaterials().crate),
  );
  mesh.name = "crate";
  return mesh;
}

export function ball(): Mesh {
  const mesh = solid(new Mesh(new SphereGeometry(BALL_RADIUS, 20, 14), createMaterials().ball));
  mesh.name = "ball";
  return mesh;
}

/** The hinge frame: two posts and a beam. The bob hangs from the beam on a `Joint3D`. */
export function gantry(span: number, height: number): Group {
  const materials = createMaterials();
  const group = new Group();
  group.name = "gantry";
  for (const side of [-1, 1]) {
    const post = solid(new Mesh(new CylinderGeometry(0.16, 0.2, height, 10), materials.steel));
    post.position.set((side * span) / 2, height / 2, 0);
    group.add(post);
  }
  const beam = solid(new Mesh(new BoxGeometry(span, 0.22, 0.32), materials.steel));
  beam.position.y = height;
  group.add(beam);
  return group;
}

export function weight(radius: number): Mesh {
  const mesh = solid(new Mesh(new SphereGeometry(radius, 18, 12), createMaterials().steel));
  mesh.name = "weight";
  return mesh;
}

/** The goal ring, lying flat. Its `Area3D` is a separate, invisible volume in the scene. */
export function goalRing(): Group {
  const materials = createMaterials();
  const group = new Group();
  group.name = "goal";
  const ring = new Mesh(new TorusGeometry(GOAL_RADIUS, 0.09, 10, 28), materials.goal);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.09;
  const pad = new Mesh(new CylinderGeometry(GOAL_RADIUS, GOAL_RADIUS, 0.04, 28), materials.goal);
  pad.position.y = 0.02;
  pad.receiveShadow = true;
  group.add(ring, pad);
  return group;
}

/**
 * The player: a hovering claw that carries one crate at a time.
 *
 * It wears the accent, and it is the only accent-coloured thing that is not a crate. The first
 * version was steel on a dark floor and read as debris in the frame — a player who cannot find
 * themselves in one glance has no game to play.
 */
export function gripper(): Group {
  const materials = createMaterials();
  const group = new Group();
  const body = solid(new Mesh(new SphereGeometry(0.4, 18, 12), materials.crate));
  body.position.y = 1.05;
  body.scale.y = 0.72;
  const mast = solid(new Mesh(new CylinderGeometry(0.07, 0.09, 0.75, 8), materials.steel));
  mast.position.y = 0.62;
  const foot = solid(new Mesh(new CylinderGeometry(0.34, 0.42, 0.12, 12), materials.steel));
  foot.position.y = 0.06;
  for (const side of [-1, 1]) {
    const claw = solid(new Mesh(new BoxGeometry(0.12, 0.42, 0.12), materials.crate));
    claw.position.set(side * 0.24, 0.34, 0);
    claw.rotation.z = side * 0.3;
    group.add(claw);
  }
  group.add(body, mast, foot);
  return group;
}

/** One floor tile's geometry and material, handed to an `InstancedBatch` by the room builder. */
export function floorTile(size: number): {
  geometry: BoxGeometry;
  material: MeshStandardMaterial;
} {
  // A floor pattern, not a chessboard. The first version used the wall grey against the darker
  // floor and the contrast read louder than the crates, which are the thing the player is meant
  // to look at. `tile` is a half-step above the slab it sits on.
  return { geometry: new BoxGeometry(size, 0.06, size), material: createMaterials().tile };
}
