import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  AdditiveBlending,
  Box3,
  ConeGeometry,
  type Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Quaternion,
  Vector3,
} from "three";
import { scale } from "../render/scale.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export const MAGAZINE = 30;
export const RESERVE = 120;
const RELOAD_SECONDS = 1.1;
/** 600 rounds a minute. The trigger is held, not tapped; this cooldown is what makes a cadence. */
const CYCLIC_SECONDS = 0.1;

/**
 * Rest poses in camera space. Hip is offset to the right hand; aim brings the optic to centre.
 *
 * `z` is the number to touch first if the weapon reads wrong. At 72 degrees of vertical field of
 * view the frame is only 0.41 m tall a quarter of a metre out, so a life-size carbine parked there
 * covers half the screen as one dark slab. Held where a shouldered weapon actually sits — the
 * receiver a bit over half a metre from the eye — the same model reads as a weapon.
 */
const HIP = { x: 0.2, y: -0.21, z: -0.72, pitch: -0.02, yaw: 0.09, roll: 0.03 };
const AIM_Z = -0.56;
/** Where the shot is zeroed. Closer than this the barrel and the crosshair disagree slightly. */
const ZERO_DISTANCE = 22;
/** The barrel is allowed to lean this far to meet the crosshair before the pose gives up. */
const MAX_CONVERGENCE_DEGREES = 7;
const UP = new Vector3(0, 1, 0);

/**
 * The weapon in the player's hands: how it sits, how it kicks, and how many rounds are left.
 *
 * The mechanism the framework owns is elsewhere — particles, pooling, animation. What lives here
 * is the *feel*: where the weapon rests at the hip and down the sights, how far a shot throws it,
 * how fast it comes back, and how long a magazine change takes. Change any of those numbers and
 * the gun changes character; nothing in `packages/` has an opinion about them.
 */
export class Viewmodel {
  ammo = MAGAZINE;
  reserve = RESERVE;
  shots = 0;
  reloads = 0;
  reloading = false;
  readonly group: Group;
  #flash: Mesh;
  #flashLife = 0;
  #light: PointLight;
  #muzzleLocal = new Vector3();
  #barrelAxisLocal = new Vector3(0, 0, -1);
  #opticLocal = new Vector3();
  #kick = 0;
  #cooldown = 0;
  #blend = 0;
  #sway = 0;
  #lowered = 0;
  #aimOrigin = new Vector3();
  #aimDirection = new Vector3(0, 0, -1);
  #hasAimRay = false;

  constructor(viewmodel: Group) {
    this.group = viewmodel;
    const rifle = viewmodel.getObjectByName("held-rifle");
    if (rifle === undefined) throw new Error("Shooter viewmodel is missing its held rifle.");
    // Measure the weapon after `normaliseToMetres` has sized it, so the muzzle is where the
    // geometry actually ends rather than where it was authored.
    viewmodel.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(rifle);
    const inverse = viewmodel.matrixWorld.clone().invert();
    const local = new Box3();
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          local.expandByPoint(new Vector3(x, y, z).applyMatrix4(inverse));
    const centre = local.getCenter(new Vector3());
    this.#muzzleLocal.set(centre.x, centre.y, local.min.z);
    const optic = rifle.getObjectByName("optic");
    this.#opticLocal.copy(
      optic === undefined
        ? new Vector3(centre.x, local.max.y - 0.02, centre.z)
        : viewmodel.worldToLocal(optic.getWorldPosition(new Vector3())),
    );

