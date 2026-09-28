import {
  AnimationPlayer,
  attachToBone,
  type ICtx,
  measureThreePose,
  normaliseToMetres,
} from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { TownCollider } from "../render/town.js";
import { scale } from "../render/scale.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** One solid box in the world: nav, grounding and hit tests all read these. */
export type BoxCollider = TownCollider;

export type EnemyPhase = "patrol" | "suspicious" | "engage" | "search" | "return" | "dead";

const MAX_HEALTH = 36;
const WALK_SPEED = 2.4;
/**
 * Chase pace, capped at what this rig can be animated doing.
 *
 * It was 3.6 m/s. The only locomotion clip in the asset is a walk that covers 1.307 m/s at rate 1,
 * so a 3.6 m/s chase drove `setEffectiveTimeScale` to 2.75 and clipped against a ceiling of 3 —
 * a walk cycle on fast-forward, which is exactly the "moving faster than he is animated" read.
 * Measured over a 45 s run: `maxRate` 3.00 on both engaging soldiers, i.e. saturated.
 *
 * 2.75 m/s is rate 2.10 against the same clip: a brisk jog, which a walk cycle can pass for, and
 * `#applyCarriage` now leans him into it. The honest fix is a run cycle retargeted onto this
 * skeleton — the asset is "CC-BY-4.0 carrying retargeted Mixamo clips" and a run is one more of
 * those — and until there is one, the pace is bounded by the animation rather than the reverse.
 */
const CHASE_SPEED = 2.75;
const HEAR_RANGE = 26;
const VIEW_RANGE = 30;
const VIEW_HALF_ANGLE = MathUtils.degToRad(46);
const ENGAGE_RANGE = 13;
const BURST_ROUNDS = 3;
const BURST_SPACING = 0.11;
const BURST_COOLDOWN = 3.2;
const ROUND_DAMAGE = 9;
const RESPAWN_SECONDS = 4.5;
const AGENT_RADIUS = 0.48;
const NAV_CELL = 0.7;
const NAV_MIN = -16;
const NAV_MAX = 16;
const NAV_REPLAN_SECONDS = 0.4;
/** Seconds between first sighting and the first round, so the player is not shot on sight. */
const REACTION_SECONDS = 0.45;
const SPAWN_GRACE_SECONDS = 2.5;
/**
 * Animation blending, tuned by eye rather than by what typechecks.
 *
 * `LOCOMOTION_FADE` at 0.05 s is three frames, which pops; a quarter second reads as weight
 * shifting between feet. `LOCOMOTION_HOLD` stops the rig re-deciding every frame when crouch
 * state sits on a threshold, and `STILL_BEFORE_IDLE` stops one blocked step reading as a stop.
 */
const LOCOMOTION_FADE = 0.26;
const LOCOMOTION_HOLD_SECONDS = 0.3;
const STILL_BEFORE_IDLE_SECONDS = 0.16;
/**
 * Locomotion playback rate, in clip-seconds per world-second.
 *
 * The walk clip carries the body 1.7 m per 1.30 s cycle; patrol speed is 2.4 m/s and a chase
 * is 3.6 m/s, so at rate 1 the feet travel at half or a third of the ground speed and skate.
 * The rate is therefore derived from the measured stride (`#measureClipGroundSpeed`) and the
 * speed the body is actually making. The clamp is the honest limit of a nine-clip rig with no
 * run cycle: above it a sprint would read as a cartoon, below it a crawl would freeze.
 *
 * The floor is 0.15 and not 0.35 because the body now accelerates. The measured walk clip
 * covers 1.307 m/s at rate 1, so 0.35 cannot represent any ground speed under 0.46 m/s — and
 * every start and every stop passes through that band. Clamped there, the feet run visibly
 * faster than the ground and `strideErrorPeak` goes to 0.5 against a gate that allows 0.15.
 * 0.15 represents everything from 0.196 m/s up, which is below `LOCOMOTION_RATE_FLOOR`, so
 * the clamp is no longer reachable by anything the stride metric scores.
 */
const LOCOMOTION_RATE_MIN = 0.15;
const LOCOMOTION_RATE_MAX = 2.1;
/** Ground speed below which the rate is meaningless and the stride metric is not scored. */
const LOCOMOTION_RATE_FLOOR = 0.3;
/** Frames used to sample one clip cycle when measuring its stride. */
const STRIDE_SAMPLES = 96;
/**
 * How a body gets up to walking pace and back down again, in metres per second squared.
 *
 * Travel used to be `speed * dt` with no ramp at all. Traced over 359 frames of patrol, the
 * soldier was either standing at exactly 0 or travelling at exactly 2.400 m/s, and the change
 * between the two happened inside one frame. That single step is most of what reads as a
 * machine: nothing with legs reaches full pace instantly, and nothing with legs stops dead.
 * 6.5 m/s² is about 0.37 s to walking pace, which is roughly two steps.
 */
const WALK_ACCEL = 6.5;
const WALK_DECEL = 9;
/**
 * Steering and facing, in radians per second and radians per second squared.
 *
 * The old turn was `MathUtils.clamp(delta, -dt * 7, dt * 7)`: a bang-bang servo that sat at
 * exactly zero angular velocity, saturated at the cap for two or three frames at a waypoint,
 * and stopped dead. The same 359-frame trace held the heading bit-exactly constant on 343
 * frames and ran at 5–10 rad/s on the other 16. Carrying angular velocity and accelerating it
 * toward what the error asks for gives a turn that starts, peaks and settles.
 *
 * Travel direction is steered as well as facing, so a corner is a curve through the waypoint
 * rather than a vertex — the A* grid is 0.7 m, and turning hard at every grid point is what
 * made the route read as faceted. `#segmentClear` already keeps the corridor wide enough for
 * the body, and cornering sheds speed, so the curve stays inside what the search cleared.
 *
 * Steering is deliberately quicker than facing. `enemy-reaches-walkway` is the constraint: the
 * soldier has about eight seconds to cover twenty-five metres, and the first tuning — steering
 * at 3.1 rad/s with cornering cutting to a third of pace — cost roughly a metre and a half per
 * ninety-degree corner and he arrived too late, twice, against a baseline that passed twice.
 * At 4.6 rad/s a right-angle takes about a third of a second, which is what a walking person
 * takes, and the visible easing is all still there: peak turn rate stays under half of the old
 * clamp's, and the turn still spins up and settles instead of switching on and off.
 */
const STEER_RATE_MAX = 4.6;
const STEER_ACCEL = 26;
const STEER_SETTLE = 0.11;
const FACE_RATE_MAX = 4.4;
const FACE_ACCEL = 26;
const FACE_SETTLE = 0.12;
/**
 * Pace below which a coast is over, in metres per second.
 *
 * Two centimetres a second is under a millimetre a frame: past this the body is standing, and
 * carrying the remainder only keeps the walk clip alive on a soldier who has stopped.
 */
const COAST_FLOOR = 0.02;
/** Heading error, in radians, at which cornering has taken all the speed off it can. */
const CORNER_FULL = 2.2;
/** Slowest a corner may be taken, as a fraction of the requested speed. */
const CORNER_FLOOR = 0.55;
/** Metres from the end of the route over which he eases off instead of stopping on the mark. */
const ARRIVE_DISTANCE = 1.6;
const ARRIVE_FLOOR = 0.3;
/**
 * How far a soldier's facing may deviate from where his feet are going, in radians.
 *
 * `#engage` aimed the body at the player and then `#step` immediately overwrote that with the
 * travel heading, so a flanking soldier turned his back and jogged. Facing the player outright
 * is not the answer either: this rig has no strafe cycle, so a body moving sideways under a
 * forward walk clip moonwalks. 0.75 rad is as far as the feet can be wrong before that shows.
 */
const AIM_LEAD_MAX = 0.75;
/**
 * Upper-body carriage, layered on top of the clip after the mixer has written the pose.
 *
 * A rifle carry clip holds the torso rigid, so a soldier who turns is a statue rotating about
 * its own axis. These are the three cues that read as a person: the chest banks into a turn,
 * the shoulders lag it, and the head leads it. All three are driven by angular velocity and
 * acceleration, so a soldier standing still gets exactly zero of them and every frozen-sentry
 * scenario keeps the pose it had.
 */
const CARRIAGE_BANK = 0.055;
const CARRIAGE_BANK_MAX = 0.1;
const CARRIAGE_LAG = 0.05;
const CARRIAGE_LAG_MAX = 0.085;
const CARRIAGE_LEAD = 0.075;
const CARRIAGE_LEAD_MAX = 0.14;
const CARRIAGE_PITCH = 0.014;
const CARRIAGE_PITCH_MAX = 0.055;
/**
 * Forward lean at full chase pace, in radians, on top of the acceleration pitch above.
 *
 * The acceleration pitch is a transient: it exists while he is speeding up and decays to nothing
 * once he is at pace, which is correct for what it models and leaves a soldier travelling flat out
 * standing as upright as one strolling. A run is a *sustained* posture, and the lean is most of
 * what separates the two silhouettes at a glance. Driven by `#pace` rather than by acceleration so
 * it holds for as long as the chase does — and it is zero at walking pace, so a patrol, a frozen
 * sentry and a corpse are all untouched.
 */
const RUN_LEAN = 0.17;
/** Seconds the carriage takes to catch up with a change, so it never pops. */
const CARRIAGE_SETTLE = 7;
/**
 * Seconds between precise corpse ground measurements. The precise pass is the per-vertex
 * `Box3` the skin envelope exists to avoid, so a corpse pays it at 20 Hz rather than 60 —
 * invisible on a body that is settling, and a fifth of the cost.
 */
const CORPSE_GROUND_INTERVAL = 0.05;
/** Reactions and deaths are sharp events, but three frames is still a pop. */
const REACTION_FADE = 0.12;
const DEATH_FADE = 0.14;
const FIRE_FADE = 0.1;
const ROUTE: readonly Vector3[] = [
  new Vector3(-4.5, 0, -9.5),
  new Vector3(-11.5, 0, -13.0),
  new Vector3(-1.0, 0, -15.0),
  new Vector3(4.5, 0, -11.0),
  new Vector3(11.6, 0, -8.6),
  new Vector3(1.5, 0, -6.5),
  new Vector3(-6.0, 0, -4.5),
];
const ROUTE_START = ROUTE[0] ?? new Vector3();

/**
 * Uniform world scale of an object, read straight off its world matrix.
 *
 * `Object3D.getWorldScale` decomposes the whole matrix and allocates a `Vector3`; the length of
 * the first basis column is the same number for the uniform scales this rig uses, and this runs
 * per soldier per frame.
 */
/**
 * Where a soldier's frame goes, accumulated across the squad.
 *
 * A section timer inside the per-soldier update, because "enemies cost 13 ms" is not something
 * anyone can act on. Peaks are per frame and reset by `beginSquadFrame`, so what comes out is
 * the worst single frame each stage has ever cost across all five soldiers together.
 */
/**
 * Seconds between line-of-sight raycasts for one soldier.
 *
 * The cheap half of `#canSee` — range and view cone — still runs every frame, so a soldier turning
 * away or stepping out of range loses sight instantly. Only the raycast is rationed, because it is
 * a `raycastAll` against every solid in the town and five soldiers doing that at 60 Hz measured at
 * 15.9 ms of a 16.3 ms frame: the entire mid-round hitch, in one call.
 *
 * A tenth of a second of staleness on "can he see me" is invisible next to `REACTION_SECONDS`,
 * which already holds fire for far longer than this after a soldier first spots the player.
 */
const LOS_INTERVAL_SECONDS = 0;
/**
 * Shortest gap between two grid searches for one soldier when only the goal has drifted.
 *
 * `NAV_REPLAN_SECONDS` (0.4) is the gap for a route that has become obstructed. Reusing it for
 * goal drift is too coarse to navigate with: `enemy-reaches-walkway` caught a soldier failing to
 * work his way under the deck because he could not re-plan often enough to follow the target
 * around it. A tenth of a second still turns a per-frame search into one every six frames, which
 * is where nearly all of the saving was.
 *
 * Settled at 0.15 s, about nine frames. The scenario's flakiness turned out to be a stale sight
 * answer rather than a stale route — see `#canSee` — so this can be rationed properly: a route
 * re-aimed six times a second still tracks a running player, and the search stops being a
 * per-frame cost.
 */
const GOAL_REPLAN_SECONDS = 0.15;
/** Spreads the squad's raycasts across frames, so five soldiers never all test on the same one. */
let losStagger = 0;


/** Blocked-cell bitmaps per collider set, so the squad pays for the nav grid once. */
const NAV_GRIDS = new WeakMap<object, Map<string, Uint8Array>>();

const squadFrame = { canSee: 0, ground: 0, weapon: 0, animation: 0, brain: 0, opacity: 0 };
const squadPeak = { canSee: 0, ground: 0, weapon: 0, animation: 0, brain: 0, opacity: 0 };
type SquadStage = keyof typeof squadFrame;
const nowMs = (): number => globalThis.performance?.now() ?? 0;

/** Forget the peaks so far. Startup builds raycast trees and compiles pipelines exactly once. */
export function resetSquadProfile(): void {
  for (const key of Object.keys(squadPeak) as SquadStage[]) squadPeak[key] = 0;
}

/** Call once per frame before the squad updates: the per-frame accumulators start again. */
export function beginSquadFrame(): void {
  for (const key of Object.keys(squadFrame) as SquadStage[]) {
    if (squadFrame[key] > squadPeak[key]) squadPeak[key] = squadFrame[key];
    squadFrame[key] = 0;
  }
}

/** Worst single frame each stage has cost across the whole squad, in milliseconds. */
export function squadProfile(): Record<SquadStage, number> {
  const out = {} as Record<SquadStage, number>;
  for (const key of Object.keys(squadPeak) as SquadStage[]) {
    out[key] = Math.round(squadPeak[key] * 100) / 100;
  }
  return out;
}

function chargeStage<T>(stage: SquadStage, run: () => T): T {
  const started = nowMs();
  const value = run();
  squadFrame[stage] += nowMs() - started;
  return value;
}

// Scratch for the per-frame sight test; five soldiers × three vectors × 60 Hz is real garbage.
const scratchGoal = new Vector3();
const scratchTo = new Vector3();
const scratchFacing = new Vector3();
const scratchFlat = new Vector3();
// Scratch for the upper-body carriage: five soldiers × six rotations × 60 Hz is real garbage.
const scratchEuler = new Euler();
const scratchDelta = new Quaternion();
const scratchBody = new Quaternion();
const scratchInverse = new Quaternion();
const scratchParent = new Quaternion();
const scratchLocal = new Quaternion();

function worldScaleOf(object: Object3D): number {
  const e = object.matrixWorld.elements;
  return Math.hypot(e[0] as number, e[1] as number, e[2] as number);
}

/** Shortest signed rotation from one yaw to another, in radians. */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * A yaw that carries its own angular velocity, so a turn eases in as well as out.
 *
 * Clamping the per-frame step — what `#turn` did — gives a body that is either not turning at
 * all or turning at exactly its maximum. There is no third state, and both edges are a step
 * change in angular velocity. Accelerating the rate toward `delta / settle` instead means the
 * turn spins up over a few frames, tops out at `maxRate`, and eases onto the target. Never
 * stepping past the remaining delta keeps it from ringing on a small correction.
 */
