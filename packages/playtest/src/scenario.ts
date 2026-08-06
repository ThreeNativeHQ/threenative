import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PLAYTEST_ASSERTION_REGISTRY } from "./assertions.js";

export type PlaytestTarget = "web" | "desktop" | "bevy";
export type PlaytestInputDelivery = "deterministic" | "focused-dom";

export interface IPlaytestViewport {
  height: number;
  width: number;
}

export interface IPlaytestStep {
  kind?: "input" | "wait";
  holdFrames?: number;
  holdTicks?: number;
  label?: string;
  overlayMessage?: {
    overlayId: string;
    payload: unknown;
    type: string;
  };
  pointerPosition?: {
    x: number;
    y: number;
  };
  press?: string;
  release: boolean;
  screenshot?: string;
  waitFrames?: number;
  waitTicks?: number;
  window?: {
    height?: number;
    operation: "minimize" | "resize" | "restore";
    width?: number;
  };
}

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
  allowTrivial?: boolean;
  path?: string;
  textIncludes?: string;
  throughoutSteps?: boolean;
}

export interface IPlaytestResourcePathAlternative {
  changed?: boolean;
  equals?: unknown;
  gte?: number;
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

export interface IPlaytestSettledAssertion {
  atStep?: string;
  compareToStep?: string;
  entity: string;
  minBodies?: number;
  minMeanPoseDistance?: number;
  requiredOn?: PlaytestTarget[];
}

export interface IPlaytestOccludedAssertion {
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
  clip?: string;
  entered?: boolean;
  entity?: string;
}

export interface IPlaytestTagCountAssertion {
  count?: number;
  gte?: number;
  tag: string;
}

export interface IPlaytestStateAssertion {
  entity: string;
  equals: string;
}

export interface IPlaytestVisibilityAssertion {
  entity?: string;
  maxOffscreenRatio?: number;
  minProjectedPixels?: number;
}

export interface IPlaytestDiagnosticsAssertion {
  noConsoleErrors?: boolean;
  noNetworkErrors?: boolean;
  noRuntimeDiagnostics?: boolean;
  runtimeDiagnosticsOptOutReason?: string;
  runtimeReady?: boolean;
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

export interface IPlaytestWorldAssertion {
  seed: number | null;
}

export interface IPlaytestScenarioAssertions {
  aerodynamics?: IPlaytestAerodynamicsAssertion[];
  animation?: IPlaytestAnimationAssertion[];
  camera?: IPlaytestCameraAssertion;
  components?: IPlaytestComponentAssertion[];
  contacts?: IPlaytestContactAssertion[];
  diagnostics?: IPlaytestDiagnosticsAssertion;
  hud?: IPlaytestPathAssertion[];
  movement?: IPlaytestMovementAssertion;
  occluded?: IPlaytestOccludedAssertion[];
  overlayNodes?: IPlaytestOverlayNodeAssertion[];
  reachability?: IPlaytestReachabilityAssertion;
  resources?: IPlaytestResourceAssertion[];
  settled?: IPlaytestSettledAssertion[];
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

export interface IPlaytestSetupResource {
  id: string;
  path?: string;
  value: unknown;
}

export interface IPlaytestScenarioSetup {
  entities?: IPlaytestSetupEntityTransform[];
  resources?: IPlaytestSetupResource[];
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

export class PlaytestScenarioError extends Error {
  constructor(readonly diagnostic: IPlaytestScenarioDiagnostic) {
    super(diagnostic.message);
  }
}

export async function loadPlaytestScenario(projectPath: string, scenarioPath: string): Promise<IPlaytestScenario> {
  const absolutePath = resolve(projectPath, scenarioPath);
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch {
    throw new PlaytestScenarioError({
      code: "TN_PLAYTEST_SCENARIO_NOT_FOUND",
      message: `Playtest scenario '${scenarioPath}' could not be read.`,
      severity: "error",
      suggestion: "Check the --scenario path. Committed playtest scenarios normally live under playtests/*.playtest.json.",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PlaytestScenarioError({
      code: "TN_PLAYTEST_SCENARIO_INVALID",
      message: `Playtest scenario '${scenarioPath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      severity: "error",
      suggestion: "Fix the scenario JSON syntax and rerun tn playtest.",
    });
  }
  const scenario = validatePlaytestScenario(parsed, scenarioPath, absolutePath);
  return hydrateReachabilityArtifact(projectPath, scenario, scenarioPath);
}

async function hydrateReachabilityArtifact(projectPath: string, scenario: IPlaytestScenario, scenarioPath: string): Promise<IPlaytestScenario> {
  const assertion = scenario.assert?.reachability;
  if (assertion === undefined) return scenario;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(projectPath, assertion.artifact), "utf8"));
  } catch {
    throw invalidScenario(scenarioPath, `Reachability artifact '${assertion.artifact}' could not be read as JSON.`);
  }
  const envelope = reachabilityEnvelope(parsed);
  if (envelope === undefined) {
    throw invalidScenario(scenarioPath, `Reachability artifact '${assertion.artifact}' must contain finite non-negative maxRise, forwardReach, and fallDistanceToGround measurements.`);
  }
  return {
    ...scenario,
    assert: { ...scenario.assert, reachability: { ...assertion, envelope } },
  };
}

function reachabilityEnvelope(value: unknown): IPlaytestReachabilityAssertion["envelope"] | undefined {
  if (!isRecord(value)) return undefined;
  const measurement = isRecord(value.jump) ? value.jump : value;
  return typeof measurement.maxRise === "number" && Number.isFinite(measurement.maxRise) && measurement.maxRise >= 0
    && typeof measurement.forwardReach === "number" && Number.isFinite(measurement.forwardReach) && measurement.forwardReach >= 0
    && typeof measurement.fallDistanceToGround === "number" && Number.isFinite(measurement.fallDistanceToGround) && measurement.fallDistanceToGround >= measurement.maxRise
    ? { fallDistanceToGround: measurement.fallDistanceToGround, forwardReach: measurement.forwardReach, maxRise: measurement.maxRise }
    : undefined;
}

export function oneShotScenario(options: {
  expectAxis?: string;
  expectMoved: boolean;
  follow?: { entityId: string; within: number };
  frames: number;
  movementThreshold: number;
  press: string;
  subject: string;
  target?: PlaytestTarget;
  viewport?: IPlaytestViewport;
}): IPlaytestScenario {
  return {
    assert: {
      ...(options.expectMoved || options.expectAxis !== undefined
        ? { movement: { axis: options.expectAxis, entity: options.subject, minDistance: options.expectMoved ? options.movementThreshold : undefined } }
        : {}),
      ...(options.follow === undefined ? {} : { camera: { entity: options.follow.entityId, follows: options.subject, within: options.follow.within } }),
    },
    name: `${safeFilePart(options.subject)}-${safeFilePart(options.press)}`,
    schemaVersion: 1,
    steps: [{ holdFrames: options.frames, press: options.press, release: true }],
    subject: options.subject,
    target: options.target ?? "web",
    viewport: options.viewport ?? { height: 720, width: 1280 },
    warmupFrames: 0,
  };
}

export function applyScenarioOverrides(
  scenario: IPlaytestScenario,
  overrides: { target?: PlaytestTarget; viewport?: IPlaytestViewport },
): IPlaytestScenario {
  return {
    ...scenario,
    ...(overrides.target === undefined ? {} : { target: overrides.target }),
    ...(overrides.viewport === undefined ? {} : { viewport: overrides.viewport }),
  };
}

export function parsePlaytestTarget(value: string | undefined): PlaytestTarget | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === "web" || value === "desktop" || value === "bevy" ? value : undefined;
}

export function parseViewport(value: string | undefined): IPlaytestViewport | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? { height, width } : undefined;
}

function validatePlaytestScenario(value: unknown, scenarioPath: string, absolutePath?: string): IPlaytestScenario {
  if (!isRecord(value)) {
    throw invalidScenario(scenarioPath, "Scenario root must be a JSON object.");
  }
  rejectUnknownKeys(value, [
    "acceptanceId",
    "artifacts",
    "assert",
    "inputDelivery",
    "name",
    "parity",
    "schemaVersion",
    "setup",
    "steps",
    "subject",
    "target",
    "viewport",
    "warmupFrames",
  ], scenarioPath, "scenario root");
  if (value.schemaVersion !== 1) {
    throw invalidScenario(scenarioPath, "Scenario schemaVersion must be 1.");
  }
  if (value.acceptanceId !== undefined && (typeof value.acceptanceId !== "string" || value.acceptanceId.length === 0)) {
    throw invalidScenario(scenarioPath, "Scenario acceptanceId must be a non-empty string when present.");
  }
  const name = typeof value.name === "string" ? value.name : undefined;
  if (name === undefined || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw invalidScenario(scenarioPath, "Scenario name must be a stable file-safe identifier.");
  }
  const target = value.target === undefined ? "web" : value.target;
  if (target !== "web" && target !== "desktop" && target !== "bevy") {
    throw invalidScenario(scenarioPath, "Scenario target must be one of: web, desktop, bevy.");
  }
  const inputDelivery = value.inputDelivery ?? "deterministic";
  if (inputDelivery !== "deterministic" && inputDelivery !== "focused-dom") {
    throw invalidScenario(scenarioPath, "Scenario inputDelivery must be deterministic or focused-dom.");
  }
  if (value.assert !== undefined && !isRecord(value.assert)) {
    throw invalidScenario(scenarioPath, "Scenario assert must be a JSON object keyed by supported assertion kinds.");
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw invalidStep(scenarioPath, "Scenario steps[] must contain at least one step.");
  }
  const steps = value.steps.map((step, index) => validateStep(step, scenarioPath, index));
  return {
    ...(typeof value.acceptanceId === "string" ? { acceptanceId: value.acceptanceId } : {}),
    ...(isRecord(value.artifacts) ? { artifacts: validateArtifacts(value.artifacts, scenarioPath) } : {}),
    ...(isRecord(value.assert) ? { assert: validateAssertions(value.assert, scenarioPath) } : {}),
    inputDelivery,
    name,
    ...(isRecord(value.parity) ? { parity: validateParityConfig(value.parity, scenarioPath) } : {}),
    schemaVersion: 1,
    ...(isRecord(value.setup) ? { setup: validateSetup(value.setup, scenarioPath) } : {}),
    ...(absolutePath === undefined ? {} : { sourcePath: absolutePath }),
    steps,
    ...(typeof value.subject === "string" ? { subject: value.subject } : {}),
    target,
    viewport: validateViewport(value.viewport),
    warmupFrames: positiveInteger(value.warmupFrames) ?? 0,
  };
}

function validateArtifacts(value: Record<string, unknown>, scenarioPath: string): IPlaytestArtifactRequest {
  rejectUnknownKeys(value, ["console", "contactSheet", "effectLog", "network", "runtimeTrace", "screenshots"], scenarioPath, "artifacts");
  return value as IPlaytestArtifactRequest;
}

function validateParityConfig(value: Record<string, unknown>, scenarioPath: string): IPlaytestParityConfig {
  rejectUnknownKeys(value, ["animation", "axisDelta", "compare", "contacts", "movementDistance", "resources", "targets"], scenarioPath, "parity");
  if (isRecord(value.compare)) {
    rejectUnknownKeys(value.compare, ["animation", "axisDelta", "contacts", "movementDistance", "resources"], scenarioPath, "parity.compare");
  }
  return {
    ...(Array.isArray(value.animation) ? { animation: value.animation.map(validateParityAnimation).filter((item): item is NonNullable<IPlaytestParityConfig["animation"]>[number] => item !== undefined) } : {}),
    ...(isRecord(value.compare) ? validateParityCompare(value.compare) : validateParityCompare(value)),
    ...(Array.isArray(value.resources) ? { resources: value.resources.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value.targets) ? { targets: value.targets.filter((item): item is PlaytestTarget => item === "web" || item === "desktop" || item === "bevy") } : {}),
  };
}

function validateParityCompare(value: Record<string, unknown>): Omit<IPlaytestParityConfig, "targets"> {
  const movementDistance = isRecord(value.movementDistance) && typeof value.movementDistance.maxDelta === "number" && Number.isFinite(value.movementDistance.maxDelta)
    ? { maxDelta: value.movementDistance.maxDelta }
    : undefined;
  const axisDelta = isRecord(value.axisDelta)
    ? Object.fromEntries(Object.entries(value.axisDelta).filter((entry): entry is ["x" | "y" | "z", number] =>
        (entry[0] === "x" || entry[0] === "y" || entry[0] === "z") && typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ))
    : undefined;
  const contacts = isRecord(value.contacts) && typeof value.contacts.minSharedCount === "number" && Number.isFinite(value.contacts.minSharedCount)
    ? { minSharedCount: value.contacts.minSharedCount }
    : undefined;
  return {
    ...(axisDelta !== undefined && Object.keys(axisDelta).length > 0 ? { axisDelta } : {}),
    ...(Array.isArray(value.animation) ? { animation: value.animation.map(validateParityAnimation).filter((item): item is NonNullable<IPlaytestParityConfig["animation"]>[number] => item !== undefined) } : {}),
    ...(contacts === undefined ? {} : { contacts }),
    ...(movementDistance === undefined ? {} : { movementDistance }),
    ...(Array.isArray(value.resources) ? { resources: value.resources.filter((item): item is string => typeof item === "string") } : {}),
  };
}

function validateParityAnimation(value: unknown): NonNullable<IPlaytestParityConfig["animation"]>[number] | undefined {
  if (!isRecord(value) || typeof value.entity !== "string") {
    return undefined;
  }
  return {
    ...(typeof value.clip === "string" ? { clip: value.clip } : {}),
    entity: value.entity,
    ...(Array.isArray(value.requiredOn) ? { requiredOn: value.requiredOn.filter((item): item is PlaytestTarget => item === "web" || item === "desktop" || item === "bevy") } : {}),
  };
}

function validateSetup(value: Record<string, unknown>, scenarioPath: string): IPlaytestScenarioSetup {
  rejectUnknownKeys(value, ["entities", "resources"], scenarioPath, "setup");
  return {
    ...(Array.isArray(value.entities) ? { entities: value.entities.map((entity, index) => validateSetupEntity(entity, scenarioPath, index)) } : {}),
    ...(Array.isArray(value.resources) ? { resources: value.resources.map((resource, index) => validateSetupResource(resource, scenarioPath, index)) } : {}),
  };
}

function validateSetupResource(value: unknown, scenarioPath: string, index: number): IPlaytestSetupResource {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw invalidScenario(scenarioPath, `Scenario setup.resources[${index}] must name a resource id.`);
  }
  rejectUnknownKeys(value, ["id", "path", "value"], scenarioPath, `setup.resources[${index}]`);
  if (!hasKey(value, "value")) {
    throw invalidScenario(scenarioPath, `Scenario setup.resources[${index}] must define value.`);
  }
  if (value.path !== undefined && (typeof value.path !== "string" || value.path.split(".").some((part) => part.length === 0))) {
    throw invalidScenario(scenarioPath, `Scenario setup.resources[${index}].path must be a non-empty dot path when present.`);
  }
  return {
    id: value.id,
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    value: value.value,
  };
}

function validateSetupEntity(value: unknown, scenarioPath: string, index: number): IPlaytestSetupEntityTransform {
  if (!isRecord(value) || typeof value.entity !== "string" || value.entity.length === 0) {
    throw invalidScenario(scenarioPath, `Scenario setup.entities[${index}] must name an entity.`);
  }
  rejectUnknownKeys(value, ["entity", "position", "rotation", "scale"], scenarioPath, `setup.entities[${index}]`);
  const position = validateOptionalNumberTuple(value, "position", 3, scenarioPath, index);
  const rotation = validateOptionalNumberTuple(value, "rotation", 4, scenarioPath, index);
  const scale = validateOptionalNumberTuple(value, "scale", 3, scenarioPath, index);
  if (position === undefined && rotation === undefined && scale === undefined) {
    throw invalidScenario(scenarioPath, `Scenario setup.entities[${index}] must define position, rotation, or scale.`);
  }
  return {
    entity: value.entity,
    ...(position === undefined ? {} : { position }),
    ...(rotation === undefined ? {} : { rotation }),
    ...(scale === undefined ? {} : { scale }),
  };
}

function validateStep(value: unknown, scenarioPath: string, index: number): IPlaytestStep {
  if (!isRecord(value)) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must be a JSON object.`);
  }
  rejectUnknownKeys(value, [
    "holdFrames",
    "holdTicks",
    "kind",
    "label",
    "overlayMessage",
    "pointerPosition",
    "press",
    "release",
    "screenshot",
    "waitFrames",
    "waitTicks",
    "window",
  ], scenarioPath, `steps[${index}]`);
  const press = typeof value.press === "string" && value.press.length > 0 ? value.press : undefined;
  const overlayMessage = isRecord(value.overlayMessage)
    && typeof value.overlayMessage.overlayId === "string"
    && value.overlayMessage.overlayId.length > 0
    && typeof value.overlayMessage.type === "string"
    && value.overlayMessage.type.length > 0
    ? {
        overlayId: value.overlayMessage.overlayId,
        payload: value.overlayMessage.payload ?? {},
        type: value.overlayMessage.type,
      }
    : undefined;
  const pointerPosition = isRecord(value.pointerPosition)
    && typeof value.pointerPosition.x === "number"
    && Number.isFinite(value.pointerPosition.x)
    && value.pointerPosition.x >= 0
    && value.pointerPosition.x <= 1
    && typeof value.pointerPosition.y === "number"
    && Number.isFinite(value.pointerPosition.y)
    && value.pointerPosition.y >= 0
    && value.pointerPosition.y <= 1
    ? { x: value.pointerPosition.x, y: value.pointerPosition.y }
    : undefined;
  if (isRecord(value.overlayMessage)) {
    rejectUnknownKeys(value.overlayMessage, ["overlayId", "payload", "type"], scenarioPath, `steps[${index}].overlayMessage`);
  }
  if (isRecord(value.pointerPosition)) {
    rejectUnknownKeys(value.pointerPosition, ["x", "y"], scenarioPath, `steps[${index}].pointerPosition`);
  }
  const holdFrames = positiveInteger(value.holdFrames);
  const holdTicks = positiveInteger(value.holdTicks);
  const waitFrames = positiveInteger(value.waitFrames);
  const waitTicks = positiveInteger(value.waitTicks);
  const kind = value.kind === "wait" ? "wait" : value.kind === "input" ? "input" : undefined;
  const screenshot = typeof value.screenshot === "string" && /^[A-Za-z0-9._-]+$/.test(value.screenshot)
    ? value.screenshot
    : undefined;
  const window: IPlaytestStep["window"] = isRecord(value.window)
    && (value.window.operation === "minimize" || value.window.operation === "resize" || value.window.operation === "restore")
    && (value.window.operation !== "resize"
      || (typeof value.window.width === "number" && Number.isFinite(value.window.width) && value.window.width >= 1
        && typeof value.window.height === "number" && Number.isFinite(value.window.height) && value.window.height >= 1))
    ? {
        operation: value.window.operation as NonNullable<IPlaytestStep["window"]>["operation"],
        ...(typeof value.window.width === "number" ? { width: value.window.width } : {}),
        ...(typeof value.window.height === "number" ? { height: value.window.height } : {}),
      }
    : undefined;
  if (isRecord(value.window)) {
    rejectUnknownKeys(value.window, ["height", "operation", "width"], scenarioPath, `steps[${index}].window`);
  }
  if (kind === "wait" && press !== undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} kind wait cannot define press.`);
  }
  if (value.overlayMessage !== undefined && overlayMessage === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} overlayMessage must define non-empty overlayId and type fields.`);
  }
  if (value.pointerPosition !== undefined && pointerPosition === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pointerPosition must define normalized x and y values from 0 through 1.`);
  }
  if (value.screenshot !== undefined && screenshot === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} screenshot must be a stable file-safe name.`);
  }
  if (value.window !== undefined && window === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} window must define minimize, restore, or resize with positive width and height.`);
  }
  if (press === undefined && overlayMessage === undefined && pointerPosition === undefined && window === undefined && waitFrames === undefined && waitTicks === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must define press, overlayMessage, pointerPosition, window, or waitFrames/waitTicks.`);
  }
  if (value.holdFrames !== undefined && holdFrames === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} holdFrames must be a positive integer.`);
  }
  if (value.waitFrames !== undefined && waitFrames === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} waitFrames must be a positive integer.`);
  }
  if (value.holdTicks !== undefined && holdTicks === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} holdTicks must be a positive integer.`);
  }
  if (value.waitTicks !== undefined && waitTicks === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} waitTicks must be a positive integer.`);
  }
  if (holdTicks !== undefined && holdFrames !== undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must choose holdTicks or holdFrames, not both.`);
  }
  if (waitTicks !== undefined && waitFrames !== undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must choose waitTicks or waitFrames, not both.`);
  }
  if (
    (holdTicks !== undefined || waitTicks !== undefined) &&
    (holdFrames !== undefined || waitFrames !== undefined)
  ) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must choose frame timing or fixed ticks, not both.`);
  }
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(holdFrames === undefined ? {} : { holdFrames }),
    ...(holdTicks === undefined ? {} : { holdTicks }),
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(overlayMessage === undefined ? {} : { overlayMessage }),
    ...(pointerPosition === undefined ? {} : { pointerPosition }),
    ...(press === undefined ? {} : { press }),
    release: typeof value.release === "boolean" ? value.release : true,
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(waitFrames === undefined ? {} : { waitFrames }),
    ...(waitTicks === undefined ? {} : { waitTicks }),
    ...(window === undefined ? {} : { window }),
  };
}

export function playtestStepHoldTicks(step: IPlaytestStep, fallback = 1): number {
  if (step.press === undefined || step.holdFrames !== undefined || step.waitFrames !== undefined) return 0;
  return Math.max(1, step.holdTicks ?? fallback);
}

export function playtestStepWaitTicks(step: IPlaytestStep): number {
  return step.waitFrames === undefined ? Math.max(0, step.waitTicks ?? 0) : 0;
}

function validateAssertions(value: Record<string, unknown>, scenarioPath: string): IPlaytestScenarioAssertions {
  rejectUnknownKeys(value, PLAYTEST_ASSERTION_REGISTRY.map((entry) => entry.kind), scenarioPath, "assert");
  validateAssertionShapes(value, scenarioPath);
  validateAssertionKeys(value, scenarioPath);
  const movement = isRecord(value.movement) ? value.movement : undefined;
  const camera = isRecord(value.camera) ? value.camera : undefined;
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : undefined;
  const world = isRecord(value.world) ? value.world : undefined;
  if (diagnostics?.noRuntimeDiagnostics === false
    && (typeof diagnostics.runtimeDiagnosticsOptOutReason !== "string" || diagnostics.runtimeDiagnosticsOptOutReason.trim() === "")) {
    throw invalidScenario(
      scenarioPath,
      "Assertion 'assert.diagnostics.noRuntimeDiagnostics' may be false only when 'runtimeDiagnosticsOptOutReason' explains the bounded exception.",
    );
  }
  return {
    ...(Array.isArray(value.aerodynamics) ? { aerodynamics: value.aerodynamics.map(validateAerodynamicsAssertion).filter((item): item is IPlaytestAerodynamicsAssertion => item !== undefined) } : {}),
    ...(Array.isArray(value.animation) ? { animation: value.animation.map(validateAnimationAssertion).filter((item): item is IPlaytestAnimationAssertion => item !== undefined) } : {}),
    ...(camera === undefined
      ? {}
      : {
          camera: {
            ...(typeof camera.entity === "string" ? { entity: camera.entity } : {}),
            ...(typeof camera.follows === "string" ? { follows: camera.follows } : {}),
            ...(typeof camera.targetInViewport === "boolean" ? { targetInViewport: camera.targetInViewport } : {}),
            ...(typeof camera.within === "number" && Number.isFinite(camera.within) ? { within: camera.within } : {}),
          },
        }),
    ...(Array.isArray(value.components)
      ? {
          components: value.components.map((entry, index) =>
            validateComponentAssertion(entry, scenarioPath, `assert.components[${index}]`),
          ),
        }
      : {}),
    ...(Array.isArray(value.contacts) ? { contacts: value.contacts.map(validateContactAssertion).filter((item): item is IPlaytestContactAssertion => item !== undefined) } : {}),
    ...(diagnostics === undefined
      ? {}
      : {
          diagnostics: {
            ...(typeof diagnostics.noConsoleErrors === "boolean" ? { noConsoleErrors: diagnostics.noConsoleErrors } : {}),
            ...(typeof diagnostics.noNetworkErrors === "boolean" ? { noNetworkErrors: diagnostics.noNetworkErrors } : {}),
            ...(typeof diagnostics.noRuntimeDiagnostics === "boolean" ? { noRuntimeDiagnostics: diagnostics.noRuntimeDiagnostics } : {}),
            ...(typeof diagnostics.runtimeDiagnosticsOptOutReason === "string" ? { runtimeDiagnosticsOptOutReason: diagnostics.runtimeDiagnosticsOptOutReason } : {}),
            ...(typeof diagnostics.runtimeReady === "boolean" ? { runtimeReady: diagnostics.runtimeReady } : {}),
          },
        }),
    ...(Array.isArray(value.hud) ? { hud: value.hud.map(validatePathAssertion).filter((item): item is IPlaytestPathAssertion => item !== undefined) } : {}),
    ...(movement === undefined
      ? {}
      : {
          movement: {
            ...(typeof movement.axis === "string" ? { axis: movement.axis } : {}),
            ...(isRecord(movement.closesDistanceToPosition) && validateNumberTuple(movement.closesDistanceToPosition.position, 3) !== undefined && typeof movement.closesDistanceToPosition.min === "number" && Number.isFinite(movement.closesDistanceToPosition.min)
              ? { closesDistanceToPosition: { position: validateNumberTuple(movement.closesDistanceToPosition.position, 3)!, min: movement.closesDistanceToPosition.min } }
              : {}),
            ...(typeof movement.entity === "string" ? { entity: movement.entity } : {}),
            ...(typeof movement.facesMovementWithinDegrees === "number" && Number.isFinite(movement.facesMovementWithinDegrees)
              ? { facesMovementWithinDegrees: movement.facesMovementWithinDegrees }
              : {}),
            ...(isRecord(movement.minAxisDelta) && typeof movement.minAxisDelta.axis === "string" && typeof movement.minAxisDelta.min === "number" && Number.isFinite(movement.minAxisDelta.min)
              ? { minAxisDelta: { axis: movement.minAxisDelta.axis, min: movement.minAxisDelta.min } }
              : {}),
            ...(isRecord(movement.minResolvedAxisDelta) && typeof movement.minResolvedAxisDelta.axis === "string" && typeof movement.minResolvedAxisDelta.min === "number" && Number.isFinite(movement.minResolvedAxisDelta.min)
              ? { minResolvedAxisDelta: { axis: movement.minResolvedAxisDelta.axis, min: movement.minResolvedAxisDelta.min } }
              : {}),
            ...(typeof movement.maxTiltDegrees === "number" && Number.isFinite(movement.maxTiltDegrees) && movement.maxTiltDegrees >= 0 && movement.maxTiltDegrees <= 180
              ? { maxTiltDegrees: movement.maxTiltDegrees }
              : {}),
            ...(typeof movement.minDistance === "number" && Number.isFinite(movement.minDistance) ? { minDistance: movement.minDistance } : {}),
            ...(typeof movement.maxDistance === "number" && Number.isFinite(movement.maxDistance) && movement.maxDistance >= 0 ? { maxDistance: movement.maxDistance } : {}),
            ...(typeof movement.minVelocity === "number" && Number.isFinite(movement.minVelocity) ? { minVelocity: movement.minVelocity } : {}),
            ...(typeof movement.pathLength === "number" && Number.isFinite(movement.pathLength) && movement.pathLength >= 0 ? { pathLength: movement.pathLength } : {}),
            ...(isRecord(movement.notFacing) && typeof movement.notFacing.entity === "string" && typeof movement.notFacing.minDegrees === "number" && Number.isFinite(movement.notFacing.minDegrees)
              ? { notFacing: { entity: movement.notFacing.entity, minDegrees: movement.notFacing.minDegrees } }
              : {}),
            ...(isRecord(movement.notFacingPosition) && validateNumberTuple(movement.notFacingPosition.position, 3) !== undefined && typeof movement.notFacingPosition.minDegrees === "number" && Number.isFinite(movement.notFacingPosition.minDegrees)
              ? { notFacingPosition: { position: validateNumberTuple(movement.notFacingPosition.position, 3)!, minDegrees: movement.notFacingPosition.minDegrees } }
              : {}),
            ...(isRecord(movement.reachesPositionWithin) && validateNumberTuple(movement.reachesPositionWithin.position, 3) !== undefined && typeof movement.reachesPositionWithin.maxDistance === "number" && Number.isFinite(movement.reachesPositionWithin.maxDistance)
              ? {
                reachesPositionWithin: {
                  ...(typeof movement.reachesPositionWithin.atStep === "string"
                    ? { atStep: movement.reachesPositionWithin.atStep }
                    : {}),
                  position: validateNumberTuple(movement.reachesPositionWithin.position, 3)!,
                  maxDistance: movement.reachesPositionWithin.maxDistance,
                },
              }
              : {}),
            ...(typeof movement.rotationChanged === "boolean" ? { rotationChanged: movement.rotationChanged } : {}),
          },
    }),
    ...(Array.isArray(value.occluded) ? { occluded: value.occluded.map(validateOccludedAssertion).filter((item): item is IPlaytestOccludedAssertion => item !== undefined) } : {}),
    ...(Array.isArray(value.overlayNodes)
      ? {
          overlayNodes: value.overlayNodes.map((entry, index) =>
            validateOverlayNodeAssertion(entry, scenarioPath, `assert.overlayNodes[${index}]`),
          ),
        }
      : {}),
    ...(isRecord(value.reachability) ? { reachability: validateReachabilityAssertion(value.reachability, scenarioPath) } : {}),
    ...(Array.isArray(value.resources) ? { resources: value.resources.map((item, index) => validateResourcePathAssertion(item, scenarioPath, `assert.resources[${index}]`)) } : {}),
    ...(Array.isArray(value.settled)
      ? {
          settled: value.settled.map((entry, index) =>
            validateSettledAssertion(entry, scenarioPath, `assert.settled[${index}]`),
          ),
        }
      : {}),
    ...(Array.isArray(value.states) ? { states: value.states.map((entry, index) => validateStateAssertion(entry, scenarioPath, `assert.states[${index}]`)) } : {}),
    ...(Array.isArray(value.tags) ? { tags: value.tags.map((entry, index) => validateTagCountAssertion(entry, scenarioPath, `assert.tags[${index}]`)) } : {}),
    ...(Array.isArray(value.visibility) ? { visibility: value.visibility.map(validateVisibilityAssertion).filter((item): item is IPlaytestVisibilityAssertion => item !== undefined) } : {}),
    ...(Array.isArray(value.visual) ? { visual: value.visual.map(validateVisualAssertion).filter((item): item is IPlaytestVisualAssertion => item !== undefined) } : {}),
    ...(world === undefined ? {} : { world: validateWorldAssertion(world, scenarioPath) }),
  };
}

function validateWorldAssertion(value: Record<string, unknown>, scenarioPath: string): IPlaytestWorldAssertion {
  if (!hasKey(value, "seed") || (value.seed !== null && (typeof value.seed !== "number" || !Number.isFinite(value.seed)))) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.world.seed' must be a finite number or null.");
  }
  return { seed: value.seed as number | null };
}

function validateReachabilityAssertion(value: Record<string, unknown>, scenarioPath: string): IPlaytestReachabilityAssertion {
  if (typeof value.artifact !== "string" || value.artifact.trim() === "") {
    throw invalidScenario(scenarioPath, "Assertion 'assert.reachability.artifact' must be a non-empty project-relative path.");
  }
  if (!Array.isArray(value.entities) || value.entities.length < 2
    || value.entities.some((entity) => typeof entity !== "string" || entity.trim() === "")) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.reachability.entities' must contain at least two non-empty entity ids.");
  }
  const entities = value.entities as string[];
  if (entities.some((entity, index) => index > 0 && entity === entities[index - 1])) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.reachability.entities' must not repeat a consecutive entity id.");
  }
  return {
    artifact: value.artifact,
    entities,
  };
}

function validateSettledAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestSettledAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["atStep", "compareToStep", "entity", "minBodies", "minMeanPoseDistance", "requiredOn"], scenarioPath, objectPath);
  return {
    ...present("atStep", optionalString(record, "atStep", scenarioPath, objectPath)),
    ...present("compareToStep", optionalString(record, "compareToStep", scenarioPath, objectPath)),
    entity: requireString(record, "entity", scenarioPath, objectPath),
    ...present("minBodies", optionalPositiveInteger(record, "minBodies", scenarioPath, objectPath)),
    ...present("minMeanPoseDistance", optionalPositiveNumber(record, "minMeanPoseDistance", scenarioPath, objectPath)),
    ...present("requiredOn", optionalTargetArray(record, "requiredOn", scenarioPath, objectPath)),
  };
}

function validateOverlayNodeAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestOverlayNodeAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["attribute", "equals", "overlayId", "selector", "textIncludes", "visible"], scenarioPath, objectPath);
  return {
    ...present("attribute", optionalString(record, "attribute", scenarioPath, objectPath)),
    // `equals` is deliberately untyped: an overlay node may be compared against any
    // JSON value, so presence is the only check that can be made here.
    ...(hasKey(record, "equals") ? { equals: record.equals } : {}),
    overlayId: requireString(record, "overlayId", scenarioPath, objectPath),
    selector: requireString(record, "selector", scenarioPath, objectPath),
    ...present("textIncludes", optionalString(record, "textIncludes", scenarioPath, objectPath)),
    ...present("visible", optionalBoolean(record, "visible", scenarioPath, objectPath)),
  };
}

function validateComponentAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestComponentAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "atSteps", "changed", "component", "entity", "equals", "gte", "path"], scenarioPath, objectPath);
  return {
    ...(record.atSteps === undefined
      ? {}
      : {
        atSteps: requireArray(record, "atSteps", scenarioPath, objectPath).map((step, index) => {
          const stepPath = `${objectPath}.atSteps[${index}]`;
          const stepRecord = requireRecord(step, scenarioPath, stepPath);
          rejectUnknownKeys(stepRecord, ["equals", "label"], scenarioPath, stepPath);
          return {
            ...(hasKey(stepRecord, "equals") ? { equals: stepRecord.equals } : {}),
            label: requireString(stepRecord, "label", scenarioPath, stepPath),
          };
        }),
      }),
    ...present("changed", optionalBoolean(record, "changed", scenarioPath, objectPath)),
    component: requireString(record, "component", scenarioPath, objectPath),
    entity: requireString(record, "entity", scenarioPath, objectPath),
    ...present("allowTrivial", optionalBoolean(record, "allowTrivial", scenarioPath, objectPath)),
    // As above: any JSON value is a legal comparison target.
    ...(hasKey(record, "equals") ? { equals: record.equals } : {}),
    ...present("gte", optionalNumber(record, "gte", scenarioPath, objectPath)),
    ...present("path", optionalString(record, "path", scenarioPath, objectPath)),
  };
}

function validateAssertionShapes(value: Record<string, unknown>, scenarioPath: string): void {
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    const assertionValue = value[entry.kind];
    if (assertionValue === undefined) {
      continue;
    }
    const valid = entry.cardinality === "array"
      ? Array.isArray(assertionValue)
      : isRecord(assertionValue);
    if (!valid) {
      throw invalidScenario(
        scenarioPath,
        `Assertion 'assert.${entry.kind}' must be ${entry.cardinality === "array" ? "an array" : "an object"}; the declared assertion cannot be executed.`,
      );
    }
  }
}

function validateAerodynamicsAssertion(value: unknown): IPlaytestAerodynamicsAssertion | undefined {
  if (!isRecord(value) || typeof value.entity !== "string") return undefined;
  const controls: IPlaytestAerodynamicsAssertion["controls"] = Array.isArray(value.controls)
    ? value.controls.flatMap((control) => isRecord(control)
      && typeof control.surface === "string"
      && (control.sign === "negative" || control.sign === "positive")
      ? [{
          ...(typeof control.minAbs === "number" && Number.isFinite(control.minAbs) && control.minAbs >= 0 ? { minAbs: control.minAbs } : {}),
          sign: control.sign as "negative" | "positive",
          surface: control.surface,
        }]
      : [])
    : undefined;
  const torques: IPlaytestAerodynamicsAssertion["torques"] = Array.isArray(value.torques)
    ? value.torques.flatMap((torque) => isRecord(torque)
      && (torque.axis === "x" || torque.axis === "y" || torque.axis === "z")
      && typeof torque.label === "string"
      && (torque.sign === "negative" || torque.sign === "positive")
      ? [{
          axis: torque.axis,
          label: torque.label,
          ...(typeof torque.minAbs === "number" && Number.isFinite(torque.minAbs) && torque.minAbs >= 0 ? { minAbs: torque.minAbs } : {}),
          ...(typeof torque.relativeToLabel === "string" ? { relativeToLabel: torque.relativeToLabel } : {}),
          sign: torque.sign as "negative" | "positive",
        }]
      : [])
    : undefined;
  return {
    ...(controls === undefined ? {} : { controls }),
    entity: value.entity,
    ...(typeof value.minForceSamples === "number" && Number.isInteger(value.minForceSamples) && value.minForceSamples > 0 ? { minForceSamples: value.minForceSamples } : {}),
    ...(torques === undefined ? {} : { torques }),
  };
}

function validateOccludedAssertion(value: unknown): IPlaytestOccludedAssertion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(typeof value.entity === "string" ? { entity: value.entity } : {}),
    ...(typeof value.target === "string" ? { target: value.target } : {}),
  };
}

function validateVisualAssertion(value: unknown): IPlaytestVisualAssertion | undefined {
  if (!isRecord(value)) return undefined;
  const frameDiff = isRecord(value.frameDiff) ? value.frameDiff : undefined;
  const region = isRecord(value.region) ? value.region : undefined;
  const entityVisible = isRecord(value.entityVisible) ? value.entityVisible : undefined;
  const validRegion = region !== undefined && [region.x, region.y, region.width, region.height].every((item) => typeof item === "number" && Number.isFinite(item));
  return {
    ...(frameDiff === undefined ? {} : { frameDiff: {
      ...(isSafeProjectRelativePng(frameDiff.baselineImage) ? { baselineImage: frameDiff.baselineImage } : {}),
      ...(typeof frameDiff.minChangedPixelRatio === "number" ? { minChangedPixelRatio: frameDiff.minChangedPixelRatio } : {}),
      ...(typeof frameDiff.maxChangedPixelRatio === "number" ? { maxChangedPixelRatio: frameDiff.maxChangedPixelRatio } : {}),
    } }),
    ...(validRegion ? { region: {
      height: Number(region.height), width: Number(region.width), x: Number(region.x), y: Number(region.y),
      ...(typeof region.minNonblankPixelRatio === "number" ? { minNonblankPixelRatio: region.minNonblankPixelRatio } : {}),
      ...(typeof region.maxLuminance === "number" ? { maxLuminance: region.maxLuminance } : {}),
      ...(typeof region.minDarkPixelRatio === "number" ? { minDarkPixelRatio: region.minDarkPixelRatio } : {}),
    } } : {}),
    ...(entityVisible !== undefined && typeof entityVisible.entity === "string" && typeof entityVisible.minProjectedPixels === "number" ? { entityVisible: {
      entity: entityVisible.entity,
      minProjectedPixels: entityVisible.minProjectedPixels,
      ...(typeof entityVisible.throughoutFrames === "boolean" ? { throughoutFrames: entityVisible.throughoutFrames } : {}),
    } } : {}),
  };
}

function isSafeProjectRelativePng(value: unknown): value is string {
  if (
    typeof value !== "string"
    || !value.toLowerCase().endsWith(".png")
    || value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false;
  }
  return !value.split(/[\\/]/).includes("..");
}

// Typed field accessors (CHARTER.md §8).
//
// The distinction these exist to enforce: a key that is ABSENT is fine and yields
// undefined; a key that is PRESENT but wrong-typed throws. Collapsing those two
// cases into a single `undefined` is what let a malformed assertion disappear and
// leave the scenario reporting green with nothing asserted.
//
// `optionalX` returning undefined only for an absent key kills that bug class by
// construction, so it cannot be reintroduced one careless `...(cond ? {} : {})` at
// a time.

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  return `${typeof value} ${JSON.stringify(value) ?? String(value)}`;
}

function requireRecord(value: unknown, scenarioPath: string, objectPath: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must be an object, received ${describeValue(value)}.`);
  }
  return value;
}

