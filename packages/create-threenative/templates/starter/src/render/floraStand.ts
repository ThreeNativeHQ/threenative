// Generated for you: this game owns the flora recipe. Change the envelope,
// seed, bounds, budgets, materials, and wind strength here — never in
// floraField.ts (local generated generation) or floraMesh.ts (display).
// No engine API lives under this path: no species, preset, or catalog.
import type { IFloraBounds, IFloraBudgets, IFloraEnvelope } from "./floraSample.js";

/** Climate envelope for the starter's coastal planting. All fields required. */
export const FLORA_ENVELOPE: IFloraEnvelope = {
  aridity: 0.32,
  gravity: 1,
  light: 0.62,
  sunAngle: 0.25,
  wind: 0.2,
};

/** Integer seed: new individuals reroll this; new kinds change the envelope. */
export const FLORA_SEED = 20_260_906;

/** Foreground planting bounds, clear of the play corridor and the island. */
export const FLORA_BOUNDS: IFloraBounds = {
  maxX: -5.5,
  maxZ: 3.4,
  minX: -9.5,
  minZ: 1.2,
};

/** Countable budgets: plants, wood segments, foliage instances. */
export const FLORA_BUDGETS: IFloraBudgets = {
  maxLeaves: 220,
  maxPlants: 7,
  maxSegments: 64,
};

/** Game-owned wind strength. 0 is exactly static — measured, not labelled. */
export const FLORA_WIND_STRENGTH = 0.25;
