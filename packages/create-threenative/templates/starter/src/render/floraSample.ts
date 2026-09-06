// Generated for you: the flora data contract for this game. The envelope,
// bounds, budgets, samples, and report shapes live here so the generation
// (floraField.ts) and display (floraMesh.ts) files stay under their budgets.
export interface IFloraEnvelope {
  /** Light flux [0,1]: 0 dim, 1 bright. Drives leaf size. */
  readonly light: number;
  /** Sun elevation [0,1]: 0 overhead, 1 horizon. Drives lean. */
  readonly sunAngle: number;
  /** Wind severity [0,1]: 0 calm, 1 strong. Drives sturdiness. */
  readonly wind: number;
  /** Dryness [0,1]: 0 lush, 1 arid. Drives succulence. */
  readonly aridity: number;
  /** Gravity in g [0.1,3]: drives trunk thickness and droop. */
  readonly gravity: number;
}

export interface IFloraBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface IFloraBudgets {
  readonly maxPlants: number;
  readonly maxSegments: number;
  readonly maxLeaves: number;
}

export interface IFloraPlantSample {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly baseRadius: number;
  readonly leanX: number;
  readonly leanZ: number;
}

export interface IFloraSegmentSample {
  readonly plant: number;
  /** Parent segment index, -1 for a trunk base. Always < own index. */
  readonly parent: number;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly tipX: number;
  readonly tipY: number;
  readonly tipZ: number;
  readonly tipRadius: number;
  readonly bend: number;
}

export interface IFloraLeafSample {
  /** Segment this anchor sits on — never dangling. */
  readonly segment: number;
  readonly anchor: readonly [number, number, number];
  readonly size: number;
  readonly angle: number;
  readonly phase: number;
}

export interface IFloraStandSample {
  readonly plants: readonly IFloraPlantSample[];
  readonly segments: readonly IFloraSegmentSample[];
  readonly leaves: readonly IFloraLeafSample[];
}

/** Countable report computed from the final attached arrays. */
export interface IFloraReport {
  readonly plants: number;
  readonly woodVertices: number;
  readonly woodTriangles: number;
  readonly leafInstances: number;
  readonly boundaryEdges: number;
  readonly detachedLeaves: number;
  readonly positionHash: string;
  readonly indexHash: string;
  readonly buildMs: number;
}