function requireArray(
  value: Record<string, unknown>,
  key: string,
  scenarioPath: string,
  objectPath: string,
): unknown[] {
  const raw = value[key];
  if (!Array.isArray(raw)) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be an array, received ${describeValue(raw)}.`);
  }
  return raw;
}

function requireString(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): string {
  const raw = value[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a non-empty string, received ${describeValue(raw)}.`);
  }
  return raw;
}

function optionalString(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): string | undefined {
  if (value[key] === undefined) return undefined;
  return requireString(value, key, scenarioPath, objectPath);
}

function optionalBoolean(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): boolean | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a boolean, received ${describeValue(raw)}.`);
  }
  return raw;
}

function optionalNumber(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a finite number, received ${describeValue(raw)}.`);
  }
  return raw;
}

function optionalNonNegativeInteger(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a non-negative integer, received ${describeValue(raw)}.`);
  }
  return raw;
}

function optionalPositiveInteger(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a positive integer, received ${describeValue(raw)}.`);
  }
  return raw;
}

function optionalPositiveNumber(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a positive number, received ${describeValue(raw)}.`);
  }
  return raw;
}

function optionalTargetArray(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): PlaytestTarget[] | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be an array of targets, received ${describeValue(raw)}.`);
  }
  return raw.map((target, index) => {
    if (target !== "web" && target !== "desktop" && target !== "bevy") {
      throw invalidScenario(scenarioPath, `'${objectPath}.${key}[${index}]' must be one of web, desktop, bevy; received ${describeValue(target)}.`);
    }
    return target;
  });
}