class EasedYaw {
  value: number;
  #rate = 0;
  readonly #maxRate: number;
  readonly #accel: number;
  readonly #settle: number;

  constructor(maxRate: number, accel: number, settle: number, value = 0) {
    this.#maxRate = maxRate;
    this.#accel = accel;
    this.#settle = settle;
    this.value = value;
  }

  /** Jump to a yaw with no turn at all: a respawn, or a body placed by a scenario. */
  set(value: number): void {
    this.value = value;
    this.#rate = 0;
  }

  /** `scale` trims the ceiling for a slower turn — looking around rather than reorienting. */
  step(target: number, dt: number, scale = 1): number {
    const delta = angleDelta(this.value, target);
    const ceiling = this.#maxRate * scale;
    const wanted = MathUtils.clamp(delta / this.#settle, -ceiling, ceiling);
    this.#rate += MathUtils.clamp(wanted - this.#rate, -this.#accel * dt, this.#accel * dt);
    const magnitude = Math.abs(delta);
    this.value += MathUtils.clamp(this.#rate * dt, -magnitude, magnitude);
    return this.value;
  }

  /** Drive the yaw directly — a scanning sweep — while keeping `rate` honest for the carriage. */
  spin(radiansPerSecond: number, dt: number): number {
    this.#rate = radiansPerSecond;
    this.value += radiansPerSecond * dt;
    return this.value;
  }
}

type WeaponPose = {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
};

type WeaponKeyframe = { readonly time: number; readonly transform: WeaponPose };
type WeaponTrack = {
  readonly attachment: "attached" | "detached";
  readonly keyframes: readonly WeaponKeyframe[];
};
type WeaponRecipe = {
  readonly animations: Record<string, WeaponKeyframe | WeaponTrack>;
  readonly version: 2 | 3;
};
const weaponPose = (
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  attachment: "attached" | "detached" = "attached",
): WeaponTrack => ({
  attachment,
  keyframes: [{ time: 0, transform: { position, rotation, scale: [1, 1, 1] } }],
});
const ENEMY_AK47_RECIPE: WeaponRecipe = {
  version: 3,
  animations: {
    RifleIdle: weaponPose([188.2202, 439.6458, 144.7051], [-111.181, -29.47, -46.122]),
    RifleWalk: weaponPose([-11.9183, 294.5358, 104.4656], [-90, 0, -90]),
    RifleCrouchWalk: weaponPose([-23.3305, 274.7849, 53.6152], [-106.891, -21.763, -115.469]),
    RifleCrouchWalkToIdle: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-106.673, -21.153, -114.665],
    ),
    HitReaction: weaponPose([-23.3305, 274.7849, 53.6152], [-91.054, -11.075, -93.276]),
    DeathFront: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-91.054, -11.075, -93.276],
      "detached",
    ),
    DeathBack: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-91.054, -11.075, -93.276],
      "detached",
    ),
    DeathHeadshot: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-91.054, -11.075, -93.276],
      "detached",
    ),
    FiringRifle: weaponPose([-23.3305, 274.7849, 53.6152], [-95.123, -0.777, -94.787]),
  },
};

function weaponTrack(animation: string): WeaponTrack | undefined {
  const value = ENEMY_AK47_RECIPE.animations[animation];
  if (value === undefined) return undefined;
  if (ENEMY_AK47_RECIPE.version === 3 && "keyframes" in value) return value;
  if (!("transform" in value)) return undefined;
  return { attachment: "attached", keyframes: [value] };
}

function interpolateWeaponPose(track: WeaponTrack, time: number): WeaponPose | undefined {
  const frames = [...track.keyframes].sort((a, b) => a.time - b.time);
  const first = frames[0];
  if (first === undefined) return undefined;
  const last = frames.at(-1) ?? first;
  if (time <= first.time) return first.transform;
  if (time >= last.time) return last.transform;
  const right = frames.find((frame) => frame.time >= time) ?? last;
  const left = frames[Math.max(0, frames.indexOf(right) - 1)] ?? first;
  const alpha = (time - left.time) / Math.max(1e-6, right.time - left.time);
  const mix = (a: number, b: number): number => MathUtils.lerp(a, b, alpha);
  const angle = (a: number, b: number): number =>
    a + ((((b - a + 540) % 360) - 180) * alpha);
  return {
    position: left.transform.position.map((value, index) =>
      mix(value, right.transform.position[index] ?? value),
    ) as [number, number, number],
    rotation: left.transform.rotation.map((value, index) =>
      angle(value, right.transform.rotation[index] ?? value),
    ) as [number, number, number],
    scale: left.transform.scale.map((value, index) =>
      mix(value, right.transform.scale[index] ?? value),
    ) as [number, number, number],
  };
}

export type EnemyHooks = {
  /** True when nothing solid blocks the segment. */
  readonly lineOfSight: (from: Vector3, to: Vector3) => boolean;
  readonly damagePlayer: (amount: number) => void;
  readonly onMuzzleFlash: (at: Vector3, direction: Vector3, distance: number) => void;
  /**
   * A foot planted while actually moving — at most twice per walk cycle, read off
   * the locomotion action's phase so steps stay glued to the animation.
   */
  readonly onFootstep?: (at: Vector3) => void;
};

/** Raised-deck footprints this soldier may be routed beneath. */
export type DeckFootprint = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type EnemyOptions = {
  /** Patrol loop to walk and return to; defaults to the single range route. */
  readonly route?: readonly Vector3[];
  /** Ground rectangle the navigation grid covers; defaults to the old yard. */
  readonly navBounds?: { readonly min: number; readonly max: number };
  /** Raised deck footprints, reported by `underDeck` so a scenario can see routing under them. */
  readonly decks?: readonly DeckFootprint[];
  /**
   * Scenario-placed sentry: stands at route[0] and never walks it. Hearing and vision
   * are disconnected, so rounds landing near him cannot turn the rest of the shot into
   * pursuit; a killing round still plays the full death. Shooting scenarios need a
   * target whose hit window does not depend on where a patrol happens to be.
   */
  readonly frozen?: boolean;
};

/**
 * Metres the body travels per second of a locomotion clip played at rate 1.
 *
 * Cached on the clip itself: every soldier shares one `AnimationClip[]` from the loader, so
 * the sampling pass below runs once for the whole squad rather than once per man.
 */
const CLIP_GROUND_SPEED = new WeakMap<AnimationClip, number>();

/** First bone whose name matches, for models that do not use the Mixamo naming. */
function findBone(root: Object3D, pattern: RegExp): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((object) => {
    if (found === undefined && pattern.test(object.name)) found = object;
  });
  return found;
}

export class Enemy {
  readonly group = new Group();
  readonly hitbox: Mesh;
  health = MAX_HEALTH;
  phase: EnemyPhase = "patrol";
  wounded = false;
  /**
   * Combat voice, assigned by the scene and throttled there (one shout at a time
   * across the squad). Optional so tests and headless rigs run mute.
   */
  voice:
    | {
        readonly spot: (at: Vector3) => void;
        readonly chase: (at: Vector3) => void;
        readonly pain: (at: Vector3) => void;
        readonly death: (at: Vector3) => void;
      }
    | undefined;
  /**
   * Whether the body is snapped down so its lowest posed point rests on the deck.
   *
   * On is right for a soldier walking a range: the planted foot has to touch the floor and
   * the corpse has to lie on it. Turn it off for anything that is legitimately airborne —
   * a fall, a ragdoll driven by physics, a vault, a scripted drop — otherwise this pins the
   * body to the ground and eats the motion. `footClearance` keeps reporting the real height
   * either way, so a scenario can still see where the body actually is.
   */
  groundSnap = true;
  #animation: AnimationPlayer | undefined;
  #clips: ReadonlySet<string>;
  #clipDurations = new Map<string, number>();
  #weaponPoseElapsed = 0;
  #routeIndex = 0;
  #target = new Vector3();
  #lastSeen = new Vector3();
  #alertTimer = 0;
  #burstLeft = 0;
  #burstTimer = 0;
  #cooldown = 0;
  #strafe = 1;
  #strafeTimer = 0;
  #deadFor = 0;
  #deathSettleReady = false;
  /**
   * World Y the body stood at when it died. A corpse settles onto the deck it fell on; it
   * never climbs off it, so this is a hard ceiling on the grounding correction while dead.
   */
  #deathGroundCeiling: number | null = null;
  /** Precise corpse ground measurement, refreshed on a timer rather than every frame. */
  #corpseGroundTimer = 0;
  #fade = 1;
  #bodyClearance: number | null = null;
  #footClearance: number | null = null;
  #deathObserved = false;
  #deathAnkleDelta = 0;
  /**
   * Sticky record of the last death: which clip ran and how many frames it advanced. Sticky
   * because the corpse is gone 4.5 s later, so a scenario sampling after the respawn would
   * otherwise see a live soldier and be unable to tell a played death from a frozen one.
   */
  #deathClip: string | null = null;
  #deathClipFrames = 0;
  /** Travel direction of the round that last connected, for choosing which way the body falls. */
  #lastHitDirection: Vector3 | null = null;
  #hips: Object3D | undefined;
  /** Hip world position at the instant of death, so the fall direction can be measured. */
  #deathHipStart: Vector3 | null = null;
  /** Sticky fall measurement: the corpse is gone before a scenario can read a live value. */
  #deathFallMeasured: number | null = null;
  /** True while the last locomotion frame was a crouch, so standing up can play its transition. */
  #crouchMoving = false;
  /** Seconds left of the crouch-to-stand transition, during which no locomotion clip overrides it. */
  #standUp = 0;
  /** Seconds left of being under fire. Degrades aim and keeps the soldier low. */
  #suppressed = 0;
  #suppressedPeak = 0;
  /**
   * Frames each clip has actually advanced this session. The rig ships nine clips; without a
   * per-clip count nothing catches four of them quietly going unused again.
   */
  #clipFrames = new Map<string, number>();
  /** Locomotion clip currently committed to, and how long before another switch is allowed. */
  #locomotion = "";
  #locomotionHold = 0;
  /** Walk-cycle phase bookkeeping for the footstep hook: which half-cycle last planted a foot. */
  #lastStepClip = "";
  #lastStepHalf = -1;
  /** Clips by name, so a locomotion action can be re-timed through the mixer that owns it. */
  #clipsByName = new Map<string, AnimationClip>();
  /** Metres per second each clip covers at rate 1, measured off this rig's own feet. */
  #clipGroundSpeed = new Map<string, number>();
  /** Where the body stood at the top of this frame, so ground speed is measured, not assumed. */
  #frameStart = new Vector3();
  #groundSpeed = 0;
  /**
   * Ground pace he is actually carrying, in metres per second. Ramped toward whatever the
   * current behaviour asked for rather than adopted outright — see `WALK_ACCEL`.
   */
  #pace = 0;
  /** Change in `#pace` per second, for the forward lean. Smoothed; raw it is frame noise. */
  #paceRate = 0;
  /** True when a movement branch ran `#step` this frame; if none did, he coasts to a stop. */
  #stepped = false;
  /** Direction he is travelling, and which way the body is pointed. Both eased, both stateful. */
  #heading = new EasedYaw(STEER_RATE_MAX, STEER_ACCEL, STEER_SETTLE);
  #facing = new EasedYaw(FACE_RATE_MAX, FACE_ACCEL, FACE_SETTLE);
  /**
   * This soldier's own pace, as a multiplier. Five men walking at exactly 2.400 m/s in step
   * with each other is a tell no amount of animation work can cover. Seeded, so a replay of
   * the same run puts every soldier in the same place.
   */
  #gait = 1;
  /** Torso, shoulders and head, for the carriage layered over the clip. */
  #spine: Object3D | undefined;
  #chest: Object3D | undefined;
  #neck: Object3D | undefined;
  /** Smoothed carriage inputs, so a turn does not snap the torso on its first frame. */
  #carriageTurn = 0;
  #carriagePush = 0;
  /** Body yaw last frame, so the carriage measures the turn instead of trusting one turner. */
  #lastYaw = 0;
  /** Playback rate the locomotion clip is running at, and how well it matches the ground. */
  /**
   * Seconds the flinch still owns the pose.
   *
   * Without it `HitReaction` was set by `hurt` and overwritten by `#playLocomotion` on the very
   * next frame, because the locomotion branch re-asserts its clip every frame and `#play` only
   * declines when the clip it is asked for is already current. Measured over two 45 s runs and
   * 678 samples: `HitReaction` was never the current clip on a single one. A soldier who does not
   * flinch when hit is the loudest "this is a state machine" cue in the game, and it was one line.
   */
  #reactionHold = 0;
  #locomotionRate = 1;
  #locomotionRatePeak = 0;
  #strideErrorRatio = 1;
  #strideErrorPeak = 0;
  /** Seconds the body has been continuously still, so one blocked frame is not a stop. */
  #stillFor = 0;
  #lastHitMultiplier = 1;
  /**
   * Skin envelope: one bone per entry with the radius of the furthest skin vertex bound to
   * it, measured once in the bind pose. See `#calibrateSkinEnvelope`.
   */
  #envelopeBones: Object3D[] = [];
  #envelopeRadii: number[] = [];
  #envelopeBias = 0;
  /**
   * Largest sphere radius in the envelope. Published because a degenerate calibration is
   * invisible in every other number: it cancels itself in the bind pose and only shows up
   * once the body leaves it. No bone on a 1.78 m man owns skin half a metre away, so a
   * radius above that means the vertex walk measured the wrong thing.
   */
  #maxEnvelopeRadius = 0;
  #modelHeightMeasured: number = scale.humanHeight;
  #hitboxWidth: number = scale.shoulderWidth;
  #hitboxHeight: number = scale.humanHeight;
  #hitboxDepth: number = scale.bodyDepth;
  #crown: Object3D | undefined;
  #head: Object3D | undefined;
  #leftKnee: Object3D | undefined;
  #rightKnee: Object3D | undefined;
  #colliders: readonly BoxCollider[];
  #bodyMeshes: Object3D[] = [];
  #poseBones: Object3D[] = [];
  #bodyProxy: Object3D | undefined;
  #body: CharacterBody3D | undefined;
  #weapon: Object3D | undefined;
  #weaponModel: Object3D | undefined;
  /**
   * The rifle's longest axis in the holder's own units at unit scale, measured once.
   *
   * `#normaliseWeapon` used to re-measure it every frame through `normaliseToMetres`, whose
   * `axis: "longest"` path runs `new Box3().setFromObject(holder)`. The AK is a rigged asset, so
   * that is `applyBoneTransform` — four matrix multiplies — on every vertex of the weapon, once
   * per soldier per frame. It is the same precise-bounds cost `#calibrateSkinEnvelope` was
   * written to avoid on the body, and it was still being paid on the weapon: measured at 11.6 ms
   * at p99 across five soldiers, which is most of a frame's budget spent re-deriving a constant.
   */
  #weaponUnitLength = 0;
  #weaponDetached = false;
  #weaponSettled = false;
  #weaponVelocity = new Vector3();
  #rifleLocalMinZ = -scale.rifleLength * 0.35;
  #rifleLocalMaxZ = scale.rifleLength * 0.65;
  #rightHand: Object3D | undefined;
  #leftHand: Object3D | undefined;
  #grip: Object3D | undefined;
  #magazine: Object3D | undefined;
  #leftUpLeg: Object3D | undefined;
  #leftFoot: Object3D | undefined;
  #rightUpLeg: Object3D | undefined;
  #rightFoot: Object3D | undefined;
  #weaponNodes: string[] = [];
  #renderedRifleLength: number | null = null;
  /** Seconds left before it may fire after first seeing the player — it is not a turret. */
  #reaction = 0;
  /** Cached A* route. Dynamic combat goals are replanned without changing direction every frame. */
  #path: Vector3[] = [];
  #pathIndex = 0;
  #pathGoal = new Vector3();
  #replanIn = 0;
  /** Countdown for goal-drift replans, kept apart from the obstruction cooldown. */
  #goalReplanIn = 0;
  #searchAtGoal = 0;
  #patrolPause = 0;
  #previousGroundSpeed = 0;
  #decelPeak = 0;
  /** Set on the frames a hard stop is honest — walking into a wall, dying, being placed. */
  #decelExempt = false;
  #spawnGrace = SPAWN_GRACE_SECONDS;
  #route: readonly Vector3[] = ROUTE;
  #navMin = NAV_MIN;
  #navMax = NAV_MAX;
  #decks: readonly DeckFootprint[] = [];
  #frozen = false;

