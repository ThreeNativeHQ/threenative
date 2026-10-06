/** What the playtest reads out of the forest scene. Every number is measured, none is a default. */
export type GameState = {
  loadingError: string;
  spawnCellsLoaded: number;
  spawnCellsRequired: number;
  spawnTerrainLoaded: number;
  spawnTerrainRequired: number;
  /** The kit's world streamed, its colliders built and the daylight mounted. */
  worldReady: number;
  /** Which fixed camera view is up; the scenario switches it with 1, 2 and 3. */
  view: string;
  /** |player foot − terrain height| under the player, once it has settled. */
  groundError: number;
  /** Smallest horizontal distance from the player's centre to the fir's axis while it walked. */
  closestToTrunk: number;
  /** Ground the player actually covered; without it a tree that never moved could pass the row above. */
  driveMetres: number;
  /** One collider per placed fir and boulder, from `addForest`'s result. */
  propColliders: number;
  /** Instances the renderer is drawing in the fir batches. */
  firInstancesDrawn: number;
  /** The walk finished. */
  driveDone: number;
  frames: number;
  /** Per view, from the engine's own frame budget: GPU ms p50, GPU ms p95, CPU frame p95. */
  viewGpuP50: Record<string, number>;
  viewGpuP95: Record<string, number>;
  viewFrameP95: Record<string, number>;
};

/** -1 everywhere a number has not been measured yet, so a bound cannot pass on a default. */
export const initialState: GameState = {
  loadingError: "",
  spawnCellsLoaded: 0,
  spawnCellsRequired: 0,
  spawnTerrainLoaded: 0,
  spawnTerrainRequired: 0,
  closestToTrunk: -1,
  driveDone: 0,
  driveMetres: 0,
  firInstancesDrawn: -1,
  frames: 0,
  groundError: -1,
  propColliders: -1,
  view: "ground",
  viewFrameP95: { edge: -1, ground: -1, overview: -1 },
  viewGpuP50: { edge: -1, ground: -1, overview: -1 },
  viewGpuP95: { edge: -1, ground: -1, overview: -1 },
  worldReady: 0,
};
