// Generated for you. Framing is a game-owned decision.
import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 52;
  camera.near = 0.1;
  // Past the sea's own reach (`SURFACE.reach`). The far plane is what says where the world ends,
  // and if it ends closer than the water does, the horizon is a cut edge at 420 m with the sky
  // showing through above it.
  camera.far = 8_000;
  camera.position.set(5.2, 2.6, 6.4);
  camera.lookAt(0, 0.6, -2);
  camera.updateProjectionMatrix();
}

/** Where the camera sits relative to the ship: astern, up, and a little out to starboard. */
const CHASE = { astern: 7.4, height: 3.7, starboard: 2.1 } as const;
/** How far ahead of the bow the camera looks, so the next mark is in frame before it is reached. */
const LEAD = 5.2;
/** The least water the camera keeps under it, in metres. */
const FREEBOARD = 1.5;

/**
 * Follow from off the starboard quarter, near the water, **behind the bow**.
 *
 * The offset used to be a constant in world axes, which was fine while the ship could only travel
 * along -Z. Now that the helm turns the hull, a fixed offset means the camera watches the ship
 * from whatever side it has turned towards: sail west and the shot is the transom, sail east and
 * the bowsprit comes at the lens. Rotating the offset by the heading keeps the rig against the
 * sky, which is the shot this game is about.
 *
 * The position is eased and the aim point is not. Easing the aim as well makes the horizon lag
 * the turn and the whole frame swim; easing only the position gives the camera the weight of
 * something being towed astern while the ship stays where the player put it.
 */
export function followShip(
  camera: PerspectiveCamera,
  target: { x: number; y: number; z: number },
  heading: number,
  deltaTime: number,
  seaAtCamera: (x: number, z: number) => number,
): void {
  const forwardX = -Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  const starboardX = Math.cos(heading);
  const starboardZ = -Math.sin(heading);
  const wantX = target.x - forwardX * CHASE.astern + starboardX * CHASE.starboard;
  const wantZ = target.z - forwardZ * CHASE.astern + starboardZ * CHASE.starboard;
  const wantY = target.y + CHASE.height;
  const blend = Math.min(1, Math.max(0, deltaTime) * 3.6);
  camera.position.x += (wantX - camera.position.x) * blend;
  camera.position.y += (wantY - camera.position.y) * blend;
  camera.position.z += (wantZ - camera.position.z) * blend;
  // Never below the sea it is looking at.
  //
  // The height offset is measured from the ship, and the ship is in a trough about half the time
  // — so a camera seven metres astern of a hull that has just dropped into one sits level with, or
  // inside, the crest between them. The frame then goes to a wall of water with a mast sticking
  // out of it, which reads as the renderer having failed rather than as a sea running. The
  // clearance is generous because a crest arriving between two frames has to clear it too.
  const floor = seaAtCamera(camera.position.x, camera.position.z) + FREEBOARD;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(target.x + forwardX * LEAD, target.y + 1.2, target.z + forwardZ * LEAD);
}