/** Spread helper: omits an absent key, keeps a validated one. */
function present<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function validateStateAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestStateAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["entity", "equals"], scenarioPath, objectPath);
  return {
    entity: requireString(record, "entity", scenarioPath, objectPath),
    equals: requireString(record, "equals", scenarioPath, objectPath),
  };
}

function validateTagCountAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestTagCountAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["count", "gte", "tag"], scenarioPath, objectPath);
  const count = optionalNonNegativeInteger(record, "count", scenarioPath, objectPath);
  const gte = optionalNonNegativeInteger(record, "gte", scenarioPath, objectPath);
  // Without a bound the evaluator degrades to "a numeric count exists", which is
  // satisfied by a count of zero — the opposite of what `tags: [{ tag: "coin" }]`
  // was written to prove. Reject it at load time, where the author sees it.
  if (count === undefined && gte === undefined) {
    throw invalidScenario(
      scenarioPath,
      `'${objectPath}' must declare 'count' or 'gte'; a tag assertion with neither passes on a count of zero.`,
    );
  }
  return {
    ...present("count", count),
    ...present("gte", gte),
    tag: requireString(record, "tag", scenarioPath, objectPath),
  };
}

function validateContactAssertion(value: unknown): IPlaytestContactAssertion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(typeof value.atStep === "string" ? { atStep: value.atStep } : {}),
    ...(typeof value.entity === "string" ? { entity: value.entity } : {}),
    ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
    ...(typeof value.maxCount === "number" && Number.isInteger(value.maxCount) && value.maxCount >= 0 ? { maxCount: value.maxCount } : {}),
    ...(typeof value.minCount === "number" && Number.isFinite(value.minCount) ? { minCount: value.minCount } : {}),
    ...(Array.isArray(value.requiredOn) ? { requiredOn: value.requiredOn.filter((item): item is PlaytestTarget => item === "web" || item === "desktop" || item === "bevy") } : {}),
    ...(typeof value.with === "string" ? { with: value.with } : {}),
  };
}

