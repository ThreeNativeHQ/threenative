// Every number the game is balanced on lives here and nowhere else, with no engine import, so a
// spec can pin the rules without a renderer and a designer can retune a whole game in one file.

export type TowerKind = "sentry" | "mortar" | "arc" | "cryo";
export type EnemyKind = "skitter" | "runner" | "bulwark" | "titan";
export type TargetMode = "first" | "strongest" | "nearest";

export const TOWER_KINDS: readonly TowerKind[] = ["sentry", "mortar", "arc", "cryo"];
export const TARGET_MODES: readonly TargetMode[] = ["first", "strongest", "nearest"];

export const START_CREDITS = 360;
export const START_LIVES = 25;
export const TOTAL_WAVES = 12;
export const MAX_LEVEL = 3;
/** Seconds of game time between a cleared wave and the next launch when auto-send is on. */
export const AUTO_SEND_DELAY = 7;
/** Share of everything invested in a tower that recycling returns. */
export const SELL_RATE = 0.65;

export interface ITowerDef {
  readonly name: string;
  readonly role: string;
  readonly cost: number;
  /** Metres, centre to centre. */
  readonly range: number;
  readonly damage: number;
  /** Seconds between shots. */
  readonly interval: number;
}

export const TOWERS: Readonly<Record<TowerKind, ITowerDef>> = {
  sentry: {
    name: "Sentry",
    role: "Rapid single-target fire",
    cost: 100,
    range: 5.5,
    damage: 19,
    interval: 0.48,
  },
  mortar: {
    name: "Mortar",
    role: "Splash artillery",
    cost: 160,
    range: 7,
    damage: 66,
    interval: 1.9,
  },
  arc: {
    name: "Arc coil",
    role: "Chains between foes",
    cost: 190,
    range: 4.8,
    damage: 27,
    interval: 0.85,
  },
  cryo: {
    name: "Cryo",
    role: "Slows what it touches",
    cost: 120,
    range: 5.2,
    damage: 7,
    interval: 0.8,
  },
};

export const MORTAR_SPLASH = 2.5;
export const MORTAR_FLIGHT = 0.68;
export const ARC_CHAINS = 4;
export const ARC_HOP = 3.6;
export const ARC_FALLOFF = 0.87;
export const CRYO_RADIUS = 2.4;
export const CRYO_SLOW = 0.45;
export const CRYO_SLOW_STEP = 0.04;
export const CRYO_DURATION = 2.25;

export interface ITowerStats {
  readonly range: number;
  readonly damage: number;
  readonly interval: number;
  readonly splash: number;
  readonly chains: number;
  /** Speed multiplier applied to a chilled enemy: lower is slower. */
  readonly slow: number;
}

/** What a tower of `kind` does at `level` (1 to `MAX_LEVEL`). */
export function towerStats(kind: TowerKind, level: number): ITowerStats {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL)
    throw new Error(`Tower level must be an integer from 1 to ${MAX_LEVEL}.`);
  const base = TOWERS[kind];
  const step = level - 1;
  return {
    chains: ARC_CHAINS + step,
    damage: Math.round(base.damage * (1 + 0.7 * step)),
    interval: base.interval / (1 + 0.12 * step),
    range: base.range + 0.6 * step,
    slow: CRYO_SLOW - CRYO_SLOW_STEP * step,
    splash: MORTAR_SPLASH + 0.25 * step,
  };
}

/** Credits to raise a tower from `level` to the next, or undefined at the top. */
export function upgradeCost(kind: TowerKind, level: number): number | undefined {
  if (level === 1) return Math.round(TOWERS[kind].cost * 0.85);
  if (level === 2) return Math.round(TOWERS[kind].cost * 1.3);
  return undefined;
}

export function sellValue(invested: number): number {
  return Math.floor(SELL_RATE * invested);
}

export interface IEnemyDef {
  readonly name: string;
  readonly hp: number;
  /** Metres per second. */
  readonly speed: number;
  readonly reward: number;
  /** Lives lost when it reaches the reactor. */
  readonly leak: number;
  readonly scale: number;
}

export const ENEMIES: Readonly<Record<EnemyKind, IEnemyDef>> = {
  skitter: { name: "Skitter", hp: 58, speed: 2.65, reward: 10, leak: 1, scale: 0.82 },
  runner: { name: "Runner", hp: 40, speed: 4.2, reward: 9, leak: 1, scale: 0.67 },
  bulwark: { name: "Bulwark", hp: 210, speed: 1.55, reward: 24, leak: 2, scale: 1.14 },
  titan: { name: "Titan", hp: 1000, speed: 1.02, reward: 180, leak: 8, scale: 1.65 },
};

export interface ISpawn {
  readonly kind: EnemyKind;
  readonly hp: number;
  /** Seconds after the previous spawn (or after the launch, for the first). */
  readonly delay: number;
}

export function waveCount(wave: number): number {
  return 7 + 2 * wave;
}

/** Health multiplier for a wave: 1.0 on wave 1, about 6 on wave 12. */
export function hpScale(wave: number): number {
  const n = wave - 1;
  return 1 + n * 0.2 + n * n * 0.023;
}

export function waveBonus(wave: number, leaked: boolean): number {
  return 55 + 10 * wave + (leaked ? 0 : 25);
}

export function strikeDamage(wave: number): number {
  return 160 + 36 * wave;
}

export const STRIKE_RADIUS = 4.8;
export const STRIKE_COOLDOWN = 30;

function kindAt(wave: number, index: number): EnemyKind {
  if (wave >= 8 && index % 5 === 0) return "bulwark";
  if (wave >= 3 && index % 6 === 4) return "bulwark";
  if (wave >= 2 && index % 4 === 2) return "runner";
  return "skitter";
}

/** The whole wave as an ordered spawn list. Deterministic: the same wave is the same wave. */
export function buildWave(wave: number): ISpawn[] {
  if (!Number.isInteger(wave) || wave < 1 || wave > TOTAL_WAVES)
    throw new Error(`Wave must be an integer from 1 to ${TOTAL_WAVES}.`);
  const scale = hpScale(wave);
  const count = waveCount(wave);
  const gap = Math.max(0.35, 1.05 - 0.035 * wave);
  const spawns: ISpawn[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = kindAt(wave, index);
    spawns.push({
      delay: index === 0 ? 0.15 : gap,
      hp: Math.round(ENEMIES[kind].hp * scale),
      kind,
    });
  }
  if (wave === 6 || wave === 12) {
    const boss = ENEMIES.titan.hp * scale * (wave === 6 ? 0.82 : 1.1);
    spawns.splice(Math.floor(count * 0.55), 0, { delay: 2, hp: Math.round(boss), kind: "titan" });
  }
  return spawns;
}
