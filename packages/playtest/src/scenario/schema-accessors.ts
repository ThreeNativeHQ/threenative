import { PLAYTEST_ASSERTION_REGISTRY } from "../assertions.js";
import { PlaytestScenarioError, invalidScenario, rejectUnknownKeys } from "./errors.js";
import { MIN_TRIVIALITY_REASON_LENGTH, NUMERIC_COMPARISON_KEYS } from "./schema-base.js";
import type { IPlaytestVisualAssertion, PlaytestTarget, IPlaytestPerformanceAssertion, IPlaytestFramebufferCoverageAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestContactAssertion, IPlaytestSignalAssertion, IPlaytestAnimationAssertion, IPlaytestVisibilityAssertion, IPlaytestPathAssertion, IPlaytestResourceAssertion, IPlaytestResourcePathAlternative, IPlaytestViewport, IPlaytestScenarioAssertions } from "./schema-base.js";
export function validateVisualAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestVisualAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  // A non-record entry used to be dropped from the array, and a mistyped key
  // collapsed its sub-object to nothing, so an entry could evaluate to an empty
  // row that reported pass without ever observing a pixel. Sub-objects validate
  // strictly and at least one of them must remain.
  const frameDiff = record.frameDiff === undefined
    ? undefined
    : validateVisualFrameDiff(requireRecord(record.frameDiff, scenarioPath, `${objectPath}.frameDiff`), scenarioPath, `${objectPath}.frameDiff`);
  const regionRecord = record.region === undefined
    ? undefined
    : requireRecord(record.region, scenarioPath, `${objectPath}.region`);
  let region: IPlaytestVisualAssertion["region"] | undefined;
  if (regionRecord !== undefined) {
    const edges: Record<"height" | "width" | "x" | "y", number> = { height: 0, width: 0, x: 0, y: 0 };
    for (const key of ["height", "width", "x", "y"] as const) {
      const item = regionRecord[key];
      if (typeof item !== "number" || !Number.isFinite(item)) {
        throw invalidScenario(scenarioPath, `'${objectPath}.region.${key}' must be a finite number, received ${describeValue(item)}.`);
      }
      edges[key] = item;
    }
    region = {
      ...edges,
      ...present("maxLuminance", optionalNumber(regionRecord, "maxLuminance", scenarioPath, `${objectPath}.region`)),
      ...present("minDarkPixelRatio", optionalNumber(regionRecord, "minDarkPixelRatio", scenarioPath, `${objectPath}.region`)),
      ...present("minNonblankPixelRatio", optionalNumber(regionRecord, "minNonblankPixelRatio", scenarioPath, `${objectPath}.region`)),
    };
  }
  const entityVisibleRecord = record.entityVisible === undefined
    ? undefined
    : requireRecord(record.entityVisible, scenarioPath, `${objectPath}.entityVisible`);
  let entityVisible: IPlaytestVisualAssertion["entityVisible"] | undefined;
  if (entityVisibleRecord !== undefined) {
    if (typeof entityVisibleRecord.minProjectedPixels !== "number") {
      throw invalidScenario(scenarioPath, `'${objectPath}.entityVisible.minProjectedPixels' must be a number, received ${describeValue(entityVisibleRecord.minProjectedPixels)}.`);
    }
    entityVisible = {
      entity: requireString(entityVisibleRecord, "entity", scenarioPath, `${objectPath}.entityVisible`),
      minProjectedPixels: entityVisibleRecord.minProjectedPixels,
      ...present("throughoutFrames", optionalBoolean(entityVisibleRecord, "throughoutFrames", scenarioPath, `${objectPath}.entityVisible`)),
    };
  }
  if (frameDiff === undefined && region === undefined && entityVisible === undefined) {
    throw invalidScenario(
      scenarioPath,
      `'${objectPath}' must declare 'entityVisible', 'frameDiff', or 'region'; an empty visual assertion evaluates nothing.`,
    );
  }
  return {
    ...(frameDiff === undefined ? {} : { frameDiff }),
    ...(entityVisible === undefined ? {} : { entityVisible }),
    ...(region === undefined ? {} : { region }),
  };
}

