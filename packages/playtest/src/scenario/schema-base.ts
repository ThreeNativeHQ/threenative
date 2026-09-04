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

export interface IPlaytestWheel {
  deltaX?: number;
  deltaY: number;
}

export interface IPlaytestStep {
  kind?: "aimAt" | "click" | "input" | "wait";
  /** @deprecated Use holdTicks. Fixed-step bridges treat this as a tick alias. */
  holdFrames?: number;
  holdTicks?: number;
  /** A viewport-pixel click target, resolved directly or from a registered entity's bounds. */
  at?: IPlaytestClickTarget;
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
  /** A browser/native wheel sample; negative DOM deltaY is the conventional toward-user gesture. */
  wheel?: IPlaytestWheel;
  window?: {
    height?: number;
    operation: "minimize" | "resize" | "restore";
    width?: number;
  };
}

/** Where an aimAt step points: a world xz position or another registered entity. */
export type IPlaytestAimTarget = { entity: string } | { x: number; z: number };

export type IPlaytestClickTarget = { entity: string } | { x: number; y: number };

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
  /** Require a DOM node to occupy pixels above the page at the sampled viewport centre. */
  visible?: boolean;
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

/**
 * Bounds on the room the game is played in — what a screenshot would have shown, as numbers.
 *
 * Every member fails closed on an unobserved scene: a bridge that does not report `scene.observe`
 * has not reported a well-lit one.
 */
export interface IPlaytestSceneAssertion {
  allowTrivial?: string;
  /** Fail when the camera's far plane cuts the scene it is pointed at. */
  cameraClearsScene?: boolean;
  /** Fail when a linear fog reaches full colour in front of the scene it is fogging. */
  fogClearsScene?: boolean;
  /** Fail when lit materials are mounted and no light in the scene is visible. */
  litMaterialsAreLit?: boolean;
  /** Floor on how many lights the renderer will actually see. */
  minVisibleLights?: number;
}

export interface IPlaytestAnimationAssertion {
  advancedFrames?: number;
  allowTrivial?: string;
  clip?: string;
  entered?: boolean;
  entity?: string;
  finished?: boolean;
  /**
   * Ceiling on |feet − ground| / ground for the observed clip. A run whose producer reports no
   * stride fails closed: the convention is on by default, so silence is a missing observation,
   * not agreement.
   */
  maxFootSlide?: number;
  /** Require the stride convention to be applied (`true`) or deliberately overridden (`false`). */
  strideSynced?: boolean;
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

export interface IPlaytestRenderChainAssertion {
  contributions?: {
    graphOutputChanged: string[];
  };
  tier?: "high" | "medium" | "low" | "off";
  stages?: {
    includes?: string[];
    excludes?: string[];
    /** Ordered subsequence of applied stage ids, not necessarily the complete chain. */
    order?: string[];
  };
  velocity?: {
    maxRejectionFraction: number;
  };
}

/** Ceilings on the application's startup milestones, in milliseconds since navigation. */
export interface IPlaytestStartupAssertion {
  /** The start scene's `enter()` returned: a controllable world exists. */
  maxEnteredMs?: number;
  /** First-use compilation settled or its budget expired. */
  maxCompileSettledMs?: number;
  /** `whenReady()` resolved: the world is safe to show. */
  maxReadyMs?: number;
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

export interface IPlaytestVisualRegionTarget {
  id?: string;
  selector?: string;
}

export interface IPlaytestVisualRegionBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface IPlaytestVisualRegionThresholds {
  maxDarkPixelRatio?: number;
  maxLuminance?: number;
  minDarkPixelRatio?: number;
  minNonblankPixelRatio?: number;
}

export interface IPlaytestVisualStaticRegion extends IPlaytestVisualRegionBounds, IPlaytestVisualRegionThresholds {}

export interface IPlaytestVisualElementRegion extends IPlaytestVisualRegionThresholds {
  element: IPlaytestVisualRegionTarget;
}

export type IPlaytestVisualRegion = IPlaytestVisualStaticRegion | IPlaytestVisualElementRegion;

export interface IPlaytestVisualAssertion {
  entityVisible?: { entity: string; minProjectedPixels: number; throughoutFrames?: boolean };
  frameDiff?: { baselineImage?: string; maxChangedPixelRatio?: number; minChangedPixelRatio?: number };
  region?: IPlaytestVisualRegion;
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

/**
 * Thermal, power and battery state measured around the run itself. Its point is comparability:
 * a run that started hot, or whose thermal status rose while it ran, is not evidence against a
 * cool baseline, and this is how a scenario says so out loud.
 */
export interface IPlaytestDeviceMetricsAssertion {
  /** Ceiling on the battery temperature climb from the first to the last sample, in °C. */
  maxTemperatureRiseC?: number;
  /** Ceiling on the highest Android thermal status observed during the run (0 is NONE). */
  maxThermalStatus?: number;
  /** Requires a run the harness judged comparable with a cool one. */
  notThermallyConfounded?: boolean;
}

export interface IPlaytestScenarioAssertions {
  aerodynamics?: IPlaytestAerodynamicsAssertion[];
  animation?: IPlaytestAnimationAssertion[];
  camera?: IPlaytestCameraAssertion;
  components?: IPlaytestComponentAssertion[];
  contacts?: IPlaytestContactAssertion[];
  deviceMetrics?: IPlaytestDeviceMetricsAssertion;
  diagnostics?: IPlaytestDiagnosticsAssertion;
  framebufferCoverage?: IPlaytestFramebufferCoverageAssertion;
  hud?: IPlaytestPathAssertion[];
  movement?: IPlaytestMovementAssertion;
  occluded?: IPlaytestOccludedAssertion[];
  overlayNodes?: IPlaytestOverlayNodeAssertion[];
  performance?: IPlaytestPerformanceAssertion;
  renderChain?: IPlaytestRenderChainAssertion;
  reachability?: IPlaytestReachabilityAssertion;
  resources?: IPlaytestResourceAssertion[];
  settled?: IPlaytestSettledAssertion[];
  signals?: IPlaytestSignalAssertion[];
  scene?: IPlaytestSceneAssertion;
  startup?: IPlaytestStartupAssertion;
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
  /** Test-only browser seam that makes the renderer's no-adapter boot path deterministic. */
  bootFailure?: "renderer-no-adapter";
  /**
   * Wait for the application to finish its own startup before the first observation. Default
   * true, because a fixed-step run otherwise observes a game that has not finished loading.
   * Set false only when the launch *is* the subject — a loading-screen scenario has to be
   * allowed to look at the loading screen.
   */
  awaitStartup?: boolean;
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
