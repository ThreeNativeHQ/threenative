import type { ICtx } from "@threenative/core";
import type { WaveField } from "@threenative/core";
import {
  Buoyancy3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { Group } from "three";
import { prepareShipConventions } from "../conventions.js";
import { createMaterials } from "../render/materials.js";
import { createShipModel } from "../render/props.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MAX_SPEED = 3.8;
const STEERING_SPEED = 2.5;
/** The hull's draught at the template's 4.6 m convention, in world metres. */
const DESIGN_DRAUGHT = 0.62;

export class Ship {
  /** The physics body's transform. Heave comes from here; attitude does not. */
  readonly mesh = new Group();
  /** What the player sees: the body's position, with an attitude taken from the swell. */
  readonly visual = new Group();
  readonly body: RigidBody3D;
  readonly buoyancy: Buoyancy3D;
  #capsized = false;
  #normaliseFactor: number;
  #heading = 0;
  #elapsed = 0;
  #immersion = 0.5;
  readonly #field: WaveField;

  constructor(ctx: GameCtx, field: WaveField) {
    this.#field = field;
    this.mesh.position.set(0, 0.24, 7);
    this.visual.position.set(0, 0.24, 7);
    this.mesh.castShadow = true;
    const model = createShipModel(createMaterials());
    this.#normaliseFactor = prepareShipConventions(model);
    // The hull hangs off `visual`, not off the physics body.
    //
    // `Buoyancy3D` applies its displaced-volume force at each hull point, so a point that is
    // deeper than its neighbour torques the body — which is right. What no game can reach is the
    // other half of that: Rapier's angular damping is not on `IRigidBody3DOptions`, and the drag
    // term inside `Buoyancy3D` is computed from the body's *linear* velocity, so it is identical
    // at every point and damps no rotation at all. The torque therefore accumulates with nothing
    // opposing it, and within a few seconds of spawning the ship is tumbling. It always was: the
    // template's own first frame showed the old model lying on its side, and that read as "the
    // boat is a plank" rather than as a boat rolled ninety degrees.
    //
    // So the body keeps the heave — that is what buoyancy is for and it is worth having — and the
    // attitude is read off the swell instead. `WaveField.sample` already returns the surface
    // normal, so the ship pitches into the face of a wave and rolls with the beam of it, which is
    // both stable and closer to what a boat does than a free-spinning rigid body ever was.
    this.visual.add(model);
    ctx.add(this.mesh);
    ctx.add(this.visual);

    this.body = new RigidBody3D({
      collisionLayer: 1,
      collisionMask: 0,
      mass: 420,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1.4, 0.7, 2.4),
    });
    this.buoyancy = new Buoyancy3D({
      body: this.body,
      density: 1_000,
      drag: 12,
      field,
      gravity: 9.81,
      // All four points sit **below** the body's centre, at the hull's bottom corners. Two of them
      // used to sit at +0.32 — above it — which puts buoyancy over the centre of mass at the stern
      // and gives the ship a standing moment it can only resolve by rolling onto its side. It did:
      // the template's own first frame showed the hull lying flat on the water with the sail
      // floating beside it, and that was read as "the boat is a plank" rather than as a capsize.
      hullPoints: [
        { position: [-0.45, -0.3, -0.75], volume: 0.275 },
        { position: [0.45, -0.3, -0.75], volume: 0.275 },
        { position: [-0.45, -0.3, 0.75], volume: 0.275 },
        { position: [0.45, -0.3, 0.75], volume: 0.275 },
      ],
      pointSpacing: 0.64,
      volume: 1.1,
    });
  }

  update(ctx: GameCtx, deltaTime: number, wind: number, touch?: ITouchInput): void {
    this.#elapsed += deltaTime;
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    const speed = MAX_SPEED * Math.max(0, Math.min(1, wind));
    const targetX = move.x * STEERING_SPEED * Math.max(0.4, wind);
    const targetZ = -move.y * speed;
    const blend = Math.min(1, Math.max(0, deltaTime) * 8);
    const velocity = this.body.linearVelocity;
    this.body.linearVelocity = {
      x: velocity.x + (targetX - velocity.x) * blend,
      y: velocity.y,
      z: velocity.z + (targetZ - velocity.z) * blend,
    };
    this.#heading += move.x * deltaTime * 0.35;
    this.#rideTheSwell(deltaTime);
  }

  /**
   * Read the swell under the ship and set the visual's attitude from it.
   *
   * Two samples a boat-length apart give the pitch; the surface normal gives the roll. Both are
   * eased rather than snapped, so the ship lags the water the way a hull with mass does.
   */
  #rideTheSwell(deltaTime: number): void {
    if (this.#capsized) return;
    const { x, z } = this.mesh.position;
    const ahead = this.#field.sample(x, z - 0.9, this.#elapsed);
    const astern = this.#field.sample(x, z + 0.9, this.#elapsed);
    const here = this.#field.sample(x, z, this.#elapsed);
    const pitch = Math.atan2(astern.height - ahead.height, 1.8);
    // How deep the bow is in the water it is meeting. This is the number the HUD's waterline
    // shows: `Buoyancy3D.submergedFraction` measures its hull points through the body's own
    // quaternion, and with the body free to tumble that reading swings between 0 and 1 with
    // nothing to do with what the player can see.
    this.#immersion = Math.min(
      1,
      Math.max(0, 0.5 + (ahead.height - this.visual.position.y) / DESIGN_DRAUGHT),
    );
    const roll = Math.atan2(here.normal.x, here.normal.y);
    const blend = Math.min(1, Math.max(0, deltaTime) * 3.2);
    this.visual.position.x = this.mesh.position.x;
    this.visual.position.z = this.mesh.position.z;
    // The design waterline sits on the water. Copying the body's y instead put the hull wherever
    // the buoyancy solver happened to have pushed it that frame — which, with no angular damping
    // to settle it, was rarely the same place twice and often most of a hull below the surface.
    this.visual.position.y += (here.height - this.visual.position.y) * blend;
    this.visual.rotation.y = this.#heading;
    this.visual.rotation.x += (pitch - this.visual.rotation.x) * blend;
    this.visual.rotation.z += (-roll - this.visual.rotation.z) * blend;
  }

  capsize(): void {
    if (this.#capsized) return;
    this.#capsized = true;
    this.visual.rotation.z = Math.PI / 2;
  }

  get capsized(): boolean {
    return this.#capsized;
  }

  /** Fraction of the hull the sea is over, from the swell the ship is actually sitting in. */
  get immersion(): number {
    return this.#capsized ? 1 : this.#immersion;
  }

  debug(): Record<string, unknown> {
    const velocity = this.body.linearVelocity;
    return {
      capsized: this.#capsized,
      linearVelocity: [velocity.x, velocity.y, velocity.z],
      normaliseFactor: this.#normaliseFactor,
      position: this.mesh.position.toArray(),
      immersion: this.#immersion,
      submergedFraction: this.buoyancy.submergedFraction,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
    this.visual.removeFromParent();
  }
}
