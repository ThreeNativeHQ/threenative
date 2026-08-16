import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from "three";
import { roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";
import { LAYER, MASK } from "./Crate.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MOVE_SPEED = 3.4;
const TURN_RATE = 12;
export const SPAWN = { x: -4.9, y: 0.75, z: 1.7 } as const;

/** A stubby cream mover, after the reference's little pusher. */
function buildFigure(material: MeshStandardMaterial): {
  root: Group;
  lean: Group;
  arms: [Mesh, Mesh];
  legs: [Mesh, Mesh];
} {
  const root = new Group();
  const lean = new Group();
  lean.scale.setScalar(1.22);
  root.add(lean);

  const torso = new Mesh(roundedBox(0.46, 0.6, 0.36, 0.16, 3), material);
  torso.position.y = 0.16;
  const head = new Mesh(new SphereGeometry(0.235, 20, 14), material);
  head.position.y = 0.62;
  head.scale.set(1, 1.08, 1);

  const makeLimb = (width: number, height: number, x: number, y: number): Mesh => {
    const limb = new Mesh(roundedBox(width, height, width, width * 0.45, 3), material);
    limb.position.set(x, y, 0);
    return limb;
  };
  const arms: [Mesh, Mesh] = [makeLimb(0.17, 0.5, -0.3, 0.2), makeLimb(0.17, 0.5, 0.3, 0.2)];
  const legs: [Mesh, Mesh] = [makeLimb(0.19, 0.5, -0.13, -0.36), makeLimb(0.19, 0.5, 0.13, -0.36)];

  for (const mesh of [torso, head, ...arms, ...legs]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    lean.add(mesh);
  }
  return { root, lean, arms, legs };
}

export class Player {
  readonly object: Group;
  readonly body: CharacterBody3D;
  #lean: Group;
  #arms: [Mesh, Mesh];
  #legs: [Mesh, Mesh];
  #facing = 0;
  #stride = 0;
  #speed = 0;

  constructor(ctx: GameCtx, material: MeshStandardMaterial) {
    const figure = buildFigure(material);
    this.object = figure.root;
    this.#lean = figure.lean;
    this.#arms = figure.arms;
    this.#legs = figure.legs;
    this.object.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    ctx.add(this.object);

    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.35, minWidth: 0.2, includeDynamicBodies: false },
      collisionLayer: LAYER.player,
      collisionMask: MASK.player,
      object: this.object,
      physics: ctx.physics,
      // Without this the character walks into a crate and the crate does not
      // move, which reads as a broken simulation rather than a default.
      pushesDynamicBodies: true,
      shape: CollisionShape3D.capsule(0.34, 0.3),
      snapToGround: 0.3,
    });
  }

  /** `move` is the raw action vector; `yaw` rotates it into camera space. */
  update(move: { x: number; y: number }, yaw: number, dt: number): void {
    const dir = new Vector3(move.x, 0, -move.y);
    if (dir.lengthSq() > 1) dir.normalize();
    dir.applyAxisAngle(new Vector3(0, 1, 0), yaw);

    this.body.velocity.x = dir.x * MOVE_SPEED;
    this.body.velocity.z = dir.z * MOVE_SPEED;
    this.body.moveAndSlide(dt);

    this.#speed = Math.hypot(dir.x, dir.z);
    if (this.#speed > 0.01) {
      const target = Math.atan2(dir.x, dir.z);
      let delta = target - this.#facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.#facing += delta * Math.min(1, TURN_RATE * dt);
      this.#stride += dt * 11;
    } else {
      this.#stride *= 1 - Math.min(1, dt * 8);
    }

    this.object.rotation.y = this.#facing;
    // Lean into the push, and swing the limbs so a still frame reads as motion.
    this.#lean.rotation.x = this.#speed * 0.34;
    const swing = Math.sin(this.#stride) * 0.7 * this.#speed;
    this.#arms[0].rotation.x = swing;
    this.#arms[1].rotation.x = -swing;
    this.#legs[0].rotation.x = -swing * 0.8;
    this.#legs[1].rotation.x = swing * 0.8;
  }

  get position(): Vector3 {
    return this.object.position;
  }

  dispose(): void {
    this.body.dispose();
    this.object.removeFromParent();
  }
}
