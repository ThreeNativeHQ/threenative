export type GameState = {
  ammo: number;
  cooldown: number;
  enemiesRemaining: number;
  health: number;
  objective: string;
  pickups: number;
  playerX: number;
  playerZ: number;
  shots: number;
  score: number;
  won: boolean;
};

export const initialState: GameState = {
  ammo: 6,
  cooldown: 0,
  enemiesRemaining: 3,
  health: 100,
  objective: "CLEAR THE ARENA",
  pickups: 0,
  playerX: -5,
  playerZ: 3.4,
  shots: 0,
  score: 0,
  won: false,
};
