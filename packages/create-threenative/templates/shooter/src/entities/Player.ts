import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, MathUtils, type PerspectiveCamera, Vector3 } from "three";
import { type IShooterConventions, preparePlayerConventions } from "../conventions.js";
import { scale } from "../render/scale.js";
import { createLegsVisual, createViewmodelVisual } from "../render/shapes.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

export const WORLD_LAYER = 1;
export const PLAYER_LAYER = 2;
export const HOSTILE_LAYER = 4;
export const FRIENDLY_LAYER = 8;
export const PROJECTILE_LAYER = 16;

type GameCtx = ICtx<GameState, IPhysicsContext>;

const BODY_Y = scale.humanHeight / 2;
const SPAWN = new Vector3(0, BODY_Y, 5);
const WALK_SPEED = 4.2;
const SPRINT_SPEED = 6.6;
/** Crouched movement. A crouch that only lowers the eye is a camera trick, not a stance. */
const CROUCH_SPEED = 2.2;
/** How fast the stance folds and unfolds. Fast enough to peek with, slow enough to see. */
const CROUCH_RATE = 11;
const FOV_HIP = 72;
const FOV_AIM = 34;
const PITCH_MIN = MathUtils.degToRad(-72);
const PITCH_MAX = MathUtils.degToRad(72);
/** Relative pointer pixels to radians. The delta is already per-frame, so nothing scales by dt. */
const LOOK_RADIANS_PER_PIXEL = 0.005;
/** Down the sights the same hand movement should cover less angle. */
const AIM_SENSITIVITY = 0.5;
const CAPSULE_RADIUS = scale.shoulderWidth / 2;
const CAPSULE_HALF = (scale.humanHeight - CAPSULE_RADIUS * 2) / 2;
/** Metres of stride between planted feet, walking. Sprint covers it sooner, so it sounds faster. */
const STRIDE_METRES = 0.82;

/**
 * Yaw and pitch, integrated from the `look` action.
 *
 * `look` is bound `pointerRelative`, so `ctx.input.vector("look")` is the pointer delta for this
 * tick in canvas pixels. The framework owns the pointer lock and the native equivalent, so nothing
 * in this game reads `movementX` or touches the DOM.
 */
class Look {
  yaw = 0;
  pitch = 0;

  /** Applied by both paths: mouse deltas and the right thumb, which has no lock to earn. */
  applyDelta(dx: number, dy: number, sensitivity: number): void {
    if (dx === 0 && dy === 0) return;
    this.yaw -= dx * LOOK_RADIANS_PER_PIXEL * sensitivity;
    this.pitch = MathUtils.clamp(
      this.pitch - dy * LOOK_RADIANS_PER_PIXEL * sensitivity,
      PITCH_MIN,
      PITCH_MAX,
    );
  }
}

/**
 * The player, seen from behind their own eyes.
 *
 * The body is a capsule the physics solver owns; the camera is placed from it once the solver has
 * written the step (see `syncCamera` and the `afterPhysics` call in `scenes/Play.ts`). The
 * viewmodel hangs off the camera, so the weapon is always in frame no matter how the body is
 * being shoved around.
 */
export class Player {
  readonly mesh: Group;
  /** The weapon and hands, parented to the camera. */
  readonly visual: Group;
  /** The part of the player their own eyes can see, parented to the body. */
  readonly legs: Group;
  readonly body: CharacterBody3D;
  readonly look = new Look();
  readonly maxHealth = 100;
  health = 100;
  dead = false;
  aiming = false;
  crouching = false;
  sprinting = false;
  /** Metres walked. The scene does not read it; a scenario can, through `debug()`. */
  distanceMoved = 0;
  /** Fired each time a stride completes, so footsteps keep pace with speed rather than time. */
  onFootstep: ((sprinting: boolean) => void) | undefined;
  #onDamage: (amount: number) => void;
  #onDeath: () => void;
  #conventions: IShooterConventions;
  #camera: PerspectiveCamera;
  /** 0 standing, 1 fully folded. Eased, so the eye slides rather than teleports. */
  #crouch = 0;
  #fov = FOV_HIP;
  #lastX = SPAWN.x;
  #lastZ = SPAWN.z;
  #strideAccumulated = 0;
  #moving = 0;

