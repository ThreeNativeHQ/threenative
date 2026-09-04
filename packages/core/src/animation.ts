import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type Object3D,
  Vector3,
  type VectorKeyframeTrack,
} from "three";

export interface IAnimationPlayerOptions {
  readonly clips: readonly AnimationClip[];
  readonly root: Object3D;
  /**
   * Match a travelling clip's playback rate to the ground the body actually covers.
   *
   * On by default, because a model whose feet do not agree with its motion is the single most
   * common thing wrong with a character in a game built here, and every game solves it the same
   * way. Set `false` to keep the authored rate; the measurement below stays live either way and
   * says that it was overridden. The convention re-times locomotion only: a `"once"` clip — a
   * death, a flinch — always plays at its authored rate.
   */
  readonly strideSync?: boolean;
  /**
   * The object whose travel counts as ground covered. Defaults to `root`.
   *
   * Name the body a game moves when the rig is a child of it, which is the usual shape: the clip
   * writes the model's own root track, so measuring the same object the mixer writes would read
   * the clip's motion back as if it were the body's.
   */
  readonly strideRoot?: Object3D;
}

/**
 * What the feet are doing against what the body is doing.
 *
 * Reported whether or not the convention is applied: turning a convention off must not turn its
 * measurement off, or a game that opted out has no way to know what it cost.
 */
export interface IStrideReport {
  /** Metres of ground the current clip carries per clip-second, at rate 1. Zero if it travels none. */
  readonly clipGroundSpeed: number;
  /** Metres per second the root has actually covered, smoothed over the last update. */
  readonly groundSpeed: number;
  /** The playback rate those two imply, clamped to `limits`. */
  readonly rate: number;
  /** True when that rate is being applied to the action. */
  readonly synced: boolean;
  /** True when a rate was measured and deliberately not applied. */
  readonly overridden: boolean;
  /**
   * True when the clip carries no root motion and its stride was read off the feet instead.
   *
   * `synced: false, overridden: false` is what an idle reports, so without this a game whose walk
   * cycle is silently going unmatched cannot tell itself apart from one with nothing to match. An
   * in-place clip that also yields no foot plant reports `inPlace: true` with a zero
   * `clipGroundSpeed`, which names the asset as the thing to fix.
   */
  readonly inPlace: boolean;
}

/**
 * The band a measured rate is held inside.
 *
 * A rig with one walk cycle cannot honestly represent a sprint or a crawl. Above the ceiling the
 * clip reads as a cartoon; at zero it freezes mid-stride while the body drifts, which is worse
 * than a slow cycle. Both ends are a property of the clip set, so both are the game's to move.
 */
const STRIDE_RATE_MIN = 0.15;
const STRIDE_RATE_MAX = 3;
/** Below this the body is standing, and a measured rate would be noise. */
const STRIDE_SPEED_FLOOR = 1e-4;
/** A clip carrying less ground than this per second is not locomotion. */
const CLIP_GROUND_FLOOR = 1e-3;
/** Poses taken across one cycle when reading an in-place clip's stride off its feet. */
const PLANT_SAMPLES = 64;
/** A contact bone is one that reaches this near the lowest point the rig visits. */
const CONTACT_BAND = 0.15;
/** Of a contact bone's own vertical arc, the bottom slice counts as planted. */
const PLANT_BAND = 0.3;

/** What one clip's own locomotion measured out at, cached per clip name. */
interface IClipStride {
  /** Metres of ground the clip carries per clip-second at rate 1. */
  readonly groundSpeed: number;
  /** True when no root track travelled and the number came from the feet — or from nothing. */
  readonly inPlace: boolean;
}

/**
 * The ground a clip's root track carries, per clip-second, in the track's own units.
 *
 * **Net** displacement, not distance walked. Summing every step's magnitude is what made a
 * swinging thigh outscore a still root: a limb that ends the cycle where it began has covered no
 * ground however far it waved, while a travelling root ends the cycle somewhere else — that is
 * what root motion *is*. Measured in `sandbox/wildwood`: `ANIM_DeerStag_Walk` scored 0.1287 under
 * the old sum (from `STAG_-R-Thigh`) and scores 0 under this one, which is the truth.
 */