export function validateVisualFrameDiff(
  record: Record<string, unknown>,
  scenarioPath: string,
  objectPath: string,
): IPlaytestVisualAssertion["frameDiff"] {
  if (record.baselineImage !== undefined && !isSafeProjectRelativePng(record.baselineImage)) {
    throw invalidScenario(scenarioPath, `'${objectPath}.baselineImage' must be a project-relative .png path without '..' or absolute segments, received ${describeValue(record.baselineImage)}.`);
  }
  return {
    ...present("baselineImage", optionalString(record, "baselineImage", scenarioPath, objectPath)),
    ...present("maxChangedPixelRatio", optionalNumber(record, "maxChangedPixelRatio", scenarioPath, objectPath)),
    ...present("minChangedPixelRatio", optionalNumber(record, "minChangedPixelRatio", scenarioPath, objectPath)),
  };
}

export function isSafeProjectRelativePng(value: unknown): value is string {
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

export function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  return `${typeof value} ${JSON.stringify(value) ?? String(value)}`;
}

export function requireRecord(value: unknown, scenarioPath: string, objectPath: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must be an object, received ${describeValue(value)}.`);
  }
  return value;
}

export function requireArray(
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

export function requireString(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): string {
  const raw = value[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a non-empty string, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalString(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): string | undefined {
  if (value[key] === undefined) return undefined;
  return requireString(value, key, scenarioPath, objectPath);
}

export function optionalTrivialityReason(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): string | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  const nonWhitespaceLength = typeof raw === "string" ? raw.replace(/\s/gu, "").length : 0;
  if (typeof raw !== "string" || nonWhitespaceLength < MIN_TRIVIALITY_REASON_LENGTH) {
    throw invalidScenario(
      scenarioPath,
      `'${objectPath}.${key}' must be a string with at least ${MIN_TRIVIALITY_REASON_LENGTH} non-whitespace characters, received ${describeValue(raw)}.`,
    );
  }
  return raw;
}

export function optionalBoolean(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): boolean | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a boolean, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalNumber(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a finite number, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalNonNegativeNumber(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a finite non-negative number, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalNonNegativeInteger(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a non-negative integer, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalPositiveInteger(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a positive integer, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalPositiveNumber(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a positive number, received ${describeValue(raw)}.`);
  }
  return raw;
}

export function optionalTargetArray(value: Record<string, unknown>, key: string, scenarioPath: string, objectPath: string): PlaytestTarget[] | undefined {
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
export function present<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export function validatePerformanceAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestPerformanceAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["maxDrawCalls", "maxFrameMsP95", "maxTriangles"], scenarioPath, objectPath);
  return {
    ...present("maxDrawCalls", optionalNonNegativeNumber(record, "maxDrawCalls", scenarioPath, objectPath)),
    ...present("maxFrameMsP95", optionalNonNegativeNumber(record, "maxFrameMsP95", scenarioPath, objectPath)),
    ...present("maxTriangles", optionalNonNegativeNumber(record, "maxTriangles", scenarioPath, objectPath)),
  };
}

