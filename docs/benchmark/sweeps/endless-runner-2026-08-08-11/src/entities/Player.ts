import type { Ctx } from "@threenative/core";
import {
  Group,
  MathUtils,
  type Material,
  Mesh,
  Object3D,
} from "three";
import { ball, block, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState>;

export interface PlayerMaterials {
  readonly coral: Material;
  readonly dark: Material;
  readonly light: Material;
}

const LANES = [-2.25, 0, 2.25] as const;
const JUMP_SPEED = 8.2;
const GRAVITY = 20;

export class Player {
  readonly mesh = new Group();
  #body = new Group();
  #leftArm = new Object3D();
  #rightArm = new Object3D();
  #leftLeg = new Object3D();
  #rightLeg = new Object3D();
  #lane = 1;
  #verticalVelocity = 0;
  #jumping = false;
  #sliding = false;
  #stride = 0;
  #jumps = 0;
  #crashed = false;
  #pendingLeft = false;
  #pendingRight = false;
  #pendingJump = false;
  #pendingRestart = false;
  #slideHeld = false;
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === "ArrowLeft" || event.code === "KeyA") this.#pendingLeft = true;
    if (event.code === "ArrowRight" || event.code === "KeyD") this.#pendingRight = true;
    if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
      this.#pendingJump = true;
    }
    if (event.code === "Enter" || event.code === "KeyR") this.#pendingRestart = true;
    if (event.code === "ArrowDown" || event.code === "KeyS") this.#slideHeld = true;
  };
  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "ArrowDown" || event.code === "KeyS") this.#slideHeld = false;
  };

  constructor(ctx: GameCtx, materials: PlayerMaterials) {
    this.#buildModel(materials);
    this.mesh.position.set(0, 0, 3.2);
    this.mesh.traverse((object) => {
      if (object instanceof Mesh) object.castShadow = true;
    });
    ctx.add(this.mesh);
    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
  }

  get lane(): number {
    return this.#lane;
  }

  get jumping(): boolean {
    return this.#jumping;
  }

  get sliding(): boolean {
    return this.#sliding;
  }

  get jumps(): number {
    return this.#jumps;
  }

  update(ctx: GameCtx, dt: number, speed: number): void {
    if (!this.#crashed) {
      if (ctx.input.justPressed("laneLeft") || this.#pendingLeft) {
        this.#lane = Math.max(0, this.#lane - 1);
      }
      if (ctx.input.justPressed("laneRight") || this.#pendingRight) {
        this.#lane = Math.min(2, this.#lane + 1);
      }
      if ((ctx.input.justPressed("jump") || this.#pendingJump) && !this.#jumping) {
        this.#jumping = true;
        this.#verticalVelocity = JUMP_SPEED;
        this.#jumps += 1;
      }
      this.#sliding = (ctx.input.pressed("slide") || this.#slideHeld) && !this.#jumping;
    }
    this.#pendingLeft = false;
    this.#pendingRight = false;
    this.#pendingJump = false;

    if (this.#jumping) {
      this.#verticalVelocity -= GRAVITY * dt;
      this.mesh.position.y += this.#verticalVelocity * dt;
      if (this.mesh.position.y <= 0) {
        this.mesh.position.y = 0;
        this.#verticalVelocity = 0;
        this.#jumping = false;
      }
    }

    this.mesh.position.z -= speed * dt;
    this.mesh.position.x = MathUtils.damp(this.mesh.position.x, LANES[this.#lane] ?? 0, 14, dt);
    this.#stride += dt * speed * 0.72;
    this.#animate();
  }

  crash(direction: number): void {
    this.#crashed = true;
    this.#body.rotation.z = direction * -0.22;
    this.#body.rotation.x = -0.18;
  }

  consumeRestart(): boolean {
    const requested = this.#pendingRestart || this.#pendingJump;
    this.#pendingRestart = false;
    this.#pendingJump = false;
    return requested;
  }

  reset(): void {
    this.#lane = 1;
    this.#verticalVelocity = 0;
    this.#jumping = false;
    this.#sliding = false;
    this.#crashed = false;
    this.#pendingLeft = false;
    this.#pendingRight = false;
    this.#pendingJump = false;
    this.#pendingRestart = false;
    this.#slideHeld = false;
    this.mesh.position.set(0, 0, 3.2);
    this.#body.rotation.set(0, 0, 0);
    this.#body.scale.set(1, 1, 1);
  }

  debug(): Record<string, unknown> {
    return {
      grounded: !this.#jumping,
      jumping: this.#jumping,
      lane: this.#lane,
      position: this.mesh.position.toArray(),
      sliding: this.#sliding,
      jumps: this.#jumps,
      tags: ["runner", this.#crashed ? "crashed" : "running"],
    };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
    this.mesh.removeFromParent();
  }

  #buildModel(materials: PlayerMaterials): void {
    const torso = block(0.84, 1.05, 0.62, materials.coral, { radius: 0.22 });
    torso.position.y = 1.25;
    const chest = block(0.58, 0.2, 0.66, materials.light, { radius: 0.08 });
    chest.position.set(0, 1.42, -0.03);
    const head = ball(0.42, materials.coral, { segments: 14 });
    head.position.y = 2.05;
    const visor = block(0.47, 0.16, 0.16, materials.dark, { radius: 0.07 });
    visor.position.set(0, 2.08, -0.37);

    this.#leftArm = this.#limb(-0.58, 1.55, materials.coral, 0.72, 0.15);
    this.#rightArm = this.#limb(0.58, 1.55, materials.coral, 0.72, 0.15);
    this.#leftLeg = this.#limb(-0.23, 0.78, materials.dark, 0.78, 0.17);
    this.#rightLeg = this.#limb(0.23, 0.78, materials.dark, 0.78, 0.17);

    this.#body.add(
      torso,
      chest,
      head,
      visor,
      this.#leftArm,
      this.#rightArm,
      this.#leftLeg,
      this.#rightLeg,
    );
    this.mesh.add(this.#body);
  }

  #limb(x: number, y: number, material: Material, length: number, radius: number): Object3D {
    const pivot = new Object3D();
    pivot.position.set(x, y, 0);
    const limb = tube(radius, radius * 0.9, length, material, { segments: 10 });
    limb.position.y = -length / 2;
    pivot.add(limb);
    return pivot;
  }

  #animate(): void {
    if (this.#crashed) return;
    const swing = Math.sin(this.#stride) * (this.#jumping ? 0.28 : 0.72);
    this.#leftArm.rotation.x = swing;
    this.#rightArm.rotation.x = -swing;
    this.#leftLeg.rotation.x = -swing * 0.72;
    this.#rightLeg.rotation.x = swing * 0.72;

    if (this.#sliding) {
      this.#body.scale.set(1.08, 0.54, 1.18);
      this.#body.position.y = 0.08;
      this.#body.rotation.x = -0.2;
    } else {
      this.#body.scale.set(1, 1, 1);
      this.#body.position.y = this.#jumping ? 0 : Math.abs(Math.sin(this.#stride * 2)) * 0.045;
      this.#body.rotation.x = 0;
    }
    this.#body.rotation.z = ((LANES[this.#lane] ?? 0) - this.mesh.position.x) * -0.09;
  }
}
