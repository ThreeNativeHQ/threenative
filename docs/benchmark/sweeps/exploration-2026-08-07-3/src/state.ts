export type AreaId = "hub" | "north" | "south";
export type PointId = "hub.beacon" | "north.archive" | "south.grove";

export type GameState = {
  area: AreaId;
  coyoteJumps: number;
  inspections: number;
  inspectedPoints: PointId[];
  jumps: number;
  levelX: number;
  objectiveComplete: boolean;
  peakRise: number;
  playerX: number;
  playerZ: number;
  respawns: number;
  returns: number;
  score: number;
  nearbyPoint: PointId | null;
  transitionActive: boolean;
  transitionTitle: string;
  transitionSubtitle: string;
  lastInspected: PointId | null;
};
