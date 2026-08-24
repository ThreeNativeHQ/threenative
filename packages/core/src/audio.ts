import { AudioListener, Object3D, PositionalAudio, Audio as ThreeAudio, type Vector3 } from "three";

export interface IAudioBusOptions {
  readonly camera: Object3D;
  readonly gestureTarget?: EventTarget;
  readonly listener?: AudioListener;
  readonly source?: () => EventTarget | undefined;
  /**
   * Ceiling on simultaneously sounding one-shots. Past it the oldest voice is stopped and its
   * slot reused: a firefight generates far more cues than a listener can resolve, and the newest
   * event is always the one they need to hear. Looping voices from `music` are exempt.
   * Defaults to 48.
   */
  readonly maxVoices?: number;
}

export interface IAudioPlayOptions {
  readonly fade?: number;
  readonly loop?: boolean;
  readonly volume?: number;
  /**
   * Metres from the source where positional attenuation begins; `playAt` only. Three's panner
   * default of 1 m makes a shot 20 m away all but inaudible — raise this to keep mid-distance
   * sounds loud. Must be finite and positive.
   */
  readonly refDistance?: number;
  /**
   * How fast volume falls off past `refDistance`; `playAt` only. 0 keeps the sound at full
   * volume at any distance. Must be finite and non-negative.
   */
  readonly rolloffFactor?: number;
  /**
   * Pitch offset in cents; ±100 is a semitone. Applied before the first sample rather than
   * through three's `setDetune`, which ramps over ~30 ms and turns a percussive attack into an
   * audible sweep. A few dozen cents of per-shot spread is what stops a repeated sample
   * comb-filtering with its own copies into a metallic buzz.
   */
  readonly detune?: number;
  /**
   * Seconds of the buffer to pass before an exponential cut-off. A 1.4 s gunshot fired ten times
   * a second stacks fourteen overlapping tails into mush; truncating all but the last keeps the
   * transient and drops the wash. Must be finite and positive.
   */
  readonly cutoffSeconds?: number;
  /**
   * Low-pass corner in Hz. Air and geometry eat the top of a sound as it crosses a space, and a
   * sample played flat at every range is the loudest tell that a game's audio is not in a place.
   * Must be finite and positive.
   */
  readonly lowpassHz?: number;
}

export interface IAudioRuntimeSnapshot {
  readonly queued: number;
  readonly voices: number;
  /** Retired voices held for reuse. Bounded by peak concurrency, never by session length. */
  readonly pooled: number;
}

const buses = new Set<AudioBus>();

const DEFAULT_MAX_VOICES = 48;
const GESTURE_EVENTS = ["keydown", "pointerdown", "touchstart"] as const;
/** Above 20 kHz a low-pass is inaudible, so this doubles as "no filter". */
const OPEN_LOWPASS_HZ = 20_000;

/**
 * Every voice this bus has ever played, one-shot or looping, positional or flat.
 *
 * A voice is recycled rather than rebuilt. Each one owns a `GainNode`, a `PannerNode` when it is
 * positional, and an `Object3D` in whatever scene graph it was parented into; minting a fresh set
 * per cue and abandoning them is unbounded growth in three places at once — scene children walked
 * every frame, nodes left connected to the listener, and garbage produced on the hottest path a
 * game has. A shooter emits hundreds of footsteps, shots and impacts a minute, so that growth is
 * measured in a single round, not over a session.
 *
 * The pool is bounded by peak concurrency: a bus that never plays more than eight cues at once
 * holds eight voices forever, whatever its uptime.
 */
type PooledVoice = {
  voice: ThreeAudio<AudioNode>;
  /** Context time playback began; the stealing policy sorts on it. */
  startedAt: number;
  /** Built on this voice's first filtered cue and retuned after, never rebuilt. */
  filter: BiquadFilterNode | undefined;
  /** Looping voices are exempt from stealing and never self-retire. */
  looping: boolean;
  /**
   * Which free list this voice goes back to. Recorded at construction rather than sniffed:
   * three's `PositionalAudio` carries no `isPositionalAudio` marker, so a duck-typed check
   * silently files every panner on the flat list and the pool never reuses one.
   */
  positional: boolean;
};

