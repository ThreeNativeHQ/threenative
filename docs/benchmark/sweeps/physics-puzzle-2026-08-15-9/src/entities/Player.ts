import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, type Vector2, Vector3 } from "three";
import { LAYER_GOAL, LAYER_PLAYER, LAYER_SOLID, LAYER_WORLD, SPAWN } from "../level/layout.js";
import type { IIsometricView } from "../render/camera.js";
import type { Materials } from "../render/materials.js";
import { ball, block, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MOVE_SPEED = 6.5;
const TURN_RATE = 16;
const LEAN = 0.24;
/** Capsule half-height and radius. Total height 1.4, centred on the group origin. */
const HALF_HEIGHT = 0.3;
const RADIUS = 0.4;

/**
 * The controlled character: a kinematic capsule that shoves what it touches.
 *
 * `pushesDynamicBodies` is the entire reason a crate moves when the character
 * walks into it. Without it Rapier slides the character past a crate and the
 * crate never notices, which reads as a broken simulation rather than a default.
 * `collisionMask` leaves the phantom layer out, which is why the character walks
 * through the glowing crates and through nothing else.
 */
export class Player {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  readonly view: IIsometricView;
  readonly tags: readonly string[] = ["character"];
  /** Sampled by the playtest bridge's runtime.state channel. */
  state = "idle";

  readonly #rig = new Group();
  readonly #limbs: readonly Mesh[];
  #stride = 0;
  readonly #facing = new Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2);
  readonly #direction = new Vector3();

  constructor(ctx: GameCtx, materials: Materials, view: IIsometricView) {
    this.view = view;

    // Read the silhouette from the camera, not from the front: at this distance
    // the figure is about forty pixels tall, so the head has to sit clear of the
    // shoulders and the arms have to swing wide of the torso or the whole thing
    // collapses into one white blob.
    const torso = block(0.42, 0.5, 0.3, materials.player, { radius: 0.13 });
    const head = ball(0.19, materials.player);
    head.position.y = 0.42;
    const armLeft = tube(0.07, 0.055, 0.46, materials.player);
    armLeft.position.set(-0.31, 0.03, 0.1);
    armLeft.rotation.set(0.35, 0, 0.85);
    const armRight = tube(0.07, 0.055, 0.46, materials.player);
    armRight.position.set(0.31, 0.03, 0.1);
    armRight.rotation.set(0.35, 0, -0.85);
    const legLeft = tube(0.09, 0.075, 0.42, materials.playerShade);
    legLeft.position.set(-0.13, -0.49, 0);
    const legRight = tube(0.09, 0.075, 0.42, materials.playerShade);
    legRight.position.set(0.13, -0.49, 0);

    const parts = [torso, head, armLeft, armRight, legLeft, legRight];
    for (const part of parts) {
      part.castShadow = true;
      part.receiveShadow = true;
    }
    this.#rig.add(...parts);
    this.#limbs = [armLeft, armRight, legLeft, legRight];

    this.mesh = new Group();
    this.mesh.name = "player";
    this.mesh.add(this.#rig);
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    ctx.add(this.mesh);

    this.body = new CharacterBody3D({
      autostep: { includeDynamicBodies: true, maxHeight: 0.42, minWidth: 0.2 },
      collisionLayer: LAYER_PLAYER,
      // GOAL is in the mask so the destination sensor can see the character;
      // the controller excludes sensors when it moves, so it never blocks.
      collisionMask: LAYER_WORLD | LAYER_SOLID | LAYER_GOAL,
      entity: "player",
      object: this.mesh,
      physics: ctx.physics,
      pushesDynamicBodies: true,
      shape: CollisionShape3D.capsule(HALF_HEIGHT, RADIUS),
      snapToGround: 0.35,
    });
  }

  /**
   * One fixed step. `move` is the action vector, supplied by live input during
   * play and by the scripted table during a replay run — the character cannot
   * tell the two apart, which is what makes the replay a replay.
   */
  update(dt: number, move: Vector2): void {
    this.view.project(move, this.#direction);
    const moving = this.#direction.lengthSq() > 1e-6;
    if (moving) this.#direction.normalize();

    this.body.velocity.x = this.#direction.x * MOVE_SPEED;
    this.body.velocity.z = this.#direction.z * MOVE_SPEED;
    this.body.moveAndSlide(dt);

    if (moving) {
      this.#facing.lerp(this.#direction, Math.min(1, TURN_RATE * dt)).normalize();
      this.#stride += dt * 11;
    } else {
      this.#stride *= 0.86;
    }
    this.mesh.rotation.y = Math.atan2(this.#facing.x, this.#facing.z);
    // Leaning into the push is the difference between "walking" and "shoving".
    this.#rig.rotation.x = moving ? -LEAN : 0;
    for (const [index, limb] of this.#limbs.entries()) {
      limb.rotation.x = Math.sin(this.#stride + (index % 2) * Math.PI) * (moving ? 0.55 : 0.05);
    }
    this.state = moving ? "walking" : "idle";
  }

  respawn(): void {
    this.body.teleport(SPAWN);
  }

  debug(): Record<string, number | string | boolean> {
    return {
      grounded: this.body.grounded,
      state: this.state,
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
