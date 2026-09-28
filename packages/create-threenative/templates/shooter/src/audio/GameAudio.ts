import { AudioBus } from "@threenative/core";
import { MathUtils, type Object3D, type PerspectiveCamera, Vector3 } from "three";
// The surface vocabulary is defined once in `src/surfaces.ts`, where the world
// builder tags meshes and every consumer reads them; audio only consumes it.
import type { ImpactSurface } from "../surfaces.js";

/**
 * Gameplay audio, every cue through `ctx.assets.audio` and the framework's
 * `AudioBus`. No DOM audio anywhere: the bus is the only voice owner, so the
 * native build (no `window`, no `new Audio()`) plays exactly what the web does.
 *
 * Voice recycling, the concurrency ceiling, per-cue detune, tail cut-off and the
 * distance low-pass all belong to the bus. This file is only the game's part: which
 * cue, how loud, how far, and how a rifle in a stone harbour should sound.
 */

/** Every shipped cue, keyed by role. Values are paths under `public/`. */
const CUE_FILES = {
  shotPlayer: "audio/shot-player.ogg",
  shotEnemy: "audio/shot-enemy.ogg",
  stepStone1: "audio/step-stone-1.ogg",
  stepStone2: "audio/step-stone-2.ogg",
  stepStone3: "audio/step-stone-3.ogg",
  stepStone4: "audio/step-stone-4.ogg",
  impactPlaster: "audio/impact-plaster.ogg",
  impactWood: "audio/impact-wood.ogg",
  impactSteel: "audio/impact-steel.ogg",
  impactStone: "audio/impact-stone.ogg",
  ambience: "audio/ambience-harbour.ogg",
  magOut: "audio/reload-magout.ogg",
  magIn: "audio/reload-magin.ogg",
  bodyImpact: "audio/hit-impact.ogg",
  whizz: "audio/bullet-whizz.ogg",
  // The starter scaffold ships this cue at the public root, not under audio/.
  chime: "pickup.ogg",
  barkSpot1: "audio/bark-spot-1.ogg",
  barkSpot2: "audio/bark-spot-2.ogg",
  barkSpot3: "audio/bark-spot-3.ogg",
  barkChase1: "audio/bark-chase-1.ogg",
  barkChase2: "audio/bark-chase-2.ogg",
  barkChase3: "audio/bark-chase-3.ogg",
  barkPain1: "audio/bark-pain-1.ogg",
  barkPain2: "audio/bark-pain-2.ogg",
  barkDeath1: "audio/bark-death-1.ogg",
  barkDeath2: "audio/bark-death-2.ogg",
  uiClick: "audio/ui-click.ogg",
  roundWin: "audio/round-complete.ogg",
  roundLose: "audio/round-failed.ogg",
  tick: "audio/clock-tick.ogg",
} as const;

export type CueName = keyof typeof CUE_FILES;

const STEP_VARIANTS: readonly CueName[] = [
  "stepStone1",
  "stepStone2",
  "stepStone3",
  "stepStone4",
];
/** Shouted Arabic combat callouts, strictly non-religious; variants rotate per category. */
const BARK_VARIANTS: Readonly<Record<"spot" | "chase" | "pain" | "death", readonly CueName[]>> = {
  spot: ["barkSpot1", "barkSpot2", "barkSpot3"],
  chase: ["barkChase1", "barkChase2", "barkChase3"],
  pain: ["barkPain1", "barkPain2"],
  death: ["barkDeath1", "barkDeath2"],
};
/**
 * Minimum seconds between any two soldier barks across the whole squad. Five men
 * reacting at once must not collapse into a wall of shouting; one voice at a time
 * reads as a squad talking over gunfire.
 */
const BARK_GAP_SECONDS = 1.15;

type SpatialTune = {
  readonly volume: number;
  /** Panner ref distance in metres; three's default of 1 swallows distant shots. */
  readonly ref: number;
  readonly rolloff: number;
};

/** Beyond this gap a trigger pull is a fresh burst, not another round of the current one. */
const BURST_GAP_SECONDS = 0.26;
/** Silence after the last round before the report's slap-back off the town is due. */
const TAIL_DELAY_SECONDS = 0.13;
/**
 * `shot-player.ogg` runs 1.36 s. At 600 rounds a minute that is fourteen overlapping tails, which
 * is the wall of mush the rifle used to make. Sustained fire keeps the crack and drops the rest;
 * the tail comes back once, from `#tail`, when the trigger is released.
 */
const SUSTAINED_CUTOFF_SECONDS = 0.12;
const OPENING_CUTOFF_SECONDS = 0.42;