export function validateFramebufferCoverageAssertion(
  value: unknown,
  scenarioPath: string,
  objectPath: string,
): IPlaytestFramebufferCoverageAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["backdrop", "grid", "tolerance", "window"], scenarioPath, objectPath);
  const backdrop = requireArray(record, "backdrop", scenarioPath, objectPath);
  if (backdrop.length !== 3
    || backdrop.some((channel) => typeof channel !== "number" || !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw invalidScenario(
      scenarioPath,
      `'${objectPath}.backdrop' must be three integer RGB channels from 0 to 255.`,
    );
  }
  const tolerance = optionalNonNegativeInteger(record, "tolerance", scenarioPath, objectPath);
  if (tolerance === undefined || tolerance > 255) {
    throw invalidScenario(scenarioPath, `'${objectPath}.tolerance' must be an integer from 0 to 255.`);
  }
  const window = requireRecord(record.window, scenarioPath, `${objectPath}.window`);
  rejectUnknownKeys(window, ["endStep", "startStep"], scenarioPath, `${objectPath}.window`);
  const gridValue = record.grid;
  let grid: IPlaytestFramebufferCoverageAssertion["grid"];
  if (gridValue !== undefined) {
    const gridRecord = requireRecord(gridValue, scenarioPath, `${objectPath}.grid`);
    rejectUnknownKeys(gridRecord, ["columns", "rows"], scenarioPath, `${objectPath}.grid`);
    const columns = optionalPositiveInteger(gridRecord, "columns", scenarioPath, `${objectPath}.grid`);
    const rows = optionalPositiveInteger(gridRecord, "rows", scenarioPath, `${objectPath}.grid`);
    if (columns === undefined || rows === undefined || columns > 256 || rows > 256) {
      throw invalidScenario(
        scenarioPath,
        `'${objectPath}.grid' columns and rows must be positive integers no greater than 256.`,
      );
    }
    grid = { columns, rows };
  }
  return {
    backdrop: backdrop as [number, number, number],
    ...(grid === undefined ? {} : { grid }),
    tolerance,
    window: {
      endStep: requireString(window, "endStep", scenarioPath, `${objectPath}.window`),
      startStep: requireString(window, "startStep", scenarioPath, `${objectPath}.window`),
    },
  };
}

export function validateStateAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestStateAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "entity", "equals"], scenarioPath, objectPath);
  return {
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    equals: requireString(record, "equals", scenarioPath, objectPath),
  };
}

export function validateTagCountAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestTagCountAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "count", ...NUMERIC_COMPARISON_KEYS, "tag"], scenarioPath, objectPath);
  const count = optionalNonNegativeInteger(record, "count", scenarioPath, objectPath);
  const gte = optionalNonNegativeInteger(record, "gte", scenarioPath, objectPath);
  const lte = optionalNonNegativeInteger(record, "lte", scenarioPath, objectPath);
  // Without a bound the evaluator degrades to "a numeric count exists", which is
  // satisfied by a count of zero — the opposite of what `tags: [{ tag: "coin" }]`
  // was written to prove. Reject it at load time, where the author sees it.
  if (count === undefined && gte === undefined && lte === undefined) {
    throw invalidScenario(
      scenarioPath,
      `'${objectPath}' must declare 'count', 'gte', or 'lte'; a tag assertion with none passes on a count of zero.`,
    );
  }
  return {
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...present("count", count),
    ...present("gte", gte),
    ...present("lte", lte),
    tag: requireString(record, "tag", scenarioPath, objectPath),
  };
}

export function validateContactAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestContactAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  // A non-record entry used to be filtered out of the array and a typo'd
  // requiredOn target was silently dropped, widening the assertion to every
  // target. Both must fail at load.
  return {
    ...present("atStep", optionalString(record, "atStep", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    ...present("kind", optionalString(record, "kind", scenarioPath, objectPath)),
    ...present("maxCount", optionalNonNegativeInteger(record, "maxCount", scenarioPath, objectPath)),
    ...present("minCount", optionalNumber(record, "minCount", scenarioPath, objectPath)),
    ...present("requiredOn", optionalTargetArray(record, "requiredOn", scenarioPath, objectPath)),
    ...present("with", optionalString(record, "with", scenarioPath, objectPath)),
  };
}

export function validateSignalAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestSignalAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["atStep", "entity", "maxCount", "minCount", "name"], scenarioPath, objectPath);
  return {
    ...present("atStep", optionalString(record, "atStep", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    ...present("maxCount", optionalNonNegativeInteger(record, "maxCount", scenarioPath, objectPath)),
    ...present("minCount", optionalNonNegativeInteger(record, "minCount", scenarioPath, objectPath)),
    name: requireString(record, "name", scenarioPath, objectPath),
  };
}

export function validateAnimationAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestAnimationAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["advancedFrames", "allowTrivial", "clip", "entered", "entity", "finished"], scenarioPath, objectPath);
  return {
    ...present("advancedFrames", optionalNumber(record, "advancedFrames", scenarioPath, objectPath)),
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...present("clip", optionalString(record, "clip", scenarioPath, objectPath)),
    ...present("entered", optionalBoolean(record, "entered", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    ...present("finished", optionalBoolean(record, "finished", scenarioPath, objectPath)),
  };
}

export function validateVisibilityAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestVisibilityAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["allowTrivial", "entity", "maxOffscreenRatio", "minProjectedPixels", "present"], scenarioPath, objectPath);
  return {
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...present("entity", optionalString(record, "entity", scenarioPath, objectPath)),
    ...present("maxOffscreenRatio", optionalNumber(record, "maxOffscreenRatio", scenarioPath, objectPath)),
    ...present("minProjectedPixels", optionalNumber(record, "minProjectedPixels", scenarioPath, objectPath)),
    ...present("present", optionalBoolean(record, "present", scenarioPath, objectPath)),
  };
}

