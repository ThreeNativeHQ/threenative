import type { IPlaytestAssertionResult, IPlaytestDiagnostic, IPlaytestObservations } from "./assertions.js";

export type PlaytestVec3 = [number, number, number];

export interface IPlaytestTransformSample {
  frame: number;
  position: PlaytestVec3;
  rotation?: readonly [number, number, number, number];
  tick: number;
}

export interface IPlaytestFollowReport {
  after?: IPlaytestTransformSample;
  before?: IPlaytestTransformSample;
  entity: string;
  moved?: number;
  separation?: number;
  within: number;
}

export interface IPlaytestReport {
  after?: IPlaytestTransformSample;
  assertionResults?: IPlaytestAssertionResult[];
  before?: IPlaytestTransformSample;
  diagnostics: IPlaytestDiagnostic[];
  distance: number;
  effectLog?: unknown;
  entity: string;
  expectAxis?: string;
  expectMoved: boolean;
  follow?: IPlaytestFollowReport;
  frames: number;
  movementDelta?: PlaytestVec3;
  observations?: IPlaytestObservations;
  pathLength?: number;
}