function validateAnimationAssertion(value: unknown): IPlaytestAnimationAssertion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(typeof value.advancedFrames === "number" && Number.isFinite(value.advancedFrames) ? { advancedFrames: value.advancedFrames } : {}),
    ...(typeof value.clip === "string" ? { clip: value.clip } : {}),
    ...(typeof value.entered === "boolean" ? { entered: value.entered } : {}),
    ...(typeof value.entity === "string" ? { entity: value.entity } : {}),
  };
}

function validateVisibilityAssertion(value: unknown): IPlaytestVisibilityAssertion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(typeof value.entity === "string" ? { entity: value.entity } : {}),
    ...(typeof value.maxOffscreenRatio === "number" && Number.isFinite(value.maxOffscreenRatio) ? { maxOffscreenRatio: value.maxOffscreenRatio } : {}),
    ...(typeof value.minProjectedPixels === "number" && Number.isFinite(value.minProjectedPixels) ? { minProjectedPixels: value.minProjectedPixels } : {}),
  };
}

function validatePathAssertion(value: unknown): IPlaytestPathAssertion | undefined {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }
  return {
    ...(Array.isArray(value.atSteps) ? { atSteps: value.atSteps.flatMap((step) => isRecord(step) && typeof step.label === "string"
      ? [{ ...(hasKey(step, "equals") ? { equals: step.equals } : {}), label: step.label, ...(typeof step.textIncludes === "string" ? { textIncludes: step.textIncludes } : {}) }]
      : []) } : {}),
    ...(typeof value.changed === "boolean" ? { changed: value.changed } : {}),
    ...(typeof value.allowTrivial === "boolean" ? { allowTrivial: value.allowTrivial } : {}),
    ...(hasKey(value, "equals") ? { equals: value.equals } : {}),
    ...(typeof value.gte === "number" && Number.isFinite(value.gte) ? { gte: value.gte } : {}),
    id: value.id,
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(typeof value.textIncludes === "string" ? { textIncludes: value.textIncludes } : {}),
    ...(typeof value.throughoutSteps === "boolean" ? { throughoutSteps: value.throughoutSteps } : {}),
  };
}

function validateResourcePathAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestResourceAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  if (hasKey(record, "anyOf")) {
    rejectUnknownKeys(record, ["anyOf", "id"], scenarioPath, objectPath);
    const alternatives = requireArray(record, "anyOf", scenarioPath, objectPath);
    if (alternatives.length === 0) {
      throw invalidScenario(scenarioPath, `'${objectPath}.anyOf' must contain at least one path assertion.`);
    }
    return {
      anyOf: alternatives.map((alternative, index) => validateResourcePathAlternative(
        alternative,
        scenarioPath,
        `${objectPath}.anyOf[${index}]`,
      )),
      id: requireString(record, "id", scenarioPath, objectPath),
    };
  }
  const assertion = validatePathAssertion(record);
  if (assertion === undefined) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must name a resource id.`);
  }
  return assertion;
}

function validateResourcePathAlternative(
  value: unknown,
  scenarioPath: string,
  objectPath: string,
): IPlaytestResourcePathAlternative {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["changed", "equals", "gte", "path", "textIncludes"], scenarioPath, objectPath);
  const changed = optionalBoolean(record, "changed", scenarioPath, objectPath);
  const gte = optionalNumber(record, "gte", scenarioPath, objectPath);
  const textIncludes = optionalString(record, "textIncludes", scenarioPath, objectPath);
  if (!hasKey(record, "equals") && changed === undefined && gte === undefined && textIncludes === undefined) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must declare equals, gte, textIncludes, or changed.`);
  }
  return {
    ...present("changed", changed),
    ...(hasKey(record, "equals") ? { equals: record.equals } : {}),
    ...present("gte", gte),
    path: requireString(record, "path", scenarioPath, objectPath),
    ...present("textIncludes", textIncludes),
  };
}