export function validatePathAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestPathAssertion {
  const record = requireRecord(value, scenarioPath, objectPath);
  // An entry without an id used to be filtered out of the array and a wrong-typed
  // atSteps entry dropped from the labeled series, so the assertion silently
  // evaluated fewer samples than the author declared.
  const gte = optionalNumber(record, "gte", scenarioPath, objectPath);
  const lte = optionalNumber(record, "lte", scenarioPath, objectPath);
  return {
    ...(Array.isArray(record.atSteps) ? { atSteps: record.atSteps.map((step, index) => {
      const entry = requireRecord(step, scenarioPath, `${objectPath}.atSteps[${index}]`);
      return {
        ...(hasKey(entry, "equals") ? { equals: entry.equals } : {}),
        label: requireString(entry, "label", scenarioPath, `${objectPath}.atSteps[${index}]`),
        ...present("textIncludes", optionalString(entry, "textIncludes", scenarioPath, `${objectPath}.atSteps[${index}]`)),
      };
    }) } : {}),
    ...present("changed", optionalBoolean(record, "changed", scenarioPath, objectPath)),
    ...present("allowTrivial", optionalTrivialityReason(record, "allowTrivial", scenarioPath, objectPath)),
    ...(hasKey(record, "equals") ? { equals: record.equals } : {}),
    ...present("gte", gte),
    id: requireString(record, "id", scenarioPath, objectPath),
    ...present("lte", lte),
    ...present("path", optionalString(record, "path", scenarioPath, objectPath)),
    ...present("textIncludes", optionalString(record, "textIncludes", scenarioPath, objectPath)),
    ...present("throughoutSteps", optionalBoolean(record, "throughoutSteps", scenarioPath, objectPath)),
  };
}

export function validateResourcePathAssertion(value: unknown, scenarioPath: string, objectPath: string): IPlaytestResourceAssertion {
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
  const assertion = validatePathAssertion(record, scenarioPath, objectPath);
  if (assertion === undefined) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must name a resource id.`);
  }
  return assertion;
}

export function validateResourcePathAlternative(
  value: unknown,
  scenarioPath: string,
  objectPath: string,
): IPlaytestResourcePathAlternative {
  const record = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record, ["changed", "equals", ...NUMERIC_COMPARISON_KEYS, "path", "textIncludes"], scenarioPath, objectPath);
  const changed = optionalBoolean(record, "changed", scenarioPath, objectPath);
  const gte = optionalNumber(record, "gte", scenarioPath, objectPath);
  const lte = optionalNumber(record, "lte", scenarioPath, objectPath);
  const textIncludes = optionalString(record, "textIncludes", scenarioPath, objectPath);
  if (!hasKey(record, "equals") && changed === undefined && gte === undefined && lte === undefined && textIncludes === undefined) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must declare equals, gte, lte, textIncludes, or changed.`);
  }
  return {
    ...present("changed", changed),
    ...(hasKey(record, "equals") ? { equals: record.equals } : {}),
    ...present("gte", gte),
    ...present("lte", lte),
    path: requireString(record, "path", scenarioPath, objectPath),
    ...present("textIncludes", textIncludes),
  };
}

