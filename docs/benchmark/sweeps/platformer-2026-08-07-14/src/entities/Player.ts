import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group } from "three";
import { ball, block, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;
type Materials = ReturnType<typeof import("../render/materials.js").createMaterials>;

const COYOTE_TIME = 0.14;
const JUMP_BUFFER = 0.16;
const JUMP_SPEED = 7.1;
const MOVE_SPEED = 4.2;

export interface PlayerSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class Player {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #time = 0;
  #leftLeg: Group;
  #rightLeg: Group;
  #tail: Group;
  #spawn: PlayerSpawn;

  constructor(ctx: GameCtx, materials: Materials, spawn: PlayerSpawn) {
    this.#spawn = spawn;
    this.mesh = new Group();
    this.mesh.name = "orange-scout-player";
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    ctx.add(this.mesh);

    const torso = block(0.66, 0.72, 0.54, materials.playerBlue, { radius: 0.16 });
    torso.position.y = -0.02;
    this.mesh.add(torso);

    const chestPanel = block(0.34, 0.28, 0.035, materials.playerBlueDark, {
      castShadow: false,
      receiveShadow: false,
      radius: 0.045,
    });
    chestPanel.position.set(0, 0.06, -0.285);
    this.mesh.add(chestPanel);

    const backpack = block(0.58, 0.56, 0.28, materials.playerBlueDark, { radius: 0.11 });
    backpack.position.set(0, 0.02, 0.36);
    this.mesh.add(backpack);
    const packCap = block(0.42, 0.16, 0.32, materials.playerOrange, { radius: 0.07 });
    packCap.position.set(0, 0.24, 0.37);
    this.mesh.add(packCap);

    const head = ball(0.39, materials.playerOrange, { segments: 18 });
    head.scale.set(0.98, 1.04, 0.94);
    head.position.set(0, 0.46, -0.01);
    this.mesh.add(head);
    const muzzle = ball(0.22, materials.playerCream, { segments: 14 });
    muzzle.scale.set(1, 0.74, 0.8);
    muzzle.position.set(0, 0.33, -0.34);
    this.mesh.add(muzzle);
    for (const x of [-0.13, 0.13]) {
      const eye = ball(0.045, materials.eye, { segments: 10, castShadow: false, receiveShadow: false });
      eye.position.set(x, 0.52, -0.61);
      this.mesh.add(eye);
    }
    const nose = ball(0.06, materials.playerOrangeLight, { segments: 10, castShadow: false });
    nose.position.set(0, 0.33, -0.54);
    this.mesh.add(nose);

    for (const x of [-0.2, 0.2]) {
      const ear = new Group();
      const outer = tube(0.03, 0.17, 0.34, materials.playerOrange, { segments: 10 });
      outer.rotation.z = x < 0 ? -0.22 : 0.22;
      outer.position.y = 0.86;
      ear.add(outer);
      const inner = tube(0.02, 0.09, 0.2, materials.playerCream, {
        castShadow: false,
        receiveShadow: false,
        segments: 10,
      });
      inner.rotation.z = x < 0 ? -0.22 : 0.22;
      inner.position.set(0, 0.86, -0.018);
      ear.add(inner);
      ear.position.x = x;
      this.mesh.add(ear);
    }

    this.#leftLeg = new Group();
    this.#rightLeg = new Group();
    for (const [leg, x] of [
      [this.#leftLeg, -0.2],
      [this.#rightLeg, 0.2],
    ] as const) {
      const legMesh = block(0.28, 0.4, 0.3, materials.playerBlue, { radius: 0.09 });
      legMesh.position.y = -0.34;
      leg.add(legMesh);
      const boot = block(0.34, 0.18, 0.42, materials.playerCream, { radius: 0.08 });
      boot.position.set(0, -0.57, -0.08);
      leg.add(boot);
      leg.position.x = x;
      this.mesh.add(leg);
    }

    for (const [arm, x] of [
      [-1, -0.48],
      [1, 0.48],
    ] as const) {
      const armMesh = block(0.23, 0.46, 0.25, materials.playerBlue, { radius: 0.09 });
      armMesh.rotation.z = arm * 0.24;
      armMesh.position.set(x, -0.03, -0.02);
      this.mesh.add(armMesh);
      const glove = ball(0.14, materials.playerCream, { segments: 12 });
      glove.position.set(x + arm * 0.06, -0.28, -0.04);
      this.mesh.add(glove);
    }

    this.#tail = new Group();
    const tailBase = ball(0.28, materials.playerOrange, { segments: 14 });
    tailBase.position.set(0.12, 0, 0.56);
    const tailTip = ball(0.2, materials.playerCream, { segments: 14 });
    tailTip.position.set(0.12, 0.11, 0.82);
    this.#tail.add(tailBase, tailTip);
    this.mesh.add(this.#tail);

    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.34, minWidth: 0.2 },
      gravity: -19,
      maxFallSpeed: 18,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.22, 0.31),
      snapToGround: 0.18,
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const grounded = this.body.grounded;
    this.#coyoteTime = Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (grounded) this.#coyoteTime = COYOTE_TIME;
    if (ctx.input.justPressed("jump")) this.#jumpBuffer = JUMP_BUFFER;
    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#coyoteTime = 0;
      this.#jumps += 1;
      if (!grounded) this.#coyoteJumps += 1;
    }

    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);

    const horizontalSpeed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const stride = Math.min(1, horizontalSpeed / MOVE_SPEED);
    this.#time += dt * (horizontalSpeed > 0.08 ? 11 : 2.2);
    const step = Math.sin(this.#time) * 0.52 * stride;
    this.#leftLeg.rotation.x = step;
    this.#rightLeg.rotation.x = -step;
    this.#tail.rotation.y = Math.sin(this.#time * 0.43) * 0.16;
    if (horizontalSpeed > 0.08) this.mesh.rotation.y = Math.atan2(this.body.velocity.x, -this.body.velocity.z);
  }

  respawn(): void {
    this.body.teleport(this.#spawn);
    this.body.velocity.set(0, 0, 0);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
  }

  debug(): { coyoteJumps: number; grounded: boolean; jumps: number; position: number[] } {
    return {
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      jumps: this.#jumps,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