function validateViewport(value: unknown): IPlaytestViewport {
  if (!isRecord(value)) {
    return { height: 720, width: 1280 };
  }
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  return width === undefined || height === undefined ? { height: 720, width: 1280 } : { height, width };
}

function invalidScenario(scenarioPath: string, message: string): PlaytestScenarioError {
  return new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_INVALID",
    fix: {
      docs: "docs/workflows/playtest-proof.md",
      instruction: "Use playtest schemaVersion 1 with a file-safe name, target, viewport, warmupFrames, and non-empty steps.",
      snippet: '{ "schemaVersion": 1, "name": "forward-smoke", "target": "web", "viewport": { "width": 1280, "height": 720 }, "warmupFrames": 10, "steps": [{ "kind": "input", "press": "KeyW", "holdTicks": 30, "release": true }] }',
    },
    message: `Playtest scenario '${scenarioPath}' is invalid: ${message}`,
    severity: "error",
    suggestion: "Use schemaVersion 1 with a file-safe name, a supported target, and non-empty steps.",
  });
}

function invalidStep(scenarioPath: string, message: string): PlaytestScenarioError {
  return new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_STEP_INVALID",
    fix: {
      docs: "docs/workflows/playtest-proof.md",
      instruction: "Give each step either a press with positive holdTicks/holdFrames or a positive waitTicks/waitFrames value; use kind: wait for an explicit no-input interval.",
      snippet: '{ "kind": "input", "press": "KeyW", "holdTicks": 30, "release": true }',
    },
    message: `Playtest scenario '${scenarioPath}' has an invalid step: ${message}`,
    severity: "error",
    suggestion: "Each step must define press or waitTicks/waitFrames; holdTicks/holdFrames and waitTicks/waitFrames must be positive integers.",
  });
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function validateOptionalNumberTuple(value: Record<string, unknown>, key: "position" | "scale", length: 3, scenarioPath: string, index: number): [number, number, number] | undefined;
function validateOptionalNumberTuple(value: Record<string, unknown>, key: "rotation", length: 4, scenarioPath: string, index: number): [number, number, number, number] | undefined;
function validateOptionalNumberTuple(
  value: Record<string, unknown>,
  key: "position" | "rotation" | "scale",
  length: 3 | 4,
  scenarioPath: string,
  index: number,
): [number, number, number] | [number, number, number, number] | undefined {
  if (!hasKey(value, key)) {
    return undefined;
  }
  const tuple = length === 3 ? validateNumberTuple(value[key], 3) : validateNumberTuple(value[key], 4);
  if (tuple === undefined) {
    throw invalidScenario(scenarioPath, `Scenario setup.entities[${index}].${key} must be a ${length}-number tuple.`);
  }
  return tuple;
}