export function validateViewport(value: unknown, scenarioPath = "scenario"): IPlaytestViewport {
  if (value === undefined) {
    return { height: 720, width: 1280 };
  }
  const record = requireRecord(value, scenarioPath, "viewport");
  rejectUnknownKeys(record, ["height", "width"], scenarioPath, "viewport");
  const width = positiveInteger(record.width);
  if (width === undefined) {
    throw invalidScenario(scenarioPath, `'viewport.width' must be a positive integer, received ${describeValue(record.width)}.`);
  }
  const height = positiveInteger(record.height);
  if (height === undefined) {
    throw invalidScenario(scenarioPath, `'viewport.height' must be a positive integer, received ${describeValue(record.height)}.`);
  }
  return { height, width };
}



export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function validateOptionalNumberTuple(value: Record<string, unknown>, key: "position" | "scale", length: 3, scenarioPath: string, index: number): [number, number, number] | undefined;
export function validateOptionalNumberTuple(value: Record<string, unknown>, key: "rotation", length: 4, scenarioPath: string, index: number): [number, number, number, number] | undefined;
export function validateOptionalNumberTuple(
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

export function validateNumberTuple(value: unknown, length: 3): [number, number, number] | undefined;
export function validateNumberTuple(value: unknown, length: 4): [number, number, number, number] | undefined;
export function validateNumberTuple(value: unknown, length: 3 | 4): [number, number, number] | [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  return value as [number, number, number] | [number, number, number, number];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasKey(value: Record<string, unknown>, key: string): boolean {
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
export const ASSERTION_FIELD_TYPE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  "boolean": (value) => typeof value === "boolean",
  "non-empty string": isNonEmptyString,
  "non-negative integer": (value) => typeof value === "number" && Number.isInteger(value) && value >= 0,
  "number": (value) => typeof value === "number" && Number.isFinite(value),
  "number in [0, 180]": (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 180,
  "positive integer": (value) => typeof value === "number" && Number.isInteger(value) && value > 0,
  "positive number": (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  "string": isNonEmptyString,
  "triviality reason": isTrivialityReason,
};

export function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function isTrivialityReason(value: unknown): boolean {
  return typeof value === "string"
    && value.replace(/\s/gu, "").length >= MIN_TRIVIALITY_REASON_LENGTH;
}

export function rejectWrongTypedFields(
  fields: readonly { name: string; type: string }[],
  value: Record<string, unknown>,
  scenarioPath: string,
  objectPath: string,
): void {
  for (const field of fields) {
    const check = ASSERTION_FIELD_TYPE_CHECKS[field.type];
    if (check === undefined || value[field.name] === undefined) continue;
    if (!check(value[field.name])) {
      const expectedType = field.type === "triviality reason"
        ? `a string with at least ${MIN_TRIVIALITY_REASON_LENGTH} non-whitespace characters`
        : field.type;
      throw invalidScenario(
        scenarioPath,
        `'${objectPath}.${field.name}' must be ${expectedType}, received ${describeValue(value[field.name])}.`,
      );
    }
  }
}


export function validateAssertionKeys(value: Record<string, unknown>, scenarioPath: string): void {
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
      const pathAssertionWithId = (entry.kind === "hud" || entry.kind === "resources") && typeof item.id === "string";
      const fields = pathAssertionWithId
        ? entry.fields.filter((field) => !NUMERIC_COMPARISON_KEYS.includes(field.name as (typeof NUMERIC_COMPARISON_KEYS)[number]))
        : entry.fields;
      rejectWrongTypedFields(fields, item, scenarioPath, `assert.${entry.kind}${suffix}`);
      validateNestedAssertionKeys(entry.kind, item, scenarioPath, suffix);
    });
  }
}

export function validateNestedAssertionKeys(
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
  if (kind === "world" && isRecord(value.runtime)) {
    rejectUnknownKeys(
      value.runtime,
      ["agent", "core", "randomState", "rapier", "step"],
      scenarioPath,
      `assert.${kind}${suffix}.runtime`,
    );
  }
}
