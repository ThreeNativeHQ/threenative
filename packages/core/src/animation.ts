import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type Object3D,
} from "three";

export interface IAnimationPlayerOptions {
  readonly clips: readonly AnimationClip[];
  readonly root: Object3D;
}

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

  constructor(options: IAnimationPlayerOptions) {
    this.mixer = new AnimationMixer(options.root);
    for (const clip of options.clips) {
      if (this.#actions.has(clip.name)) throw new Error(`Duplicate animation clip '${clip.name}'.`);
      const action = this.mixer.clipAction(clip);
      if (action === null)
        throw new Error(`Animation clip '${clip.name}' could not create an action.`);
      this.#actions.set(clip.name, action);
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
    if (this.#current !== undefined && this.mixer.time !== before) this.#advancedFrames += 1;
  }

  stop(): void {
    this.mixer.stopAllAction();
    this.#current = undefined;
    this.#mode = "loop";
    this.#finished = false;
    this.#advancedFrames = 0;
    this.#fadeOut = [];
  }

  dispose(): void {
    this.stop();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