    // A short forward cone at the muzzle, not a camera-facing card: a card that big briefly
    // covers most of the frame and reads as a rendering fault rather than a flash.
    this.#flash = new Mesh(
      new ConeGeometry(scale.muzzleFlash * 0.18, scale.muzzleFlash, 6, 1, true),
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: 0xffd9a0,
        depthWrite: false,
        opacity: 0,
        transparent: true,
      }),
    );
    this.#flash.position.copy(this.#muzzleLocal);
    this.#flash.quaternion.setFromUnitVectors(UP, this.#barrelAxisLocal);
    // Kept in the render list at zero opacity so WebGPU compiles this material during loading
    // instead of stalling for a frame on the first trigger pull.
    this.#flash.visible = true;
    this.#flash.frustumCulled = false;
    viewmodel.add(this.#flash);

    // The flash has to light the hands, not just draw over them. The light stays in the scene for
    // the whole run with its intensity driven to zero: toggling `visible` changes the lighting
    // setup, which makes the renderer rebuild every material pipeline that uses it.
    this.#light = new PointLight(0xffc46a, 0, 4, 2);
    this.#light.position.copy(this.#muzzleLocal);
    viewmodel.add(this.#light);
    this.#apply(0);
  }

  /**
   * What a scenario points a visibility assertion at.
   *
   * `entityObject` in the playtest bridge reads `mesh`, then `object`. In first person the
   * weapon is the player's on-screen body, so this is the object a "can the player see
   * themselves" row should measure — the capsule is invisible by design.
   */
  get object(): Group {
    return this.group;
  }

  get ready(): boolean {
    return !this.reloading && this.ammo > 0 && this.#cooldown <= 0;
  }

  /** Peak opacity of the muzzle cone. A playtest reads this to prove the flash retires. */
  get flashOpacity(): number {
    return (this.#flash.material as MeshBasicMaterial).opacity;
  }

  /** World-space muzzle point, for the particle burst and the tracer. */
  muzzlePoint(): Vector3 {
    this.group.updateWorldMatrix(true, false);
    return this.group.localToWorld(this.#muzzleLocal.clone());
  }

  /**
   * One round, if the action is cycled.
   *
   * The scene calls this every frame the trigger is held; the cyclic cooldown decides which of
   * those frames sends a round, so hold-to-fire and a single tap run the same path.
   */
  fire(): boolean {
    if (!this.ready) return false;
    this.#cooldown = CYCLIC_SECONDS;
    this.ammo -= 1;
    this.shots += 1;
    this.#kick = 1;
    this.#flashLife = 0.045;
    (this.#flash.material as MeshBasicMaterial).opacity = 1;
    this.#flash.rotateOnAxis(this.#barrelAxisLocal, this.shots * 1.7);
    this.#flash.scale.setScalar(0.8 + ((this.shots * 37) % 10) / 25);
    this.#light.intensity = 3.2;
    return true;
  }

  reload(ctx: GameCtx): void {
    if (this.reloading || this.reserve <= 0 || this.ammo >= MAGAZINE) return;
    this.reloading = true;
    ctx.after(RELOAD_SECONDS, () => {
      const moved = Math.min(MAGAZINE - this.ammo, this.reserve);
      this.ammo += moved;
      this.reserve -= moved;
      this.reloads += 1;
      this.reloading = false;
    });
  }

  /** Point the barrel at whatever the crosshair is on, within `MAX_CONVERGENCE_DEGREES`. */
  converge(origin: Vector3, direction: Vector3): void {
    this.#aimOrigin.copy(origin);
    this.#aimDirection.copy(direction).normalize();
    this.#hasAimRay = true;
  }

  /**
   * Retire the visible effects of a shot.
   *
   * Separate from `update` because it must run on frames the game is not being played — an end
   * card, a pause. A round fired on the frame the round ended used to leave the cone and its light
   * burning on screen for as long as the card was up.
   */
  decay(dt: number): void {
    this.#cooldown = Math.max(0, this.#cooldown - dt);
    this.#flashLife = Math.max(0, this.#flashLife - dt);
    (this.#flash.material as MeshBasicMaterial).opacity = Math.min(1, this.#flashLife / 0.025);
    this.#light.intensity = Math.max(0, this.#light.intensity - dt * 80);
    this.#kick = Math.max(0, this.#kick - dt * 7);
  }

  update(dt: number, aiming: boolean, moving: number): void {
    this.decay(dt);
    // The sights drop while the magazine is out and come back up after.
    this.#lowered += ((this.reloading ? 1 : 0) - this.#lowered) * Math.min(1, dt * 9);
    this.#blend += ((aiming && !this.reloading ? 1 : 0) - this.#blend) * Math.min(1, dt * 12);
    this.#sway += dt * (2.6 + moving * 4.4);
    this.#apply(moving);
  }

  #apply(moving: number): void {
    const t = this.#blend;
    const hipMotion = 1 - t;
    const bob = Math.sin(this.#sway) * 0.008 * (0.35 + moving) * hipMotion;
    const bobY = Math.abs(Math.cos(this.#sway)) * 0.01 * (0.25 + moving) * hipMotion;
    const kick = this.#kick * this.#kick;
    this.group.position.set(
      HIP.x + (-this.#opticLocal.x - HIP.x) * t + bob,
      HIP.y + (-this.#opticLocal.y - HIP.y) * t + bobY - this.#lowered * 0.26,
      HIP.z + (AIM_Z - HIP.z) * t + kick * 0.04,
    );
    this.group.rotation.set(
      HIP.pitch - kick * 0.05 + this.#lowered * 0.5,
      HIP.yaw * (1 - t),
      HIP.roll * (1 - t) + this.#lowered * 0.18,
    );
    if (!this.#hasAimRay) return;

    // Lean the whole weapon so its barrel meets the crosshair's ray at the zero distance. Without
    // this the muzzle flash appears beside a target the round passes through, which reads as the
    // shot missing.
    const target = this.#aimOrigin.clone().addScaledVector(this.#aimDirection, ZERO_DISTANCE);
    this.group.updateWorldMatrix(true, false);
    const muzzle = this.group.localToWorld(this.#muzzleLocal.clone());
    const desired = target.sub(muzzle).normalize();
    const parent = this.group.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    const desiredParent = desired.applyQuaternion(parent.clone().invert());
    const currentParent = this.#barrelAxisLocal.clone().applyQuaternion(this.group.quaternion);
    const correction = new Quaternion().setFromUnitVectors(currentParent, desiredParent);
    const maxAngle = MathUtils.degToRad(MAX_CONVERGENCE_DEGREES);
    const angle = 2 * Math.acos(MathUtils.clamp(correction.w, -1, 1));
    if (angle > maxAngle) correction.slerp(new Quaternion(), maxAngle / angle);
    this.group.quaternion.premultiply(correction);
  }

  debug(): Record<string, unknown> {
    return {
      ammo: this.ammo,
      // Zero once the shot has retired. A non-zero reading long after the last round is the
      // stuck-flash bug, and it is the only way a gate can see it.
      flashOpacity: this.flashOpacity,
      reloading: this.reloading ? 1 : 0,
      reloads: this.reloads,
      reserve: this.reserve,
      shots: this.shots,
    };
  }
}