  constructor(
    ctx: GameCtx,
    camera: PerspectiveCamera,
    materials: Parameters<typeof createViewmodelVisual>[0],
    spawn: Vector3 = SPAWN,
    onDamage: (amount: number) => void = () => undefined,
    onDeath: () => void = () => undefined,
  ) {
    this.#camera = camera;
    this.#onDamage = onDamage;
    this.#onDeath = onDeath;
    this.mesh = new Group();
    this.mesh.name = "player";
    this.mesh.position.copy(spawn);
    ctx.add(this.mesh);
    // Two visuals, in two spaces. The viewmodel hangs off the camera so the weapon is always in
    // frame; the legs hang off the body so looking down shows a person standing on the floor
    // rather than a floating gun.
    this.visual = createViewmodelVisual(materials);
    camera.add(this.visual);
    this.legs = createLegsVisual(materials);
    this.mesh.add(this.legs);
    this.#conventions = preparePlayerConventions(this.visual, this.legs);
    this.body = new CharacterBody3D({
      collisionLayer: PLAYER_LAYER,
      collisionMask: WORLD_LAYER | HOSTILE_LAYER,
      autostep: { maxHeight: 0.35, minWidth: 0.18 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(CAPSULE_RADIUS, CAPSULE_HALF),
    });
    camera.fov = FOV_HIP;
    camera.near = 0.02;
    camera.far = 120;
    camera.updateProjectionMatrix();
    this.syncCamera();
  }

  /** Where the eye is right now, crouch included. */
  get eyeHeight(): number {
    return scale.eyeHeight - BODY_Y - this.#crouch * scale.crouchDrop;
  }

  /**
   * Heading, in degrees turned to the right of the spawn facing.
   *
   * Reported rather than `look.yaw` itself because the two have opposite signs: Three turns left
   * for a positive rotation about +y, and a player who moved the mouse right expects a positive
   * number back. The HUD and the scenarios read this one.
   */
  get yawDegrees(): number {
    return -MathUtils.radToDeg(this.look.yaw);
  }

  /** Elevation, in degrees above the horizon. Positive is up, matching the same expectation. */
  get pitchDegrees(): number {
    return MathUtils.radToDeg(this.look.pitch);
  }

  /** How hard the player is moving, 0 to 1. The viewmodel reads this for its bob. */
  get moving(): number {
    return this.#moving;
  }

  /**
   * The camera basis is the single source of aim truth.
   *
   * Every shot starts here rather than from a muzzle offset, because the crosshair is drawn at the
   * centre of this basis: a round that starts anywhere else lands somewhere the player did not aim.
   * The viewmodel's barrel is then converged onto this ray, not the other way round.
   */
  aimRay(): { origin: Vector3; direction: Vector3 } {
    this.#camera.updateMatrixWorld(true);
    return {
      origin: this.#camera.getWorldPosition(new Vector3()),
      direction: this.#camera.getWorldDirection(new Vector3()).normalize(),
    };
  }

  /**
   * Place the camera at the eye.
   *
   * Called from `afterPhysics`, never from `update`: `moveAndSlide` only queues the motion, and the
   * rapier plugin writes the solved transform after the frame callback returns. Reading
   * `mesh.position` inside `update` places the eye one physics step behind the body — invisible on
   * flat ground and a third of a metre low on a step, which is how a shot aimed at a target ends
   * up in the floor underfoot.
   */
  syncCamera(): void {
    this.#camera.position.set(
      this.mesh.position.x,
      this.mesh.position.y + this.eyeHeight,
      this.mesh.position.z,
    );
    this.#camera.rotation.set(this.look.pitch, this.look.yaw, 0, "YXZ");
  }

