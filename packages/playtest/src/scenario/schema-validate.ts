import { PLAYTEST_ASSERTION_REGISTRY } from "../assertions.js";
import { invalidScenario, invalidStep, rejectUnknownKeys } from "./errors.js";
import { isRecord, validateViewport, positiveInteger, hasKey, validateOptionalNumberTuple, validateAssertionKeys, validateDeviceMetricsAssertion, validateParityAssertion, validatePerformanceAssertion, validateFramebufferCoverageAssertion, validateRenderChainAssertion, validateStartupAssertion, validateSceneAssertion, validateSceneNodesAssertion, validateCausedByAssertion, validateAnimationAssertion, validateContactAssertion, validatePathAssertion, validateNumberTuple, validateResourcePathAssertion, validateSignalAssertion, validateStateAssertion, validateTagCountAssertion, validateVisibilityAssertion, validateVisualAssertion, requireRecord, optionalNumber, requireString, optionalPositiveNumber, present, optionalTrivialityReason, optionalString, optionalPositiveInteger, optionalTargetArray, optionalBoolean, requireArray, describeValue, optionalNonNegativeNumber } from "./schema-accessors.js";
import { NUMERIC_COMPARISON_KEYS } from "./schema-base.js";
import type { IPlaytestAimRequest, IPlaytestAimTarget, IPlaytestPlaceRequest, IPlaytestSpawnRequest, IPlaytestScenario, IPlaytestArtifactRequest, IPlaytestParityConfig, PlaytestTarget, IPlaytestScenarioSetup, IPlaytestSetupResource, IPlaytestSetupEntityTransform, IPlaytestStep, IPlaytestPointer, IPlaytestScenarioAssertions, IPlaytestWorldAssertion, IPlaytestReachabilityAssertion, IPlaytestSettledAssertion, IPlaytestOverlayNodeAssertion, IPlaytestComponentAssertion, IPlaytestAerodynamicsAssertion, IPlaytestOccludedAssertion } from "./schema-base.js";
export const PLAYTEST_ROOT_KEYS = [
  "acceptanceId",
  "artifacts",
  "assert",
  "awaitStartup",
  "bootFailure",
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
] as const;

export function validatePlaytestScenario(value: unknown, scenarioPath: string, absolutePath?: string): IPlaytestScenario {
  if (!isRecord(value)) {
    throw invalidScenario(scenarioPath, "Scenario root must be a JSON object.");
  }
  rejectUnknownKeys(value, PLAYTEST_ROOT_KEYS, scenarioPath, "scenario root");
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
  if (value.awaitStartup !== undefined && typeof value.awaitStartup !== "boolean") {
    throw invalidScenario(scenarioPath, "Scenario awaitStartup must be a boolean when present.");
  }
  if (value.bootFailure !== undefined && value.bootFailure !== "renderer-no-adapter") {
    throw invalidScenario(scenarioPath, "Scenario bootFailure must be 'renderer-no-adapter' when present.");
  }
  const target = value.target === undefined ? "web" : value.target;
  if (target !== "web" && target !== "desktop" && target !== "bevy") {
    throw invalidScenario(scenarioPath, "Scenario target must be one of: web, desktop, bevy.");
  }
  if (value.bootFailure !== undefined && target !== "web") {
    throw invalidScenario(scenarioPath, "Scenario bootFailure is browser-only and requires target 'web'.");
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
  const subject = typeof value.subject === "string" && value.subject.trim() !== "" ? value.subject : undefined;
  const steps = value.steps.map((step, index) => validateStep(step, scenarioPath, index));
  if (steps.some(({ kind }) => kind === "aimAt") && subject === undefined) {
    throw invalidScenario(scenarioPath, "A step with kind 'aimAt' aims the subject player start; declare scenario.subject or replace the step.");
  }
  const assertions = isRecord(value.assert) ? validateAssertions(value.assert, scenarioPath) : undefined;
  validateStepLabels(steps, assertions, scenarioPath);
  return {
    ...(typeof value.acceptanceId === "string" ? { acceptanceId: value.acceptanceId } : {}),
    ...(isRecord(value.artifacts) ? { artifacts: validateArtifacts(value.artifacts, scenarioPath) } : {}),
    ...(assertions === undefined ? {} : { assert: assertions }),
    ...(typeof value.awaitStartup === "boolean" ? { awaitStartup: value.awaitStartup } : {}),
    ...(value.bootFailure === "renderer-no-adapter" ? { bootFailure: value.bootFailure } : {}),
    inputDelivery,
    name,
    ...(isRecord(value.parity) ? { parity: validateParityConfig(value.parity, scenarioPath) } : {}),
    schemaVersion: 1,
    ...(isRecord(value.setup) ? { setup: validateSetup(value.setup, scenarioPath, subject) } : {}),
    ...(absolutePath === undefined ? {} : { sourcePath: absolutePath }),
    steps,
    ...(typeof value.subject === "string" ? { subject: value.subject } : {}),
    target,
    viewport: validateViewport(value.viewport, scenarioPath),
    warmupFrames: positiveInteger(value.warmupFrames) ?? 0,
  };
}

export function validateArtifacts(value: Record<string, unknown>, scenarioPath: string): IPlaytestArtifactRequest {
  rejectUnknownKeys(value, ["console", "contactSheet", "effectLog", "network", "runtimeTrace", "screenshots"], scenarioPath, "artifacts");
  return value as IPlaytestArtifactRequest;
}

export function validateParityConfig(value: Record<string, unknown>, scenarioPath: string): IPlaytestParityConfig {
  rejectUnknownKeys(value, ["animation", "axisDelta", "compare", "contacts", "movementDistance", "resources", "targets"], scenarioPath, "parity");
  const animation = value.animation === undefined
    ? undefined
    : requireArray(value, "animation", scenarioPath, "parity").map((item, index) => validateParityAnimation(item, scenarioPath, `parity.animation[${index}]`));
  const resources = value.resources === undefined
    ? undefined
    : validateParityResourceIds(value.resources, scenarioPath, "parity.resources");
  const targets = value.targets === undefined
    ? undefined
    : validateParityTargets(value.targets, scenarioPath, "parity.targets");
  let compareValue = value;
  let comparePath = "parity";
  if (value.compare !== undefined) {
    compareValue = requireRecord(value.compare, scenarioPath, "parity.compare");
    rejectUnknownKeys(compareValue, ["animation", "axisDelta", "contacts", "movementDistance", "resources"], scenarioPath, "parity.compare");
    comparePath = "parity.compare";
  }
  const compare = validateParityCompare(compareValue, scenarioPath, comparePath);
  return {
    ...(animation === undefined ? {} : { animation }),
    ...compare,
    ...(resources === undefined ? {} : { resources }),
    ...(targets === undefined ? {} : { targets }),
  };
}

export function validateParityCompare(
  value: Record<string, unknown>,
  scenarioPath = "scenario",
  objectPath = "parity",
): Omit<IPlaytestParityConfig, "targets"> {
  const animation = value.animation === undefined
    ? undefined
    : requireArray(value, "animation", scenarioPath, objectPath).map((item, index) => validateParityAnimation(item, scenarioPath, `${objectPath}.animation[${index}]`));
  const resources = value.resources === undefined
    ? undefined
    : validateParityResourceIds(value.resources, scenarioPath, `${objectPath}.resources`);
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
    ...(animation === undefined ? {} : { animation }),
    ...(contacts === undefined ? {} : { contacts }),
    ...(movementDistance === undefined ? {} : { movementDistance }),
    ...(resources === undefined ? {} : { resources }),
  };
}

