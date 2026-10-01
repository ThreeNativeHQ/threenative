import type { TargetMode, TowerKind } from "./balance.js";
import { START_CREDITS, START_LIVES } from "./balance.js";

export type GameStatus = "LOST" | "PLAYING" | "WON";

/**
 * Everything the HUD reads, and nothing it can write: the UI sends intents and the game decides.
 * Flat on purpose — the state crosses a process boundary on every native target, and a flat record
 * is the cheapest thing to diff and mirror.
 */
export type GameState = {
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** The field guide is up; the simulation is held while it is. */
  helpOpen: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  status: GameStatus;
  phase: "build" | "combat";
  wave: number;
  credits: number;
  lives: number;
  score: number;
  kills: number;
  leaks: number;
  towers: number;
  /** Enemies still to come plus enemies on the road. */
  hostiles: number;
  autoSend: boolean;
  speed: number;
  /** The tower kind the next pad tap builds, or "" when none is armed. */
  armed: TowerKind | "";
  strikeArmed: boolean;
  /** Whole seconds until the orbital strike is ready; 0 when it is. */
  strikeCooldown: number;
  /** The selected tower's panel, flat: `selected` is false when nothing is selected. */
  selected: boolean;
  selKind: TowerKind | "";
  selLevel: number;
  selMode: TargetMode;
  selDamage: number;
  selRange: number;
  /** Credits the next upgrade costs, 0 at the top level. */
  selUpgrade: number;
  selSell: number;
  /** One line of feedback ("Not enough credits"); `toastSeq` changes with every new one. */
  toast: string;
  toastSeq: number;
  shots: number;
  spent: number;
  placementRejects: number;
  fundsRejects: number;
};

export const INITIAL_STATE: GameState = {
  armed: "",
  autoSend: false,
  credits: START_CREDITS,
  fundsRejects: 0,
  helpOpen: false,
  hostiles: 0,
  kills: 0,
  leaks: 0,
  lives: START_LIVES,
  paused: false,
  phase: "build",
  placementRejects: 0,
  score: 0,
  selDamage: 0,
  selKind: "",
  selLevel: 0,
  selMode: "first",
  selRange: 0,
  selSell: 0,
  selUpgrade: 0,
  selected: false,
  shots: 0,
  speed: 1,
  spent: 0,
  status: "PLAYING",
  strikeArmed: false,
  strikeCooldown: 0,
  toast: "",
  toastSeq: 0,
  towers: 1,
  uiReady: false,
  wave: 0,
};