function clipRootMotionSpeed(clip: AnimationClip): number {
  let best = 0;
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".position")) continue;
    const values = (track as VectorKeyframeTrack).values;
    if (values.length < 6) continue;
    const dx = (values[values.length - 3] ?? 0) - (values[0] ?? 0);
    const dz = (values[values.length - 1] ?? 0) - (values[2] ?? 0);
    best = Math.max(best, Math.hypot(dx, dz) / clip.duration);
  }
  return best;
}

/**
 * The ground an in-place clip was authored for, read off the feet, in world metres per clip-second.
 *
 * A planted foot sweeps backward relative to the body at exactly the speed the body is meant to be
 * travelling — that is what "planted" means — so the stance phase of a cycle states the clip's
 * speed even though nothing in it translates. Contact bones are found by where they go rather than
 * by what they are called: whatever reaches the bottom of the rig's arc is a foot, in any rig and
 * any language. The median over stance frames rejects the toe-off and heel-strike ends of the
 * sweep, and the median over feet rejects a limb that never plants.
 *
 * The rig is driven and then restored to the transforms it arrived with, once per clip.
 */
function footPlantSpeed(root: Object3D, clip: AnimationClip): number {
  const objects: Object3D[] = [];
  root.traverse((object) => objects.push(object));
  const restore = objects.map((object) => ({
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  }));

  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const paths = objects.map(() => [] as { x: number; y: number; z: number }[]);
  const step = clip.duration / PLANT_SAMPLES;
  try {
    for (let frame = 0; frame <= PLANT_SAMPLES; frame += 1) {
      mixer.setTime(frame * step);
      root.updateMatrixWorld(true);
      for (let index = 0; index < objects.length; index += 1) {
        (objects[index] as Object3D).getWorldPosition(scratchWorld);
        (paths[index] as { x: number; y: number; z: number }[]).push({
          x: scratchWorld.x,
          y: scratchWorld.y,
          z: scratchWorld.z,
        });
      }
    }
  } finally {
    action.stop();
    mixer.uncacheClip(clip);
    for (const entry of restore) {
      entry.object.position.copy(entry.position);
      entry.object.quaternion.copy(entry.quaternion);
      entry.object.scale.copy(entry.scale);
    }
    root.updateMatrixWorld(true);
  }

  const rootPath = paths[0];
  if (rootPath === undefined) return 0;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const path of paths)
    for (const point of path) {
      lowest = Math.min(lowest, point.y);
      highest = Math.max(highest, point.y);
    }
  const height = highest - lowest;
  if (!(height > 0)) return 0;

  const speeds: number[] = [];
  for (const path of paths) {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const point of path) {
      low = Math.min(low, point.y);
      high = Math.max(high, point.y);
    }
    // A contact bone visits the floor and lifts off it again. One that never descends is not a
    // foot, and one that never rises is a stationary prop rather than a cycling limb.
    if (low > lowest + height * CONTACT_BAND) continue;
    const arc = high - low;
    if (!(arc > height * CLIP_GROUND_FLOOR)) continue;
    const planted = low + arc * PLANT_BAND;
    const rates: number[] = [];
    for (let frame = 1; frame < path.length; frame += 1) {
      const previous = path[frame - 1] as { x: number; y: number; z: number };
      const current = path[frame] as { x: number; y: number; z: number };
      if (current.y > planted || previous.y > planted) continue;
      const anchor = rootPath[frame] as { x: number; y: number; z: number };
      const before = rootPath[frame - 1] as { x: number; y: number; z: number };
      const dx = current.x - anchor.x - (previous.x - before.x);
      const dz = current.z - anchor.z - (previous.z - before.z);
      rates.push(Math.hypot(dx, dz) / step);
    }
    if (rates.length < 4) continue;
    rates.sort((first, second) => first - second);
    speeds.push(rates[Math.floor(rates.length / 2)] as number);
  }
  if (speeds.length === 0) return 0;
  speeds.sort((first, second) => first - second);
  return speeds[Math.floor(speeds.length / 2)] as number;
}

export interface IAnimationPlayOptions {
  readonly fade?: number;
  /**
   * `"loop"` (default) repeats; `"once"` plays through and holds the last frame. A `"once"` clip
   * also keeps its authored rate — stride sync re-times locomotion, not events.
   */
  readonly mode?: "loop" | "once";
}

type AnimationMode = "loop" | "once";