export function validateParityAnimation(
  value: unknown,
  scenarioPath = "scenario",
  objectPath = "parity.animation",
): NonNullable<IPlaytestParityConfig["animation"]>[number] {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["clip", "entity", "requiredOn"], scenarioPath, objectPath);
  return {
    ...present("clip", optionalString(record, "clip", scenarioPath, objectPath)),
    entity: requireString(record, "entity", scenarioPath, objectPath),
    ...present("requiredOn", optionalTargetArray(record, "requiredOn", scenarioPath, objectPath)),
  };
}

function validateParityResourceIds(value: unknown, scenarioPath: string, objectPath: string): string[] {
  if (!Array.isArray(value)) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must be an array of resource ids, received ${describeValue(value)}.`);
  }
  return value.map((resource, index) => {
    if (typeof resource !== "string" || resource.trim() === "") {
      throw invalidScenario(scenarioPath, `'${objectPath}[${index}]' must be a non-empty resource id string, received ${describeValue(resource)}.`);
    }
    return resource;
  });
}

function validateParityTargets(value: unknown, scenarioPath: string, objectPath: string): PlaytestTarget[] {
  if (!Array.isArray(value)) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must be an array of targets, received ${describeValue(value)}.`);
  }
  return value.map((target, index) => {
    if (target !== "web" && target !== "desktop" && target !== "bevy") {
      throw invalidScenario(scenarioPath, `'${objectPath}[${index}]' must be one of web, desktop, bevy; received ${describeValue(target)}.`);
    }
    return target;
  });
}

export function validateSetup(value: Record<string, unknown>, scenarioPath: string, subject?: string): IPlaytestScenarioSetup {
  rejectUnknownKeys(value, ["aim", "entities", "place", "resources", "spawn"], scenarioPath, "setup");
  const spawn = validateSpawnRequest(value.spawn, scenarioPath);
  const aim = validateAimRequest(value.aim, scenarioPath);
  const place = validatePlaceRequests(value.place, scenarioPath);
  // spawn and aim address the SUBJECT player start — the "one owner of the player
  // start" convention. Without a declared subject they would silently no-op or hit
  // the wrong entity, so they are rejected at load instead.
  if (spawn !== undefined && subject === undefined) {
    throw invalidScenario(scenarioPath, "Scenario setup.spawn overrides the subject player start, but the scenario declares no subject.");
  }
  if (aim !== undefined && subject === undefined) {
    throw invalidScenario(scenarioPath, "Scenario setup.aim overrides the subject player start, but the scenario declares no subject.");
  }
  const claimed = new Map<string, string>();
  for (const [index, entity] of (Array.isArray(value.entities) ? value.entities : []).entries()) {
    if (isRecord(entity) && typeof entity.entity === "string") {
      claimed.set(entity.entity, `setup.entities[${index}]`);
    }
  }
  for (const [index, entry] of (place ?? []).entries()) {
    const previous = claimed.get(entry.entity);
    if (previous !== undefined) {
      throw invalidScenario(scenarioPath, `Entity '${entry.entity}' is placed twice (${previous} and setup.place[${index}]); each id may be placed once.`);
    }
    claimed.set(entry.entity, `setup.place[${index}]`);
  }
  return {
    ...(aim === undefined ? {} : { aim }),
    ...(Array.isArray(value.entities) ? { entities: value.entities.map((entity, index) => validateSetupEntity(entity, scenarioPath, index)) } : {}),
    ...(place === undefined ? {} : { place }),
    ...(Array.isArray(value.resources) ? { resources: value.resources.map((resource, index) => validateSetupResource(resource, scenarioPath, index)) } : {}),
    ...(spawn === undefined ? {} : { spawn }),
  };
}

