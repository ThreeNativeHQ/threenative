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
  #fadeFrom: AnimationAction | undefined;
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
    this.#fadeFrom?.stop();
    this.#fadeFrom = undefined;
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
    for (const action of this.#actions.values()) {
      if (action !== previous) action.setEffectiveWeight(0).stop();
    }
    previous?.setEffectiveWeight(1).play();
    this.#playAction(next, once ? "once" : "loop", fade > 0 && previous !== undefined ? 0 : 1);
    if (previous === undefined || fade === 0) {
      previous?.stop();
      this.#fadeFrom = undefined;
    } else {
      previous.play();
      this.#fadeFrom = previous;
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
    if (this.#fadeFrom !== undefined) {
      this.#fadeElapsed = Math.min(this.#fadeDuration, this.#fadeElapsed + dt);
      const progress = this.#fadeDuration === 0 ? 1 : this.#fadeElapsed / this.#fadeDuration;
      this.#fadeFrom.setEffectiveWeight(1 - progress);
      this.#actions.get(this.#current ?? "")?.setEffectiveWeight(progress);
      if (progress >= 1) {
        this.#fadeFrom.stop();
        this.#fadeFrom = undefined;
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
    this.#fadeFrom = undefined;
  }

  dispose(): void {
    this.stop();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