export class AudioBus {
  readonly listener: AudioListener;
  #camera: Object3D;
  #gestureTarget: EventTarget | undefined;
  #gesture: (() => void) | undefined;
  #queue: Array<{ start: () => void; voice: ThreeAudio<AudioNode> }> = [];
  #voices = new Set<ThreeAudio<AudioNode>>();
  /** Sounding voices, in start order, so the oldest can be stolen without a scan. */
  #live: PooledVoice[] = [];
  /** Retired voices ready to sound again, split by kind: a panner cannot be un-built. */
  #freeFlat: PooledVoice[] = [];
  #freePositional: PooledVoice[] = [];
  #maxVoices: number;
  #unlocked = false;
  #disposed = false;

  constructor(options: IAudioBusOptions) {
    const maxVoices = options.maxVoices ?? DEFAULT_MAX_VOICES;
    if (!Number.isInteger(maxVoices) || maxVoices < 1)
      throw new RangeError("maxVoices must be a positive integer.");
    this.#maxVoices = maxVoices;
    this.#camera = options.camera;
    this.listener = options.listener ?? new AudioListener();
    const source = options.source ?? (() => (typeof window === "undefined" ? undefined : window));
    this.#gestureTarget = options.gestureTarget ?? source();
    this.setCamera(options.camera);
    this.#gesture = () => {
      void this.unlock().catch(() => undefined);
    };
    for (const event of GESTURE_EVENTS) {
      this.#gestureTarget?.addEventListener(event, this.#gesture);
    }
    buses.add(this);
  }

  get queued(): number {
    return this.#queue.length;
  }

  get voices(): number {
    return this.#voices.size;
  }

  /**
   * Retired voices held for reuse. This is the number that used to climb without limit: it is
   * now bounded by how many cues have ever sounded at once, so a gate can pin it.
   */
  get pooled(): number {
    return this.#freeFlat.length + this.#freePositional.length;
  }

  setCamera(camera: Object3D): void {
    this.#camera = camera;
    camera.add(this.listener);
  }

  async unlock(): Promise<void> {
    if (this.#disposed || this.#unlocked) return;
    const context = this.listener.context as AudioContext & { resume?: () => Promise<void> };
    if (context.resume !== undefined) await context.resume();
    this.#unlocked = true;
    const queued = this.#queue.splice(0);
    for (const { start } of queued) start();
  }

  /**
   * A cue with no place: the listener's own weapon, UI, narration.
   *
   * The returned voice is valid for as long as it is sounding. Once it ends the bus reclaims it
   * and may hand the same object to a later cue, so a caller holding the reference past that
   * point is addressing somebody else's sound. Read `isPlaying` before touching a voice you kept.
   */
  play(buffer: AudioBuffer, options: IAudioPlayOptions = {}): ThreeAudio {
    assertBuffer(buffer);
    assertOptions(options);
    const entry = this.#claimFlat(options.loop ?? false);
    const voice = entry.voice as ThreeAudio;
    configureVoice(voice, options);
    voice.setBuffer(buffer);
    this.#queueOrStart(entry, options);
    return voice;
  }

  /**
   * A cue somewhere in the world, at a fixed point or riding a moving object.
   *
   * A `Vector3` source is read in the coordinate space of the camera's parent, which is the
   * scene in the ordinary case. Pass an `Object3D` to weld the cue to something that moves.
   *
   * The same reclaim rule as `play` applies to the returned voice.
   */
  playAt(
    buffer: AudioBuffer,
    source: Object3D | Vector3,
    options: IAudioPlayOptions = {},
  ): PositionalAudio {
    assertBuffer(buffer);
    assertOptions(options);
    if (typeof (this.listener.context as { createPanner?: unknown }).createPanner !== "function")
      throw new Error("AudioBus.playAt needs createPanner(); this runtime has none.");
    const entry = this.#claimPositional(options.loop ?? false);
    const voice = entry.voice as PositionalAudio;
    configureVoice(voice, options);
    // A recycled voice carries the previous cue's falloff, so both are restated every time
    // rather than only when the caller supplies them.
    voice.setRefDistance(options.refDistance ?? 1);
    voice.setRolloffFactor(options.rolloffFactor ?? 1);
    voice.setBuffer(buffer);
    if (source instanceof Object3D) source.add(voice);
    else {
      voice.position.copy(source);
      (this.#camera.parent ?? this.#camera).add(voice);
      // The panner reads its position off the world matrix, and this voice moved after the
      // renderer's last update. Without this the cue plays where the slot last sounded.
      voice.updateMatrixWorld(true);
    }
    this.#queueOrStart(entry, options);
    return voice;
  }

  music(buffer: AudioBuffer, options: IAudioPlayOptions = {}): ThreeAudio {
    return this.play(buffer, { ...options, loop: options.loop ?? true });
  }

  stop(): void {
    for (const { voice } of this.#queue) voice.removeFromParent();
    this.#queue = [];
    for (const entry of this.#live.splice(0)) this.#retire(entry);
    this.#voices.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stop();
    // `stop` retires the live voices; `#retire` short-circuits its free-list push once disposed,
    // so the only thing left is to unhook the ones already parked there.
    for (const entry of [...this.#freeFlat, ...this.#freePositional]) {
      entry.voice.removeFromParent();
      entry.filter?.disconnect();
    }
    this.#freeFlat = [];
    this.#freePositional = [];
    this.listener.removeFromParent();
    for (const event of GESTURE_EVENTS) {
      if (this.#gesture !== undefined)
        this.#gestureTarget?.removeEventListener(event, this.#gesture);
    }
    buses.delete(this);
  }

  #queueOrStart(entry: PooledVoice, options: IAudioPlayOptions): void {
    const start = () => this.#start(entry, options);
    if (this.#unlocked) start();
    else this.#queue.push({ start, voice: entry.voice });
  }

  #start(entry: PooledVoice, options: IAudioPlayOptions): void {
    if (this.#disposed) return;
    const voice = entry.voice;
    const volume = options.volume ?? 1;
    const fade = options.fade;
    this.#applyFilter(entry, options.lowpassHz ?? OPEN_LOWPASS_HZ);
    voice.play();
    const now = this.listener.context.currentTime;
    entry.startedAt = now;
    // Gain is driven by automation rather than `setVolume`, because a recycled voice can still
    // carry a scheduled ramp from a cut-off cue, and a scheduled ramp beats a plain value write.
    const gain = voice.gain.gain;
    gain.cancelScheduledValues?.(now);
    if (fade !== undefined && fade > 0) {
      gain.setValueAtTime(0, now);
      gain.linearRampToValueAtTime(volume, now + fade);
    } else {
      gain.setValueAtTime(volume, now);
    }
    const source = voice.source as
      | (AudioNode & { onended?: (() => void) | null; detune?: AudioParam })
      | null;
    const detune = options.detune ?? 0;
    if (detune !== 0 && source?.detune !== undefined) {
      // `setDetune` ramps over ~30 ms. On a percussive attack that is an audible pitch sweep,
      // and de-phasing the attack is the entire point, so it has to land before the first sample.
      source.detune.cancelScheduledValues?.(now);
      source.detune.setValueAtTime(detune, now);
    }
    const cutoff = options.cutoffSeconds;
    if (cutoff !== undefined && cutoff > 0 && !entry.looping) {
      // Exponential, not linear: a linear cut across a decaying tail clicks, and `setTargetAtTime`
      // follows the shape the tail already has.
      gain.setTargetAtTime?.(0, now + cutoff, 0.045);
    }
    this.#voices.add(voice);
    this.#live.push(entry);
    if (source !== null && "onended" in source) {
      const onended = source.onended;
      source.onended = () => {
        onended?.();
        this.#reclaim(entry);
      };
    }
    this.#enforceCeiling();
  }

  /** Oldest one-shot first, so a burst of new cues never silences itself waiting for old ones. */
  #enforceCeiling(): void {
    if (this.#live.length <= this.#maxVoices) return;
    for (let index = 0; index < this.#live.length && this.#live.length > this.#maxVoices; ) {
      const entry = this.#live[index];
      if (entry === undefined || entry.looping) {
        index += 1;
        continue;
      }
      this.#live.splice(index, 1);
      this.#retire(entry);
    }
  }

  /** A voice that ran out on its own: out of the graph, back on the free list. */
  #reclaim(entry: PooledVoice): void {
    const index = this.#live.indexOf(entry);
    if (index === -1) return;
    this.#live.splice(index, 1);
    this.#retire(entry);
  }

  #retire(entry: PooledVoice): void {
    const voice = entry.voice;
    try {
      if (voice.isPlaying) voice.stop();
    } catch {}
    this.#voices.delete(voice);
    // Out of whatever scene graph it was parented into. Skipping this is the whole bug: the
    // object outlives its sound and the scene grows for as long as the game runs.
    voice.removeFromParent();
    voice.setLoop(false);
    entry.looping = false;
    if (this.#disposed) return;
    const free = entry.positional ? this.#freePositional : this.#freeFlat;
    if (!free.includes(entry)) free.push(entry);
  }

  #claimFlat(looping: boolean): PooledVoice {
    const reused = this.#freeFlat.pop();
    if (reused !== undefined) {
      reused.looping = looping;
      return reused;
    }
    return {
      voice: new ThreeAudio(this.listener),
      startedAt: 0,
      filter: undefined,
      looping,
      positional: false,
    };
  }

  #claimPositional(looping: boolean): PooledVoice {
    const reused = this.#freePositional.pop();
    if (reused !== undefined) {
      reused.looping = looping;
      return reused;
    }
    return {
      voice: new PositionalAudio(this.listener),
      startedAt: 0,
      filter: undefined,
      looping,
      positional: true,
    };
  }

  /**
   * Air absorption. One `BiquadFilterNode` is built on a voice's first filtered cue and retuned
   * thereafter, so filtering costs one extra node per voice for the life of the bus rather than
   * one per sound.
   */
  #applyFilter(entry: PooledVoice, hz: number): void {
    const voice = entry.voice;
    if (hz >= OPEN_LOWPASS_HZ) {
      if (voice.filters.length > 0) voice.setFilters([]);
      return;
    }
    const context = this.listener.context as AudioContext & {
      createBiquadFilter?: () => BiquadFilterNode;
    };
    if (entry.filter === undefined) {
      if (context.createBiquadFilter === undefined) return;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      entry.filter = filter;
    }
    entry.filter.frequency.value = hz;
    if (voice.filters.length === 0) voice.setFilters([entry.filter]);
  }
}

export function audioRuntimeSnapshot(): IAudioRuntimeSnapshot {
  let queued = 0;
  let voices = 0;
  let pooled = 0;
  for (const bus of buses) {
    queued += bus.queued;
    voices += bus.voices;
    pooled += bus.pooled;
  }
  return { pooled, queued, voices };
}

/** Every numeric contract on a cue, checked before a voice is claimed rather than after. */
function assertOptions(options: IAudioPlayOptions): void {
  if (
    options.cutoffSeconds !== undefined &&
    (!Number.isFinite(options.cutoffSeconds) || options.cutoffSeconds <= 0)
  ) {
    throw new RangeError("cutoffSeconds must be finite and positive.");
  }
  if (
    options.lowpassHz !== undefined &&
    (!Number.isFinite(options.lowpassHz) || options.lowpassHz <= 0)
  ) {
    throw new RangeError("lowpassHz must be finite and positive.");
  }
  if (options.detune !== undefined && !Number.isFinite(options.detune)) {
    throw new RangeError("detune must be finite.");
  }
  // Volume/fade/refDistance/rolloffFactor used to be validated only in configureVoice —
  // after play() had already claimed its voice, so a throwing option orphaned it for good.
  const volume = options.volume ?? 1;
  if (!Number.isFinite(volume) || volume < 0)
    throw new RangeError("volume must be finite and non-negative.");
  if (options.fade !== undefined && (!Number.isFinite(options.fade) || options.fade < 0)) {
    throw new RangeError("fade must be finite and non-negative.");
  }
  if (
    options.refDistance !== undefined &&
    (!Number.isFinite(options.refDistance) || options.refDistance <= 0)
  ) {
    throw new RangeError("refDistance must be finite and positive.");
  }
  if (
    options.rolloffFactor !== undefined &&
    (!Number.isFinite(options.rolloffFactor) || options.rolloffFactor < 0)
  ) {
    throw new RangeError("rolloffFactor must be finite and non-negative.");
  }
}

function configureVoice(voice: ThreeAudio<AudioNode>, options: IAudioPlayOptions): void {
  const volume = options.volume ?? 1;
  voice.setLoop(options.loop ?? false);
  voice.setVolume(options.fade === undefined || options.fade === 0 ? volume : 0);
}

function assertBuffer(buffer: AudioBuffer): void {
  if (buffer === null || buffer === undefined)
    throw new TypeError("AudioBus requires a non-null AudioBuffer.");
}
