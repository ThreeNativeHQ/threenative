export type RaceStatus = "DNF" | "RACING" | "WON";

export function resolveRaceStatus(
  currentStatus: RaceStatus,
  completedLaps: number,
  totalLaps: number,
  playerPlace: number,
): RaceStatus {
  if (currentStatus !== "RACING" || completedLaps < totalLaps) return currentStatus;
  return playerPlace === 1 ? "WON" : "DNF";
}

export type GameState = {
  boostActive: boolean;
  boostPeakSpeed: number;
  speedAfterBoost: number;
  boostUses: number;
  completedLaps: number;
  elapsed: number;
  lastOnRoad: [number, number, number];
  place: number;
  position: string;
  raceStatus: RaceStatus;
  rescueHeading: number;
  rescueHeadingError: number;
  rescuePositionError: number;
  rescues: number;
  shortcutRejects: number;
  speed: number;
  topSpeed: number;
  totalLaps: number;
  trackProgress: number;
  reverseRejects: number;
  sameDistanceRanking: string;
};
