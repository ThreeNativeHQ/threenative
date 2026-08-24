import type { PlaytestFramePhase } from "../protocol.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PLAYTEST_ASSERTION_REGISTRY } from "../assertions.js";

export const NUMERIC_COMPARISON_KEYS = ["gte", "lte"] as const;
export const MIN_TRIVIALITY_REASON_LENGTH = 20;

export type PlaytestTarget = "web" | "desktop" | "bevy";
export type PlaytestInputDelivery = "deterministic" | "focused-dom";

export interface IPlaytestViewport {
  height: number;
  width: number;
}

export interface IPlaytestPointer {
  buttons?: number;
  id: number;
  x: number;
  y: number;
}

export interface IPlaytestStep {
  kind?: "aimAt" | "input" | "wait";
  /** @deprecated Use holdTicks. Fixed-step bridges treat this as a tick alias. */
  holdFrames?: number;
  holdTicks?: number;
  label?: string;
  overlayMessage?: {
    overlayId: string;
    payload: unknown;
    type: string;
  };
  pitch?: number;
  pointerPosition?: {
    buttons?: number;
    x: number;
    y: number;
  };
  /** The complete held-pointer set for this step, in arrival order. */
  pointers?: readonly IPlaytestPointer[];
  /** A string presses one key; an array describes the complete held-key set. */
  press?: string | readonly string[];
  release: boolean;
  screenshot?: string;
  /** Runner-native aim: yaw/pitch are computed from the sampled subject position. */
  target?: IPlaytestAimTarget;
  /** @deprecated Use waitTicks. Fixed-step bridges treat this as a tick alias. */
  waitFrames?: number;
  waitTicks?: number;
  window?: {
    height?: number;
    operation: "minimize" | "resize" | "restore";
    width?: number;
  };
}

/** Where an aimAt step points: a world xz position or another registered entity. */
export type IPlaytestAimTarget = { entity: string } | { x: number; z: number };

export interface IPlaytestMovementAssertion {
  axis?: string;
  closesDistanceToPosition?: { position: [number, number, number]; min: number };
  entity?: string;
  facesMovementWithinDegrees?: number;
  minAxisDelta?: {
    axis: string;
    min: number;
  };
  minResolvedAxisDelta?: {
    axis: string;
    min: number;
  };
  maxTiltDegrees?: number;
  minDistance?: number;
  minVelocity?: number;
  maxDistance?: number;
  pathLength?: number;
  notFacing?: { entity: string; minDegrees: number };
  notFacingPosition?: { position: [number, number, number]; minDegrees: number };
  reachesPositionWithin?: {
    atStep?: string;
    position: [number, number, number];
    maxDistance: number;
  };
  rotationChanged?: boolean;
}

export interface IPlaytestCameraAssertion {
  entity?: string;
  follows?: string;
  targetInViewport?: boolean;
  within?: number;
}

export interface IPlaytestPathAssertion {
  atSteps?: Array<{
    equals?: unknown;
    label: string;
    textIncludes?: string;
  }>;
  changed?: boolean;
  equals?: unknown;
  gte?: number;
  id: string;
  lte?: number;
  allowTrivial?: string;
  path?: string;
  textIncludes?: string;
  throughoutSteps?: boolean;
}

export interface IPlaytestResourcePathAlternative {
  changed?: boolean;
  equals?: unknown;
  gte?: number;
  lte?: number;
  path: string;
  textIncludes?: string;
}

export interface IPlaytestResourcePathAssertion extends IPlaytestPathAssertion {
  anyOf?: never;
}

export interface IPlaytestResourceAnyOfAssertion {
  anyOf: IPlaytestResourcePathAlternative[];
  atSteps?: never;
  changed?: never;
  equals?: never;
  gte?: never;
  id: string;
  lte?: never;
  allowTrivial?: never;
  path?: never;
  textIncludes?: never;
  throughoutSteps?: never;
}

export type IPlaytestResourceAssertion =
  | IPlaytestResourceAnyOfAssertion
  | IPlaytestResourcePathAssertion;

export interface IPlaytestComponentAssertion extends Omit<IPlaytestPathAssertion, "id" | "textIncludes" | "throughoutSteps"> {
  component: string;
  entity: string;
}

