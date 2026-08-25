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
   * says that it was overridden.
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

export interface IAnimationPlayOptions {
  readonly fade?: number;
  /** `"loop"` (default) repeats; `"once"` plays through and holds the last frame. */
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
  #clipGroundSpeed = new Map<string, number>();
  #strideSync: boolean;
  #strideRoot: Object3D;
  #lastRootPosition = new Vector3();
  #hasLastRootPosition = false;
  #stride: IStrideReport = {
    clipGroundSpeed: 0,
    groundSpeed: 0,
    overridden: false,
    rate: 1,
    synced: false,
  };

  constructor(options: IAnimationPlayerOptions) {
    this.mixer = new AnimationMixer(options.root);
    this.#strideSync = options.strideSync ?? true;
    this.#strideRoot = options.strideRoot ?? options.root;
    for (const clip of options.clips) {
      if (this.#actions.has(clip.name)) throw new Error(`Duplicate animation clip '${clip.name}'.`);
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
    const clipGroundSpeed = this.#groundSpeedOf(name);
    return clipGroundSpeed === this.#stride.clipGroundSpeed
      ? this.#stride
      : { ...this.#stride, clipGroundSpeed };
  }

  /** The clip behind a name, for a game that wants the action or the raw `AnimationClip`. */
  clip(name: string): AnimationClip {
    const clip = this.#clips.get(name);
    if (clip === undefined) throw new Error(`Unknown animation clip '${name}'.`);
    return clip;
  }

  /**
   * How much ground a clip carries per clip-second, measured from its own root track.
   *
   * Horizontal only: a jump's vertical arc is not stride. Measured once per clip and cached,
   * because it is a property of the asset and cannot change between frames.
   *
   * The track is found by name rather than by index — a rig's root translation is authored on
   * whichever node the exporter called the root, and the position tracks of fingers and props sit
   * in the same list. The longest horizontal displacement wins, which is the root by construction:
   * every other node's translation is relative to a parent that is already carrying it.
   */
  #groundSpeedOf(name: string): number {
    const cached = this.#clipGroundSpeed.get(name);
    if (cached !== undefined) return cached;
    const clip = this.#clips.get(name);
    let best = 0;
    if (clip !== undefined && clip.duration > 0) {
      for (const track of clip.tracks) {
        if (!track.name.endsWith(".position")) continue;
        const values = (track as VectorKeyframeTrack).values;
        let travelled = 0;
        for (let index = 3; index + 2 < values.length; index += 3) {
          const dx = (values[index] ?? 0) - (values[index - 3] ?? 0);
          const dz = (values[index + 2] ?? 0) - (values[index - 1] ?? 0);
          travelled += Math.hypot(dx, dz);
        }
        best = Math.max(best, travelled / clip.duration);
      }
    }
    this.#clipGroundSpeed.set(name, best);
    return best;
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
    const clipGroundSpeed = this.#groundSpeedOf(name);
    const groundSpeed = moved / dt;
    if (clipGroundSpeed < CLIP_GROUND_FLOOR) {
      // Not locomotion. An idle, a reload or a death is authored at the rate it is authored at,
      // and warping it by how fast the body happens to be sliding is a bug, not a convention.
      if (action.getEffectiveTimeScale() !== 1) action.setEffectiveTimeScale(1);
      this.#stride = {
        clipGroundSpeed,
        groundSpeed,
        overridden: false,
        rate: 1,
        synced: false,
      };
      return;
    }
    const wanted =
      groundSpeed < STRIDE_SPEED_FLOOR ? STRIDE_RATE_MIN : groundSpeed / clipGroundSpeed;
    const rate = Math.min(STRIDE_RATE_MAX, Math.max(STRIDE_RATE_MIN, wanted));
    if (this.#strideSync) action.setEffectiveTimeScale(rate);
    this.#stride = {
      clipGroundSpeed,
      groundSpeed,
      overridden: !this.#strideSync,
      rate,
      synced: this.#strideSync,
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