  constructor(
    ctx: GameCtx,
    model: Object3D,
    clips: readonly AnimationClip[],
    colliders: readonly BoxCollider[],
    weapon?: Object3D,
    options: EnemyOptions = {},
  ) {
    this.#colliders = colliders;
    this.#route = options.route ?? ROUTE;
    this.#navMin = options.navBounds?.min ?? NAV_MIN;
    this.#navMax = options.navBounds?.max ?? NAV_MAX;
    this.#decks = options.decks ?? [];
    this.#frozen = options.frozen ?? false;
    this.#pathGoal.copy(this.#route[0] ?? ROUTE_START);
    this.#target.copy(this.#route[0] ?? ROUTE_START);
    model.removeFromParent();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(1);
    model.updateWorldMatrix(false, true);
    this.#crown =
      findBone(model, /headtop|head_end|head.*end/i) ?? findBone(model, /head/i);
    this.#head = findBone(model, /mixamorigHead$|^head$/i) ?? findBone(model, /head/i);
    this.#leftKnee = findBone(model, /left.*leg|left.*knee/i);
    this.#rightKnee = findBone(model, /right.*leg|right.*knee/i);
    normaliseToMetres(model, { axis: "height", metres: scale.humanHeight, top: this.#crown });
    model.traverse((object) => {
      if (/hips|upleg|leg|foot|toe|head/i.test(object.name)) this.#poseBones.push(object);
      const mesh = object as Mesh;
      if (mesh.isMesh === true) {
        this.#bodyMeshes.push(mesh);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    this.#hips = findBone(model, /hips/i);
    // Mixamo names these Spine / Spine1 / Spine2 / Neck. The carriage banks the lower torso,
    // lags the upper one and leads with the head; missing any of them just drops that cue.
    this.#spine = findBone(model, /spine1$|spine1_/i) ?? findBone(model, /spine/i);
    this.#chest = findBone(model, /spine2/i);
    this.#neck = findBone(model, /neck/i);
    this.#leftUpLeg = findBone(model, /leftupleg/i);
    this.#leftFoot = findBone(model, /leftfoot/i);
    this.#rightUpLeg = findBone(model, /rightupleg/i);
    this.#rightFoot = findBone(model, /rightfoot/i);
    this.group.add(model);
    if (weapon !== undefined) this.#equip(model, weapon);
    // Before the first draw, not on the first death. `#respawn` also calls this, but `#respawn`
    // only ever runs off the death timer, so a soldier that has never died would otherwise reach
    // his own death still carrying the blend state the asset shipped with — which is both a
    // mid-fight pipeline compile and, once `#setOpacity` stopped flipping the flag, a fade that
    // does not render at all because opacity is ignored on an opaque material.
    this.#fixBlendState();
    this.group.name = "enemy";
    this.group.position.copy(this.#route[0] ?? ROUTE_START);
    const firstWaypoint = this.#route[1];
    if (firstWaypoint !== undefined) {
      this.#target.copy(firstWaypoint);
      this.#routeIndex = 1;
      this.group.rotation.y = Math.atan2(
        this.#target.x - this.group.position.x,
        this.#target.z - this.group.position.z,
      );
    }
    this.group.rotation.y = Math.atan2(
      this.#target.x - this.group.position.x,
      this.#target.z - this.group.position.z,
    );
    this.#heading.set(this.group.rotation.y);
    this.#facing.set(this.group.rotation.y);
    this.#lastYaw = this.group.rotation.y;
    // Seeded per soldier: 0.94–1.06 is enough to break the squad out of lockstep and still
    // leaves the walk clip re-timed between 1.73 and 1.95, well clear of both rate clamps.
    this.#gait = ctx.random.range(0.94, 1.06);

    // Skinned meshes are the slow path for picking, so the rifle traces a plain
    // box proxy that follows the body. Invisible, but still raycastable.
    this.#modelHeightMeasured = this.modelHeight || scale.humanHeight;
    this.#calibrateSkinEnvelope();
    // Width and depth are declared sizes, not measurements. A whole-body AABB is not a
    // hitbox: in the bind pose this rig measures 1.11 m across because the arms are out in a
    // T, and over a walk cycle it measures 1.13 m deep because the stride reaches fore and
    // aft. Both would make a man a barn door to shoot at. Height stays measured, because it
    // comes off the posed head-top bone rather than a box.
    this.#hitboxWidth = scale.shoulderWidth;
    this.#hitboxHeight = this.#modelHeightMeasured;
    this.#hitboxDepth = scale.bodyDepth;
    this.hitbox = new Mesh(
      new BoxGeometry(this.#hitboxWidth, this.#hitboxHeight, this.#hitboxDepth),
      new MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = this.#hitboxHeight / 2;
    this.hitbox.userData.enemy = this;
    this.group.add(this.hitbox);

    const bodyProxy = new Group();
    bodyProxy.name = "enemy-body";
    ctx.add(bodyProxy);
    this.#bodyProxy = bodyProxy;
    this.#body = new CharacterBody3D({
      physics: ctx.physics,
      object: bodyProxy,
      entity: "enemy-body",
      shape: CollisionShape3D.box(this.#hitboxWidth, this.#hitboxHeight, this.#hitboxDepth),
      gravity: 0,
      collisionLayer: 2,
      collisionMask: 1,
    });
    this.#syncCollisionBody();

    this.#clips = new Set(clips.map((clip) => clip.name));
    this.#clipDurations = new Map(clips.map((clip) => [clip.name, clip.duration]));
    this.#clipsByName = new Map(clips.map((clip) => [clip.name, clip]));
    // Measure the stride before the player exists: the sampling pass poses the rig, and the
    // envelope and hitbox above were both measured in the bind pose that it would disturb.
    for (const clip of clips) {
      this.#clipGroundSpeed.set(clip.name, this.#measureClipGroundSpeed(clip));
    }
    if (clips.length > 0) {
      this.#animation = new AnimationPlayer({ clips, root: this.group });
      this.#play("RifleWalk");
    }
  }

  get alive(): boolean {
    return this.phase !== "dead";
  }

  /** Chest height, used as the eye and muzzle origin. */
  get chest(): Vector3 {
    return new Vector3(
      this.group.position.x,
      this.group.position.y + this.bodyHeight * 0.8,
      this.group.position.z,
    );
  }

  /**
   * Rendered height, boots to head-top, measured off the skeleton.
   *
   * A `Box3` over a skinned mesh reports the *bind pose* transformed by the world matrix,
   * not the posed body — which is precisely how a 2.68 m soldier stood beside a 1.66 m
   * player without any gate noticing. The head-top bone is posed, so it tells the truth.
   */
  get modelHeight(): number {
    const crown =
      this.#crown ??
      findBone(this.group, /headtop|head_end|head.*end/i) ??
      findBone(this.group, /head/i);
    this.#crown = crown;
    if (crown === undefined) return 0;
    this.#syncWorldMatrices();
    return crown.getWorldPosition(new Vector3()).y - this.group.position.y;
  }

  get bodyBase(): number {
    return this.group.position.y;
  }

  get bodyHeight(): number {
    return this.modelHeight || this.#modelHeightMeasured;
  }

  get headZoneMinY(): number {
    const head = this.#head?.getWorldPosition(new Vector3());
    return (head?.y ?? this.bodyBase + this.bodyHeight) - scale.headRadius;
  }

  get legZoneMaxY(): number {
    const left = this.#leftKnee?.getWorldPosition(new Vector3()).y;
    const right = this.#rightKnee?.getWorldPosition(new Vector3()).y;
    const knees = [left, right].filter((value): value is number => value !== undefined);
    return knees.length > 0
      ? Math.max(...knees)
      : this.bodyBase + this.bodyHeight * scale.legZoneFraction;
  }

  /**
   * Put the rifle in the enemy's right hand.
   *
   * The animation clips are retargeted Mixamo rifle clips, so the arms are already posed around
   * a weapon that was not in the file — without this the soldier walks and fires holding air.
   * The bone is found by name because nothing in the asset pipeline reports a socket, and the
   * offsets are the grip pose measured against the model's own scale.
   */
  #equip(model: Object3D, weapon: Object3D): void {
    weapon.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh === true) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });

    // Assets are cached across scene restarts. Detach and restore authored transforms before
    // measuring, or the second run measures the first run's normalised attachment and scales it
    // again into a giant AK.
    weapon.removeFromParent();
    weapon.position.set(0, 0, 0);
    weapon.rotation.set(0, 0, 0);
    weapon.scale.setScalar(1);
    weapon.updateWorldMatrix(false, true);

    const bounds = new Box3().setFromObject(weapon);

    const hand =
      model.getObjectByName("mixamorigRightHand") ??
      model.getObjectByName("RightHand") ??
      findBone(model, /right.*hand|hand.*r$|hand_r/i);
    this.#rightHand = hand;
    this.#leftHand =
      model.getObjectByName("mixamorigLeftHand") ??
      model.getObjectByName("LeftHand") ??
      findBone(model, /left.*hand|hand.*l$|hand_l/i);

    // A holder carries the grip offset so the rifle's own transform stays the measured one.
    const holder = new Group();
    holder.add(weapon);

    // Line the rifle's own `Grip_Bone` up with the holder origin. Hanging it off the model
    // origin instead puts the fist around the barrel: this AK is authored with its origin
    // 22 cm behind the receiver, which `create-threenative inspect` reports along with the
    // bone. The asset declares where it is held, so read that rather than guessing an offset.
    const grip = weapon.getObjectByName("Grip_Bone");
    this.#grip = grip;
    this.#magazine = findBone(weapon, /magazine|mag[_ -]|clip[_ -]/i);
    this.#weaponModel = weapon;
    weapon.traverse((object) => {
      if (object.name !== "" && this.#weaponNodes.length < 40) {
        this.#weaponNodes.push(object.name);
      }
    });
    this.#rifleLocalMinZ = bounds.min.z;
    this.#rifleLocalMaxZ = bounds.max.z;

    if (hand === undefined) {
      holder.position.set(0.16, 1.24, 0.16);
      holder.rotation.set(0, Math.PI / 2, 0);
      this.group.add(holder);
      this.#weapon = holder;
      normaliseToMetres(holder, { axis: "longest", metres: scale.rifleLength });
      this.#alignWeaponGrip();
      this.#renderedRifleLength = this.#measureRenderedWeapon(weapon);
      return;
    }
    // The engine's attachment keeps the holder's authored world scale under the hand bone;
    // the measured re-normalisation below still has the final word on length.
    attachToBone(model, hand.name, holder);
    this.#weapon = holder;
    this.#applyWeaponPose("RifleWalk");
    normaliseToMetres(holder, { axis: "longest", metres: scale.rifleLength });
    this.#alignWeaponGrip();
    this.#renderedRifleLength = this.#measureRenderedWeapon(weapon);
  }

  #applyWeaponPose(animation: string): void {
    const holder = this.#weapon;
    const track = weaponTrack(animation);
    const duration = this.#clipDurations.get(animation) ?? 1;
    const normalized = MathUtils.clamp(this.#weaponPoseElapsed / Math.max(duration, 1e-6), 0, 1);
    const pose = track === undefined ? undefined : interpolateWeaponPose(track, normalized);
    if (holder === undefined || pose === undefined) return;
    holder.rotation.set(
      MathUtils.degToRad(pose.rotation[0]),
      MathUtils.degToRad(pose.rotation[1]),
      MathUtils.degToRad(pose.rotation[2]),
    );
    holder.scale.fromArray(pose.scale);
    holder.updateWorldMatrix(false, true);
  }

  #detachWeapon(ctx: GameCtx, animation: string): void {
    const holder = this.#weapon;
    if (holder === undefined || weaponTrack(animation)?.attachment !== "detached") return;
    ctx.scene.attach(holder);
    this.#weaponDetached = true;
    this.#weaponSettled = false;
    this.#weaponVelocity.set(0.45, 1.4, -0.25).applyAxisAngle(
      new Vector3(0, 1, 0),
      this.group.rotation.y,
    );
  }

  #updateDetachedWeapon(dt: number, deckY: number): void {
    const holder = this.#weapon;
    if (holder === undefined || !this.#weaponDetached || this.#weaponSettled) return;
    this.#weaponVelocity.y -= 9.81 * dt;
    holder.position.addScaledVector(this.#weaponVelocity, dt);
    holder.rotation.x += dt * 2.7;
    holder.rotation.z += dt * 1.9;
    holder.updateWorldMatrix(false, true);
    const minimum = new Box3().setFromObject(holder).min.y;
    if (minimum < deckY) {
      holder.position.y += deckY - minimum;
      this.#weaponVelocity.set(0, 0, 0);
      this.#weaponSettled = true;
    }
    holder.updateWorldMatrix(false, true);
  }

  #reattachWeapon(): void {
    const holder = this.#weapon;
    if (holder === undefined || this.#rightHand === undefined) return;
    this.#rightHand.add(holder);
    this.#weaponDetached = false;
    this.#weaponSettled = false;
    this.#weaponVelocity.set(0, 0, 0);
    this.#weaponPoseElapsed = 0;
    this.#applyWeaponPose("RifleWalk");
  }

  #measureRenderedWeapon(weapon: Object3D): number {
    weapon.updateWorldMatrix(true, true);
    const size = new Box3().setFromObject(weapon).getSize(new Vector3());
    return Math.max(size.x, size.y, size.z);
  }

  /** Re-anchor the measured grip after pose or parent-bone scale changes. */
  #alignWeaponGrip(): void {
    const holder = this.#weapon;
    const grip = this.#grip;
    const parent = holder?.parent;
    const hand = this.#rightHand;
    if (
      this.#weaponDetached ||
      holder === undefined ||
      grip === undefined ||
      parent === null ||
      parent === undefined ||
      hand === undefined
    ) {
      return;
    }
    holder.updateWorldMatrix(true, true);
    const gripWorld = grip.getWorldPosition(new Vector3());
    const desiredLocal = parent.worldToLocal(hand.getWorldPosition(new Vector3()));
    const gripLocal = holder.worldToLocal(gripWorld);
    const offset = gripLocal.multiply(holder.scale).applyQuaternion(holder.quaternion);
    holder.position.copy(desiredLocal.sub(offset));
    holder.updateWorldMatrix(false, true);
  }