export interface IPlaytestContactAssertion {
  atStep?: string;
  entity?: string;
  kind?: string;
  maxCount?: number;
  minCount?: number;
  requiredOn?: PlaytestTarget[];
  with?: string;
}

export interface IPlaytestSignalAssertion {
  atStep?: string;
  entity?: string;
  maxCount?: number;
  minCount?: number;
  name: string;
}

export interface IPlaytestSettledAssertion {
  atStep?: string;
  allowTrivial?: string;
  compareToStep?: string;
  entity?: string;
  minBodies?: number;
  minMeanPoseDistance?: number;
  requiredOn?: PlaytestTarget[];
}

export interface IPlaytestOccludedAssertion {
  allowTrivial?: string;
  entity?: string;
  target?: string;
}

export interface IPlaytestOverlayNodeAssertion {
  attribute?: string;
  equals?: unknown;
  overlayId: string;
  selector: string;
  textIncludes?: string;
  visible?: boolean;
}

export interface IPlaytestAnimationAssertion {
  advancedFrames?: number;
  allowTrivial?: string;
  clip?: string;
  entered?: boolean;
  entity?: string;
  finished?: boolean;
}

export interface IPlaytestTagCountAssertion {
  allowTrivial?: string;
  count?: number;
  gte?: number;
  lte?: number;
  tag: string;
}

export interface IPlaytestStateAssertion {
  allowTrivial?: string;
  entity?: string;
  equals: string;
}

export interface IPlaytestVisibilityAssertion {
  allowTrivial?: string;
  entity?: string;
  maxOffscreenRatio?: number;
  minProjectedPixels?: number;
  present?: boolean;
}

export interface IPlaytestDiagnosticsAssertion {
  noConsoleErrors?: boolean;
  noNetworkErrors?: boolean;
  noRuntimeDiagnostics?: boolean;
  consoleErrorsOptOutReason?: string;
  networkErrorsOptOutReason?: string;
  runtimeDiagnosticsOptOutReason?: string;
  runtimeReady?: boolean;
}

export interface IPlaytestPerformanceAssertion {
  maxDrawCalls?: number;
  maxFrameMsP95?: number;
  maxTriangles?: number;
  /** Frame-budget floor: the median presented frame must sustain at least this many frames a second. */
  minFps?: number;
  /**
   * Per-phase ceilings in milliseconds, nearest-rank p95 across the sampled frames. The phase
   * names are the engine's frame-budget phases: hostGap, update, render, overlay, residual.
   */
  maxPhaseMsP95?: Readonly<Partial<Record<PlaytestFramePhase, number>>>;
}

export interface IPlaytestFramebufferCoverageAssertion {
  backdrop: [number, number, number];
  grid?: {
    columns: number;
    rows: number;
  };
  tolerance: number;
  window: {
    endStep: string;
    startStep: string;
  };
}

export interface IPlaytestVisualAssertion {
  entityVisible?: { entity: string; minProjectedPixels: number; throughoutFrames?: boolean };
  frameDiff?: { baselineImage?: string; maxChangedPixelRatio?: number; minChangedPixelRatio?: number };
  region?: { height: number; maxLuminance?: number; minDarkPixelRatio?: number; minNonblankPixelRatio?: number; width: number; x: number; y: number };
}

export interface IPlaytestAerodynamicsAssertion {
  controls?: Array<{
    minAbs?: number;
    sign: "negative" | "positive";
    surface: string;
  }>;
  entity: string;
  minForceSamples?: number;
  torques?: Array<{
    axis: "x" | "y" | "z";
    label: string;
    minAbs?: number;
    relativeToLabel?: string;
    sign: "negative" | "positive";
  }>;
}

export interface IPlaytestReachabilityAssertion {
  artifact: string;
  entities: string[];
  /** Loaded from artifact by loadPlaytestScenario; not authored in scenario JSON. */
  envelope?: { fallDistanceToGround: number; forwardReach: number; maxRise: number };
}

export interface IPlaytestWorldRuntimeAssertion {
  agent: string;
  core: string;
  portable?: boolean;
  randomState: number;
  rapier: string | null;
  step: number;
}

export interface IPlaytestWorldAssertion {
  runtime?: IPlaytestWorldRuntimeAssertion;
  seed: number | null;
}

