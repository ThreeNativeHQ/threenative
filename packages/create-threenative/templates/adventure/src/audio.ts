import { AudioBus, type ICtx, loadAll } from "@threenative/core";

/**
 * Every clip in `assets/`, synthesised by `scripts/adventure-audio.ts` in the engine repository:
 * eleven one-shots, a wind-and-birds bed and a slow melody, all original.
 */
export const CLIP_NAMES = [
  "altar",
  "ambience",
  "block",
  "chest",
  "gem",
  "hit",
  "hurt",
  "music",
  "pot",
  "roll",
  "sigil",
  "step",
  "swing",
  "talk",
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];
export type Clips = Partial<Record<ClipName, AudioBuffer>>;

/**
 * Loads the clips six at a time, in order. A clip that fails to decode is absent, not fatal: a game
 * with no sound is a worse game and still a game, and the cue ledger will show which never played.
 */
export async function loadClips(ctx: Pick<ICtx, "assets">): Promise<Clips> {
  const buffers = await loadAll(CLIP_NAMES, (name) =>
    ctx.assets.audio(`${name}.wav`).catch(() => undefined),
  );
  return Object.fromEntries(CLIP_NAMES.map((name, i) => [name, buffers[i]])) as Clips;
}

export interface ISound {
  /** Plays a one-shot, labelled with its own name so a playtest can count it. */
  readonly cue: (name: ClipName, volume?: number) => void;
  /** Turns everything on or off, fading. */
  readonly setOn: (on: boolean) => void;
  /** Ducks the music and wind while a menu is open. */
  readonly duck: (ducked: boolean) => void;
}

/**
 * Two mixer buses: effects, and the bed (wind and melody). A bus is a mixer channel, so muting and
 * ducking are one call each and never touch a clip.
 */
export function createSound(
  ctx: Pick<ICtx, "camera" | "entities">,
  clips: Clips,
  on: boolean,
): ISound {
  const sfx = ctx.entities.add("audio-sfx", new AudioBus({ camera: ctx.camera }));
  const bed = ctx.entities.add("audio-bed", new AudioBus({ camera: ctx.camera }));
  if (clips.ambience) bed.music(clips.ambience, { cue: "ambience", volume: 0.55 });
  if (clips.music) bed.music(clips.music, { cue: "music", volume: 0.32 });
  let enabled = on;
  let ducked = false;
  const apply = (): void => {
    sfx.setVolume(enabled ? 1 : 0, 0.15);
    bed.setVolume(enabled ? (ducked ? 0.3 : 1) : 0, 0.4);
  };
  apply();
  return {
    cue: (name, volume = 1) => {
      const buffer = clips[name];
      if (buffer && enabled) sfx.play(buffer, { cue: name, volume });
    },
    duck: (value) => {
      if (value === ducked) return;
      ducked = value;
      apply();
    },
    setOn: (value) => {
      enabled = value;
      apply();
    },
  };
}
