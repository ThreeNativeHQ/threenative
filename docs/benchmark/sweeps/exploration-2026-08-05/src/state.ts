export type AreaId = "hub" | "north" | "south";

export type GameState = {
  area: AreaId;
  areaLabel: string;
  coyoteJumps: number;
  inspectedPoints: string[];
  inspections: number;
  jumps: number;
  levelX: number;
  lastMessage: string;
  peakRise: number;
  playerX: number;
  playerZ: number;
  returns: number;
  respawns: number;
  score: number;
  signalFound: boolean;
  transitionCount: number;
  objectiveComplete: boolean;
};

export const initialState: GameState = {
  area: "hub",
  areaLabel: "The Quiet Hub",
  coyoteJumps: 0,
  inspectedPoints: [],
  inspections: 0,
  jumps: 0,
  levelX: -99,
  lastMessage: "Find the three memory stones. Walk with WASD or arrows.",
  peakRise: 0,
  playerX: -2,
  playerZ: 0,
  returns: 0,
  respawns: 0,
  score: 0,
  signalFound: false,
  transitionCount: 0,
  objectiveComplete: false,
};
