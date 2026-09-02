import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, type Material, Mesh, Vector3 } from "three";
import { type IStarterConventions, preparePlayerConventions } from "../conventions.js";
import { roundedBox } from "../render/shapes.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

// Tune these two timers for jump feel; they forgive a late or early button press.
// 0.12s is 7.2 ticks at the 1/60 step, and `playtests/coyote.playtest.json` is written against
// that: 3 ticks walking off the ledge, 5 more airborne, then the jump — the jump lands about 5
// ticks after the player actually leaves the ground, inside the window. Change this and those two
// step lengths move with it. Tightening the airborne hold does NOT make the scenario safer: with
// 2 the player has not left the ledge yet, and the jump is counted as an ordinary one
// (`jumps: 1, coyoteJumps: 0`), which is what it measured when I tried.
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 5;
const MOVE_SPEED = 2;
const PLAYER_FOOT_OFFSET = 0.51;
const VISUAL_ATTACHMENT_TOLERANCE = 0.1;
const SPAWN = { x: -2, y: 0.5, z: 0 } as const;

export class Player {
  readonly mesh: Group;
  readonly visual: Mesh;
  readonly body: CharacterBody3D;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #odometer = 0;
  #supportSurfaceY = 0;
  #previousPosition = new Vector3();
  #bodyWorldPosition = new Vector3();
  #visualWorldPosition = new Vector3();
  #visualBodyOffsetY: number | undefined;
  #hasPreviousPosition = false;
  #conventions: IStarterConventions;

  constructor(
    ctx: GameCtx,
    material: Material,
    spawn: { readonly x: number; readonly y: number; readonly z: number } = SPAWN,
  ) {
    this.mesh = new Group();
    this.visual = new Mesh(roundedBox(0.6, 1, 0.6), material);
    this.visual.castShadow = true;
    this.mesh.add(this.visual);
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    this.#conventions = preparePlayerConventions(this.visual);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
  }

  update(
    ctx: GameCtx,
    dt: number,
    supportSurfaceY?: (position: Pick<Vector3, "x" | "y" | "z">) => number | undefined,
    touch?: ITouchInput,
  ): void {
    if (this.#hasPreviousPosition) {
      this.#odometer += this.mesh.position.distanceTo(this.#previousPosition);
    }
    const grounded = this.body.grounded;
    this.#coyoteTime = Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (grounded) this.#coyoteTime = COYOTE_TIME;
    if (ctx.input.justPressed("jump") || touch?.jumpPressed === true)
      this.#jumpBuffer = JUMP_BUFFER;
    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#coyoteTime = 0;
      this.#jumps += 1;
      if (!grounded) this.#coyoteJumps += 1;
    }
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.#previousPosition.copy(this.mesh.position);
    this.body.moveAndSlide(dt);
    this.#hasPreviousPosition = true;
    if (this.body.grounded) this.#coyoteTime = COYOTE_TIME;
    const supportingSurfaceY = supportSurfaceY?.(this.mesh.position);
    const canCorrectGrounding =
      this.body.grounded && this.body.velocity.y <= 0 && supportingSurfaceY !== undefined;
    // The resolver identifies the supporting collider; derive the contact plane from the
    // grounded character so a changed platform height never pulls the visual from its body.
    if (canCorrectGrounding) this.#supportSurfaceY = this.mesh.position.y - PLAYER_FOOT_OFFSET;
    this.#conventions.groundSnap.enabled = canCorrectGrounding;
    this.#conventions.applyGrounding(this.#supportSurfaceY, dt);
    this.#captureVisualBodyOffset();
  }

  respawn(): void {
    this.body.teleport(SPAWN);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
    this.#hasPreviousPosition = false;
  }

  debug(): {
    coyoteJumps: number;
    grounded: boolean;
    groundClearance: number | null;
    groundCorrectionEnabled: boolean;
    groundSurfaceY: number;
    jumps: number;
    normaliseFactor: number;
    odometer: number;
    position: number[];
    visualAttached: boolean;
    visualAttachmentDrift: number;
  } {
    const visualAttachmentDrift = this.#visualAttachmentDrift();
    return {
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      groundClearance: this.#conventions.groundSnap.clearance,
      groundCorrectionEnabled: this.#conventions.groundSnap.enabled,
      groundSurfaceY: this.#supportSurfaceY,
      jumps: this.#jumps,
      normaliseFactor: this.#conventions.normaliseFactor,
      odometer: this.#odometer,
      position: this.mesh.position.toArray(),
      visualAttached: visualAttachmentDrift <= VISUAL_ATTACHMENT_TOLERANCE,
      visualAttachmentDrift,
    };
  }

  get coyoteJumps(): number {
    return this.#coyoteJumps;
  }

  get grounded(): boolean {
    return this.body.grounded;
  }

  get jumps(): number {
    return this.#jumps;
  }

  get odometer(): number {
    return this.#odometer;
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }

  #captureVisualBodyOffset(): void {
    if (this.#visualBodyOffsetY !== undefined || !this.body.grounded || this.body.velocity.y > 0)
      return;
    this.mesh.getWorldPosition(this.#bodyWorldPosition);
    this.visual.getWorldPosition(this.#visualWorldPosition);
    this.#visualBodyOffsetY = this.#visualWorldPosition.y - this.#bodyWorldPosition.y;
  }

  #visualAttachmentDrift(): number {
    if (this.#visualBodyOffsetY === undefined) return 0;
    this.mesh.getWorldPosition(this.#bodyWorldPosition);
    this.visual.getWorldPosition(this.#visualWorldPosition);
    return Math.abs(
      this.#visualWorldPosition.y - this.#bodyWorldPosition.y - this.#visualBodyOffsetY,
    );
  }
}