  update(ctx: GameCtx, dt: number, touch?: ITouchInput): void {
    if (this.dead) return;
    this.aiming = ctx.input.pressed("aim") || touch?.aimPressed === true;
    this.crouching = ctx.input.pressed("crouch") || touch?.crouchPressed === true;
    this.#crouch = MathUtils.damp(this.#crouch, this.crouching ? 1 : 0, CROUCH_RATE, dt);

    const sensitivity = this.aiming ? AIM_SENSITIVITY : 1;
    const look = ctx.input.vector("look");
    this.look.applyDelta(look.x, look.y, sensitivity);
    if (touch !== undefined) this.look.applyDelta(touch.aim.x * 12, touch.aim.y * 12, sensitivity);

    const keyboard = ctx.input.vector("move");
    const moveX = MathUtils.clamp(keyboard.x + (touch?.move.x ?? 0), -1, 1);
    const moveY = MathUtils.clamp(keyboard.y + (touch?.move.y ?? 0), -1, 1);
    // Sprint arrives as its own flag rather than as a longer move vector, so the two vetoes below
    // apply to a thumb and to Shift alike. Crouch wins: holding both should not sprint at a
    // crouch-walk's silhouette.
    const sprintAsked = ctx.input.pressed("sprint") || touch?.sprintPressed === true;
    this.sprinting = sprintAsked && !this.aiming && !this.crouching;
    const speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    // `vector().y` is +up on the stick; forward on this ground plane is -z at yaw 0.
    const forwardX = -Math.sin(this.look.yaw);
    const forwardZ = -Math.cos(this.look.yaw);
    const rightX = Math.cos(this.look.yaw);
    const rightZ = -Math.sin(this.look.yaw);
    let vx = forwardX * moveY + rightX * moveX;
    let vz = forwardZ * moveY + rightZ * moveX;
    const length = Math.hypot(vx, vz);
    if (length > 1e-4) {
      vx = (vx / length) * speed;
      vz = (vz / length) * speed;
    } else {
      vx = 0;
      vz = 0;
    }
    this.#moving = length > 1e-4 ? speed / SPRINT_SPEED : 0;

    // The backend writes the solved transform after the step, so measuring the mesh either side of
    // `moveAndSlide` in one frame always reads zero. Compare against the previous frame instead.
    const stride = Math.hypot(
      this.mesh.position.x - this.#lastX,
      this.mesh.position.z - this.#lastZ,
    );
    this.distanceMoved += stride;
    this.#strideAccumulated += stride;
    if (length > 1e-4 && this.#strideAccumulated >= STRIDE_METRES) {
      this.#strideAccumulated = 0;
      this.onFootstep?.(this.sprinting);
    }
    this.#lastX = this.mesh.position.x;
    this.#lastZ = this.mesh.position.z;

    this.body.velocity.x = vx;
    this.body.velocity.z = vz;
    this.body.moveAndSlide(dt);
    this.#conventions.applyGrounding(0, dt);

    const wanted = this.aiming ? FOV_AIM : FOV_HIP;
    this.#fov = MathUtils.damp(this.#fov, wanted, 14, dt);
    if (Math.abs(this.#camera.fov - this.#fov) > 0.01) {
      this.#camera.fov = this.#fov;
      this.#camera.updateProjectionMatrix();
    }
  }

  takeDamage(amount: number): void {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.#onDamage(amount);
    if (this.health > 0) return;
    this.dead = true;
    this.visual.visible = false;
    this.legs.visible = false;
    this.body.velocity.set(0, 0, 0);
    this.#onDeath();
  }

  respawn(spawn: Vector3): void {
    this.body.teleport(spawn);
    this.health = 40;
    this.dead = false;
    this.visual.visible = true;
    this.legs.visible = true;
    this.syncCamera();
  }

  debug(): Record<string, unknown> {
    return {
      aiming: this.aiming ? 1 : 0,
      crouching: this.crouching ? 1 : 0,
      dead: this.dead,
      distanceMoved: this.distanceMoved,
      fov: this.#camera.fov,
      groundClearance: this.#conventions.groundSnap.clearance,
      health: this.health,
      normaliseFactor: this.#conventions.normaliseFactor,
      pitchDegrees: this.pitchDegrees,
      position: this.mesh.position.toArray(),
      skeletonBones: this.#conventions.boneNames,
      weaponBone: this.#conventions.attachedBone,
      yawDegrees: this.yawDegrees,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.visual.removeFromParent();
    this.legs.removeFromParent();
    this.mesh.removeFromParent();
  }
}

export { SPAWN };
