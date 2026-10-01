import type { ICtx } from "@threenative/core";
import {
  Area3D,
  CollisionShape3D,
  type IPhysicsContext,
  type PhysicsBody3D,
} from "@threenative/physics";
import type { Object3D } from "three";
import { SEAL } from "../render/vault.js";
import type { GameState } from "../state.js";

/**
 * The way out, and the only thing in the game that can end the run.
 *
 * It is an `Area3D` and nothing else: the run ends when the physics backend reports that a body
 * has *overlapped* this volume — the warden's capsule, or a crate the warden shoved into it. No
 * distance check, no timer, no "close enough". If the solver never reports contact the run never
 * ends, which is the point: a proximity test would pass on a warden standing on the far side of a
 * crate it could not actually move.
 */
export class Seal {
  readonly area: Area3D;
  /** The lit floor plate, so a scenario can ask whether the destination is on screen. */
  readonly mesh: Object3D;
  #contacts = 0;

  constructor(ctx: ICtx<GameState, IPhysicsContext>, mesh: Object3D) {
    this.mesh = mesh;
    this.area = new Area3D({
      entity: "seal",
      physics: ctx.physics,
      // Lifted clear of the floor slab: an area whose underside sits on y = 0 overlaps the fixed
      // floor body from the first step, and the run reports itself won before anything moves.
      position: { x: SEAL.x, y: 0.78, z: SEAL.z },
      // Tall enough that a crate resting on the plate counts, shallow enough that a crate sailing
      // over the kerb without stopping does not linger in it.
      shape: CollisionShape3D.box(SEAL.half * 2, 1.2, SEAL.half * 2),
    });
  }

  /**
   * Register the two things that can trip it. Returns an unsubscribe for the scene's `exit`.
   *
   * The area hands back the physics node itself, so "was that the warden" is an identity check
   * against the node the scene already holds — not an id lookup, and not a name.
   */
  watch(handlers: {
    readonly isCrate: (body: PhysicsBody3D) => boolean;
    readonly warden: PhysicsBody3D;
    readonly onContact: (by: "crate" | "warden") => void;
  }): () => void {
    return this.area.on("bodyEntered", (body) => {
      const by = body === handlers.warden ? "warden" : handlers.isCrate(body) ? "crate" : undefined;
      // Walls and the floor slab overlap this volume too. Only the two things the brief allows to
      // end the run are counted, and anything else is not even recorded as a contact.
      if (by === undefined) return;
      this.#contacts += 1;
      handlers.onContact(by);
    });
  }

  get contacts(): number {
    return this.#contacts;
  }

  dispose(): void {
    this.area.dispose();
  }
}