function validateNumberTuple(value: unknown, length: 3): [number, number, number] | undefined;
function validateNumberTuple(value: unknown, length: 4): [number, number, number, number] | undefined;
function validateNumberTuple(value: unknown, length: 3 | 4): [number, number, number] | [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  return value as [number, number, number] | [number, number, number, number];
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// CHARTER.md §8, the per-key variant. `rejectUnknownKeys` catches a misspelled key,
// but a KNOWN key holding a wrong-typed value used to survive it and then get
// dropped by the `typeof x === "number" ? { x } : {}` spreads in validateAssertions.
// The assertion object stayed, minus the check the author wrote, and the scenario
// reported green having proved nothing. `"minDistance": "0.5"` was a silent pass.
//
// The registry already declares every field's type, so the check lives here once
// instead of in each spread. Composite types (objects, arrays, json) are still
// validated by their own validators; only the scalar contract is enforced here.
const ASSERTION_FIELD_TYPE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  "boolean": (value) => typeof value === "boolean",
  "non-empty string": isNonEmptyString,
  "non-negative integer": (value) => typeof value === "number" && Number.isInteger(value) && value >= 0,
  "number": (value) => typeof value === "number" && Number.isFinite(value),
  "number in [0, 180]": (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 180,
  "positive integer": (value) => typeof value === "number" && Number.isInteger(value) && value > 0,
  "positive number": (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  "string": isNonEmptyString,
};

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function rejectWrongTypedFields(
  fields: readonly { name: string; type: string }[],
  value: Record<string, unknown>,
  scenarioPath: string,
  objectPath: string,
): void {
  for (const field of fields) {
    const check = ASSERTION_FIELD_TYPE_CHECKS[field.type];
    if (check === undefined || value[field.name] === undefined) continue;
    if (!check(value[field.name])) {
      throw invalidScenario(
        scenarioPath,
        `'${objectPath}.${field.name}' must be ${field.type}, received ${describeValue(value[field.name])}.`,
      );
    }
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  scenarioPath: string,
  objectPath: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw invalidScenario(
      scenarioPath,
      `Unknown key '${unknown}' at ${objectPath}.${unknown}. Supported keys: ${[...allowed].sort().join(", ")}.`,
    );
  }
}

function validateAssertionKeys(value: Record<string, unknown>, scenarioPath: string): void {
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    const assertionValue = value[entry.kind];
    if (assertionValue === undefined) {
      continue;
    }
    const items = Array.isArray(assertionValue) ? assertionValue : [assertionValue];
    items.forEach((item, index) => {
      if (!isRecord(item)) {
        return;
      }
      const suffix = Array.isArray(assertionValue) ? `[${index}]` : "";
      rejectUnknownKeys(item, entry.fields.map((field) => field.name), scenarioPath, `assert.${entry.kind}${suffix}`);
      rejectWrongTypedFields(entry.fields, item, scenarioPath, `assert.${entry.kind}${suffix}`);
      validateNestedAssertionKeys(entry.kind, item, scenarioPath, suffix);
    });
  }
}

function validateNestedAssertionKeys(
  kind: keyof IPlaytestScenarioAssertions,
  value: Record<string, unknown>,
  scenarioPath: string,
  suffix: string,
): void {
  if (kind === "movement") {
    for (const field of ["minAxisDelta", "minResolvedAxisDelta"] as const) {
      if (isRecord(value[field])) {
        rejectUnknownKeys(value[field], ["axis", "min"], scenarioPath, `assert.${kind}${suffix}.${field}`);
      }
    }
  }
  if (kind === "resources" || kind === "hud" || kind === "components") {
    if (kind === "resources" && hasKey(value, "anyOf")) {
      rejectUnknownKeys(value, ["anyOf", "id"], scenarioPath, `assert.${kind}${suffix}`);
      return;
    }
    if (Array.isArray(value.atSteps)) {
      value.atSteps.forEach((step, index) => {
        if (isRecord(step)) {
          rejectUnknownKeys(step, kind === "components" ? ["equals", "label"] : ["equals", "label", "textIncludes"], scenarioPath, `assert.${kind}${suffix}.atSteps[${index}]`);
        }
      });
    }
  }
  if (kind === "visual") {
    const fields = {
      entityVisible: ["entity", "minProjectedPixels", "throughoutFrames"],
      frameDiff: ["baselineImage", "maxChangedPixelRatio", "minChangedPixelRatio"],
      region: ["height", "maxLuminance", "minDarkPixelRatio", "minNonblankPixelRatio", "width", "x", "y"],
    } as const;
    for (const [field, keys] of Object.entries(fields)) {
      if (isRecord(value[field])) {
        rejectUnknownKeys(value[field], keys, scenarioPath, `assert.${kind}${suffix}.${field}`);
      }
    }
  }
  if (kind === "aerodynamics") {
    const arrays = {
      controls: ["minAbs", "sign", "surface"],
      torques: ["axis", "label", "minAbs", "relativeToLabel", "sign"],
    } as const;
    for (const [field, keys] of Object.entries(arrays)) {
      const entries = value[field];
      if (Array.isArray(entries)) {
        entries.forEach((item, index) => {
          if (isRecord(item)) {
            rejectUnknownKeys(item, keys, scenarioPath, `assert.${kind}${suffix}.${field}[${index}]`);
          }
        });
      }
    }
  }
}