  /**
   * Refresh this soldier's world matrices, including the skinned meshes' bind matrices.
   *
   * `Object3D.updateWorldMatrix` recurses through `updateWorldMatrix`, which is *not* the
   * method `SkinnedMesh` overrides. `SkinnedMesh.updateMatrixWorld` is, and in the default
   * `attached` bind mode that override is the only thing that keeps `bindMatrixInverse`
   * equal to `matrixWorld.invert()`.
   *
   * That matters here because `SkeletonUtils.clone` — how every soldier in this game is
   * made — ends by calling `bind(skeleton, bindMatrix)`, which sets
   * `bindMatrixInverse = bindMatrix⁻¹`. This asset's `bindMatrix` is the identity, so a
   * freshly cloned rig carries an identity `bindMatrixInverse` until something runs the
   * override. Until then `getVertexPosition` returns *world* coordinates rather than
   * geometry-local ones, and every caller that follows the documented contract and
   * multiplies by `matrixWorld` — three's own precise `Box3`, `computeBoundingBox`, and the
   * envelope calibration below — folds the body onto the model origin. The renderer runs
   * `scene.updateMatrixWorld` every frame, so this only ever bit measurements taken before
   * the first frame: the constructor's, which is where the envelope is calibrated.
   */
  #syncWorldMatrices(): void {
    this.group.updateWorldMatrix(true, false);
    this.group.updateMatrixWorld(true);
  }

  #measureBodyPose(): ReturnType<typeof measureThreePose> {
    this.#syncWorldMatrices();
    for (const object of this.#bodyMeshes) {
      const mesh = object as Mesh & { isSkinnedMesh?: boolean; skeleton?: { update(): void } };
      if (mesh.isSkinnedMesh === true) mesh.skeleton?.update();
    }
    return measureThreePose(this.group, { bounds: this.#bodyMeshes });
  }

  /**
   * Build the skin envelope: for every bone, the distance to the furthest skin vertex it
   * dominates, plus a bias that makes the envelope agree exactly with the true posed bounds
   * in the bind pose.
   *
   * This exists because `measureThreePose(..., { bounds })` is a *precise* `Box3` pass:
   * `Box3.expandByObject` calls `SkinnedMesh.applyBoneTransform` on every vertex, which is
   * four matrix multiplies each. Over this soldier that is the single most expensive thing
   * in the frame — a CPU profile put it at 4.2 s of every 5 s wall clock and held the game
   * at single-digit FPS. Grounding needs one number, the lowest posed point, so pay for the
   * vertex walk once here and approximate it per frame from bone transforms alone.
   *
   * A sphere per bone is conservative under rotation, which is what a falling corpse needs:
   * the estimate never suddenly loses the limb that is actually touching the deck.
   */
  #calibrateSkinEnvelope(): void {
    this.#syncWorldMatrices();
    const radii = new Map<Object3D, number>();
    const bonePositions = new Map<Object3D, Vector3>();
    const vertex = new Vector3();

    for (const object of this.#bodyMeshes) {
      const mesh = object as Mesh & {
        isSkinnedMesh?: boolean;
        skeleton?: { bones: Object3D[]; update(): void };
      };
      const position = mesh.geometry?.getAttribute("position");
      if (position === undefined) continue;

      if (mesh.isSkinnedMesh !== true || mesh.skeleton === undefined) {
        // A rigid prop welded to the body still has to be grounded. It never deforms, so a
        // single sphere around its own origin covers it for every pose the body reaches.
        mesh.geometry.computeBoundingSphere();
        const sphere = mesh.geometry.boundingSphere;
        if (sphere === null) continue;
        const centre = sphere.center.clone().applyMatrix4(mesh.matrixWorld);
        const scale = mesh.getWorldScale(new Vector3());
        const radius = sphere.radius * Math.max(scale.x, scale.y, scale.z);
        radii.set(mesh, radius + centre.distanceTo(mesh.getWorldPosition(new Vector3())));
        continue;
      }

      mesh.skeleton.update();
      const bones = mesh.skeleton.bones;
      const indexAttribute = mesh.geometry.getAttribute("skinIndex");
      const weightAttribute = mesh.geometry.getAttribute("skinWeight");
      for (let i = 0; i < position.count; i += 1) {
        mesh.getVertexPosition(i, vertex);
        vertex.applyMatrix4(mesh.matrixWorld);
        // Bind the vertex to the bone that actually drives it. A vertex on a blended seam
        // lands on the heavier of the two, which is the one whose motion it follows.
        // Read the components directly: these attributes may be interleaved, which rules
        // out `Vector4.fromBufferAttribute`.
        let dominant = indexAttribute.getX(i);
        let best = weightAttribute.getX(i);
        for (const [weight, index] of [
          [weightAttribute.getY(i), indexAttribute.getY(i)],
          [weightAttribute.getZ(i), indexAttribute.getZ(i)],
          [weightAttribute.getW(i), indexAttribute.getW(i)],
        ] as const) {
          if (weight > best) {
            best = weight;
            dominant = index;
          }
        }
        const bone = bones[dominant];
        if (bone === undefined) continue;
        let bonePosition = bonePositions.get(bone);
        if (bonePosition === undefined) {
          bonePosition = bone.getWorldPosition(new Vector3());
          bonePositions.set(bone, bonePosition);
        }
        const radius = vertex.distanceTo(bonePosition);
        if (radius > (radii.get(bone) ?? 0)) radii.set(bone, radius);
      }
    }

    this.#envelopeBones = [...radii.keys()];
    this.#envelopeRadii = this.#envelopeBones.map((bone) => radii.get(bone) ?? 0);
    this.#maxEnvelopeRadius = this.#envelopeRadii.reduce((a, b) => Math.max(a, b), 0);
    if (this.#envelopeBones.length === 0) return;
    // The spheres always reach below the real skin. Measure that gap once against the true
    // posed bounds so the estimate is exact here and stays within a centimetre elsewhere.
    this.#envelopeBias = 0;
    const truth = this.#measureBodyPose().bounds?.min[1];
    if (truth !== undefined) this.#envelopeBias = truth - this.#lowestSkinY();
  }

  /**
   * Signed error of the skin envelope against a real precise-bounds measurement, in metres.
   * Positive means the envelope reads high and the body is actually sunk into the deck.
   *
   * Returns null unless `globalThis.__FPS_GROUNDING_AUDIT__` is set, because computing it
   * is exactly the per-vertex walk that made this game run at 9 FPS.
   */
  #groundingAudit(): number | null {
    const host = globalThis as { __FPS_GROUNDING_AUDIT__?: boolean };
    if (host.__FPS_GROUNDING_AUDIT__ !== true) return null;
    if (this.#envelopeBones.length === 0) return null;
    this.#syncWorldMatrices();
    const truth = this.#measureBodyPose().bounds?.min[1];
    if (truth === undefined) return null;
    return this.#lowestSkinY() - truth;
  }

  /**
   * Lowest posed point of the body, in world Y. O(bones) with no allocation, against the
   * O(vertices × 4 matrix multiplies) of a precise `Box3`. Assumes world matrices are
   * current — `#groundToDeck` refreshes them before calling.
   */
  #lowestSkinY(): number {
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.#envelopeBones.length; i += 1) {
      // elements[13] is the world-matrix Y translation: the bone's world height, decomposed
      // by hand because `getWorldPosition` allocates and this runs on every bone every frame.
      const y = (this.#envelopeBones[i] as Object3D).matrixWorld.elements[13] as number;
      const candidate = y - (this.#envelopeRadii[i] as number);
      if (candidate < lowest) lowest = candidate;
    }
    return lowest + this.#envelopeBias;
  }

  #syncCollisionBody(): void {
    const proxy = this.#bodyProxy;
    const body = this.#body;
    if (proxy === undefined || body === undefined) return;
    proxy.position.set(
      this.group.position.x,
      this.group.position.y + this.#hitboxHeight / 2,
      this.group.position.z,
    );
    body.teleport(proxy.position);
  }


  /**
   * Fade a soldier in or out without changing his pipeline.
   *
   * `transparent` and `depthWrite` are blend and depth state, not shader uniforms, so flipping
   * either one makes WebGPU compile a *new* render pipeline for every material it touches — and a
   * soldier is a skinned mesh with several. This used to set `transparent = alpha < 0.999` and
   * `depthWrite = alpha > 0.5`, which meant the first death in a round compiled a fresh pipeline
   * per material on the frame the corpse started fading. Measured as a single ~180 ms frame,
   * mid-round, entirely outside game logic: `outsideGame` peaked at 177-186 ms with a firefight in
   * the scenario and 28.6 ms without one, on identical movement.
   *
   * So the state is fixed at construction and never moves. Only `opacity` changes, which is a
   * uniform the existing pipeline already reads. `needsUpdate` is deliberately not set: it forces
   * the material to be re-evaluated, and there is nothing left to re-evaluate.
   *
   * Keeping `depthWrite` on for a fading corpse is the deliberate half of this. It costs a little
   * correctness on a half-faded body seen through another one, and it buys never compiling
   * mid-fight — and a corpse fading on the ground is not what anyone is looking at.
   */
  #setOpacity(alpha: number): void {
    const objects = [...this.#bodyMeshes, ...(this.#weaponModel === undefined ? [] : [this.#weaponModel])];
    for (const object of objects) {
      object.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh !== true) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.opacity = alpha;
        }
      });
    }
    this.#fade = alpha;
  }

  /**
   * Put every material into its final blend state once, before the soldier is ever drawn.
   *
   * Called at construction so the transparent pipeline is compiled during loading, where a long
   * frame is part of the loading screen, rather than on the frame someone dies.
   */
  #fixBlendState(): void {
    const objects = [...this.#bodyMeshes, ...(this.#weaponModel === undefined ? [] : [this.#weaponModel])];
    for (const object of objects) {
      object.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh !== true) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.transparent = true;
          material.depthWrite = true;
          material.needsUpdate = true;
        }
      });
    }
  }

  /** Muzzle point in world space: the weapon tip when equipped, the chest otherwise. */
  muzzle(): Vector3 {
    const weapon = this.#weapon;
    if (weapon === undefined) return this.chest;
    const tip = new Vector3(0, 0, this.#rifleLocalMaxZ);
    return weapon.localToWorld(tip);
  }

  /**
   * `override` is what makes the flinch survive.
   *
   * Every branch of the state machine re-asserts its own clip every frame, so a one-shot pose set
   * from outside the machine — `hurt` setting `HitReaction`, which is the only one — was replaced
   * on the next frame by whichever branch ran. Guarding the two call sites was not enough: the
   * spawn-grace branch plays `RifleIdle` directly rather than through `#playLocomotion`, and the
   * burst plays `FiringRifle` on every round. One refusal here covers all of them, and death
   * passes `override` because a corpse outranks a flinch.
   */
  #play(name: string, fade = 0.18, mode: "loop" | "once" = "loop", override = false): void {
    if (this.#animation === undefined || !this.#clips.has(name)) return;
    if (!override && this.#reactionHold > 0) return;
    if (this.#animation.current === name) return;
    this.#weaponPoseElapsed = 0;
    this.#applyWeaponPose(name);
    this.#animation.play(name, { fade, mode });
  }

  /**
   * Metres per second a clip covers when played at rate 1, measured off this rig's feet.
   *
   * Every clip in this asset is authored in place — no hips translation track in any of the
   * nine, verified against the GLB — so the distance is not in the file and has to be read
   * out of the gait. Each foot's forward excursion over one cycle is its step length, and a
   * stride is one step from each foot; that agrees with integrating the planted foot's
   * backward slip to within 6% on the walk cycle, and unlike the naive
   * "lowest foot is the planted one" rule it does not fall apart on the crouch cycle where
   * both feet stay low.
   *
   * The result is cached on the `AnimationClip`, which the whole squad shares, so this runs
   * once per clip rather than once per soldier. The rig is left in the pose it started in.
   */
  #measureClipGroundSpeed(clip: AnimationClip): number {
    const cached = CLIP_GROUND_SPEED.get(clip);
    if (cached !== undefined) return cached;
    const left = this.#leftFoot;
    const right = this.#rightFoot;
    if (left === undefined || right === undefined || clip.duration <= 0) {
      CLIP_GROUND_SPEED.set(clip, 0);
      return 0;
    }

    // Snapshot every posed bone: this walks the clip, and the caller measured the bind pose.
    const restored: { bone: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }[] =
      [];
    this.group.traverse((object) => {
      restored.push({
        bone: object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    });

    const mixer = new AnimationMixer(this.group);
    mixer.clipAction(clip).reset().play();
    const forward = new Vector3();
    const root = new Vector3();
    let leftMin = Number.POSITIVE_INFINITY;
    let leftMax = Number.NEGATIVE_INFINITY;
    let rightMin = Number.POSITIVE_INFINITY;
    let rightMax = Number.NEGATIVE_INFINITY;
    for (let sample = 0; sample <= STRIDE_SAMPLES; sample += 1) {
      mixer.setTime((sample / STRIDE_SAMPLES) * clip.duration);
      this.#syncWorldMatrices();
      this.group.getWorldPosition(root);
      // The body's own forward axis, so a rig that is not authored along +Z still measures.
      forward.set(0, 0, 1).applyQuaternion(this.group.getWorldQuaternion(new Quaternion()));
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
      forward.normalize();
      const leftAt = left.getWorldPosition(new Vector3()).sub(root).dot(forward);
      const rightAt = right.getWorldPosition(new Vector3()).sub(root).dot(forward);
      leftMin = Math.min(leftMin, leftAt);
      leftMax = Math.max(leftMax, leftAt);
      rightMin = Math.min(rightMin, rightAt);
      rightMax = Math.max(rightMax, rightAt);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(this.group);
    for (const entry of restored) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.quaternion);
      entry.bone.scale.copy(entry.scale);
    }
    this.#syncWorldMatrices();

    const stride = leftMax - leftMin + (rightMax - rightMin);
    const speed = Number.isFinite(stride) ? Math.max(0, stride) / clip.duration : 0;
    CLIP_GROUND_SPEED.set(clip, speed);
    return speed;
  }

  /**
   * Play the locomotion clip at the rate the body is actually travelling.
   *
   * `timeScale` lives on the mixer action, not on the player, so the clip is looked up by
   * name and re-timed directly. A clip with no measurable stride (idle, the crouch-to-stand
   * transition) keeps rate 1: scaling it by ground speed would make a standing man twitch.
   */
  #applyLocomotionRate(name: string): void {
    const player = this.#animation;
    const clip = this.#clipsByName.get(name);
    if (player === undefined || clip === undefined) return;
    const action = player.mixer.existingAction(clip);
    if (action === null || action === undefined) return;
    const clipSpeed = this.#clipGroundSpeed.get(name) ?? 0;
    if (clipSpeed <= 0.05) {
      this.#locomotionRate = 1;
      this.#strideErrorRatio = 1;
      action.setEffectiveTimeScale(1);
      return;
    }
    const rate = MathUtils.clamp(
      this.#groundSpeed / clipSpeed,
      LOCOMOTION_RATE_MIN,
      LOCOMOTION_RATE_MAX,
    );
    this.#locomotionRate = rate;
    action.setEffectiveTimeScale(rate);
    if (this.#groundSpeed >= LOCOMOTION_RATE_FLOOR) {
      this.#locomotionRatePeak = Math.max(this.#locomotionRatePeak, rate);
    }
    // How fast the feet believe the body is going, over how fast it is. 1 is no slip.
    if (this.#groundSpeed >= LOCOMOTION_RATE_FLOOR) {
      this.#strideErrorRatio = (clipSpeed * rate) / this.#groundSpeed;
      this.#strideErrorPeak = Math.max(
        this.#strideErrorPeak,
        Math.abs(this.#strideErrorRatio - 1),
      );
    } else {
      this.#strideErrorRatio = 1;
    }
  }

  /**
   * Pick the locomotion clip from what the body is actually doing.
   *
   * Two things this fixes beyond using more of the rig: the walk cycle no longer plays while
   * the soldier is standing still against a blocked path, and standing up out of a crouch runs
   * its authored transition instead of popping straight to idle.
   */
  #playLocomotion(moving: boolean, crouched: boolean, dt: number, poseLocked = false): void {
    // Ground speed is measured from where the body actually got to this frame, not from the
    // speed constant it was asked for: a blocked step, a corner, or a slow turn all cut it.
    this.#groundSpeed =
      dt > 0
        ? Math.hypot(
            this.group.position.x - this.#frameStart.x,
            this.group.position.z - this.#frameStart.z,
          ) / dt
        : 0;
    // How hard the body braked this frame, in metres per second squared.
    //
    // A soldier sheds pace at WALK_DECEL and no faster. Anything above it means the body was
    // teleported to rest rather than walked to it, which is what a patrol pause used to do:
    // `#brake` decays `#pace`, `#pace` is read only by `#step`, and the pause called neither —
    // so ground speed went 2.31 to 0 between two frames while the legs were mid-stride.
    // Exempt frames are the stops that are honest: a wall, a death, a scenario placement.
    if (dt > 0 && !this.#decelExempt) {
      const braking = (this.#previousGroundSpeed - this.#groundSpeed) / dt;
      if (braking > this.#decelPeak) this.#decelPeak = braking;
    }
    this.#previousGroundSpeed = this.#groundSpeed;
    this.#decelExempt = false;
    // One frame against a wall, or one frame of a replan, is not a stop. Without this the
    // walk clip strobes against idle whenever the path is briefly blocked.
    this.#stillFor = moving ? 0 : this.#stillFor + dt;
    // The burst clip and the flinch own the pose while they last, but the body keeps reporting the
    // ground speed it is actually making. Returning before the measurement above froze
    // `#groundSpeed` at whatever it was when the burst started, which drove `#updateFootsteps`
    // into playing footfalls for a soldier standing still.
    if (poseLocked || this.#reactionHold > 0) return;
    const travelling = this.#stillFor < STILL_BEFORE_IDLE_SECONDS;

    let wanted: string;
    if (travelling) {
      // Crouch state changes on the frame he is suppressed or wounded, but the body takes
      // `WALK_DECEL` to shed the pace it was carrying. Dropping onto the crouch clip during
      // that window puts a 0.807 m/s creep under a body still making walking pace, which is
      // the same foot slide `#clipPaceCap` exists to prevent — so the clip waits for the legs.
      const creeping = this.#groundSpeed <= this.#clipPaceCap(true) * 1.02;
      wanted =
        crouched && creeping && this.#clips.has("RifleCrouchWalk")
          ? "RifleCrouchWalk"
          : "RifleWalk";
    } else if (this.#crouchMoving && this.#clips.has("RifleCrouchWalkToIdle")) {
      // Standing up runs its authored transition, and owns the pose until it finishes.
      this.#crouchMoving = false;
      this.#standUp = this.#clipDurations.get("RifleCrouchWalkToIdle") ?? 0.5;
      this.#locomotion = "RifleCrouchWalkToIdle";
      this.#locomotionHold = this.#standUp;
      this.#play("RifleCrouchWalkToIdle", LOCOMOTION_FADE, "once");
      this.#applyLocomotionRate("RifleCrouchWalkToIdle");
      return;
    } else {
      if (this.#standUp > 0) return;
      wanted = "RifleIdle";
    }

    // Commit to a locomotion clip for a beat. Crouch state can flicker as suppression decays
    // or a burst starts, and a rig that re-blends every frame reads as a twitch, not a soldier.
    if (wanted !== this.#locomotion && this.#locomotionHold > 0) return;
    if (wanted !== this.#locomotion) this.#locomotionHold = LOCOMOTION_HOLD_SECONDS;
    this.#locomotion = wanted;
    this.#crouchMoving = wanted === "RifleCrouchWalk";
    this.#standUp = travelling ? 0 : this.#standUp;
    this.#play(wanted, LOCOMOTION_FADE);
    this.#applyLocomotionRate(wanted);
  }

  /**
   * How far the corpse travelled along the killing round's direction, in metres, measured on
   * the hips and flattened to the deck. Positive means he fell away from the shooter, which is
   * true of both death clips when they are mapped the right way round.
   */
  #deathFallDot(): number | null {
    const start = this.#deathHipStart;
    const round = this.#lastHitDirection;
    if (start === null || round === null || this.#hips === undefined) return null;
    const now = this.#hips.getWorldPosition(new Vector3());
    const travel = new Vector3(now.x - start.x, 0, now.z - start.z);
    const heading = new Vector3(round.x, 0, round.z);
    if (heading.lengthSq() < 1e-6) return null;
    return travel.dot(heading.normalize());
  }

  #countClipFrame(): void {
    const current = this.#animation?.current;
    if (current === undefined) return;
    this.#clipFrames.set(current, (this.#clipFrames.get(current) ?? 0) + 1);
  }

  /**
   * Fire `hooks.onFootstep` each time the locomotion action crosses a half-cycle
   * boundary — one planted foot per half-cycle, so a re-timed walk keeps its steps
   * in step with the animation rather than with a timer. A clip switch resets the
   * phase so the first frame of a new clip cannot read as a plant.
   */
  #updateFootsteps(hooks: EnemyHooks): void {
    if (hooks.onFootstep === undefined || this.#groundSpeed < LOCOMOTION_RATE_FLOOR) return;
    const clip = this.#clipsByName.get(this.#locomotion);
    if (clip === undefined || clip.duration <= 0) return;
    const action = this.#animation?.mixer.existingAction(clip);
    if (action === null || action === undefined) return;
    const half = Math.floor(((action.time / clip.duration) % 1) * 2);
    if (this.#locomotion !== this.#lastStepClip) {
      this.#lastStepClip = this.#locomotion;
      this.#lastStepHalf = half;
      return;
    }
    if (half === this.#lastStepHalf) return;
    this.#lastStepHalf = half;
    hooks.onFootstep(this.group.position);
  }

  /** Which death animation reads as true for the round that killed him. */
  #deathClipFor(): string {
    const fallback = this.#clips.has("DeathFront") ? "DeathFront" : "DeathBack";
    // A head hit is unmistakable on screen and outranks direction.
    if (this.#lastHitMultiplier >= 4 && this.#clips.has("DeathHeadshot")) return "DeathHeadshot";
    const round = this.#lastHitDirection;
    if (round === null) return fallback;
    const forward = new Vector3(0, 0, 1).applyEuler(this.group.rotation);
    // A round travelling the way he faces reached him from behind, so the body pitches
    // forward, away from the shooter. Facing into the round drops him backward instead.
    const struckFromBehind = round.dot(forward) > 0;
    const wanted = struckFromBehind ? "DeathFront" : "DeathBack";
    return this.#clips.has(wanted) ? wanted : fallback;
  }

  #occupied(x: number, z: number, padding: number): boolean {
    for (const box of this.#colliders) {
      // The raised deck is overhead, not a wall. Keep its supports and the lower range solids
      // in the navigation map, but let a soldier route through the open space underneath it.
      if (box.min[1] > scale.humanHeight + scale.ankleHeight * 6) continue;
      if (
        x > box.min[0] - padding &&
        x < box.max[0] + padding &&
        z > box.min[2] - padding &&
        z < box.max[2] + padding &&
        box.max[1] > 0.5
      ) {
        return true;
      }
    }
    return x < this.#navMin || x > this.#navMax || z < this.#navMin || z > this.#navMax;
  }

  /** True when the soldier stands in any raised deck's footprint — routing beneath it. */
  #underDeck(): boolean {
    const x = this.group.position.x;
    const z = this.group.position.z;
    for (const deck of this.#decks) {
      if (
        x > deck.minX &&
        x < deck.maxX &&
        z > deck.minZ &&
        z < deck.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * The navigation grid's blocked cells, built once and shared by the whole squad.
   *
   * `#occupied` is a linear scan of every town collider, and A* asked it for up to three cells per
   * neighbour across a 46x46 grid — per search, per soldier. It was the single hottest function in
   * the game (197 ms of self time in a 3.7-minute trace) and it was recomputing one static answer
   * over and over: the town's colliders never move, so a cell that is blocked on the first frame is
   * blocked on the last. The bitmap is keyed on the collider array itself, so the five soldiers
   * that share `town.colliders` share one grid, and a scene that rebuilds its town gets a new one.
   *
   * Only cell-centre queries use this. `#segmentClear` interpolates arbitrary points between cells
   * and still runs the exact test, so no route changes shape.
   */
  #navGrid(width: number): Uint8Array {
    let byBounds = NAV_GRIDS.get(this.#colliders);
    if (byBounds === undefined) {
      byBounds = new Map();
      NAV_GRIDS.set(this.#colliders, byBounds);
    }
    const boundsKey = `${this.#navMin}|${this.#navMax}|${width}`;
    const cached = byBounds.get(boundsKey);
    if (cached !== undefined) return cached;
    const grid = new Uint8Array(width * width);
    for (let z = 0; z < width; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const worldX = this.#navMin + x * NAV_CELL;
        const worldZ = this.#navMin + z * NAV_CELL;
        grid[z * width + x] = this.#occupied(worldX, worldZ, AGENT_RADIUS + 0.16) ? 1 : 0;
      }
    }
    byBounds.set(boundsKey, grid);
    return grid;
  }

  #blocked(x: number, z: number): boolean {
    return this.#occupied(x, z, AGENT_RADIUS);
  }

  #navBlocked(x: number, z: number): boolean {
    // Grid nodes need slack: a mathematically tangent route clips a corner after interpolation.
    return this.#occupied(x, z, AGENT_RADIUS + 0.16);
  }

  /** True when the whole body-width corridor is clear, not merely its end point. */
  #segmentClear(from: Vector3, to: Vector3): boolean {
    const distance = from.distanceTo(to);
    const samples = Math.max(1, Math.ceil(distance / (NAV_CELL * 0.45)));
    for (let index = 1; index <= samples; index += 1) {
      const t = index / samples;
      if (this.#navBlocked(MathUtils.lerp(from.x, to.x, t), MathUtils.lerp(from.z, to.z, t))) {
        return false;
      }
    }
    return true;
  }

  /** Build a deterministic 8-way A* route and then remove grid points visible from each other. */
  #findPath(goalX: number, goalZ: number): Vector3[] {
    const navMin = this.#navMin;
    const navMax = this.#navMax;
    const width = Math.floor((navMax - navMin) / NAV_CELL) + 1;
    const toCell = (value: number): number =>
      MathUtils.clamp(Math.round((value - navMin) / NAV_CELL), 0, width - 1);
    const toWorld = (cell: number): number => navMin + cell * NAV_CELL;
    const key = (x: number, z: number): number => z * width + x;
    const grid = this.#navGrid(width);
    /** Cell-centre blocked test: one array read instead of a scan of every collider. */
    const cellBlocked = (x: number, z: number): boolean => grid[z * width + x] === 1;
    const sx = toCell(this.group.position.x);
    const sz = toCell(this.group.position.z);
    let gx = toCell(goalX);
    let gz = toCell(goalZ);
    const requestedGoalBlocked = this.#navBlocked(goalX, goalZ);

    // A requested point may sit within the body's clearance margin. Pick the nearest usable cell.
    if (cellBlocked(gx, gz)) {
      let replacement: [number, number] | undefined;
      for (let radius = 1; radius < width && replacement === undefined; radius += 1) {
        for (let dz = -radius; dz <= radius && replacement === undefined; dz += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = gx + dx;
            const z = gz + dz;
            if (
              x >= 0 &&
              z >= 0 &&
              x < width &&
              z < width &&
              !cellBlocked(x, z)
            ) {
              replacement = [x, z];
              break;
            }
          }
        }
      }
      if (replacement === undefined) return [];
      [gx, gz] = replacement;
    }

    const start = key(sx, sz);
    const goal = key(gx, gz);
    const open = new Set<number>([start]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[start, 0]]);
    const fScore = new Map<number, number>([[start, Math.hypot(gx - sx, gz - sz)]]);
    const neighbours: readonly (readonly [number, number, number])[] = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
    ];

    while (open.size > 0) {
      let current = -1;
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of open) {
        const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
        if (score < best) {
          best = score;
          current = candidate;
        }
      }
      if (current === goal) break;
      open.delete(current);
      const cx = current % width;
      const cz = Math.floor(current / width);
      for (const [dx, dz, cost] of neighbours) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= width) continue;
        if (cellBlocked(nx, nz)) continue;
        // Do not squeeze diagonally between two touching solids.
        if (
          dx !== 0 &&
          dz !== 0 &&
          (cellBlocked(cx + dx, cz) || cellBlocked(cx, cz + dz))
        ) continue;
        const next = key(nx, nz);
        const tentative = (gScore.get(current) ?? Number.POSITIVE_INFINITY) + cost;
        if (tentative >= (gScore.get(next) ?? Number.POSITIVE_INFINITY)) continue;
        cameFrom.set(next, current);
        gScore.set(next, tentative);
        fScore.set(next, tentative + Math.hypot(gx - nx, gz - nz));
        open.add(next);
      }
    }
    if (start !== goal && !cameFrom.has(goal)) return [];

    const raw: Vector3[] = [];
    let cursor = goal;
    while (cursor !== start) {
      raw.push(new Vector3(toWorld(cursor % width), 0, toWorld(Math.floor(cursor / width))));
      const previous = cameFrom.get(cursor);
      if (previous === undefined) return [];
      cursor = previous;
    }
    raw.reverse();
    // Preserve clearance when the requested destination itself is inside an inflated obstacle.
    if (!requestedGoalBlocked) raw.push(new Vector3(goalX, 0, goalZ));

    const smooth: Vector3[] = [];
    let anchor = new Vector3(this.group.position.x, 0, this.group.position.z);
    for (let index = 0; index < raw.length;) {
      let furthest = index;
      while (furthest + 1 < raw.length && this.#segmentClear(anchor, raw[furthest + 1] as Vector3)) {
        furthest += 1;
      }
      const waypoint = (raw[furthest] as Vector3).clone();
      smooth.push(waypoint);
      anchor = waypoint;
      index = furthest + 1;
    }
    return smooth;
  }

  /** Detection is an event: commit a route now instead of waiting for a movement branch. */
  #beginPursuit(target: Vector3): void {
    this.#path = this.#findPath(target.x, target.z);
    this.#pathIndex = 0;
    this.#pathGoal.set(target.x, 0, target.z);
    this.#replanIn = NAV_REPLAN_SECONDS;
  }

  /** Shed pace at the walking deceleration. Used by every branch that is not travelling. */
  #brake(dt: number): void {
    this.#pace = Math.max(0, this.#pace - WALK_DECEL * dt);
  }

  /**
   * Carry the last of his pace into the stop instead of dropping it in one frame.
   *
   * `#brake` only decays `#pace`, and `#pace` is read nowhere except `#step`. So every branch
   * that stopped by braking without stepping — a patrol pause, a consumed path, a waypoint
   * reached — took the body from walking pace to standing still between two frames while the
   * legs were still mid-stride. Measured on patrol before this existed: ground speed went
   * 2.31 -> 0 with no intermediate frame, twice in 2.6 s, and the locomotion clip snapped to
   * idle underneath a body that had already teleported to rest. It reads as a stutter, and it is
   * the same foot-slide defect `#clipPaceCap` guards on the other end of the speed range.
   *
   * Returns whether he is still under way, so the caller can keep the walk clip on until the
   * body has actually finished moving rather than the frame the decision was made.
   */
  #coast(dt: number): boolean {
    // Coasting owns the pace for this frame. Without claiming the step, the tail brake at the
    // end of `update` — which exists for the branches that neither step nor coast, a burst or a
    // soldier standing and listening — decays it a second time, and the body stops at twice the
    // deceleration it was authored with. Measured: 18.0 m/s squared against a WALK_DECEL of 9.
    this.#stepped = true;
    this.#brake(dt);
    if (this.#pace <= COAST_FLOOR) {
      this.#pace = 0;
      return false;
    }
    const heading = this.#heading.value;
    const travel = this.#pace * dt;
    const nextX = this.group.position.x + Math.sin(heading) * travel;
    const nextZ = this.group.position.z + Math.cos(heading) * travel;
    // A body that walks into something does not coast through it.
    if (this.#blocked(nextX, nextZ)) {
      this.#pace = 0;
      this.#decelExempt = true;
      return false;
    }
    this.group.position.set(nextX, this.group.position.y, nextZ);
    return true;
  }

  /** Follow a cached route, replanning when a moving goal changes or the corridor becomes blocked. */
  /**
   * Returns true while he is walking the route — including the first few frames of the ramp,
   * where the body has barely moved. The old test was `travel > speed * dt * 0.05`, which is
   * false for the whole acceleration, so the walk clip would not start until he was already
   * gliding. What the caller wants to know is whether he is under way, not whether this
   * particular frame cleared a distance threshold.
   *
   * `faceTravel` is off for combat, where `#engage` owns the facing so the rifle can stay on
   * the player while the feet go somewhere else.
   */
  /**
   * The fastest this soldier may travel while the clip that carries him still keeps up, in
   * metres per second.
   *
   * `#applyLocomotionRate` re-times the locomotion clip to the ground speed and clamps the
   * result at `LOCOMOTION_RATE_MAX`. Whenever that clamp bites, the clamp is what gives — the
   * body keeps its speed and the feet stop matching it, which is foot slide by another name and
   * is silent from inside `#applyLocomotionRate`, which has already moved the body by then.
   *
   * Measured, before this existed: a soldier searching crouched ran `RifleCrouchWalk`, a clip
   * that carries 0.807 m/s at rate 1, at 2.25 m/s — rate 2.79 asked for, 2.1 delivered, feet
   * making 1.69 m/s under a body making 2.25. `strideErrorPeak` 0.248 against a gate of 0.15.
   * The uncrouched chase saturated too, mildly: 2.886 m/s against a walk ceiling of 2.744.
   *
   * So the ceiling is applied where it belongs — to the speed that is asked for, before the
   * body travels — and the rate clamp goes back to being unreachable. Divided by nothing:
   * `#step` applies `#gait` first and this caps the product, so the fastest-gaited soldier is
   * bounded by the same clip as the slowest.
   */
  #clipPaceCap(crouched: boolean): number {
    const name = crouched && this.#clips.has("RifleCrouchWalk") ? "RifleCrouchWalk" : "RifleWalk";
    const clipSpeed = this.#clipGroundSpeed.get(name) ?? 0;
    // A clip with no measurable stride cannot bound anything; leave the caller's speed alone.
    return clipSpeed <= 0.05 ? Number.POSITIVE_INFINITY : clipSpeed * LOCOMOTION_RATE_MAX;
  }

  #step(
    dt: number,
    toX: number,
    toZ: number,
    speed: number,
    faceTravel = true,
    crouched = false,
  ): boolean {
    this.#stepped = true;
    this.#replanIn -= dt;
    this.#goalReplanIn -= dt;
    const goalMoved = Math.hypot(toX - this.#pathGoal.x, toZ - this.#pathGoal.z) > 0.8;
    const currentWaypoint = this.#path[this.#pathIndex];
    const routeObstructed =
      this.#replanIn <= 0 &&
      currentWaypoint !== undefined &&
      !this.#segmentClear(this.group.position, currentWaypoint);
    // A grid search is not a per-frame operation. `goalMoved` used to bypass the replan cooldown
    // entirely, so a soldier chasing a moving player re-planned his whole route on almost every
    // frame — measured at 16.7 ms across the squad, the largest single cost left in the game.
    // Having no path at all is still replanned immediately, because a soldier with nowhere to go
    // stands still and that is visible; a route four-tenths of a second out of date is not.
    // A grid search is not a per-frame operation. `goalMoved` used to bypass the replan cooldown
    // entirely, so a soldier chasing a moving player re-planned his whole route on almost every
    // frame — measured at 16.7 ms across the squad, the largest single cost left in the game.
    // Having no path at all is still replanned immediately, because a soldier with nowhere to go
    // stands still and that is visible; a route four-tenths of a second out of date is not.
    //
    // A squad-wide budget of one search per frame was tried on top of this and reverted: it holds
    // the worst frame down further, but a soldier pressed against geometry then has to win a race
    // for the token before he can re-route, and `enemy-reaches-walkway` caught him failing to.
    // The cooldown alone is the part that is safe to keep.
    const mustReplan = this.#path.length === 0;
    const goalDrifted = goalMoved && this.#goalReplanIn <= 0;
    if (goalDrifted) this.#goalReplanIn = GOAL_REPLAN_SECONDS;
    if (mustReplan || goalDrifted || routeObstructed) {
      this.#beginPursuit(scratchGoal.set(toX, 0, toZ));
    }
    let waypoint = this.#path[this.#pathIndex];
    while (waypoint !== undefined && this.group.position.distanceTo(waypoint) < 0.32) {
      this.#pathIndex += 1;
      waypoint = this.#path[this.#pathIndex];
    }
    if (waypoint === undefined) return this.#coast(dt);
    const dx = waypoint.x - this.group.position.x;
    const dz = waypoint.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return this.#coast(dt);

    // Steer the direction of travel rather than snapping it to the bearing of the next grid
    // point. This is what turns the 0.7 m A* polyline into a path a body could have walked.
    const bearing = Math.atan2(dx, dz);
    const heading = this.#heading.step(bearing, dt);
    const error = Math.abs(angleDelta(heading, bearing));
    // Nobody walks a corner at full pace. This also keeps the arc tight: the harder he has to
    // turn, the less ground he covers while turning, so the curve stays in the cleared corridor.
    const cornering = MathUtils.clamp(1 - error / CORNER_FULL, CORNER_FLOOR, 1);
    // Ease off onto the last waypoint instead of stopping on the mark.
    const arriving =
      this.#pathIndex >= this.#path.length - 1
        ? MathUtils.clamp(distance / ARRIVE_DISTANCE, ARRIVE_FLOOR, 1)
        : 1;
    const wanted =
      Math.min(speed * this.#gait, this.#clipPaceCap(crouched)) * cornering * arriving;
    const gained = MathUtils.clamp(wanted - this.#pace, -WALK_DECEL * dt, WALK_ACCEL * dt);
    this.#pace += gained;
    this.#paceRate = dt > 0 ? gained / dt : 0;

    const travel = Math.min(distance, this.#pace * dt);
    const nextX = this.group.position.x + Math.sin(heading) * travel;
    const nextZ = this.group.position.z + Math.cos(heading) * travel;
    if (this.#blocked(nextX, nextZ)) {
      this.#path = [];
      this.#replanIn = 0;
      // He walked into something. A body that hits a wall does not keep its momentum.
      this.#pace *= 0.3;
      this.#decelExempt = true;
      return false;
    }
    this.group.position.set(nextX, this.group.position.y, nextZ);
    if (faceTravel) this.group.rotation.y = this.#facing.step(heading, dt);
    return true;
  }


  /**
   * Can he see the player right now?
   *
   * Every frame, with no caching. Rationing this to one answer every few frames was tried and
   * reverted: `enemy-reaches-walkway` went from reliable to a coin flip, because a soldier acting
   * on a sight answer a tenth of a second stale takes a different route and does not arrive.
   * Vision is what the whole AI branches on, and stale input to a state machine is not a
   * shortcut — it is a different state machine.
   *
   * It is affordable because the sight line itself got cheap: the range and cone rejects here
   * cost three dot products, and `lineOfSight` answers most calls from a box test without
   * touching a raycast at all. See the two-stage test in `Play`.
   */
  #canSee(eye: Vector3, hooks: EnemyHooks): boolean {
    const chest = this.chest;
    scratchTo.subVectors(eye, chest);
    if (scratchTo.length() > VIEW_RANGE) return false;
    scratchFacing.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    scratchFlat.set(scratchTo.x, 0, scratchTo.z).normalize();
    if (scratchFacing.dot(scratchFlat) < Math.cos(VIEW_HALF_ANGLE)) return false;
    return hooks.lineOfSight(chest, eye);
  }

  hearShot(shooter: Vector3): void {
    if (!this.alive || this.#frozen) return;
    if (shooter.distanceTo(this.group.position) > HEAR_RANGE) return;
    this.#lastSeen.copy(shooter);
    this.#beginPursuit(shooter);
    if (this.phase === "patrol" || this.phase === "return") {
      this.phase = "suspicious";
      this.#alertTimer = 0;
      // Only the men pulled off a calm route call it out; anyone already
      // fighting has said his piece.
      this.voice?.chase(this.group.position);
    }
  }

  /** Returns the score the shot earned: 300 for the kill, 100 for the first wound. */
  hurt(ctx: GameCtx, amount: number): number {
    if (!this.alive) return 0;
    this.health -= amount;
    let earned = 0;
    if (!this.wounded) {
      this.wounded = true;
      earned = 100;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.phase = "dead";
    this.#decelExempt = true;
      this.voice?.death(this.group.position);
      this.#deadFor = 0;
      this.#deathObserved = true;
      this.#deathSettleReady = false;
      this.#bodyClearance = null;
      this.#footClearance = null;
      this.#deathAnkleDelta = 0;
      this.#deathClipFrames = 0;
      this.#deathFallMeasured = null;
      this.#deathGroundCeiling = this.group.position.y;
      this.#corpseGroundTimer = 0;
      this.#deathHipStart = this.#hips?.getWorldPosition(new Vector3()) ?? null;
      const clip = this.#deathClipFor();
      this.#deathClip = this.#clips.has(clip) ? clip : null;
      this.#play(clip, DEATH_FADE, "once", true);
      this.#detachWeapon(ctx, clip);
      ctx.after(RESPAWN_SECONDS, () => this.#respawn());
      return earned + 300;
    }
    // Surviving a round costs him his composure for a couple of seconds, not just health.
    this.#suppressed = Math.max(this.#suppressed, 2.4);
    this.#suppressedPeak = Math.max(this.#suppressedPeak, this.#suppressed);
    this.voice?.pain(this.group.position);
    // "once", and held: the clip is a one-shot flinch, and the hold is what stops locomotion
    // reclaiming the rig before a single frame of it has been drawn.
    this.#reactionHold = Math.min(this.#clipDurations.get("HitReaction") ?? 0.4, 0.45);
    this.#play("HitReaction", REACTION_FADE, "once", true);
    // A frozen sentry flinches at the impact but holds his ground: engaging here
    // would walk him out of a scenario-placed spawn on the first non-killing round.
    if (!this.#frozen && this.phase !== "engage") this.phase = "engage";
    return earned;
  }

  /** `shotDirection` is the round's travel direction, used to pick which way the body falls. */
  recordHit(multiplier: number, shotDirection?: Vector3): void {
    this.#lastHitMultiplier = multiplier;
    if (shotDirection !== undefined) {
      this.#lastHitDirection = shotDirection.clone().normalize();
    }
  }

  #respawn(): void {
    this.health = MAX_HEALTH;
    this.wounded = false;
    this.phase = "patrol";
    this.#suppressed = 0;
    this.#standUp = 0;
    this.#reactionHold = 0;
    this.#crouchMoving = false;
    this.#locomotion = "";
    this.#locomotionHold = 0;
    this.#stillFor = 0;
    this.#lastHitDirection = null;
    this.#deathSettleReady = false;
    this.#deathGroundCeiling = null;
    this.#corpseGroundTimer = 0;
    this.#reattachWeapon();
    this.#bodyClearance = null;
    this.#footClearance = null;
    this.#groundInitialised = false;
    // Blend state first, and only here: it is what costs a pipeline, so it is set once per
    // soldier and never again. The fade below is a uniform on the pipeline this just built.
    this.#fixBlendState();
    this.#setOpacity(0);
    this.#reaction = 0;
    this.#burstLeft = 0;
    this.#cooldown = 0;
    this.#path = [];
    this.#pathIndex = 0;
    this.#pathGoal.copy(this.#route[0] ?? ROUTE_START);
    this.#replanIn = 0;
    this.#searchAtGoal = 0;
    this.#patrolPause = 0;
    this.#spawnGrace = SPAWN_GRACE_SECONDS;
    this.#routeIndex = 0;
    this.group.position.copy(this.#route[0] ?? ROUTE_START);
    const firstWaypoint = this.#route[1];
    if (firstWaypoint !== undefined) {
      this.#target.copy(firstWaypoint);
      this.#routeIndex = 1;
    }
    this.group.rotation.set(
      0,
      Math.atan2(this.#target.x - this.group.position.x, this.#target.z - this.group.position.z),
      0,
    );
    // A fresh body starts still and pointed down its route, with no turn or pace carried over
    // from the one that died — otherwise he respawns already leaning out of a corner.
    this.#heading.set(this.group.rotation.y);
    this.#facing.set(this.group.rotation.y);
    this.#lastYaw = this.group.rotation.y;
    this.#pace = 0;
    this.#paceRate = 0;
    this.#carriageTurn = 0;
    this.#carriagePush = 0;
    this.#play("RifleWalk", LOCOMOTION_FADE, "loop", true);
  }

  /**
   * Layer a walking carriage over whatever the clip just posed.
   *
   * The rig's rifle clips hold the torso locked to the hips, so a soldier changing direction is
   * a mannequin rotating about its own axis — which is most of what is left of "robot" once the
   * path and the pace are smooth. Three cues, all driven by how hard he is turning and how hard
   * he is accelerating, so a man standing still gets a delta of exactly zero and every
   * frozen-sentry scenario keeps the pose it measured:
   *
   *   - the lower torso banks into the turn,
   *   - the shoulders lag behind it,
   *   - the head leads it, because people look where they are going before they get there.
   *
   * The delta is built in the body's own frame and rotated into each bone's parent space, so it
   * stays a lean and a twist however the rig's bind axes happen to be oriented. It is applied
   * after `AnimationPlayer.update`, which rewrites every bone from the clip, so it can never
   * accumulate.
   */
  #applyCarriage(dt: number): void {
    // How fast the body actually turned this frame, read off the transform rather than off any
    // one branch's turner: patrol, suspicion, search and combat all steer the yaw differently,
    // and a soldier standing in a patrol pause has to read as zero without extra bookkeeping.
    const yaw = this.group.rotation.y;
    const measured = dt > 0 ? angleDelta(this.#lastYaw, yaw) / dt : 0;
    this.#lastYaw = yaw;
    const spine = this.#spine;
    if (spine === undefined) return;
    // Smoothed, not raw: angular velocity changes fast enough near a waypoint to pop the torso.
    const blend = 1 - Math.exp(-dt * CARRIAGE_SETTLE);
    this.#carriageTurn += (measured - this.#carriageTurn) * blend;
    this.#carriagePush += (this.#paceRate - this.#carriagePush) * blend;
    const turn = this.#carriageTurn;
    const push = this.#carriagePush;
    // Sustained lean, from pace rather than acceleration. Zero at walking pace by construction,
    // so a patrol, a pause and a scenario-frozen sentry all still get a delta of exactly zero.
    const run =
      MathUtils.clamp((this.#pace - WALK_SPEED) / Math.max(0.1, CHASE_SPEED - WALK_SPEED), 0, 1) *
      RUN_LEAN;
    if (Math.abs(turn) < 1e-3 && Math.abs(push) < 1e-3 && run < 1e-3) return;

    const bank = MathUtils.clamp(turn * CARRIAGE_BANK, -CARRIAGE_BANK_MAX, CARRIAGE_BANK_MAX);
    const lag = MathUtils.clamp(-turn * CARRIAGE_LAG, -CARRIAGE_LAG_MAX, CARRIAGE_LAG_MAX);
    const lead = MathUtils.clamp(turn * CARRIAGE_LEAD, -CARRIAGE_LEAD_MAX, CARRIAGE_LEAD_MAX);
    const pitch = MathUtils.clamp(push * CARRIAGE_PITCH, -CARRIAGE_PITCH_MAX, CARRIAGE_PITCH_MAX);

    const body = this.group.getWorldQuaternion(scratchBody);
    const inverse = scratchInverse.copy(body).invert();
    const apply = (bone: Object3D | undefined, x: number, y: number, z: number): void => {
      if (bone === undefined || bone.parent === null) return;
      scratchEuler.set(x, y, z, "YXZ");
      // Body frame → world, then world → this bone's parent frame.
      const world = scratchDelta.setFromEuler(scratchEuler).premultiply(body).multiply(inverse);
      const parent = bone.parent.getWorldQuaternion(scratchParent);
      scratchLocal.copy(parent).invert().multiply(world).multiply(parent);
      bone.quaternion.premultiply(scratchLocal);
    };
    // Leaning forward under acceleration belongs to the lower torso, banking with it. The run
    // lean rides the same bone, and the chest takes a fraction of it back so the head and the
    // rifle stay level — a torso that pitches as one piece points the weapon at the pavement.
    apply(spine, -pitch - run, 0, bank);
    apply(this.#chest, run * 0.42, lag, bank * 0.5);
    apply(this.#neck, 0, lead, 0);
  }

  update(ctx: GameCtx, dt: number, playerEye: Vector3, deckY: number, hooks: EnemyHooks): void {
    this.#frameStart.copy(this.group.position);
    if (this.phase === "dead") {
      this.#deadFor += dt;
      // The authored fall plays out first; the leg damp below only takes over once it has
      // ended. Running both at once has the IK fighting the clip, and skipping the clip
      // entirely leaves the soldier standing upright as a corpse.
      this.#animation?.update(dt);
      this.#countClipFrame();
      this.#deathClipFrames = Math.max(this.#deathClipFrames, this.#animation?.advancedFrames ?? 0);
      const fall = this.#deathFallDot();
      if (fall !== null && (this.#deathFallMeasured === null || fall > this.#deathFallMeasured)) {
        this.#deathFallMeasured = fall;
      }
      if (this.#deathClipFinished) this.#settleDeath(dt, deckY);
      this.#weaponPoseElapsed += dt;
      if (!this.#weaponDetached) this.#applyWeaponPose(this.#animation?.current ?? "");
      this.#updateDetachedWeapon(dt, deckY);
      this.#groundToDeck(deckY, dt);
      this.#normaliseWeapon();
      this.#alignWeaponGrip();
      this.#syncCollisionBody();
      if (this.#deadFor > RESPAWN_SECONDS - 0.35) {
        this.#setOpacity(MathUtils.clamp((RESPAWN_SECONDS - this.#deadFor) / 0.35, 0, 1));
      }
      return;
    }
    this.#spawnGrace = Math.max(0, this.#spawnGrace - dt);
    this.#reactionHold = Math.max(0, this.#reactionHold - dt);
    const sees =
      !this.#frozen &&
      this.#spawnGrace <= 0 &&
      chargeStage("canSee", () => this.#canSee(playerEye, hooks));
    if (sees) {
      // Entering combat from anywhere else starts the reaction clock, so the player gets a
      // moment to react rather than taking a burst the instant they step into the open.
      if (this.phase !== "engage") {
        this.#reaction = REACTION_SECONDS;
        this.#beginPursuit(playerEye);
        this.voice?.spot(this.group.position);
      }
      this.#lastSeen.copy(playerEye);
      this.phase = "engage";
      this.#alertTimer = 0;
    }

    const brainStarted = nowMs();
    this.#stepped = false;
    switch (this.phase) {
      case "patrol": {
        if (this.#spawnGrace > 0) {
          this.#play("RifleIdle");
          break;
        }
        if (this.#patrolPause > 0) {
          this.#patrolPause -= dt;
          // Coasting, not stopping: he sheds the pace he was carrying over WALK_DECEL and the
          // legs stay under him until the body has actually come to rest.
          this.#playLocomotion(this.#coast(dt), false, dt);
          break;
        }
        this.#playLocomotion(this.#step(dt, this.#target.x, this.#target.z, WALK_SPEED), false, dt);
        if (this.group.position.distanceTo(this.#target) < 0.9) {
          const routeLength = this.#route.length;
          if (routeLength === 0) break;
          this.#routeIndex = (this.#routeIndex + 1) % routeLength;
          const nextWaypoint = this.#route[this.#routeIndex];
          if (nextWaypoint !== undefined) this.#target.copy(nextWaypoint);
          // A patrol that pauses for exactly 0.45 s at every corner reads as a machine.
          this.#patrolPause = 0.35 + ctx.random() * 1.1;
        }
        break;
      }
      case "suspicious": {
        // Heard something: turn toward it, then go looking.
        this.#alertTimer += dt;
        const wanted = Math.atan2(
          this.#lastSeen.x - this.group.position.x,
          this.#lastSeen.z - this.group.position.z,
        );
        // Slower than a combat turn: he is placing a sound, not swinging onto a target.
        this.group.rotation.y = this.#facing.step(wanted, dt, 0.55);
        // Something is wrong and he does not know what: stay low while he works it out.
        this.#playLocomotion(false, true, dt);
        if (this.#alertTimer > 0.8) this.phase = "search";
        break;
      }
      case "engage": {
        this.#engage(ctx, dt, playerEye, hooks, sees);
        break;
      }
      case "search": {
        this.#alertTimer += dt;
        if (this.group.position.distanceTo(this.#lastSeen) >= 1.6 && this.#alertTimer <= 7) {
          // Closing on a position someone was just shooting from: move low and quick.
          this.#playLocomotion(
            this.#step(dt, this.#lastSeen.x, this.#lastSeen.z, CHASE_SPEED * 0.85, true, true),
            true,
            dt,
          );
        } else {
          // Search the last known area before giving up; do not instantly snap back to patrol.
          this.#searchAtGoal += dt;
          // Through the eased yaw rather than straight onto the transform, so the sweep is
          // reported as angular velocity and the shoulders and head read it like any other turn.
          this.group.rotation.y = this.#facing.spin(this.#strafe > 0 ? 1.2 : -1.2, dt);
          this.#playLocomotion(false, true, dt);
        }
        if (this.#searchAtGoal > 2.4 || this.#alertTimer > 9.5) {
          this.phase = "return";
          this.#alertTimer = 0;
          this.#searchAtGoal = 0;
          this.#path = [];
        }
        break;
      }
      case "return": {
        const home = this.#route[this.#routeIndex] ?? this.#route[0] ?? this.group.position;
        this.#playLocomotion(this.#step(dt, home.x, home.z, WALK_SPEED), false, dt);
        if (this.group.position.distanceTo(home) < 1.0) this.phase = "patrol";
        break;
      }
    }
    squadFrame.brain += nowMs() - brainStarted;
    // A branch that never called `#step` — a patrol pause, a burst, standing and listening —
    // is a soldier coming to a halt, not one who was never moving. Coast the pace down.
    if (!this.#stepped) {
      const before = this.#pace;
      this.#brake(dt);
      this.#paceRate = dt > 0 ? (this.#pace - before) / dt : 0;
    }
    this.#standUp = Math.max(0, this.#standUp - dt);
    this.#suppressed = Math.max(0, this.#suppressed - dt);
    this.#locomotionHold = Math.max(0, this.#locomotionHold - dt);
    chargeStage("animation", () => {
      this.#animation?.update(dt);
      // Straight after the mixer writes the pose and before anything reads the bones: the
      // carriage is a delta on top of the clip, and the clip is rewritten every frame.
      this.#applyCarriage(dt);
      this.#countClipFrame();
      this.#updateFootsteps(hooks);
    });
    this.#weaponPoseElapsed += dt;
    chargeStage("weapon", () => {
      if (!this.#weaponDetached) this.#applyWeaponPose(this.#animation?.current ?? "");
    });
    chargeStage("ground", () => this.#groundToDeck(deckY, dt));
    chargeStage("weapon", () => {
      this.#normaliseWeapon();
      this.#alignWeaponGrip();
      this.#syncCollisionBody();
    });
    if (this.#fade < 1) {
      chargeStage("opacity", () => this.#setOpacity(MathUtils.clamp(this.#fade + dt / 0.35, 0, 1)));
    }
  }

  #groundInitialised = false;

  /**
   * True once the one-shot death clip has played out and is holding its last frame. The
   * duration is the fallback for a mixer that has not reported yet, so nothing downstream
   * waits forever on a clip that finished.
   */
  get #deathClipFinished(): boolean {
    if (this.phase !== "dead") return false;
    if (this.#animation === undefined) return true;
    return this.#animation.finished || this.#deadFor >= (this.#clipDurations.get("DeathFront") ?? 0);
  }

  /**
   * Keep the rendered rifle at its declared length after parent-bone animation updates.
   *
   * The length is a constant of the asset; only the animated scale of the hand bone above it
   * varies. So the vertex walk happens once, and every frame after that is one division: the
   * local scale that cancels the parent's current world scale and lands on `rifleLength`.
   */
  #normaliseWeapon(): void {
    const holder = this.#weapon;
    if (holder === undefined) return;
    if (this.#weaponUnitLength <= 0) {
      holder.scale.setScalar(1);
      holder.updateWorldMatrix(true, true);
      const bounds = new Box3().setFromObject(holder);
      if (bounds.isEmpty()) return;
      const size = bounds.getSize(new Vector3());
      const parentScale = holder.parent === null ? 1 : worldScaleOf(holder.parent);
      const longest = Math.max(size.x, size.y, size.z);
      if (longest <= 0 || parentScale <= 0) return;
      // Back the parent's contribution out, so what is stored is the asset's own length.
      this.#weaponUnitLength = longest / parentScale;
    }
    const parentScale = holder.parent === null ? 1 : worldScaleOf(holder.parent);
    if (parentScale <= 0) return;
    holder.scale.setScalar(scale.rifleLength / (this.#weaponUnitLength * parentScale));
  }

  /**
   * Lowest posed body point for a corpse, measured precisely rather than estimated.
   *
   * The skin envelope is a sphere per bone whose radius is fixed at calibration and whose
   * error is cancelled by one scalar bias in the bind pose. A collapsing body rotates every
   * limb out of that pose, and the spheres then reach as much as 1.2 m below the real skin —
   * measured on this rig, with the head sphere the offender. `#groundToDeck` turns that
   * error into height one-for-one, which is exactly how the corpse ended up floating with
   * its hips 1.36 m in the air. Returns null on the frames between measurements, where the
   * caller leaves the body where it is.
   */
  #corpseLowestY(dt: number): number | null {
    this.#corpseGroundTimer -= dt;
    if (this.#corpseGroundTimer > 0) return null;
    this.#corpseGroundTimer = CORPSE_GROUND_INTERVAL;
    return this.#measureBodyPose().bounds?.min[1] ?? null;
  }

  /** Keep the lowest posed body point on the requested deck with a bounded correction. */
  #groundToDeck(deckY: number, dt: number): void {
    if (this.#envelopeBones.length === 0) return;
    this.#syncWorldMatrices();
    const dead = this.phase === "dead";
    const minimum = dead ? this.#corpseLowestY(dt) : this.#lowestSkinY();
    if (minimum === null || !Number.isFinite(minimum)) return;
    const correction = deckY - minimum;
    // While the death clip is still playing the body must track the fall exactly, or it
    // hovers above its own pose. Only the settle that follows is damped, so the corpse
    // cannot twitch once it has come to rest.
    //
    // That settle is also one-way. `#settleDeath` rotates the legs down until the ankles
    // reach the deck, which puts the soles a few centimetres through it; grounding then
    // reads a body below the floor and lifts it, and the two ratchet the corpse into the air
    // at the damping rate. Once the fall has played out the body may only sink.
    const damped =
      dead && this.#groundInitialised && this.#deathClipFinished
        ? MathUtils.clamp(correction, -1 * dt, 0)
        : correction;
    // Grounding off still measures and reports; it just does not move the body.
    const wanted = this.groundSnap ? damped : 0;
    // A corpse settles onto the deck it fell on. Whatever the clip does with an arm that
    // swings through the floor, the body may never end up higher than the man was standing.
    const ceiling = this.#deathGroundCeiling;
    const applied =
      dead && ceiling !== null && this.groundSnap
        ? Math.min(wanted, ceiling - this.group.position.y)
        : wanted;
    this.group.position.y += applied;
    this.#syncWorldMatrices();
    // The estimate moves one-for-one with the group, so the settled height follows from the
    // correction that was actually applied. No second measurement is needed to read it back.
    const settled = minimum + applied;
    this.#bodyClearance = Math.abs(settled - deckY);
    this.#footClearance = Math.max(0, settled - deckY);
    this.#groundInitialised = true;
  }

  /** Compute a target leg orientation every frame, then approach it instead of applying a snap. */
  #settleDeath(dt: number, deckY: number): void {
    // `deathAnkleDelta` is the gate on B6, "the leg suddenly snaps". It has to measure the
    // motion *this correction* causes, not every ankle movement while dead — a raw
    // frame-to-frame delta also counts the authored fall, so the only way to pass it is to
    // stop animating the death, which is how the corpse ended up standing upright.
    const beforeLeft = this.#leftFoot?.getWorldPosition(new Vector3()).y;
    const beforeRight = this.#rightFoot?.getWorldPosition(new Vector3()).y;
    const alpha = 1 - Math.exp(-dt * 2.4);
    for (const [upLeg, foot] of [
      [this.#leftUpLeg, this.#leftFoot],
      [this.#rightUpLeg, this.#rightFoot],
    ] as const) {
      if (upLeg === undefined || foot === undefined || upLeg.parent === null) continue;
      this.#syncWorldMatrices();
      const hip = upLeg.getWorldPosition(new Vector3());
      const ankle = foot.getWorldPosition(new Vector3());
      const current = ankle.sub(hip);
      const length = current.length();
      if (length < 1e-4) continue;
      const desiredY = MathUtils.clamp(deckY + scale.ankleHeight - hip.y, -length, length);
      const horizontal = new Vector3(current.x, 0, current.z);
      if (horizontal.lengthSq() < 1e-6) horizontal.set(0, 0, 1);
      horizontal.setLength(Math.sqrt(Math.max(0, length * length - desiredY * desiredY)));
      const desired = horizontal.setY(desiredY);
      const worldDelta = new Quaternion().setFromUnitVectors(current.normalize(), desired.normalize());
      const parentWorld = upLeg.parent.getWorldQuaternion(new Quaternion());
      const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
      const target = localDelta.multiply(upLeg.quaternion.clone());
      upLeg.quaternion.slerp(target, alpha);
      upLeg.updateWorldMatrix(false, true);
    }
    const afterLeft = this.#leftFoot?.getWorldPosition(new Vector3()).y;
    const afterRight = this.#rightFoot?.getWorldPosition(new Vector3()).y;
    if (beforeLeft !== undefined && afterLeft !== undefined) {
      this.#deathAnkleDelta = Math.max(this.#deathAnkleDelta, Math.abs(afterLeft - beforeLeft));
    }
    if (beforeRight !== undefined && afterRight !== undefined) {
      this.#deathAnkleDelta = Math.max(this.#deathAnkleDelta, Math.abs(afterRight - beforeRight));
    }
    this.#deathSettleReady = true;
  }

  #engage(ctx: GameCtx, dt: number, playerEye: Vector3, hooks: EnemyHooks, sees: boolean): void {
    const chest = this.chest;
    const knownTarget = sees ? playerEye : this.#lastSeen;
    const aim = Math.atan2(knownTarget.x - chest.x, knownTarget.z - chest.z);
    const flatDistance = Math.hypot(playerEye.x - chest.x, playerEye.z - chest.z);

    this.#strafeTimer -= dt;
    if (this.#strafeTimer <= 0) {
      // A metronome flank is the loudest tell that this is a state machine. Vary it.
      this.#strafeTimer = 0.9 + ctx.random() * 1.4;
      this.#strafe = -this.#strafe;
    }

    // Stay low when hurt or when rounds are landing near him, and plant to shoot: nobody
    // sprints through their own burst. This is most of what separates a soldier from a turret
    // that happens to be walking.
    const firing = this.#burstLeft > 0;
    const crouched = this.wounded || this.#suppressed > 0;
    // Planted, not creeping. At 0.18 he still made 0.65 m/s under a firing clip that has both
    // feet nailed down — 16 frames of visible slide per engagement, measured. `#step` still runs,
    // so he decelerates into the plant over ~70 ms rather than stopping on the frame.
    const settle = firing ? 0 : crouched ? 0.72 : 1;
    let moved = false;

    if (this.#reaction > 0) {
      // Detection means pursuit immediately; tactical spacing begins only after reacting.
      moved = this.#step(dt, knownTarget.x, knownTarget.z, CHASE_SPEED * settle, false, crouched);
    } else {
      // Every later combat route is still derived from the player: close distance when far,
      // back off when rushed, and flank rather than running straight into the muzzle.
      const away = new Vector3(
        this.group.position.x - knownTarget.x,
        0,
        this.group.position.z - knownTarget.z,
      );
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      away.normalize();
      const desiredRange = flatDistance > ENGAGE_RANGE ? 10.5 : 9;
      const lateral = new Vector3(away.z, 0, -away.x).multiplyScalar(this.#strafe * 2.6);
      const combatGoal = new Vector3(knownTarget.x, 0, knownTarget.z)
        .addScaledVector(away, desiredRange)
        .add(lateral);
      moved = this.#step(
        dt,
        combatGoal.x,
        combatGoal.z,
        (flatDistance > ENGAGE_RANGE ? CHASE_SPEED : WALK_SPEED) * settle,
        false,
        crouched,
      );
    }
    // Facing is the engage branch's, not `#step`'s. Standing, he squares up on the player;
    // moving, he keeps the rifle as far round as the feet can carry without moonwalking, which
    // is a flanker who never takes his weapon off you rather than one who turns his back.
    const carry = moved
      ? this.#heading.value + MathUtils.clamp(
          angleDelta(this.#heading.value, aim),
          -AIM_LEAD_MAX,
          AIM_LEAD_MAX,
        )
      : aim;
    this.group.rotation.y = this.#facing.step(carry, dt, 1.25);
    // The firing clip owns the pose for as long as the burst lasts; locomotion resumes after.
    this.#playLocomotion(moved, crouched, dt, firing);

    this.#cooldown -= dt;
    this.#burstTimer -= dt;
    this.#reaction -= dt;
    if (this.#burstLeft > 0) {
      if (this.#burstTimer <= 0) {
        this.#burstLeft -= 1;
        this.#burstTimer = BURST_SPACING;
        // A round only reaches the player if the shot is actually clear. Firing through a
        // barricade was the loudest tell that this was a timer and not a soldier.
        const clear = hooks.lineOfSight(chest, playerEye);
        // A round that connects costs the full 9; the ones that go wide do not.
        // Seeded, so a replay of the same run takes the same damage.
        // Taking rounds spoils a shooter's aim. Without this he shoots exactly as well while
        // being hit as he does unopposed, which reads as a machine no matter how he moves.
        const composure = this.#suppressed > 0 ? 0.45 : 1;
        const accuracy = MathUtils.clamp((0.75 - flatDistance * 0.035) * composure, 0.05, 0.75);
        const muzzle = this.muzzle();
        const shotDirection = playerEye.clone().sub(muzzle).normalize();
        const missDirection = shotDirection.clone();
        if (ctx.random() >= accuracy) {
          missDirection.x += (ctx.random() - 0.5) * 0.16;
          missDirection.y += (ctx.random() - 0.5) * 0.1;
          missDirection.normalize();
        }
        if (clear && shotDirection.angleTo(missDirection) < 0.02) hooks.damagePlayer(ROUND_DAMAGE);
        hooks.onMuzzleFlash(muzzle, missDirection, playerEye.distanceTo(muzzle));
        // `#play` declines while a flinch is held, so a soldier hit mid-burst keeps the reaction
        // rather than having it stomped by the very next round 110 ms later.
        this.#play("FiringRifle", FIRE_FADE);
        if (this.#burstLeft === 0) {
          // Break contact for an irregular beat, longer when he is rattled. A fixed 3.2 s
          // gap between bursts is learnable within two engagements.
          this.#cooldown =
            BURST_COOLDOWN * (0.7 + ctx.random() * 0.6) + (this.#suppressed > 0 ? 0.9 : 0);
        }
      }
    } else if (sees && this.#cooldown <= 0 && this.#reaction <= 0) {
      // Bursts of two to four, not always three.
      this.#burstLeft = BURST_ROUNDS + Math.round((ctx.random() - 0.5) * 2);
      this.#burstTimer = 0;
    }

    if (!sees) {
      this.#burstLeft = 0;
      this.#alertTimer += dt;
      if (this.#alertTimer > 0.9) {
        this.phase = "search";
        this.#alertTimer = 0;
        this.#searchAtGoal = 0;
        this.#beginPursuit(this.#lastSeen);
      }
    }
  }

  debug(): {
    health: number;
    phase: EnemyPhase;
    position: number[];
    deadFor: number;
    armed: boolean;
    reaction: number;
    bodyClearance: number | null;
    footClearance: number | null;
    modelHeight: number;
    hitboxHeight: number;
    headZoneMinY: number;
    legZoneMaxY: number;
    underWalkway: boolean;
    deathObserved: boolean;
    deathAnkleDelta: number;
    wounded: boolean;
    suppressedPeak: number;
    crouchClipFrames: number;
    clipsPlayed: string[];
    groundSnap: boolean;
    deathFallDot: number | null;
    crouching: boolean;
    suppressed: number;
    animation: string | null;
    decelPeakMs2: number;
    groundSpeed: number;
    locomotionRate: number;
    locomotionRatePeak: number;
    clipGroundSpeed: number;
    strideErrorRatio: number;
    strideErrorPeak: number;
    deathRiseM: number;
    deathClip: string | null;
    deathClipFrames: number;
    clips: string[];
    envelopeErrorM: number | null;
    maxEnvelopeRadius: number;
    lastHitMultiplier: number;
    navigation: { goal: number[]; next: number[] | null; remaining: number };
    rifleForward: number[] | null;
    rifleForwardDot: number | null;
    clipMarkerDownDot: number | null;
    rifleLength: number | null;
    rightHandToGrip: number | null;
    leftHandToRifle: number | null;
    weaponNodes: string[];
    bodyJoints: Record<string, number[]>;
  } {
    this.#syncWorldMatrices();
    const weaponPose =
      this.#weapon === undefined || this.#weaponModel === undefined
        ? null
        : measureThreePose(this.#weapon, { bounds: false });
    const rifleForward =
      weaponPose === null ? null : new Vector3().fromArray(weaponPose.axes.z);
    const enemyForward = new Vector3(0, 0, 1)
      .applyQuaternion(this.group.getWorldQuaternion(this.group.quaternion.clone()))
      .normalize();
    const gripPosition = this.#grip?.getWorldPosition(new Vector3()) ?? null;
    const rightHandPosition = this.#rightHand?.getWorldPosition(new Vector3()) ?? null;
    const magazinePosition = this.#magazine?.getWorldPosition(new Vector3()) ?? null;
    const leftHandPosition = this.#leftHand?.getWorldPosition(new Vector3()) ?? null;
    const rifleStart = this.#weapon?.localToWorld(new Vector3(0, 0, this.#rifleLocalMinZ)) ?? null;
    const rifleEnd = this.#weapon?.localToWorld(new Vector3(0, 0, this.#rifleLocalMaxZ)) ?? null;
    const bodyJoints: Record<string, number[]> = {};
    for (const bone of this.#poseBones) {
      bodyJoints[bone.name] = [...measureThreePose(bone, { bounds: false }).position];
    }
    return {
      health: this.health,
      phase: this.phase,
      position: this.group.position.toArray(),
      deadFor: this.#deadFor,
      armed: this.#weapon !== undefined,
      reaction: this.#reaction,
      bodyClearance: this.#bodyClearance,
      footClearance: this.#footClearance,
      modelHeight: this.modelHeight,
      hitboxHeight: this.#hitboxHeight,
      headZoneMinY: this.headZoneMinY,
      legZoneMaxY: this.legZoneMaxY,
      underWalkway: this.#underDeck(),
      deathObserved: this.#deathObserved,
      deathAnkleDelta: this.#deathAnkleDelta,
      // A frozen corpse passes every settle gate trivially, so publish how far the death
      // clip actually advanced and let a scenario require that it played.
      wounded: this.wounded,
      suppressedPeak: this.#suppressedPeak,
      crouchClipFrames: this.#clipFrames.get("RifleCrouchWalk") ?? 0,
      // Every clip the rig has actually run, so an unused animation is visible to a scenario.
      clipsPlayed: [...this.#clipFrames.keys()].sort(),
      groundSnap: this.groundSnap,
      // Whichever death clip ran, the body must travel the way the round did — i.e. away from
      // the shooter. One number that catches DeathFront and DeathBack being swapped.
      deathFallDot: this.#deathFallMeasured,
      crouching: this.#crouchMoving,
      suppressed: this.#suppressed,
      animation: this.#animation?.current ?? null,
      // Locomotion honesty: how fast the body is going, how fast the clip is being played,
      // how far the clip carries the body at rate 1, and the ratio of the last two to the
      // first. `strideErrorPeak` is sticky because a scenario samples on step boundaries and
      // would otherwise miss the frames where the feet were skating hardest.
      decelPeakMs2: this.#decelPeak,
      groundSpeed: this.#groundSpeed,
      locomotionRate: this.#locomotionRate,
      // Sticky: a scenario samples on step boundaries and would otherwise land on an idle
      // frame and see rate 1, which is also what un-re-timed locomotion looks like.
      locomotionRatePeak: this.#locomotionRatePeak,
      clipGroundSpeed: this.#clipGroundSpeed.get(this.#locomotion) ?? 0,
      strideErrorRatio: this.#strideErrorRatio,
      strideErrorPeak: this.#strideErrorPeak,
      // Metres the corpse has climbed above the spot it was standing on when it died.
      // Negative means it settled, which is the only direction a body goes.
      deathRiseM:
        this.#deathGroundCeiling === null
          ? 0
          : this.group.position.y - this.#deathGroundCeiling,
      deathClip: this.#deathClip,
      deathClipFrames: this.#deathClipFrames,
      clips: [...this.#clips].sort(),
      // Ground truth for `footClearance`, which is otherwise reported from the cheap skin
      // envelope and would happily agree with itself. Off unless a probe asks: this is the
      // per-vertex `Box3` pass the envelope exists to avoid, and it costs a whole frame.
      envelopeErrorM: this.#groundingAudit(),
      maxEnvelopeRadius: this.#maxEnvelopeRadius,
      lastHitMultiplier: this.#lastHitMultiplier,
      navigation: {
        goal: this.#pathGoal.toArray(),
        next: this.#path[this.#pathIndex]?.toArray() ?? null,
        remaining: Math.max(0, this.#path.length - this.#pathIndex),
      },
      rifleForward: rifleForward?.toArray() ?? null,
      rifleForwardDot: rifleForward?.dot(enemyForward) ?? null,
      clipMarkerDownDot:
        magazinePosition === null || gripPosition === null
          ? null
          : magazinePosition.clone().sub(gripPosition).normalize().dot(new Vector3(0, -1, 0)),
      rifleLength: weaponPose === null ? null : this.#renderedRifleLength,
      rightHandToGrip:
        rightHandPosition === null || gripPosition === null
          ? null
          : rightHandPosition.distanceTo(gripPosition),
      leftHandToRifle:
        leftHandPosition === null || rifleStart === null || rifleEnd === null
          ? null
          : this.#distanceToSegment(leftHandPosition, rifleStart, rifleEnd),
      weaponNodes: this.#weaponNodes,
      bodyJoints,
    };
  }

  #distanceToSegment(point: Vector3, start: Vector3, end: Vector3): number {
    const segment = end.clone().sub(start);
    const lengthSquared = segment.lengthSq();
    if (lengthSquared === 0) return point.distanceTo(start);
    const t = MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSquared, 0, 1);
    return point.distanceTo(start.addScaledVector(segment, t));
  }

  dispose(): void {
    this.#animation?.dispose();
    this.#body?.dispose();
    this.#bodyProxy?.removeFromParent();
    this.group.removeFromParent();
  }
}
