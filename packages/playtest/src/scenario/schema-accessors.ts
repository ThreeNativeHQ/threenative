import { invalidScenario } from "./errors.js";
import { MIN_TRIVIALITY_REASON_LENGTH } from "./schema-base.js";
import type { IPlaytestViewport, PlaytestTarget } from "./schema-base.js";

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

export function validateViewport(value: unknown): IPlaytestViewport {
  if (!isRecord(value)) {
    return { height: 720, width: 1280 };
  }
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  return width === undefined || height === undefined ? { height: 720, width: 1280 } : { height, width };
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