export class AnimationPlayer {
  readonly mixer: AnimationMixer;
  #actions = new Map<string, AnimationAction>();
  #current: string | undefined;
  #mode: AnimationMode = "loop";
  #advancedFrames = 0;
  #finished = false;
  #fadeOut: { action: AnimationAction; from: number }[] = [];
  #fadeElapsed = 0;
  #fadeDuration = 0;
  #clips = new Map<string, AnimationClip>();
  #clipGroundSpeed = new Map<string, IClipStride>();
  #strideSync: boolean;
  #strideRoot: Object3D;
  #lastRootPosition = new Vector3();
  #hasLastRootPosition = false;
  #stride: IStrideReport = {
    clipGroundSpeed: 0,
    groundSpeed: 0,
    inPlace: false,
    overridden: false,
    rate: 1,
    synced: false,
  };

  constructor(options: IAnimationPlayerOptions) {
    this.mixer = new AnimationMixer(options.root);
    this.#strideSync = options.strideSync ?? true;
    this.#strideRoot = options.strideRoot ?? options.root;
    for (const clip of options.clips) {
      if (this.#actions.has(clip.name))
        // Two clip sources on one rig is the normal way to assemble a character's vocabulary, and
        // stock libraries all ship a bind pose under the same name. Failing closed is right — a
        // silently dropped clip is a pose bug nobody thinks to look for — but the message says
        // what to do about it, because every game that loads two `.glb` files hits this.
        throw new Error(
          `Duplicate animation clip '${clip.name}'. Two clip sources define it; keep one per name before constructing the player.`,
        );
      const action = this.mixer.clipAction(clip);
      if (action === null)
        throw new Error(`Animation clip '${clip.name}' could not create an action.`);
      this.#actions.set(clip.name, action);
      this.#clips.set(clip.name, clip);
    }
    this.mixer.addEventListener("finished", ({ action }) => {
      if (action === this.#actions.get(this.#current ?? "")) this.#finished = true;
    });
  }

  get current(): string | undefined {
    return this.#current;
  }

  get advancedFrames(): number {
    return this.#advancedFrames;
  }

  /** True when a `"once"` clip has reached its end and is holding. */
  get finished(): boolean {
    return this.#finished;
  }

  /**
   * What the feet are doing against what the body is doing, as of the last `update`.
   *
   * Live whether or not the convention is applied. A game that set `strideSync: false` reads
   * `overridden: true` here next to the rate it declined, which is the only way an override can
   * be honest about what it turned off.
   */
  get stride(): IStrideReport {
    const name = this.#current;
    if (name === undefined) return this.#stride;
    // Derived on read so a clip's own ground speed is answerable the moment it is played, before
    // any frame has advanced. It is a property of the asset, and cached.
    const measured = this.#measureOf(name);
    return measured.groundSpeed === this.#stride.clipGroundSpeed &&
      measured.inPlace === this.#stride.inPlace
      ? this.#stride
      : { ...this.#stride, clipGroundSpeed: measured.groundSpeed, inPlace: measured.inPlace };
  }

  /** The clip behind a name, for a game that wants the action or the raw `AnimationClip`. */
  clip(name: string): AnimationClip {
    const clip = this.#clips.get(name);
    if (clip === undefined) throw new Error(`Unknown animation clip '${name}'.`);
    return clip;
  }

  /**
   * How much ground a clip carries per clip-second, in the world's metres.
   *
   * Horizontal only: a jump's vertical arc is not stride. Measured once per clip and cached,
   * because it is a property of the asset and cannot change between frames.
   *
   * Root motion first, feet second. Most game locomotion is authored **in place** — every ActorX
   * and Unreal export, every Mixamo "in place" clip, every stock animal pack — and a convention
   * that only works on the travelling minority is a convention that does not work.
   */
  #measureOf(name: string): IClipStride {
    const cached = this.#clipGroundSpeed.get(name);
    if (cached !== undefined) return cached;
    const clip = this.#clips.get(name);
    let measured: IClipStride = { groundSpeed: 0, inPlace: true };
    if (clip !== undefined && clip.duration > 0) {
      const rootMotion = clipRootMotionSpeed(clip);
      measured =
        rootMotion >= CLIP_GROUND_FLOOR
          ? { groundSpeed: rootMotion * this.#trackScale(), inPlace: false }
          : { groundSpeed: footPlantSpeed(this.mixer.getRoot() as Object3D, clip), inPlace: true };
    }
    this.#clipGroundSpeed.set(name, measured);
    return measured;
  }

  #groundSpeedOf(name: string): number {
    return this.#measureOf(name).groundSpeed;
  }

  /**
   * What one unit of a root track is worth in world metres.
   *
   * A clip's translation values are in the animated node's **parent** space, while the ground the
   * body covers is measured in world metres. `normaliseToMetres` — the framework's own convention
   * for sizing an import — all but guarantees the two differ, and a half-scale rig compared
   * without this reads its own stride at twice the speed. The foot-plant path below needs no such
   * conversion: it reads world positions, which already carry every ancestor's scale.
   */
  #trackScale(): number {
    const root = this.mixer.getRoot() as Object3D;
    (root.parent ?? root).getWorldScale(scratchScale);
    return (Math.abs(scratchScale.x) + Math.abs(scratchScale.z)) / 2;
  }

  /**
   * Hold the current clip's playback rate against the ground the body just covered.
   *
   * Called after `mixer.update`, from the root's world position, so it reads the movement a game
   * already applied this frame rather than asking the game to report it. A game that drives the
   * same object from the clip's own root motion has the two ends of this loop joined and should
   * turn the convention off; that is what the option is for.
   */
  #syncStride(dt: number): void {
    const name = this.#current;
    const action = name === undefined ? undefined : this.#actions.get(name);
    this.#strideRoot.getWorldPosition(scratchWorld);
    const previous = this.#lastRootPosition;
    const moved = this.#hasLastRootPosition
      ? Math.hypot(scratchWorld.x - previous.x, scratchWorld.z - previous.z)
      : 0;
    this.#lastRootPosition.copy(scratchWorld);
    this.#hasLastRootPosition = true;
    if (name === undefined || action === undefined || dt <= 0) return;
    const measured = this.#measureOf(name);
    const clipGroundSpeed = measured.groundSpeed;
    const groundSpeed = moved / dt;
    if (clipGroundSpeed < CLIP_GROUND_FLOOR) {
      // Not locomotion. An idle, a reload or a death is authored at the rate it is authored at,
      // and warping it by how fast the body happens to be sliding is a bug, not a convention.
      if (action.getEffectiveTimeScale() !== 1) action.setEffectiveTimeScale(1);
      this.#stride = {
        clipGroundSpeed,
        groundSpeed,
        inPlace: measured.inPlace,
        overridden: false,
        rate: 1,
        synced: false,
      };
      return;
    }
    const wanted =
      groundSpeed < STRIDE_SPEED_FLOOR ? STRIDE_RATE_MIN : groundSpeed / clipGroundSpeed;
    const rate = Math.min(STRIDE_RATE_MAX, Math.max(STRIDE_RATE_MIN, wanted));
    // A `"once"` clip is an event — a death, a flinch, a reload — and plays at the rate the
    // event happens at, however still the body stands: its own root motion is the movement, so
    // re-timing it against a stationary body only slows the event down. A travelling death clip
    // clamped to the rate floor held a corpse upright through its whole death in the sandbox.
    const applies = this.#strideSync && this.#mode === "loop";
    if (applies) action.setEffectiveTimeScale(rate);
    this.#stride = {
      clipGroundSpeed,
      groundSpeed,
      inPlace: measured.inPlace,
      overridden: !this.#strideSync,
      rate,
      synced: applies,
    };
  }

  #playAction(action: AnimationAction, mode: AnimationMode, weight: number): void {
    const once = mode === "once";
    action
      .reset()
      .setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Number.POSITIVE_INFINITY)
      .setEffectiveWeight(weight)
      .play();
    action.clampWhenFinished = once;
  }

  #replayCurrent(action: AnimationAction, mode: AnimationMode): void {
    for (const entry of this.#fadeOut) entry.action.stop();
    this.#fadeOut = [];
    for (const other of this.#actions.values()) {
      if (other !== action) other.setEffectiveWeight(0).stop();
    }
    this.#playAction(action, mode, 1);
    this.#mode = mode;
    this.#finished = false;
    this.#advancedFrames = 0;
  }

  #playCurrent(action: AnimationAction, requestedMode: AnimationMode | undefined): void {
    const mode = requestedMode ?? "loop";
    if (!this.#finished && mode === this.#mode) return;
    this.#replayCurrent(action, mode);
  }

  #playNext(name: string, next: AnimationAction, options: IAnimationPlayOptions): void {
    const previous = this.#current === undefined ? undefined : this.#actions.get(this.#current);
    const fade = Math.max(0, options.fade ?? 0);
    const once = options.mode === "once";

    // Every clip still contributing ramps out together, from the weight it currently holds.
    //
    // This used to hard-stop anything that was not `previous` and force `previous` to weight 1.
    // Interrupting a blend therefore dropped the older clip's contribution in a single frame
    // and snapped the outgoing clip up to full — a visible pop, and one that appeared only when
    // transitions came faster than the fade, which is exactly when a character is reacting.
    const outgoing: { action: AnimationAction; from: number }[] = [];
    for (const action of this.#actions.values()) {
      if (action === next) continue;
      const weight = action.getEffectiveWeight();
      if (weight > 1e-4) outgoing.push({ action, from: weight });
      else action.setEffectiveWeight(0).stop();
    }
    if (previous !== undefined && !outgoing.some((entry) => entry.action === previous)) {
      previous.setEffectiveWeight(1).play();
      outgoing.push({ action: previous, from: 1 });
    }

    this.#playAction(next, once ? "once" : "loop", fade > 0 && outgoing.length > 0 ? 0 : 1);
    if (outgoing.length === 0 || fade === 0) {
      for (const entry of outgoing) entry.action.setEffectiveWeight(0).stop();
      this.#fadeOut = [];
    } else {
      for (const entry of outgoing) entry.action.play();
      this.#fadeOut = outgoing;
      this.#fadeElapsed = 0;
      this.#fadeDuration = fade;
    }
    this.#current = name;
    this.#mode = once ? "once" : "loop";
    this.#finished = false;
    this.#advancedFrames = 0;
  }

  play(name: string, options: IAnimationPlayOptions = {}): void {
    const next = this.#actions.get(name);
    if (next === undefined) throw new Error(`Unknown animation clip '${name}'.`);
    if (this.#current === name) {
      this.#playCurrent(next, options.mode);
      return;
    }
    this.#playNext(name, next, options);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("AnimationPlayer.update requires a finite non-negative dt.");
    // Read before mixer.update(): the "finished" listener fires inside it for a completing
    // once-clip, and that final frame still counts as advancement.
    const wasFinished = this.#finished;
    const before = this.mixer.time;
    this.mixer.update(dt);
    if (this.#fadeOut.length > 0) {
      this.#fadeElapsed = Math.min(this.#fadeDuration, this.#fadeElapsed + dt);
      const linear = this.#fadeDuration === 0 ? 1 : this.#fadeElapsed / this.#fadeDuration;
      // Smoothstep rather than linear. A linear weight ramp changes the pose's velocity
      // instantly at both ends, which reads as a corner on the character even when the fade
      // duration is right.
      const progress = linear * linear * (3 - 2 * linear);
      for (const entry of this.#fadeOut) {
        entry.action.setEffectiveWeight(entry.from * (1 - progress));
      }
      this.#actions.get(this.#current ?? "")?.setEffectiveWeight(progress);
      if (linear >= 1) {
        for (const entry of this.#fadeOut) entry.action.setEffectiveWeight(0).stop();
        this.#fadeOut = [];
      }
    }
    // three advances mixer.time unconditionally, finished or not: past a held last frame the
    // pose is frozen, so counting there would report idle frames as animation progress.
    if (this.#current !== undefined && !wasFinished && this.mixer.time !== before)
      this.#advancedFrames += 1;
    this.#syncStride(dt);
  }

  stop(): void {
    this.mixer.stopAllAction();
    this.#current = undefined;
    this.#mode = "loop";
    this.#finished = false;
    this.#advancedFrames = 0;
    this.#fadeOut = [];
    this.#resetStride();
  }

  #resetStride(): void {
    this.#hasLastRootPosition = false;
    this.#stride = {
      clipGroundSpeed: 0,
      groundSpeed: 0,
      inPlace: false,
      overridden: false,
      rate: 1,
      synced: false,
    };
  }

  dispose(): void {
    this.stop();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}

/** Reused so a per-frame stride read costs no allocation. See PRD-189. */
const scratchWorld = new Vector3();
const scratchScale = new Vector3();