function validateSpawnRequest(value: unknown, scenarioPath: string): IPlaytestSpawnRequest | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, scenarioPath, "setup.spawn");
  rejectUnknownKeys(record, ["x", "y", "z"], scenarioPath, "setup.spawn");
  const x = optionalNumber(record, "x", scenarioPath, "setup.spawn");
  const y = optionalNumber(record, "y", scenarioPath, "setup.spawn");
  const z = optionalNumber(record, "z", scenarioPath, "setup.spawn");
  if (x === undefined || z === undefined) {
    throw invalidScenario(scenarioPath, "'setup.spawn' must define finite x and z; y is optional and preserves the game's current height when absent.");
  }
  return { x, ...(y === undefined ? {} : { y }), z };
}

function validateAimRequest(value: unknown, scenarioPath: string): IPlaytestAimRequest | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, scenarioPath, "setup.aim");
  rejectUnknownKeys(record, ["pitch", "yaw"], scenarioPath, "setup.aim");
  const pitch = optionalNumber(record, "pitch", scenarioPath, "setup.aim");
  const yaw = optionalNumber(record, "yaw", scenarioPath, "setup.aim");
  if (pitch === undefined || yaw === undefined) {
    throw invalidScenario(scenarioPath, "'setup.aim' must define finite yaw and pitch angles in radians.");
  }
  return { pitch, yaw };
}

function validatePlaceRequests(value: unknown, scenarioPath: string): IPlaytestPlaceRequest[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw invalidScenario(scenarioPath, `'setup.place' must be an array of placements, received ${describeValue(value)}.`);
  }
  if (value.length === 0) {
    throw invalidScenario(scenarioPath, "'setup.place' must contain at least one placement; an empty array places nothing.");
  }
  return value.map((entry, index) => validatePlaceRequest(entry, scenarioPath, index));
}

function validatePlaceRequest(value: unknown, scenarioPath: string, index: number): IPlaytestPlaceRequest {
  const objectPath = `setup.place[${index}]`;
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["at", "entity", "facing", "frozen", "lookAt"], scenarioPath, objectPath);
  const entity = requireString(record, "entity", scenarioPath, objectPath);
  const at = validatePoint(record.at, scenarioPath, `${objectPath}.at`, "placement is absolute");
  const facingYaw = record.facing === undefined
    ? undefined
    : (() => {
        const facingRecord = requireRecord(record.facing, scenarioPath, `${objectPath}.facing`);
        rejectUnknownKeys(facingRecord, ["yaw"], scenarioPath, `${objectPath}.facing`);
        const yaw = optionalNumber(facingRecord, "yaw", scenarioPath, `${objectPath}.facing`);
        if (yaw === undefined) {
          throw invalidScenario(scenarioPath, `'${objectPath}.facing.yaw' must be a finite angle in radians.`);
        }
        return yaw;
      })();
  const lookAt = record.lookAt === undefined ? undefined : validatePoint(record.lookAt, scenarioPath, `${objectPath}.lookAt`, "lookAt names a world point");
  if (facingYaw !== undefined && lookAt !== undefined) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must choose facing or lookAt, not both.`);
  }
  return {
    at,
    entity,
    ...(facingYaw === undefined ? {} : { facing: { yaw: facingYaw } }),
    ...present("frozen", optionalBoolean(record, "frozen", scenarioPath, objectPath)),
    ...(lookAt === undefined ? {} : { lookAt }),
  };
}

function validatePoint(
  value: unknown,
  scenarioPath: string,
  objectPath: string,
  requirement: string,
): { x: number; y: number; z: number } {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["x", "y", "z"], scenarioPath, objectPath);
  const x = optionalNumber(record, "x", scenarioPath, objectPath);
  const y = optionalNumber(record, "y", scenarioPath, objectPath);
  const z = optionalNumber(record, "z", scenarioPath, objectPath);
  if (x === undefined || y === undefined || z === undefined) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must define finite x, y, and z; ${requirement}.`);
  }
  return { x, y, z };
}

