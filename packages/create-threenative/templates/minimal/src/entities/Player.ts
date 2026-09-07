import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Group, Mesh } from "three";
import { type IMinimalConventions, preparePlayerConventions } from "../conventions.js";
import { accentMaterial, defaultMaterial } from "../render/materials.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 5;
const MOVE_SPEED = 2;
const SPAWN = { x: -2, y: 0.5, z: 0 } as const;

export class Player {
  readonly mesh: Group;
  readonly visual: Mesh;
  readonly body: CharacterBody3D;
  #conventions: IMinimalConventions;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;

  constructor(ctx: GameCtx) {
    this.mesh = new Group();
    // A figure, not a cube. Three boxes is still minimal, and it gives the player a front — which
    // is the whole difference between "a character" and "the scene's placeholder".
    this.visual = new Mesh(new BoxGeometry(0.46, 0.56, 0.34), defaultMaterial);
    this.visual.castShadow = true;
    const head = new Mesh(new BoxGeometry(0.34, 0.3, 0.3), defaultMaterial);
    head.position.y = 0.42;
    head.castShadow = true;
    this.visual.add(head);
    const visor = new Mesh(new BoxGeometry(0.26, 0.08, 0.04), accentMaterial);
    visor.position.set(0, 0.44, -0.16);
    this.visual.add(visor);
    for (const side of [-1, 1]) {
      const leg = new Mesh(new BoxGeometry(0.15, 0.34, 0.2), accentMaterial);
      leg.position.set(side * 0.12, -0.44, 0);
      leg.castShadow = true;
      this.visual.add(leg);
    }
    this.mesh.add(this.visual);
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    this.#conventions = preparePlayerConventions(this.visual);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
  }

  update(ctx: GameCtx, dt: number, touch?: ITouchInput): void {
    this.#coyoteTime = Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (this.body.grounded) this.#coyoteTime = COYOTE_TIME;
    if (ctx.input.justPressed("jump") || touch?.jumpPressed === true)
      this.#jumpBuffer = JUMP_BUFFER;
    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#coyoteTime = 0;
      this.#jumps += 1;
      this.#coyoteJumps += 1;
    }
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);
    this.#conventions.applyGrounding(0, dt);
  }

  debug(): Record<string, unknown> {
    return {
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      groundClearance: this.#conventions.groundSnap.clearance,
      groundCorrectionEnabled: this.#conventions.groundSnap.enabled,
      jumps: this.#jumps,
      normaliseFactor: this.#conventions.normaliseFactor,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
