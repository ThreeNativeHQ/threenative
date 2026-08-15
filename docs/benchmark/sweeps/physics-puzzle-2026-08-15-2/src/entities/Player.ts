import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { CapsuleGeometry, Group, Mesh, MathUtils, SphereGeometry } from "three";
import { LAYER, MASK } from "../layers.js";
import type { Materials } from "../render/materials.js";
import { roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MOVE_SPEED = 4.2;
const JUMP_SPEED = 5.4;
export const PLAYER_SPAWN = { x: -5.4, y: 0.85, z: -0.3 } as const;

/**
 * A stubby mover: capsule torso, ball head, four limbs. It leans into whatever
 * it is pushing, which is the whole read of the reference image.
 */
export class Player {
  readonly root: Group;
  readonly body: CharacterBody3D;
  readonly #rig = new Group();
  readonly #armL = new Mesh(new CapsuleGeometry(0.09, 0.34, 4, 8));
  readonly #armR = new Mesh(new CapsuleGeometry(0.09, 0.34, 4, 8));
  readonly #legL = new Mesh(new CapsuleGeometry(0.1, 0.3, 4, 8));
  readonly #legR = new Mesh(new CapsuleGeometry(0.1, 0.3, 4, 8));
  #facing = 0;
  #stride = 0;
  #jumps = 0;

  constructor(ctx: GameCtx, materials: Materials) {
    const skin = materials.player;
    const torso = new Mesh(new CapsuleGeometry(0.24, 0.34, 6, 12), skin);
    torso.position.y = 0.12;
    const head = new Mesh(new SphereGeometry(0.21, 16, 12), skin);
    head.position.y = 0.55;
    const pack = new Mesh(roundedBox(0.26, 0.26, 0.16, 0.06), skin);
    pack.position.set(0, 0.16, -0.24);
    for (const limb of [this.#armL, this.#armR, this.#legL, this.#legR]) limb.material = skin;
    this.#armL.position.set(-0.3, 0.24, 0.05);
    this.#armR.position.set(0.3, 0.24, 0.05);
    this.#legL.position.set(-0.13, -0.3, 0);
    this.#legR.position.set(0.13, -0.3, 0);
    this.#rig.add(torso, head, pack, this.#armL, this.#armR, this.#legL, this.#legR);
    this.#rig.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    this.root = new Group();
    this.root.name = "player";
    this.root.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
    this.#rig.scale.setScalar(1.5);
    this.root.add(this.#rig);
    ctx.add(this.root);

    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.35, minWidth: 0.2, includeDynamicBodies: true },
      collisionLayer: LAYER.player,
      collisionMask: MASK.player,
      object: this.root,
      physics: ctx.physics,
      // The whole point of the game: the controller shoves dynamic bodies
      // instead of sliding around them.
      pushesDynamicBodies: true,
      shape: CollisionShape3D.capsule(0.35, 0.3),
      snapToGround: 0.3,
    });
  }

  /**
   * `script` replaces live input for the determinism replay: the same table of
   * fixed-tick segments drives both runs, so the only difference between them
   * would be the simulation itself.
   */
  update(ctx: GameCtx, dt: number, script?: { readonly x: number; readonly y: number }): void {
    const move = script ?? ctx.input.vector("move");
    const speed = Math.hypot(move.x, move.y);
    if (script === undefined && ctx.input.justPressed("jump") && this.body.grounded) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumps += 1;
    }
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);

    if (speed > 0.01) this.#facing = Math.atan2(move.x, -move.y);
    this.#rig.rotation.y = MathUtils.damp(this.#rig.rotation.y, this.#facing, 12, dt);
    // Lean forward with speed, and swing the limbs so the push reads as effort.
    this.#rig.rotation.x = MathUtils.damp(this.#rig.rotation.x, speed * 0.34, 8, dt);
    this.#stride += speed * dt * 11;
    const swing = Math.sin(this.#stride) * 0.5 * Math.min(1, speed);
    this.#legL.rotation.x = swing;
    this.#legR.rotation.x = -swing;
    this.#armL.rotation.x = -swing * 0.7 - speed * 0.9;
    this.#armR.rotation.x = swing * 0.7 - speed * 0.9;
  }

  get position() {
    return this.root.position;
  }

  get jumps(): number {
    return this.#jumps;
  }

  respawn(): void {
    this.body.teleport(PLAYER_SPAWN);
    this.body.velocity.set(0, 0, 0);
  }

  dispose(): void {
    this.body.dispose();
    this.root.removeFromParent();
  }
}