/**
 * Thirty-two simultaneous cues covers five soldiers firing, walking and shouting at once, plus
 * impacts, plus the player's own rifle and its tail. It is a hard ceiling: past it the bus stops
 * its oldest one-shot rather than growing, which is what keeps a firefight from turning into a
 * wall of overlapping samples nobody can pick a threat out of.
 */
const MAX_VOICES = 32;

/**
 * Air and geometry eat the top of a report as it crosses the harbour. A flat sample played at
 * every range is the single biggest tell that a game's gunfire is not in a place; this curve is
 * what makes a shot down the quay read as further away than one in the next doorway.
 */
function lowpassForDistance(distance: number): number {
  return MathUtils.clamp(20000 * Math.exp(-distance / 24), 800, 20000);
}

const TUNE = {
  shot: { volume: 0.85, ref: 7, rolloff: 0.55 } satisfies SpatialTune,
  step: { volume: 0.42, ref: 3.5, rolloff: 0.9 } satisfies SpatialTune,
  impact: { volume: 0.7, ref: 4.5, rolloff: 0.7 } satisfies SpatialTune,
  body: { volume: 0.65, ref: 5, rolloff: 0.7 } satisfies SpatialTune,
  chime: { volume: 0.55, ref: 12, rolloff: 0.35 } satisfies SpatialTune,
  /** Shouted voices sit under the gunfire, not over it. */
  bark: { volume: 0.6, ref: 4, rolloff: 0.55 } satisfies SpatialTune,
} as const;

export class GameAudio {
  /** Load every cue through the asset cache. Await from `Scene.load`. */
  static async load(
    assets: { audio(path: string): Promise<AudioBuffer> },
  ): Promise<Map<CueName, AudioBuffer>> {
    const entries = await Promise.all(
      (Object.entries(CUE_FILES) as readonly (readonly [CueName, string])[]).map(
        async ([name, path]) => [name, await assets.audio(path)] as const,
      ),
    );
    return new Map(entries);
  }

  #bus: AudioBus;
  #camera: PerspectiveCamera;
  #scene: Object3D;
  #buffers: ReadonlyMap<CueName, AudioBuffer>;
  /** Separate cursors: the player's own cadence must not be shuffled by five soldiers walking. */
  #localStepCursor = 0;
  #soldierStepCursor = 0;
  /** Bark variant rotation, shared across categories so repeats stay spread out. */
  #barkCursor = 0;
  /** AudioContext time of the last bark; the squad-wide throttle reads this. */
  #lastBarkAt = -Infinity;
  #barksPlayed = 0;
  /** Rifle rounds fired with sound — the playtest gate reads this. Starts at zero. */
  #playerShots = 0;
  /** Highest live voice count seen across samples; only a started WebAudio node scores above zero. */
  #peakVoices = 0;
  #lastPlayerShotAt = -Infinity;
  #tailPending = false;
  #listenerPoint = new Vector3();
  /** Scratch for distance queries, so no cue allocates on the fire path. */
  #cuePoint = new Vector3();
  /**
   * Audio `Object3D`s parented into the scene right now. The bus recycles voices, so this is
   * flat for a whole round — a climbing figure means voices are being minted per cue and
   * abandoned again, which is the engine leak this game was built on top of.
   */
  #sceneVoiceNodes = 0;
  #nodeCountCooldown = 0;

  constructor(
    camera: PerspectiveCamera,
    buffers: ReadonlyMap<CueName, AudioBuffer>,
    scene: Object3D,
  ) {
    this.#bus = new AudioBus({ camera, maxVoices: MAX_VOICES });
    this.#buffers = buffers;
    this.#camera = camera;
    this.#scene = scene;
  }

  /** Called once per frame: peak-voice tracking, the burst tail, and the leak counter. */
  sample(dt = 0): void {
    this.#peakVoices = Math.max(this.#peakVoices, this.#bus.voices);
    const now = this.#bus.listener.context.currentTime;
    if (this.#tailPending && now - this.#lastPlayerShotAt >= TAIL_DELAY_SECONDS) {
      this.#tailPending = false;
      this.#tail();
    }
    this.#nodeCountCooldown -= dt;
    if (this.#nodeCountCooldown <= 0) {
      this.#nodeCountCooldown = 1;
      let count = 0;
      for (const child of this.#scene.children) {
        if (child.type === "Audio" || child.type === "PositionalAudio") count += 1;
      }
      this.#sceneVoiceNodes = count;
    }
  }

