import type { IPlaytestAssertionResult, IPlaytestDiagnostic, IPlaytestObservations } from "./assertions.js";
import type { JsonValue } from "./protocol.js";

export type PlaytestVec3 = [number, number, number];

/** One honest-reporting line: a placement/aim/spawn override the scenario requested. */
export interface IPlaytestSetupRecord {
  entity?: string;
  kind: "aim" | "entities" | "place" | "resources" | "spawn";
  value: JsonValue;
}

/** Requested overrides next to what actually applied; an unapplied request fails the run. */
export interface IPlaytestSetupApplication {
  applied: IPlaytestSetupRecord[];
  requested: IPlaytestSetupRecord[];
}

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

export interface IPlaytestDiagnosticsPolicy {
  consoleErrorsOptOutReason?: string;
  networkErrorsOptOutReason?: string;
  noConsoleErrors: boolean;
  noNetworkErrors: boolean;
  noRuntimeDiagnostics: boolean;
  runtimeReady?: boolean;
  runtimeDiagnosticsOptOutReason?: string;
}

export interface IPlaytestCaptureProvenance {
  adapter: Record<string, string>;
  browserArgs: readonly string[];
  captureMethod: "page.screenshot";
  rendererKind: "webgl" | "webgpu";
  target: string;
  viewport: IPlaytestViewport;
}

export interface IPlaytestTrivialityOptOut {
  id: string;
  reason: string;
}

interface IPlaytestViewport {
  height: number;
  width: number;
}

export interface IPlaytestReport {
  after?: IPlaytestTransformSample;
  assertionResults?: IPlaytestAssertionResult[];
  before?: IPlaytestTransformSample;
  capture?: IPlaytestCaptureProvenance;
  diagnostics: IPlaytestDiagnostic[];
  diagnosticsPolicy?: IPlaytestDiagnosticsPolicy;
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
  setup?: IPlaytestSetupApplication;
  trivialityOptOuts: IPlaytestTrivialityOptOut[];
}
