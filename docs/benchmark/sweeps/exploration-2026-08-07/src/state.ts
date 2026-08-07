export type AreaId = "hub" | "archive" | "grove";
export type PointId = "beacon" | "archiveLens" | "groveMemory";

export type GameState = {
  area: AreaId;
  coyoteJumps: number;
  jumps: number;
  levelX: number;
  peakRise: number;
  playerX: number;
  playerZ: number;
  respawns: number;
  score: number;
  inspected: PointId[];
  nearbyPoint: PointId | null;
  transitionActive: boolean;
  transitionTitle: string;
  transitionSubtitle: string;
  lastInspected: PointId | null;
};
