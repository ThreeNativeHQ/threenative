import { type AnimationAction, type AnimationClip, AnimationMixer, type Object3D } from "three";

export interface AnimationPlayerOptions {
  readonly clips: readonly AnimationClip[];
  readonly root: Object3D;
}

export interface AnimationPlayOptions {
  readonly fade?: number;
}

export class AnimationPlayer {
  readonly mixer: AnimationMixer;
  #actions = new Map<string, AnimationAction>();
  #current: string | undefined;
  #advancedFrames = 0;
  #fadeFrom: AnimationAction | undefined;
  #fadeElapsed = 0;
  #fadeDuration = 0;

  constructor(options: AnimationPlayerOptions) {
    this.mixer = new AnimationMixer(options.root);
    for (const clip of options.clips) {
      if (this.#actions.has(clip.name)) throw new Error(`Duplicate animation clip '${clip.name}'.`);
      const action = this.mixer.clipAction(clip);
      if (action === null)
        throw new Error(`Animation clip '${clip.name}' could not create an action.`);
      this.#actions.set(clip.name, action);
    }
  }

  get current(): string | undefined {
    return this.#current;
  }

  get advancedFrames(): number {
    return this.#advancedFrames;
  }

  play(name: string, options: AnimationPlayOptions = {}): void {
    const next = this.#actions.get(name);
    if (next === undefined) throw new Error(`Unknown animation clip '${name}'.`);
    if (this.#current === name) return;
    const previous = this.#current === undefined ? undefined : this.#actions.get(this.#current);
    const fade = Math.max(0, options.fade ?? 0);
    for (const action of this.#actions.values()) {
      if (action !== previous) action.setEffectiveWeight(0).stop();
    }
    previous?.setEffectiveWeight(1).play();
    next
      .reset()
      .setEffectiveWeight(fade > 0 && previous !== undefined ? 0 : 1)
      .play();
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
    this.#advancedFrames = 0;
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
    this.#advancedFrames = 0;
    this.#fadeFrom = undefined;
  }

  dispose(): void {
    this.stop();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