export function validateSetupResource(value: unknown, scenarioPath: string, index: number): IPlaytestSetupResource {
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

export function validateSetupEntity(value: unknown, scenarioPath: string, index: number): IPlaytestSetupEntityTransform {
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

/** Keys one step accepts; exported for the documentation-drift gate alongside {@link PLAYTEST_ROOT_KEYS}. */
export const PLAYTEST_STEP_KEYS = [

  "at",
  "holdFrames",
  "holdTicks",
  "kind",
  "label",
  "overlayMessage",
  "pitch",
  "pointerPosition",
  "pointers",
  "press",
  "release",
  "screenshot",
  "target",
  "waitFrames",
  "waitTicks",
  "wheel",
  "window",
] as const;

export function validateStep(value: unknown, scenarioPath: string, index: number): IPlaytestStep {
  if (!isRecord(value)) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must be a JSON object.`);
  }
  rejectUnknownKeys(value, PLAYTEST_STEP_KEYS, scenarioPath, `steps[${index}]`);
  const press = typeof value.press === "string" && value.press.length > 0
    ? value.press
    : Array.isArray(value.press)
      && value.press.every((key) => typeof key === "string" && key.length > 0)
      && new Set(value.press).size === value.press.length
      ? [...value.press]
      : undefined;
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
  const pointerButtons = isRecord(value.pointerPosition)
    && typeof value.pointerPosition.buttons === "number"
    && Number.isInteger(value.pointerPosition.buttons)
    && value.pointerPosition.buttons >= 0
    ? value.pointerPosition.buttons
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
    && (value.pointerPosition.buttons === undefined || pointerButtons !== undefined)
    ? {
        ...(pointerButtons === undefined ? {} : { buttons: pointerButtons }),
        x: value.pointerPosition.x,
        y: value.pointerPosition.y,
      }
    : undefined;
  const pointers = Array.isArray(value.pointers)
    ? value.pointers.map((pointer, pointerIndex) =>
        validatePointer(pointer, scenarioPath, index, pointerIndex))
    : undefined;
  // Preserve a validated wheel sample for the browser transport. Native runners must reject this
  // field before startup until they expose a real wheel injector; dropping it would report green
  // while the game never received the requested input.
  const wheel = isRecord(value.wheel)
    && typeof value.wheel.deltaY === "number"
    && Number.isFinite(value.wheel.deltaY)
    && (value.wheel.deltaX === undefined
      || (typeof value.wheel.deltaX === "number" && Number.isFinite(value.wheel.deltaX)))
    ? {
        ...(typeof value.wheel.deltaX === "number" ? { deltaX: value.wheel.deltaX } : {}),
        deltaY: value.wheel.deltaY,
      }
    : undefined;
  if (isRecord(value.overlayMessage)) {
    rejectUnknownKeys(value.overlayMessage, ["overlayId", "payload", "type"], scenarioPath, `steps[${index}].overlayMessage`);
  }
  if (isRecord(value.pointerPosition)) {
    rejectUnknownKeys(value.pointerPosition, ["buttons", "x", "y"], scenarioPath, `steps[${index}].pointerPosition`);
  }
  if (isRecord(value.wheel)) {
    rejectUnknownKeys(value.wheel, ["deltaX", "deltaY"], scenarioPath, `steps[${index}].wheel`);
  }
  if (pointers !== undefined && new Set(pointers.map(({ id }) => id)).size !== pointers.length) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pointers must use unique ids.`);
  }
  const holdFrames = positiveInteger(value.holdFrames);
  const holdTicks = positiveInteger(value.holdTicks);
  const waitFrames = positiveInteger(value.waitFrames);
  const waitTicks = positiveInteger(value.waitTicks);
  const kind = value.kind === "aimAt"
    ? "aimAt"
    : value.kind === "click"
      ? "click"
      : value.kind === "wait"
        ? "wait"
        : value.kind === "input"
          ? "input"
          : undefined;
  if (value.kind !== undefined && kind === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} kind must be 'aimAt', 'click', 'input', or 'wait'.`);
  }
  const at = validateClickTarget(value.at, scenarioPath, index);
  const target = validateAimTarget(value.target, scenarioPath, index);
  const pitch = typeof value.pitch === "number" && Number.isFinite(value.pitch) ? value.pitch : undefined;
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
  if (kind !== "click" && (at !== undefined || value.at !== undefined)) {
    throw invalidStep(scenarioPath, `Scenario step ${index} declares at, which belongs to kind 'click'.`);
  }
  if (kind === "click") {
    if (at === undefined) {
      throw invalidStep(scenarioPath, `Scenario step ${index} with kind 'click' must define at as { x, y } or { entity }.`);
    }
    for (const forbidden of ["overlayMessage", "pointerPosition", "pointers", "press", "target", "wheel", "window"] as const) {
      if (value[forbidden] !== undefined) {
        throw invalidStep(scenarioPath, `Scenario step ${index} with kind 'click' cannot define ${forbidden}.`);
      }
    }
    if (holdFrames !== undefined || holdTicks !== undefined) {
      throw invalidStep(scenarioPath, `Scenario step ${index} with kind 'click' cannot define holdFrames/holdTicks; use waitFrames or waitTicks after the click.`);
    }
  }
  if (value.press !== undefined && press === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} press must be a non-empty key or a unique array of non-empty keys.`);
  }
  if (kind !== "aimAt" && (target !== undefined || pitch !== undefined)) {
    throw invalidStep(scenarioPath, `Scenario step ${index} declares ${target !== undefined ? "target" : "pitch"}, which belongs to kind 'aimAt'.`);
  }
  if (kind === "aimAt") {
    // An aimAt instant steers the subject; it is not an input hold, and holdTicks
    // without a press is silently ignored by the tick math, so both are rejected.
    if (target === undefined) {
      throw invalidStep(scenarioPath, `Scenario step ${index} with kind 'aimAt' must define target as { x, z } or { entity }.`);
    }
    for (const forbidden of ["overlayMessage", "pointerPosition", "pointers", "press", "wheel", "window"] as const) {
      if (value[forbidden] !== undefined) {
        throw invalidStep(scenarioPath, `Scenario step ${index} with kind 'aimAt' cannot define ${forbidden}; apply aim in its own step.`);
      }
    }
    if (holdFrames !== undefined || holdTicks !== undefined) {
      throw invalidStep(scenarioPath, `Scenario step ${index} with kind 'aimAt' cannot define holdFrames/holdTicks; use waitTicks to hold the aimed pose.`);
    }
  }
  if (value.pitch !== undefined && pitch === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pitch must be a finite angle in radians.`);
  }
  if (value.target !== undefined && target === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} target must be { x, z } or { entity }, not both forms.`);
  }
  const hasPress = press !== undefined && (typeof press === "string" || press.length > 0);
  if (kind === "wait" && hasPress) {
    throw invalidStep(scenarioPath, `Scenario step ${index} kind wait cannot define press.`);
  }
  if (value.overlayMessage !== undefined && overlayMessage === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} overlayMessage must define non-empty overlayId and type fields.`);
  }
  if (value.pointerPosition !== undefined && pointerPosition === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pointerPosition must define normalized x and y values from 0 through 1.`);
  }
  if (value.pointers !== undefined && pointers === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pointers must be an array.`);
  }
  if (value.wheel !== undefined && wheel === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} wheel must define finite deltaY and optional finite deltaX values.`);
  }
  if (value.screenshot !== undefined && screenshot === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} screenshot must be a stable file-safe name.`);
  }
  if (value.label !== undefined && (typeof value.label !== "string" || value.label.trim() === "")) {
    throw invalidStep(scenarioPath, `Scenario step ${index} label must be a non-empty string.`);
  }
  if (value.window !== undefined && window === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} window must define minimize, restore, or resize with positive width and height.`);
  }
  if (at === undefined && press === undefined && overlayMessage === undefined && pointerPosition === undefined && pointers === undefined && wheel === undefined && window === undefined && waitFrames === undefined && waitTicks === undefined && target === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must define click at, press, overlayMessage, pointerPosition, pointers, wheel, window, aimAt target, or waitFrames/waitTicks.`);
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
    ...(at === undefined ? {} : { at }),
    ...(overlayMessage === undefined ? {} : { overlayMessage }),
    ...(pitch === undefined ? {} : { pitch }),
    ...(pointerPosition === undefined ? {} : { pointerPosition }),
    ...(pointers === undefined ? {} : { pointers }),
    ...(press === undefined ? {} : { press }),
    release: typeof value.release === "boolean" ? value.release : true,
    ...(target === undefined ? {} : { target }),
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(waitFrames === undefined ? {} : { waitFrames }),
    ...(waitTicks === undefined ? {} : { waitTicks }),
    ...(wheel === undefined ? {} : { wheel }),
    ...(window === undefined ? {} : { window }),
  };
}

function validateClickTarget(value: unknown, scenarioPath: string, index: number): IPlaytestStep["at"] | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.entity === "string") {
    rejectUnknownKeys(value, ["entity"], scenarioPath, `steps[${index}].at`);
    return value.entity.length === 0 ? undefined : { entity: value.entity };
  }
  if (value.entity !== undefined) return undefined;
  rejectUnknownKeys(value, ["x", "y"], scenarioPath, `steps[${index}].at`);
  return typeof value.x === "number"
    && Number.isFinite(value.x)
    && value.x >= 0
    && typeof value.y === "number"
    && Number.isFinite(value.y)
    && value.y >= 0
    ? { x: value.x, y: value.y }
    : undefined;
}

/** An aimAt target is exactly one of a world xz position or a registered entity id. */
export function validateAimTarget(value: unknown, scenarioPath: string, stepIndex: number): IPlaytestAimTarget | undefined {
  if (value === undefined) return undefined;
  const objectPath = `steps[${stepIndex}].target`;
  if (!isRecord(value)) {
    throw invalidStep(scenarioPath, `Scenario ${objectPath} must be an object, received ${describeValue(value)}.`);
  }
  if (value.entity !== undefined && (value.x !== undefined || value.z !== undefined)) {
    throw invalidStep(scenarioPath, `Scenario ${objectPath} must be { x, z } or { entity }, not both forms.`);
  }
  if (value.entity !== undefined) {
    rejectUnknownKeys(value, ["entity"], scenarioPath, objectPath);
    return { entity: requireString(value, "entity", scenarioPath, objectPath) };
  }
  rejectUnknownKeys(value, ["x", "z"], scenarioPath, objectPath);
  const x = optionalNumber(value, "x", scenarioPath, objectPath);
  const z = optionalNumber(value, "z", scenarioPath, objectPath);
  if (x === undefined || z === undefined) {
    throw invalidStep(scenarioPath, `Scenario ${objectPath} must define finite x and z world coordinates.`);
  }
  return { x, z };
}

export function validatePointer(
  value: unknown,
  scenarioPath: string,
  stepIndex: number,
  pointerIndex: number,
): IPlaytestPointer {  const path = `steps[${stepIndex}].pointers[${pointerIndex}]`;
  if (!isRecord(value)) throw invalidStep(scenarioPath, `${path} must be an object.`);
  rejectUnknownKeys(value, ["buttons", "id", "x", "y"], scenarioPath, path);
  if (!Number.isInteger(value.id) || (value.id as number) < 1) {
    throw invalidStep(scenarioPath, `${path}.id must be a positive integer.`);
  }
  if (typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0 || value.x > 1
    || typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) {
    throw invalidStep(scenarioPath, `${path} must define normalized x and y values from 0 through 1.`);
  }
  if (value.buttons !== undefined && (!Number.isInteger(value.buttons) || (value.buttons as number) < 1)) {
    throw invalidStep(scenarioPath, `${path}.buttons must be a positive integer when present.`);
  }
  return {
    ...(typeof value.buttons === "number" ? { buttons: value.buttons } : {}),
    id: value.id as number,
    x: value.x,
    y: value.y,
  };
}

export function validateStepLabels(
  steps: readonly IPlaytestStep[],
  assertions: IPlaytestScenarioAssertions | undefined,
  scenarioPath: string,
): void {
  const labels = new Set<string>();
  for (const [index, step] of steps.entries()) {
    if (step.label === undefined) continue;
    if (step.label.trim() === "") {
      throw invalidStep(scenarioPath, `Scenario step ${index} label must be a non-empty string.`);
    }
    if (labels.has(step.label)) {
      throw invalidStep(scenarioPath, `Scenario step ${index} repeats duplicate label '${step.label}'.`);
    }
    labels.add(step.label);
  }
  if (assertions === undefined) return;
  const requireLabel = (label: string | undefined, path: string): void => {
    if (label !== undefined && !labels.has(label)) {
      throw invalidScenario(scenarioPath, `Assertion '${path}' names step label '${label}', but no scenario step defines it.`);
    }
  };
  for (const [index, assertion] of (assertions.resources ?? []).entries()) {
    for (const [stepIndex, step] of (assertion.atSteps ?? []).entries()) {
      requireLabel(step.label, `assert.resources[${index}].atSteps[${stepIndex}].label`);
    }
  }
  for (const [index, assertion] of (assertions.components ?? []).entries()) {
    for (const [stepIndex, step] of (assertion.atSteps ?? []).entries()) {
      requireLabel(step.label, `assert.components[${index}].atSteps[${stepIndex}].label`);
    }
  }
  for (const [index, assertion] of (assertions.signals ?? []).entries()) {
    requireLabel(assertion.atStep, `assert.signals[${index}].atStep`);
  }
  for (const [index, assertion] of (assertions.contacts ?? []).entries()) {
    requireLabel(assertion.atStep, `assert.contacts[${index}].atStep`);
  }
  for (const [index, assertion] of (assertions.settled ?? []).entries()) {
    requireLabel(assertion.atStep, `assert.settled[${index}].atStep`);
    requireLabel(assertion.compareToStep, `assert.settled[${index}].compareToStep`);
  }
  requireLabel(assertions.movement?.reachesPositionWithin?.atStep, "assert.movement.reachesPositionWithin.atStep");
  requireLabel(assertions.framebufferCoverage?.window.startStep, "assert.framebufferCoverage.window.startStep");
  requireLabel(assertions.framebufferCoverage?.window.endStep, "assert.framebufferCoverage.window.endStep");
  if (assertions.framebufferCoverage !== undefined) {
    const startIndex = steps.findIndex(({ label }) => label === assertions.framebufferCoverage?.window.startStep);
    const endIndex = steps.findIndex(({ label }) => label === assertions.framebufferCoverage?.window.endStep);
    if (endIndex < startIndex) {
      throw invalidScenario(
        scenarioPath,
        "Assertion 'assert.framebufferCoverage.window.endStep' must not precede startStep.",
      );
    }
  }
}

export function playtestStepHoldTicks(step: IPlaytestStep, fallback = 1): number {
  if (step.press === undefined || step.holdFrames !== undefined || step.waitFrames !== undefined) return 0;
  return Math.max(1, step.holdTicks ?? fallback);
}

export function playtestStepWaitTicks(step: IPlaytestStep): number {
  return step.waitFrames === undefined ? Math.max(0, step.waitTicks ?? 0) : 0;
}

export function validateAssertions(value: Record<string, unknown>, scenarioPath: string): IPlaytestScenarioAssertions {
  rejectUnknownKeys(value, PLAYTEST_ASSERTION_REGISTRY.map((entry) => entry.kind), scenarioPath, "assert");
  validateAssertionShapes(value, scenarioPath);
  validateAssertionKeys(value, scenarioPath);
  if (Array.isArray(value.signals) && value.signals.length === 0) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.signals' must contain at least one signal assertion.");
  }
  const movement = isRecord(value.movement) ? value.movement : undefined;
  const camera = isRecord(value.camera) ? value.camera : undefined;
  if (
    camera !== undefined &&
    !(
      (typeof camera.within === "number" && Number.isFinite(camera.within)) ||
      camera.targetInViewport === true
    )
  ) {
    // entity/follows only select what to observe; without a binding predicate the camera
    // assertion passes on zero observations, the vacuous-green shape rejected everywhere else.
    throw invalidScenario(
      scenarioPath,
      "Assertion 'assert.camera' must declare 'within' or 'targetInViewport: true'; a camera assertion with neither passes without consulting any observation.",
    );
  }
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : undefined;
  const performance = isRecord(value.performance)
    ? validatePerformanceAssertion(value.performance, scenarioPath, "assert.performance")
    : undefined;
  // Present-but-not-an-object is a validation failure, not a dropped assertion: a scenario that
  // says `"deviceMetrics": "cool"` must never run with the thermal check silently missing.
  const deviceMetrics = value.deviceMetrics === undefined
    ? undefined
    : validateDeviceMetricsAssertion(value.deviceMetrics, scenarioPath, "assert.deviceMetrics");
  const parity = value.parity === undefined
    ? undefined
    : validateParityAssertion(value.parity, scenarioPath, "assert.parity");
  const framebufferCoverage = isRecord(value.framebufferCoverage)
    ? validateFramebufferCoverageAssertion(
        value.framebufferCoverage,
        scenarioPath,
        "assert.framebufferCoverage",
      )
    : undefined;
  const renderChain = value.renderChain === undefined
    ? undefined
    : validateRenderChainAssertion(value.renderChain, scenarioPath, "assert.renderChain");
  const startup = value.startup === undefined
    ? undefined
    : validateStartupAssertion(value.startup, scenarioPath, "assert.startup");
  const scene = value.scene === undefined
    ? undefined
    : validateSceneAssertion(value.scene, scenarioPath, "assert.scene");
  const world = isRecord(value.world) ? value.world : undefined;
  const optOuts = [
    ["noConsoleErrors", "consoleErrorsOptOutReason"],
    ["noNetworkErrors", "networkErrorsOptOutReason"],
    ["noRuntimeDiagnostics", "runtimeDiagnosticsOptOutReason"],
  ] as const;
  for (const [policyKey, reasonKey] of optOuts) {
    if (diagnostics?.[policyKey] === false
      && (typeof diagnostics[reasonKey] !== "string" || diagnostics[reasonKey].trim() === "")) {
      throw invalidScenario(
        scenarioPath,
        `Assertion 'assert.diagnostics.${policyKey}' may be false only when '${reasonKey}' explains the bounded exception.`,
      );
    }
  }
  return {
    ...(Array.isArray(value.aerodynamics) ? { aerodynamics: value.aerodynamics.map((entry, index) => validateAerodynamicsAssertion(entry, scenarioPath, `assert.aerodynamics[${index}]`)) } : {}),
    ...(Array.isArray(value.animation) ? { animation: value.animation.map((entry, index) => validateAnimationAssertion(entry, scenarioPath, `assert.animation[${index}]`)) } : {}),
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
    ...(Array.isArray(value.contacts) ? { contacts: value.contacts.map((entry, index) => validateContactAssertion(entry, scenarioPath, `assert.contacts[${index}]`)) } : {}),
    ...(diagnostics === undefined
      ? {}
      : {
          diagnostics: {
            ...(typeof diagnostics.noConsoleErrors === "boolean" ? { noConsoleErrors: diagnostics.noConsoleErrors } : {}),
            ...(typeof diagnostics.noNetworkErrors === "boolean" ? { noNetworkErrors: diagnostics.noNetworkErrors } : {}),
            ...(typeof diagnostics.noRuntimeDiagnostics === "boolean" ? { noRuntimeDiagnostics: diagnostics.noRuntimeDiagnostics } : {}),
            ...(typeof diagnostics.consoleErrorsOptOutReason === "string" ? { consoleErrorsOptOutReason: diagnostics.consoleErrorsOptOutReason } : {}),
            ...(typeof diagnostics.networkErrorsOptOutReason === "string" ? { networkErrorsOptOutReason: diagnostics.networkErrorsOptOutReason } : {}),
            ...(typeof diagnostics.runtimeDiagnosticsOptOutReason === "string" ? { runtimeDiagnosticsOptOutReason: diagnostics.runtimeDiagnosticsOptOutReason } : {}),
            ...(typeof diagnostics.runtimeReady === "boolean" ? { runtimeReady: diagnostics.runtimeReady } : {}),
          },
        }),
    ...(Array.isArray(value.hud)
      ? {
          hud: value.hud
            .map((entry, index) => validatePathAssertion(entry, scenarioPath, `assert.hud[${index}]`)),
        }
      : {}),
    ...(performance === undefined ? {} : { performance }),
    ...(renderChain === undefined ? {} : { renderChain }),
    ...(startup === undefined ? {} : { startup }),
    ...(scene === undefined ? {} : { scene }),
    ...(hasKey(value, "causedBy")
      ? {
          causedBy: requireArray(value, "causedBy", scenarioPath, "assert.causedBy").map((entry, index) =>
            validateCausedByAssertion(entry, scenarioPath, `assert.causedBy[${index}]`)),
        }
      : {}),
    ...(hasKey(value, "sceneNodes")
      ? {
          sceneNodes: requireArray(value, "sceneNodes", scenarioPath, "assert.sceneNodes").map((entry, index) =>
            validateSceneNodesAssertion(entry, scenarioPath, `assert.sceneNodes[${index}]`)),
        }
      : {}),
    ...(deviceMetrics === undefined ? {} : { deviceMetrics }),
    ...(parity === undefined ? {} : { parity }),
    ...(framebufferCoverage === undefined ? {} : { framebufferCoverage }),
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
    ...(Array.isArray(value.occluded) ? { occluded: value.occluded.map((entry, index) => validateOccludedAssertion(entry, scenarioPath, `assert.occluded[${index}]`)) } : {}),
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
    ...(Array.isArray(value.signals)
      ? {
          signals: value.signals.map((entry, index) =>
            validateSignalAssertion(entry, scenarioPath, `assert.signals[${index}]`),
          ),
        }
      : {}),
    ...(Array.isArray(value.states) ? { states: value.states.map((entry, index) => validateStateAssertion(entry, scenarioPath, `assert.states[${index}]`)) } : {}),
    ...(Array.isArray(value.tags) ? { tags: value.tags.map((entry, index) => validateTagCountAssertion(entry, scenarioPath, `assert.tags[${index}]`)) } : {}),
    ...(Array.isArray(value.visibility) ? { visibility: value.visibility.map((entry, index) => validateVisibilityAssertion(entry, scenarioPath, `assert.visibility[${index}]`)) } : {}),
    ...(Array.isArray(value.visual) ? { visual: value.visual.map((entry, index) => validateVisualAssertion(entry, scenarioPath, `assert.visual[${index}]`)) } : {}),
    ...(world === undefined ? {} : { world: validateWorldAssertion(world, scenarioPath) }),
  };
}

export function validateWorldAssertion(value: Record<string, unknown>, scenarioPath: string): IPlaytestWorldAssertion {
  rejectUnknownKeys(value, ["runtime", "seed"], scenarioPath, "assert.world");
  if (!hasKey(value, "seed") || (value.seed !== null && (typeof value.seed !== "number" || !Number.isFinite(value.seed)))) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.world.seed' must be a finite number or null.");
  }
  const runtimeValue = value.runtime;
  if (runtimeValue === undefined) return { seed: value.seed as number | null };
  const runtime = requireRecord(runtimeValue, scenarioPath, "assert.world.runtime");
  rejectUnknownKeys(runtime, ["agent", "core", "portable", "randomState", "rapier", "step"], scenarioPath, "assert.world.runtime");
  const portable = runtime.portable;
  if (portable !== undefined && typeof portable !== "boolean") {
    throw invalidScenario(scenarioPath, "'assert.world.runtime.portable' must be a boolean.");
  }
  const randomState = optionalNumber(runtime, "randomState", scenarioPath, "assert.world.runtime");
  if (randomState === undefined || !Number.isInteger(randomState)) {
    throw invalidScenario(scenarioPath, "'assert.world.runtime.randomState' must be an integer.");
  }
  const rapier = runtime.rapier;
  if (rapier !== null && typeof rapier !== "string") {
    throw invalidScenario(scenarioPath, "'assert.world.runtime.rapier' must be a string or null.");
  }
  return {
    runtime: {
      agent: requireString(runtime, "agent", scenarioPath, "assert.world.runtime"),
      core: requireString(runtime, "core", scenarioPath, "assert.world.runtime"),
      ...(portable === undefined ? {} : { portable }),
      randomState,
      rapier: rapier as string | null,
      step: optionalPositiveNumber(runtime, "step", scenarioPath, "assert.world.runtime") ?? (() => {
        throw invalidScenario(scenarioPath, "'assert.world.runtime.step' must be a positive number.");
      })(),
    },
    seed: value.seed as number | null,
  };
}

export function validateReachabilityAssertion(value: Record<string, unknown>, scenarioPath: string): IPlaytestReachabilityAssertion {
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

export function validateSettledAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestSettledAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "atStep", "compareToStep", "entity", "minBodies", "minMeanPoseDistance", "requiredOn"], scenarioPath, objectPath);
  return {
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...present("atStep", optionalString(record, "atStep", scenarioPath, objectPath)),
    ...present("compareToStep", optionalString(record, "compareToStep", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    ...present("minBodies", optionalPositiveInteger(record, "minBodies", scenarioPath, objectPath)),
    ...present("minMeanPoseDistance", optionalPositiveNumber(record, "minMeanPoseDistance", scenarioPath, objectPath)),
    ...present("requiredOn", optionalTargetArray(record, "requiredOn", scenarioPath, objectPath)),
  };
}

export function validateOverlayNodeAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestOverlayNodeAssertion {
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

export function validateComponentAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestComponentAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "atSteps", "changed", "component", "entity", "equals", ...NUMERIC_COMPARISON_KEYS, "path"], scenarioPath, objectPath);
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
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    // As above: any JSON value is a legal comparison target.
    ...(hasKey(record, "equals") ? { equals: record.equals } : {}),
    ...present("gte", optionalNumber(record, "gte", scenarioPath, objectPath)),
    ...present("lte", optionalNumber(record, "lte", scenarioPath, objectPath)),
    ...present("path", optionalString(record, "path", scenarioPath, objectPath)),
  };
}

export function validateAssertionShapes(value: Record<string, unknown>, scenarioPath: string): void {
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

export function validateAerodynamicsAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestAerodynamicsAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  // A wrong-typed entry used to be dropped from the array and an absent entity
  // dropped the whole assertion, so the control check could shrink to [] whose
  // .every() passes vacuously. Every declared entry must load or nothing loads.
  const controls: IPlaytestAerodynamicsAssertion["controls"] = Array.isArray(record.controls)
    ? record.controls.map((control, index) => {
        const entryPath = `${objectPath}.controls[${index}]`;
        const entry = requireRecord(control, scenarioPath, entryPath);
        if (entry.sign !== "negative" && entry.sign !== "positive") {
          throw invalidScenario(scenarioPath, `'${entryPath}.sign' must be "negative" or "positive", received ${describeValue(entry.sign)}.`);
        }
        return {
          ...present("minAbs", optionalNonNegativeNumber(entry, "minAbs", scenarioPath, entryPath)),
          sign: entry.sign as "negative" | "positive",
          surface: requireString(entry, "surface", scenarioPath, entryPath),
        };
      })
    : undefined;
  const torques: IPlaytestAerodynamicsAssertion["torques"] = Array.isArray(record.torques)
    ? record.torques.map((torque, index) => {
        const entryPath = `${objectPath}.torques[${index}]`;
        const entry = requireRecord(torque, scenarioPath, entryPath);
        if (entry.axis !== "x" && entry.axis !== "y" && entry.axis !== "z") {
          throw invalidScenario(scenarioPath, `'${entryPath}.axis' must be one of x, y, z, received ${describeValue(entry.axis)}.`);
        }
        if (entry.sign !== "negative" && entry.sign !== "positive") {
          throw invalidScenario(scenarioPath, `'${entryPath}.sign' must be "negative" or "positive", received ${describeValue(entry.sign)}.`);
        }
        return {
          axis: entry.axis as "x" | "y" | "z",
          label: requireString(entry, "label", scenarioPath, entryPath),
          ...present("minAbs", optionalNonNegativeNumber(entry, "minAbs", scenarioPath, entryPath)),
          ...present("relativeToLabel", optionalString(entry, "relativeToLabel", scenarioPath, entryPath)),
          sign: entry.sign as "negative" | "positive",
        };
      })
    : undefined;
  return {
    ...(controls === undefined ? {} : { controls }),
    entity: requireString(record, "entity", scenarioPath, objectPath),
    ...present("minForceSamples", optionalPositiveInteger(record, "minForceSamples", scenarioPath, objectPath)),
    ...(torques === undefined ? {} : { torques }),
  };
}

export function validateOccludedAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestOccludedAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "entity", "target"], scenarioPath, objectPath);
  return {
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    ...present("target", optionalString(record, "target", scenarioPath, objectPath)),
  };
}