  /**
   * The player's own rifle: at the ear, so plain and loud rather than panned.
   *
   * Sustained fire truncates every round to its crack. Overlapping the full 1.4 s tail ten times
   * a second is what made the rifle sound like a bag of gravel; one tail, after the trigger comes
   * up, is what a rifle in a stone harbour actually does.
   */
  playerShot(): void {
    const buffer = this.#buffers.get("shotPlayer");
    if (buffer === undefined) return;
    const now = this.#bus.listener.context.currentTime;
    const sustained = now - this.#lastPlayerShotAt < BURST_GAP_SECONDS;
    this.#lastPlayerShotAt = now;
    this.#tailPending = true;
    this.#playerShots += 1;
    // Deterministic per-shot detune. Two identical samples started a tenth of a second apart
    // comb-filter into a metallic buzz; a few dozen cents of spread is all it takes to stop.
    const spread = ((this.#playerShots * 53) % 21) - 10;
    this.#bus.play(buffer, {
      volume: sustained ? 0.72 : 0.9,
      detune: spread * 7,
      cutoffSeconds: sustained ? SUSTAINED_CUTOFF_SECONDS : OPENING_CUTOFF_SECONDS,
    });
  }

  /** A soldier's rifle, positioned at the muzzle and dulled by the distance it crossed. */
  enemyShot(at: Vector3): void {
    this.#spatial("shotEnemy", at, TUNE.shot, {
      detune: ((this.#barkCursor * 37) % 19) * 6 - 54,
      lowpassHz: lowpassForDistance(this.#distanceToListener(at)),
    });
  }

  /**
   * Incoming round passing close by: the whizz that says someone is shooting at
   * you even when the tracer went wide. Louder as the muzzle gets closer.
   */
  nearMiss(muzzleDistance: number): void {
    if (muzzleDistance >= 30) return;
    const buffer = this.#buffers.get("whizz");
    if (buffer === undefined) return;
    this.#bus.play(buffer, {
      volume: 0.4 * (1 - muzzleDistance / 30),
      detune: ((this.#playerShots * 31) % 13) * 10 - 60,
    });
  }

  /** The listener's own footfall: centred, pitch-jittered, variant-cycled. */
  localStep(): void {
    const name = STEP_VARIANTS[this.#localStepCursor % STEP_VARIANTS.length];
    this.#localStepCursor += 1;
    if (name === undefined) return;
    const buffer = this.#buffers.get(name);
    if (buffer === undefined) return;
    // Detune rather than playback rate: `setPlaybackRate` on a started voice ramps over ~30 ms,
    // so the pitch slides audibly across the front of a 0.6 s footfall.
    this.#bus.play(buffer, {
      volume: TUNE.step.volume,
      detune: ((this.#localStepCursor * 47) % 15) * 8 - 56,
    });
  }

  /** A soldier's footfall, positioned at his feet — the main positional tell. */
  soldierStep(at: Vector3): void {
    const name = STEP_VARIANTS[this.#soldierStepCursor % STEP_VARIANTS.length];
    this.#soldierStepCursor += 1;
    if (name === undefined) return;
    const distance = this.#distanceToListener(at);
    // Boots two streets away are a rumour, not a cue. Dropping them keeps the mix for the
    // soldiers you can actually act on.
    if (distance > 34) return;
    this.#spatial(name, at, TUNE.step, {
      detune: ((this.#soldierStepCursor * 61) % 17) * 9 - 72,
      lowpassHz: lowpassForDistance(distance),
    });
  }

  impact(surface: ImpactSurface, at: Vector3): void {
    const cue: CueName =
      surface === "wood"
        ? "impactWood"
        : surface === "steel"
          ? "impactSteel"
          : surface === "stone"
            ? "impactStone"
            : "impactPlaster";
    this.#spatial(cue, at, TUNE.impact, {
      detune: ((this.#playerShots * 41) % 23) * 6 - 66,
      lowpassHz: lowpassForDistance(this.#distanceToListener(at)),
    });
  }

  /** A round connecting with a soldier: dull body impact at the hit point. */
  bodyImpact(at: Vector3): void {
    this.#spatial("bodyImpact", at, TUNE.body);
  }

  /** He has spotted the player. */
  soldierSpot(at: Vector3): void {
    this.#bark(BARK_VARIANTS.spot ?? [], at);
  }

  /** Gunfire pulled him off his route; he is going looking. */
  soldierChase(at: Vector3): void {
    this.#bark(BARK_VARIANTS.chase ?? [], at);
  }

  /** A round connected but he is still standing. */
  soldierPain(at: Vector3): void {
    this.#bark(BARK_VARIANTS.pain ?? [], at);
  }

  /**
   * The killing round. A death cry cut off by the squad throttle reads as a bug,
   * so it bypasses the gap and restarts the clock for everyone else.
   */
  soldierDeath(at: Vector3): void {
    this.#bark(BARK_VARIANTS.death ?? [], at, true);
  }

  /** A scoring plate knocked down: the confirmation chime. */
  plateChime(at: Vector3): void {
    this.#spatial("chime", at, TUNE.chime);
  }

  /** Glass, pottery or a bulb giving way. Bright and close-miked, whatever the distance. */
  shatter(surface: ImpactSurface, at: Vector3): void {
    const cue: CueName = surface === "steel" ? "impactSteel" : "impactStone";
    this.#spatial(cue, at, { volume: 0.8, ref: 6, rolloff: 0.6 }, {
      // Up a fourth and thinned out: the same stone crack, read as something brittle breaking.
      detune: 520 + ((this.#playerShots * 29) % 11) * 14,
      lowpassHz: lowpassForDistance(this.#distanceToListener(at) * 0.6),
    });
  }

  magOut(): void {
    this.#flat("magOut", 0.55);
  }

  magIn(): void {
    this.#flat("magIn", 0.6);
  }

  /** Pointer-lock acquisition — the click that says the mouse now steers the aim. */
  uiClick(): void {
    this.#flat("uiClick", 0.6);
  }

  roundEnd(won: boolean): void {
    this.#flat(won ? "roundWin" : "roundLose", 0.8);
  }

  /** Last-ten-seconds clock pulse, once per remaining second. */
  tick(): void {
    this.#flat("tick", 0.5);
  }

  /** Harbour bed: gulls, water on the quay, distant town. Loops from scene enter. */
  startAmbience(): void {
    const buffer = this.#buffers.get("ambience");
    if (buffer === undefined) return;
    this.#bus.music(buffer, { fade: 2.5, loop: true, volume: 0.4 });
  }

  /** Live counters for the playtest bridge and the dev overlay. */
  debug(): {
    barksPlayed: number;
    peakVoices: number;
    playerShots: number;
    queued: number;
    sceneVoiceNodes: number;
    voicePoolSize: number;
  } {
    return {
      barksPlayed: this.#barksPlayed,
      peakVoices: this.#peakVoices,
      playerShots: this.#playerShots,
      queued: this.#bus.queued,
      sceneVoiceNodes: this.#sceneVoiceNodes,
      // Retired voices the bus holds for reuse. Bounded by peak concurrency; this is the number
      // that used to be "every cue ever played, still parented to the scene".
      voicePoolSize: this.#bus.pooled,
    };
  }

  dispose(): void {
    this.#bus.dispose();
  }

  /**
   * The report coming back off the quay and the warehouse fronts a beat after the burst ends.
   * It is the same sample, dropped an octave and stripped of its top, which is close enough to
   * a slap-back that the rifle stops sounding like it is being fired in a vacuum.
   */
  #tail(): void {
    const buffer = this.#buffers.get("shotPlayer");
    if (buffer === undefined) return;
    this.#bus.play(buffer, { volume: 0.32, detune: -700, lowpassHz: 1700 });
  }

  /**
   * One soldier voice at a time across the squad. `force` (death) bypasses the
   * gap; everything else dropped by it simply does not shout this once.
   */
  #bark(cues: readonly CueName[], at: Vector3, force = false): void {
    if (cues.length === 0) return;
    const now = this.#bus.listener.context.currentTime;
    if (!force && now - this.#lastBarkAt < BARK_GAP_SECONDS) return;
    const name = cues[this.#barkCursor % cues.length];
    if (name === undefined) return;
    this.#barkCursor += 1;
    this.#lastBarkAt = now;
    this.#barksPlayed += 1;
    this.#spatial(name, at, TUNE.bark, {
      lowpassHz: lowpassForDistance(this.#distanceToListener(at) * 0.5),
    });
  }

  #distanceToListener(at: Vector3): number {
    this.#camera.getWorldPosition(this.#listenerPoint);
    this.#cuePoint.copy(at);
    return this.#listenerPoint.distanceTo(this.#cuePoint);
  }

  #flat(name: CueName, volume: number): void {
    const buffer = this.#buffers.get(name);
    if (buffer === undefined) return;
    this.#bus.play(buffer, { volume });
  }

  #spatial(
    name: CueName,
    at: Vector3,
    tune: SpatialTune,
    extra: { detune?: number; lowpassHz?: number } = {},
  ): void {
    const buffer = this.#buffers.get(name);
    if (buffer === undefined) return;
    // three's panner defaults (ref 1 m, rolloff 1) make a shot 20 m away all but silent.
    // Open the curve per family.
    this.#bus.playAt(buffer, at, {
      volume: tune.volume,
      refDistance: tune.ref,
      rolloffFactor: tune.rolloff,
      ...extra,
    });
  }
}
