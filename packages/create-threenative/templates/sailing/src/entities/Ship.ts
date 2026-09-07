import type { ICtx } from "@threenative/core";
import type { SpectralOcean } from "@threenative/core";
import {
  Buoyancy3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { Group, MathUtils } from "three";
import { prepareShipConventions } from "../conventions.js";
import { createMaterials } from "../render/materials.js";
import { createShipModel } from "../render/props.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * `SpectralOcean` as the water surface `Buoyancy3D` measures against.
 *
 * The two contracts differ by exactly this adapter: buoyancy asks for a height at a point and a
 * time, and the ocean answers with a height and the age in frames of the GPU copy it came from.
 * Before the first readback lands there is no answer at all, and mean sea level is the right one
 * to give — `Buoyancy3D` rejects a non-finite height by name, so returning nothing is not an
 * option and returning `NaN` would take the whole scene down on frame one.
 */
function oceanSurface(ocean: SpectralOcean): { sample(x: number, z: number): { height: number } } {
  return {
    sample: (x, z) => ({ height: ocean.sampleHeight(x, z)?.height ?? 0 }),
  };
}

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
  #seaHeight = 0;
  #staleFrames = -1;
  readonly #ocean: SpectralOcean;

  constructor(ctx: GameCtx, ocean: SpectralOcean) {
    this.#ocean = ocean;
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
    // attitude is read off the swell instead: three height samples around the hull give the pitch
    // and the roll, so the ship pitches into the face of a wave and rolls with the beam of it,
    // which is both stable and closer to what a boat does than a free-spinning rigid body ever was.
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
      field: oceanSurface(ocean),
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
   * Two samples a boat-length apart give the pitch, two across the beam give the roll. Both are
   * eased rather than snapped, so the ship lags the water the way a hull with mass does.
   */
  #rideTheSwell(deltaTime: number): void {
    if (this.#capsized) return;
    const { x, z } = this.mesh.position;
    // `SpectralOcean` has no closed form, so its CPU height is a throttled copy of what the GPU
    // produced and can be `undefined` until the first readback lands. Falling back to the mean
    // sea level for those frames is the whole handling this needs — a boat sitting flat at y = 0
    // for the first fraction of a second is invisible, and throwing is not.
    const heightAt = (sampleX: number, sampleZ: number): number =>
      this.#ocean.sampleHeight(sampleX, sampleZ)?.height ?? 0;
    // Sampled across the hull's real length and beam, not a token metre. The height copy is a
    // bilinear read of a grid about three metres across, so two probes closer together than that
    // largely describe the same cell and the ship barely responds to the swell it is in.
    const aheadHeight = heightAt(x, z - 1.7);
    const asternHeight = heightAt(x, z + 1.7);
    const portHeight = heightAt(x - 0.95, z);
    const starboardHeight = heightAt(x + 0.95, z);
    const hereHeight = heightAt(x, z);
    const probe = this.#ocean.sampleHeight(x, z);
    this.#seaHeight = hereHeight;
    this.#staleFrames = probe === undefined ? -1 : probe.staleFrames;
    // The ship's bow is at **-Z**, so a positive `rotation.x` lifts it — which means the pitch is
    // driven by how much higher the water *ahead* is, not the water astern. Written the other way
    // round the bow rose over troughs and drove into the face of every wave, and the ship
    // photographed as though it were going under bow-first.
    //
    // Clamped, because the height field is a copy of a GPU buffer read on a grid coarser than the
    // hull: two probes can disagree by more than the sea actually does, and without a limit one
    // bad pair throws the ship onto its beam ends for a frame.
    const pitch = MathUtils.clamp(Math.atan2(aheadHeight - asternHeight, 3.4), -0.3, 0.3);
    // How deep the bow is in the water it is meeting. This is the number the HUD's waterline
    // shows: `Buoyancy3D.submergedFraction` measures its hull points through the body's own
    // quaternion, and with the body free to tumble that reading swings between 0 and 1 with
    // nothing to do with what the player can see.
    this.#immersion = Math.min(
      1,
      Math.max(0, 0.5 + (aheadHeight - this.visual.position.y) / DESIGN_DRAUGHT),
    );
    const roll = MathUtils.clamp(Math.atan2(starboardHeight - portHeight, 1.9), -0.26, 0.26);
    const blend = Math.min(1, Math.max(0, deltaTime) * 3.2);
    this.visual.position.x = this.mesh.position.x;
    this.visual.position.z = this.mesh.position.z;
    // The design waterline sits on the sampled water. The copy can be many frames old while the
    // GPU FFT is busy, so easing this axis would invent a second lag and let the hull drift beyond
    // its own sampled surface between readbacks. Copying the body's y instead put the hull wherever
    // the buoyancy solver happened to have pushed it that frame — which, with no angular damping
    // to settle it, was rarely the same place twice and often most of a hull below the surface.
    this.visual.position.y = hereHeight;
    this.visual.rotation.y = this.#heading;
    this.visual.rotation.x += (pitch - this.visual.rotation.x) * blend;
    this.visual.rotation.z += (roll - this.visual.rotation.z) * blend;
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
      // The three numbers a scenario needs to prove the ship is *floating* rather than merely
      // existing: the sea under it, how far the drawn hull sits off that surface, and whether the
      // height copy is arriving at all. A screenshot cannot tell a still ocean from a moving one.
      seaHeight: this.#seaHeight,
      floatGap: this.visual.position.y - this.#seaHeight,
      readbackStaleFrames: this.#staleFrames,
      oceanSteps: this.#ocean.steps,
      submergedFraction: this.buoyancy.submergedFraction,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
    this.visual.removeFromParent();
  }
}
