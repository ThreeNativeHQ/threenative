/**
 * Frame-time measurement, and the per-section breakdown that says which part to fix.
 *
 * ## Why wall-clock and not `dt`
 *
 * The fixed-step loop hands `update` a `dt` that is smoothed and clamped, so a frame that took
 * 80 ms of main-thread work can still arrive as a tidy 16.7 ms. That is correct for simulation
 * and useless for finding hitches: the number that matters is how long real time actually took
 * between one frame callback and the next. That is what this measures.
 *
 * ## Why percentiles and not an average
 *
 * A hitch is not a slow average. A round that runs at a solid 120 fps and stalls for 90 ms four
 * times a minute has an excellent mean and feels broken, because the stalls are exactly what a
 * player notices. So the figures that matter are p95, p99 and the count of frames over a
 * threshold — `playSpikes` is the number a fix has to drive to zero.
 *
 * ## Why the sections
 *
 * "The game is slow" is not actionable. `gameFrame` brackets everything this game does in a
 * frame; subtracting it from the frame delta leaves the time spent outside the callback — the
 * physics step, the scene projection and the draw — which is what tells "our code is slow" apart
 * from "the engine is". That split is what found the weapon-scale rebuild in `Enemy`.
 *
 * Registered as an entity, so a playtest can fail on a hitch instead of a person having to feel
 * one. Nothing else in this project can see a stutter.
 */

/** Frames slower than this are hitches a player can feel, not just slow frames. */
const SPIKE_MS = 33;
/** Ring size. A round is ~6000 frames; this keeps the recent history without unbounded growth. */
const WINDOW = 4096;

type SectionRing = { ring: Float32Array; cursor: number; count: number };

export class FrameStats {
  readonly #samples = new Float32Array(WINDOW);
  #count = 0;
  #cursor = 0;
  #last = 0;
  #max = 0;
  #spikes = 0;
  /** Section name → worst single frame seen in that section. */
  readonly #sectionPeaks = new Map<string, number>();
  /** Section name → its own sample ring, so a section can be read at p99 and not just its worst. */
  readonly #sectionSamples = new Map<string, SectionRing>();
  #sectionStart = 0;
  /** The wall-clock cost of the frame now being measured, for the `outsideGame` split. */
  #lastDelta = 0;
  /** Start of the whole callback, kept apart from `#sectionStart` so the two can overlap. */
  #frameStart = 0;
  /** Frames since `resetWindow`, and spikes among them: play measured apart from startup. */
  #windowFrames = 0;
  #windowSpikes = 0;

