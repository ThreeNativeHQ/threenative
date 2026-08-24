import { invalidScenario, invalidStep, rejectUnknownKeys } from "./errors.js";
import { GENERATED_ASSERTION_SCHEMAS, validateGeneratedAssertions } from "./generated-assertion-validators.js";
import { describeValue, hasKey, isRecord, optionalBoolean, optionalNumber, positiveInteger, present, requireRecord, requireString, validateOptionalNumberTuple, validateViewport } from "./schema-accessors.js";
import type { IPlaytestAimRequest, IPlaytestAimTarget, IPlaytestPlaceRequest, IPlaytestSpawnRequest, IPlaytestScenario, IPlaytestArtifactRequest, IPlaytestParityConfig, PlaytestTarget, IPlaytestScenarioSetup, IPlaytestSetupResource, IPlaytestSetupEntityTransform, IPlaytestStep, IPlaytestPointer, IPlaytestScenarioAssertions } from "./schema-base.js";
export const PLAYTEST_ROOT_KEYS = [
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
    inputDelivery,
    name,
    ...(isRecord(value.parity) ? { parity: validateParityConfig(value.parity, scenarioPath) } : {}),
    schemaVersion: 1,
    ...(isRecord(value.setup) ? { setup: validateSetup(value.setup, scenarioPath, subject) } : {}),
    ...(absolutePath === undefined ? {} : { sourcePath: absolutePath }),
    steps,
    ...(typeof value.subject === "string" ? { subject: value.subject } : {}),
    target,
    viewport: validateViewport(value.viewport),
    warmupFrames: positiveInteger(value.warmupFrames) ?? 0,
  };
}

export function validateArtifacts(value: Record<string, unknown>, scenarioPath: string): IPlaytestArtifactRequest {
  rejectUnknownKeys(value, ["console", "contactSheet", "effectLog", "network", "runtimeTrace", "screenshots"], scenarioPath, "artifacts");
  return value as IPlaytestArtifactRequest;
}

export function validateParityConfig(value: Record<string, unknown>, scenarioPath: string): IPlaytestParityConfig {
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

export function validateParityCompare(value: Record<string, unknown>): Omit<IPlaytestParityConfig, "targets"> {
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

export function validateParityAnimation(value: unknown): NonNullable<IPlaytestParityConfig["animation"]>[number] | undefined {
  if (!isRecord(value) || typeof value.entity !== "string") {
    return undefined;
  }
  return {
    ...(typeof value.clip === "string" ? { clip: value.clip } : {}),
    entity: value.entity,
    ...(Array.isArray(value.requiredOn) ? { requiredOn: value.requiredOn.filter((item): item is PlaytestTarget => item === "web" || item === "desktop" || item === "bevy") } : {}),
  };
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
  if (isRecord(value.overlayMessage)) {
    rejectUnknownKeys(value.overlayMessage, ["overlayId", "payload", "type"], scenarioPath, `steps[${index}].overlayMessage`);
  }
  if (isRecord(value.pointerPosition)) {
    rejectUnknownKeys(value.pointerPosition, ["buttons", "x", "y"], scenarioPath, `steps[${index}].pointerPosition`);
  }
  if (pointers !== undefined && new Set(pointers.map(({ id }) => id)).size !== pointers.length) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pointers must use unique ids.`);
  }
  const holdFrames = positiveInteger(value.holdFrames);
  const holdTicks = positiveInteger(value.holdTicks);
  const waitFrames = positiveInteger(value.waitFrames);
  const waitTicks = positiveInteger(value.waitTicks);
  const kind = value.kind === "aimAt" ? "aimAt" : value.kind === "wait" ? "wait" : value.kind === "input" ? "input" : undefined;
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
    for (const forbidden of ["overlayMessage", "pointerPosition", "pointers", "press", "window"] as const) {
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
  if (value.screenshot !== undefined && screenshot === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} screenshot must be a stable file-safe name.`);
  }
  if (value.label !== undefined && (typeof value.label !== "string" || value.label.trim() === "")) {
    throw invalidStep(scenarioPath, `Scenario step ${index} label must be a non-empty string.`);
  }
  if (value.window !== undefined && window === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} window must define minimize, restore, or resize with positive width and height.`);
  }
  if (press === undefined && overlayMessage === undefined && pointerPosition === undefined && pointers === undefined && window === undefined && waitFrames === undefined && waitTicks === undefined && target === undefined) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must define press, overlayMessage, pointerPosition, pointers, window, aimAt target, or waitFrames/waitTicks.`);
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
    ...(pitch === undefined ? {} : { pitch }),
    ...(pointerPosition === undefined ? {} : { pointerPosition }),
    ...(pointers === undefined ? {} : { pointers }),
    ...(press === undefined ? {} : { press }),
    release: typeof value.release === "boolean" ? value.release : true,
    ...(target === undefined ? {} : { target }),
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(waitFrames === undefined ? {} : { waitFrames }),
    ...(waitTicks === undefined ? {} : { waitTicks }),
    ...(window === undefined ? {} : { window }),
  };
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
  rejectUnknownKeys(value, GENERATED_ASSERTION_SCHEMAS.map((entry) => entry.kind), scenarioPath, "assert");
  return validateGeneratedAssertions(value, scenarioPath);
}
