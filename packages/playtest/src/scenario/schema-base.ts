import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

import type {
  IPlaytestAerodynamicsAssertion,
  IPlaytestAnimationAssertion,
  IPlaytestCameraAssertion,
  IPlaytestComponentAssertion,
  IPlaytestComponentsAssertion,
  IPlaytestContactAssertion,
  IPlaytestContactsAssertion,
  IPlaytestDiagnosticsAssertion,
  IPlaytestFramebufferCoverageAssertion,
  IPlaytestHudAssertion,
  IPlaytestMovementAssertion,
  IPlaytestOccludedAssertion,
  IPlaytestOverlayNodeAssertion,
  IPlaytestOverlayNodesAssertion,
  IPlaytestPathAssertion,
  IPlaytestPerformanceAssertion,
  IPlaytestReachabilityAssertion,
  IPlaytestResourceAnyOfAssertion,
  IPlaytestResourceAssertion,
  IPlaytestResourcePathAlternative,
  IPlaytestResourcePathAssertion,
  IPlaytestResourcesAssertion,
  IPlaytestScenarioAssertions,
  IPlaytestSettledAssertion,
  IPlaytestSignalAssertion,
  IPlaytestSignalsAssertion,
  IPlaytestStateAssertion,
  IPlaytestStatesAssertion,
  IPlaytestTagCountAssertion,
  IPlaytestTagsAssertion,
  IPlaytestVisibilityAssertion,
  IPlaytestVisualAssertion,
  IPlaytestWorldAssertion,
  IPlaytestWorldRuntimeAssertion,
} from "./generated-assertion-types.js";

export type {
  IPlaytestAerodynamicsAssertion,
  IPlaytestAnimationAssertion,
  IPlaytestCameraAssertion,
  IPlaytestComponentAssertion,
  IPlaytestComponentsAssertion,
  IPlaytestContactAssertion,
  IPlaytestContactsAssertion,
  IPlaytestDiagnosticsAssertion,
  IPlaytestFramebufferCoverageAssertion,
  IPlaytestHudAssertion,
  IPlaytestMovementAssertion,
  IPlaytestOccludedAssertion,
  IPlaytestOverlayNodeAssertion,
  IPlaytestOverlayNodesAssertion,
  IPlaytestPathAssertion,
  IPlaytestPerformanceAssertion,
  IPlaytestReachabilityAssertion,
  IPlaytestResourceAnyOfAssertion,
  IPlaytestResourceAssertion,
  IPlaytestResourcePathAlternative,
  IPlaytestResourcePathAssertion,
  IPlaytestResourcesAssertion,
  IPlaytestScenarioAssertions,
  IPlaytestSettledAssertion,
  IPlaytestSignalAssertion,
  IPlaytestSignalsAssertion,
  IPlaytestStateAssertion,
  IPlaytestStatesAssertion,
  IPlaytestTagCountAssertion,
  IPlaytestTagsAssertion,
  IPlaytestVisibilityAssertion,
  IPlaytestVisualAssertion,
  IPlaytestWorldAssertion,
  IPlaytestWorldRuntimeAssertion,
};

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
