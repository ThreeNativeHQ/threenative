import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import {
  CapsuleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 7.2;
const MOVE_SPEED = 6.5;
const SPAWN = { x: -9, y: 1.1, z: 0 } as const;

export class Player {
  readonly mesh = new Group();
  readonly body: CharacterBody3D;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #runTime = 0;
  #visual: Group;

  constructor(ctx: GameCtx) {
    this.mesh.name = "Trailblazer";
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);

    this.#visual = new Group();
    this.#visual.position.y = 0.1;
    this.mesh.add(this.#visual);

    const bodyMaterial = new MeshStandardMaterial({ color: 0xff8b38, roughness: 0.55 });
    const suitMaterial = new MeshStandardMaterial({ color: 0x2b83b6, roughness: 0.48 });
    const creamMaterial = new MeshStandardMaterial({ color: 0xfff0c9, roughness: 0.68 });
    const darkMaterial = new MeshStandardMaterial({ color: 0x2b2631, roughness: 0.5 });

    const torso = new Mesh(new CapsuleGeometry(0.29, 0.5, 6, 12), suitMaterial);
    torso.scale.set(1.05, 1, 0.72);
    torso.position.y = 0.48;
    torso.castShadow = true;
    this.#visual.add(torso);

    const head = new Mesh(new SphereGeometry(0.34, 16, 12), bodyMaterial);
    head.position.y = 1.05;
    head.castShadow = true;
    this.#visual.add(head);

    for (const side of [-1, 1]) {
      const ear = new Mesh(new ConeGeometry(0.13, 0.3, 4), bodyMaterial);
      ear.position.set(side * 0.2, 1.34, 0);
      ear.rotation.z = side * -0.15;
      ear.castShadow = true;
      this.#visual.add(ear);

      const eye = new Mesh(new SphereGeometry(0.045, 8, 6), darkMaterial);
      eye.position.set(side * 0.12, 1.1, 0.31);
      this.#visual.add(eye);

      const foot = new Mesh(new CapsuleGeometry(0.1, 0.18, 5, 8), creamMaterial);
      foot.position.set(side * 0.17, 0.05, 0.08);
      foot.rotation.z = Math.PI / 2;
      foot.castShadow = true;
      this.#visual.add(foot);
    }

    const scarf = new Mesh(
      new CapsuleGeometry(0.08, 0.25, 5, 8),
      new MeshStandardMaterial({ color: 0xf3d34a, roughness: 0.5 }),
    );
    scarf.position.set(0.22, 0.78, -0.1);
    scarf.rotation.z = -0.7;
    scarf.castShadow = true;
    this.#visual.add(scarf);

    this.mesh.castShadow = true;
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.35, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.48, 0.33),
      snapToGround: 0.15,
    });
  }

  update(ctx: GameCtx, dt: number): void {
    this.#runTime += dt;
    this.#coyoteTime = Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (this.body.grounded) this.#coyoteTime = COYOTE_TIME;
    if (ctx.input.justPressed("jump")) this.#jumpBuffer = JUMP_BUFFER;
    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#coyoteTime = 0;
      this.#jumps += 1;
      this.#coyoteJumps += 1;
    }
    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);

    const bob = this.body.grounded ? Math.sin(this.#runTime * 12) * 0.025 : 0;
    this.#visual.position.y = 0.1 + bob;
    this.#visual.rotation.z = -move.x * 0.08;
  }

  reset(): void {
    this.body.teleport(SPAWN);
    this.body.velocity.set(0, 0, 0);
    this.#jumpBuffer = 0;
  }

  debug(): Record<string, unknown> {
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