export interface IPlaytestScenarioAssertions {
  aerodynamics?: IPlaytestAerodynamicsAssertion[];
  animation?: IPlaytestAnimationAssertion[];
  camera?: IPlaytestCameraAssertion;
  components?: IPlaytestComponentAssertion[];
  contacts?: IPlaytestContactAssertion[];
  diagnostics?: IPlaytestDiagnosticsAssertion;
  framebufferCoverage?: IPlaytestFramebufferCoverageAssertion;
  hud?: IPlaytestPathAssertion[];
  movement?: IPlaytestMovementAssertion;
  occluded?: IPlaytestOccludedAssertion[];
  overlayNodes?: IPlaytestOverlayNodeAssertion[];
  performance?: IPlaytestPerformanceAssertion;
  reachability?: IPlaytestReachabilityAssertion;
  resources?: IPlaytestResourceAssertion[];
  settled?: IPlaytestSettledAssertion[];
  signals?: IPlaytestSignalAssertion[];
  states?: IPlaytestStateAssertion[];
  tags?: IPlaytestTagCountAssertion[];
  visibility?: IPlaytestVisibilityAssertion[];
  visual?: IPlaytestVisualAssertion[];
  world?: IPlaytestWorldAssertion;
}

export interface IPlaytestParityConfig {
  animation?: Array<{ clip?: string; entity: string; requiredOn?: PlaytestTarget[] }>;
  axisDelta?: Partial<Record<"x" | "y" | "z", number>>;
  contacts?: { minSharedCount?: number };
  movementDistance?: { maxDelta: number };
  resources?: string[];
  targets?: PlaytestTarget[];
}

export interface IPlaytestArtifactRequest {
  console?: boolean;
  contactSheet?: boolean;
  effectLog?: "focused" | boolean;
  network?: boolean;
  runtimeTrace?: boolean;
  screenshots?: "before-after" | "after" | false;
}

export interface IPlaytestSetupEntityTransform {
  entity: string;
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

/** Overrides the subject player start. y is optional and preserves the game's own height when absent. */
export interface IPlaytestSpawnRequest {
  x: number;
  y?: number;
  z: number;
}

/** Overrides the subject player-start aim; both angles are radians (Three.js convention). */
export interface IPlaytestAimRequest {
  pitch: number;
  yaw: number;
}

/**
 * Places a named entity at an explicit world transform before input. Orientation comes
 * from facing yaw or a lookAt point (never both); frozen delivers the placed-frozen
 * marker the game reads to suppress physics motion — placement is data, not teleports.
 */
export interface IPlaytestPlaceRequest {
  at: { x: number; y: number; z: number };
  entity: string;
  facing?: { yaw: number };
  frozen?: boolean;
  lookAt?: { x: number; y: number; z: number };
}

export interface IPlaytestSetupResource {
  id: string;
  path?: string;
  value: unknown;
}

export interface IPlaytestScenarioSetup {
  aim?: IPlaytestAimRequest;
  entities?: IPlaytestSetupEntityTransform[];
  place?: IPlaytestPlaceRequest[];
  resources?: IPlaytestSetupResource[];
  spawn?: IPlaytestSpawnRequest;
}

export interface IPlaytestScenario {
  acceptanceId?: string;
  artifacts?: IPlaytestArtifactRequest;
  assert?: IPlaytestScenarioAssertions;
  inputDelivery?: PlaytestInputDelivery;
  name: string;
  parity?: IPlaytestParityConfig;
  schemaVersion: 1;
  setup?: IPlaytestScenarioSetup;
  sourcePath?: string;
  steps: IPlaytestStep[];
  subject?: string;
  target: PlaytestTarget;
  viewport: IPlaytestViewport;
  warmupFrames: number;
}


export interface IPlaytestScenarioDiagnostic {
  code: "TN_PLAYTEST_SCENARIO_INVALID" | "TN_PLAYTEST_SCENARIO_NOT_FOUND" | "TN_PLAYTEST_SCENARIO_STEP_INVALID";
  fix?: {
    docs?: string;
    instruction: string;
    snippet?: string;
  };
  message: string;
  severity: "error";
  suggestion?: string;
}
