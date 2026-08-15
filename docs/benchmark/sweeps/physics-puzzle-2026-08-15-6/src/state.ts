import type { ReplayPhase } from "./replay.js";

export type MissionState = "playing" | "won";
export type PlayerState = "idle" | "pushing" | "walking";

/**
 * The serialisable game state. This is what the HUD renders and what the harness reads back as
 * resource `state`, so there is exactly one description of what the game believes is true.
 */
export interface IGameState {
  readonly awakeCrates: number;
  readonly crateCount: number;
  readonly crateGoalHits: number;
  readonly crateCollisions: number;
  readonly ghostCount: number;
  readonly ghostPasses: number;
  readonly mission: MissionState;
  readonly playerGoalHits: number;
  readonly playerState: PlayerState;
  readonly playerX: number;
  readonly playerY: number;
  readonly playerZ: number;
  readonly pushEvents: number;
  readonly replayHashA: number | null;
  readonly replayHashB: number | null;
  readonly replayMatch: boolean;
  readonly replayPhase: ReplayPhase;
  readonly replayTicks: number;
  readonly seed: number;
  readonly settledCrates: number;
  readonly tick: number;
  readonly won: boolean;
}