  /** Call first thing in the frame callback. Returns the real milliseconds since the last one. */
  begin(now: number): number {
    const delta = this.#last === 0 ? 0 : now - this.#last;
    this.#last = now;
    this.#lastDelta = delta;
    if (delta > 0) {
      this.#samples[this.#cursor % WINDOW] = delta;
      this.#cursor += 1;
      this.#count += 1;
      if (delta > this.#max) this.#max = delta;
      this.#windowFrames += 1;
      if (delta > SPIKE_MS) {
        this.#spikes += 1;
        this.#windowSpikes += 1;
      }
    }
    return delta;
  }

  /** Bracket a section of the frame: `mark()` before, `measure("enemies")` after. */
  mark(now: number): void {
    this.#sectionStart = now;
  }

  /** Bracket the whole callback. Separate from `mark` so a section can nest inside it. */
  markFrame(now: number): void {
    this.#frameStart = now;
  }

  measure(name: string, now: number): void {
    const spent = now - (name === "gameFrame" ? this.#frameStart : this.#sectionStart);
    // Everything the frame cost that the game did not spend: the renderer's own work, pipeline
    // compilation, texture upload, GC, and whatever else the browser did between callbacks.
    //
    // Without this the profile is blind exactly where it matters. `gameFrame` peaked at 17.8 ms
    // on a run whose worst wall-clock frame was 184.5 ms, so 167 ms of the worst hitch in the game
    // was happening somewhere nothing measured — and three separate optimisations aimed at game
    // logic moved it by nothing at all, because none of them were pointed at the cost.
    if (name === "gameFrame" && this.#lastDelta > 0) {
      this.#record("outsideGame", Math.max(0, this.#lastDelta - spent));
    }
    this.#record(name, spent);
  }

  /** Bill a section a duration measured elsewhere, for work outside the mark/measure bracket. */
  chargeSection(name: string, spent: number): void {
    this.#record(name, Math.max(0, spent));
  }

  /** File one section sample against its peak and its percentile ring. */
  #record(name: string, spent: number): void {
    const peak = this.#sectionPeaks.get(name) ?? 0;
    if (spent > peak) this.#sectionPeaks.set(name, spent);
    let entry = this.#sectionSamples.get(name);
    if (entry === undefined) {
      entry = { ring: new Float32Array(WINDOW), cursor: 0, count: 0 };
      this.#sectionSamples.set(name, entry);
    }
    entry.ring[entry.cursor % WINDOW] = spent;
    entry.cursor += 1;
    entry.count += 1;
  }

  /**
   * Forget the frames measured so far for the windowed counters.
   *
   * Startup is not gameplay: pipeline compilation, the first draw of every material and the first
   * physics step all land in the opening second and none of them can hitch twice. Counting them
   * alongside play makes a smooth round look broken and hides a real mid-round stall in the noise.
   */
  resetWindow(): void {
    this.#windowFrames = 0;
    this.#windowSpikes = 0;
    // The section rings reset too, or their percentiles keep reporting startup costs that can
    // only happen once — a raycast acceleration structure being built, a pipeline compiled. That
    // mistake sent a whole round of profiling after a cost that was already gone.
    this.#sectionPeaks.clear();
    for (const entry of this.#sectionSamples.values()) {
      entry.cursor = 0;
      entry.count = 0;
    }
  }

  #percentile(fraction: number): number {
    return FrameStats.#pick(this.#samples, Math.min(this.#count, WINDOW), fraction);
  }

  #ringPercentile(name: string, fraction: number): number {
    const entry = this.#sectionSamples.get(name);
    if (entry === undefined) return 0;
    return FrameStats.#pick(entry.ring, Math.min(entry.count, WINDOW), fraction);
  }

  static #pick(ring: Float32Array, length: number, fraction: number): number {
    if (length === 0) return 0;
    const sorted = Array.from(ring.subarray(0, length)).sort((a, b) => a - b);
    const value = sorted[Math.min(length - 1, Math.floor(length * fraction))];
    return value === undefined ? 0 : Math.round(value * 100) / 100;
  }

  debug(): {
    frames: number;
    p50: number;
    p95: number;
    p99: number;
    worstMs: number;
    spikes: number;
    /** Spikes since the last `resetWindow` — the ones that happened during play. */
    playSpikes: number;
    playFrames: number;
    /** Worst single frame per instrumented section, in milliseconds. */
    peaks: Record<string, number>;
    /** The slowest one percent per section: what a section costs when it misbehaves, not once. */
    sectionP99: Record<string, number>;
  } {
    const peaks: Record<string, number> = {};
    for (const [name, value] of this.#sectionPeaks) peaks[name] = Math.round(value * 100) / 100;
    const sectionP99: Record<string, number> = {};
    for (const name of this.#sectionSamples.keys()) {
      sectionP99[name] = this.#ringPercentile(name, 0.99);
    }
    return {
      frames: this.#count,
      p50: this.#percentile(0.5),
      p95: this.#percentile(0.95),
      p99: this.#percentile(0.99),
      worstMs: Math.round(this.#max * 100) / 100,
      spikes: this.#spikes,
      playSpikes: this.#windowSpikes,
      playFrames: this.#windowFrames,
      peaks,
      sectionP99,
    };
  }
}
