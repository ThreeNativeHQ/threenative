/**
 * The shape the HUD subscribes to, and the shape a playtest asserts against as
 * `resources: [{ id: "GameState", ... }]`.
 *
 * Counters live in `Counters` below and are mirrored into the store as absolute
 * values every frame. They are deliberately *not* written with
 * `state.set(s => ({ coins: s.coins + 1 }))`: the store coalesces writes on a
 * 100ms timer, so two increments inside one window both read the same stale
 * base and one of them is lost. Absolute writes cannot drop a coin.
 */
export type GameState = {
  coins: number;
  defeated: number;
  dashes: number;
  gems: number;
  gemsTotal: number;
  hearts: number;
  jumps: number;
  /** Highest rise above the spawn plane, in metres. Proves the jump arc. */
  peakRise: number;
  stars: number;
  /** Fastest horizontal speed seen, in m/s. Proves the dash beats the run. */
  topSpeed: number;
  timeMs: number;
};

export interface Counters {
  coins: number;
  defeated: number;
  dashes: number;
  gems: number;
  hearts: number;
  jumps: number;
  peakRise: number;
  stars: number;
  topSpeed: number;
  timeMs: number;
}

export const GEMS_TOTAL = 5;

export const initialState: GameState = {
  coins: 0,
  defeated: 0,
  dashes: 0,
  gems: 0,
  gemsTotal: GEMS_TOTAL,
  hearts: 3,
  jumps: 0,
  peakRise: 0,
  stars: 0,
  timeMs: 0,
  topSpeed: 0,
};

export function createCounters(): Counters {
  return {
    coins: 0,
    defeated: 0,
    dashes: 0,
    gems: 0,
    hearts: 3,
    jumps: 0,
    peakRise: 0,
    stars: 0,
    timeMs: 0,
    topSpeed: 0,
  };
}
