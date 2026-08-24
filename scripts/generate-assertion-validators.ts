import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAYTEST_ASSERTION_REGISTRY,
  assertPlaytestAssertionRegistryComplete,
} from "../packages/playtest/src/assertion-schema.js";
import type {
  IPlaytestAssertionSchemaConstraint,
  IPlaytestAssertionSchemaEntry,
  IPlaytestAssertionSchemaField,
} from "../packages/playtest/src/assertion-schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  repoRoot,
  "packages/playtest/src/scenario/generated-assertion-validators.ts",
);

function compactField(field: IPlaytestAssertionSchemaField): Record<string, unknown> {
  return {
    constraints: compactConstraint(field.constraints),
    name: field.name,
    required: field.required === true,
    type: field.type,
  };
}

function variantFields(
  entry: IPlaytestAssertionSchemaEntry,
  names: readonly string[] | undefined,
  excludedNames: readonly string[] = [],
  requiredNames: readonly string[] = [],
): IPlaytestAssertionSchemaField[] {
  const fields = new Map(entry.fields.map((field) => [field.name, field]));
  const selectedNames =
    names ??
    entry.fields.map((field) => field.name).filter((name) => !excludedNames.includes(name));
  return selectedNames.map((name) => {
    const field = fields.get(name);
    if (field === undefined) {
      throw new Error(
        `Assertion registry variant '${entry.kind}' references unknown field '${name}'.`,
      );
    }
    return requiredNames.includes(name) && field.required !== true
      ? { ...field, required: true }
      : field;
  });
}

function compactConstraint(
  constraint: IPlaytestAssertionSchemaConstraint,
): Record<string, unknown> {
  switch (constraint.kind) {
    case "array":
      return {
        ...(constraint.maxItems === undefined ? {} : { maxItems: constraint.maxItems }),
        ...(constraint.minItems === undefined ? {} : { minItems: constraint.minItems }),
        items: compactConstraint(constraint.items),
        kind: constraint.kind,
      };
    case "number":
      return {
        ...(constraint.integer === undefined ? {} : { integer: constraint.integer }),
        ...(constraint.max === undefined ? {} : { max: constraint.max }),
        ...(constraint.min === undefined ? {} : { min: constraint.min }),
        ...(constraint.minExclusive === undefined ? {} : { minExclusive: constraint.minExclusive }),
        kind: constraint.kind,
      };
    case "record":
      return {
        fields: constraint.fields.map(compactField),
        ...(constraint.rules === undefined ? {} : { rules: constraint.rules }),
        ...(constraint.unknownKeys === undefined ? {} : { unknownKeys: constraint.unknownKeys }),
        kind: constraint.kind,
      };
    case "string":
      return {
        ...(constraint.format === undefined ? {} : { format: constraint.format }),
        ...(constraint.minNonWhitespace === undefined
          ? {}
          : { minNonWhitespace: constraint.minNonWhitespace }),
        ...(constraint.nonEmpty === undefined ? {} : { nonEmpty: constraint.nonEmpty }),
        kind: constraint.kind,
      };
    case "tuple":
      return { items: constraint.items.map(compactConstraint), kind: constraint.kind };
    case "union":
      return {
        ...(constraint.discriminator === undefined
          ? {}
          : { discriminator: constraint.discriminator }),
        kind: constraint.kind,
        variants: constraint.variants.map(compactConstraint),
      };
    case "boolean":
    case "json":
    case "literal":
      return {
        ...(constraint.kind === "literal" ? { values: constraint.values } : {}),
        kind: constraint.kind,
      };
  }
}

function compactEntry(entry: IPlaytestAssertionSchemaEntry): Record<string, unknown> {
  const schema: IPlaytestAssertionSchemaConstraint =
    entry.variants === undefined
      ? {
          fields: entry.fields,
          kind: "record",
          ...(entry.rules === undefined ? {} : { rules: entry.rules }),
          unknownKeys: "reject",
        }
      : {
          ...(entry.discriminator === undefined ? {} : { discriminator: entry.discriminator }),
          kind: "union",
          variants: entry.variants.map((variant) => ({
            fields: variantFields(
              entry,
              variant.fields,
              variant.excludeFields,
              variant.requiredFields,
            ),
            ...(variant.rules === undefined ? {} : { rules: variant.rules }),
            kind: "record",
            unknownKeys: "reject",
          })),
        };
  return {
    cardinality: entry.cardinality,
    kind: entry.kind,
    ...(entry.minItems === undefined ? {} : { minItems: entry.minItems }),
    ...(entry.minItemsMessage === undefined ? {} : { minItemsMessage: entry.minItemsMessage }),
    schema: compactConstraint(schema),
  };
}

const runtime = String.raw`
import { invalidScenario } from "./errors.js";
import type { IPlaytestScenarioAssertions } from "./schema-base.js";

type IGeneratedPrimitive = string | number | boolean | null;
type IGeneratedRule =
  | { fields: readonly string[]; kind: "requireOneOf"; message?: string }
  | { equals: IGeneratedPrimitive; field: string; kind: "requireWhen"; message?: string; required: string }
  | { field: string; kind: "nonEmptyArray"; message?: string }
  | { field: string; kind: "noConsecutiveDuplicates"; message?: string }
  | { fields: readonly string[]; kind: "requireOneOfOrTrue"; message?: string; trueFields: readonly string[] };
type IGeneratedConstraint =
  | { kind: "boolean" }
  | { integer?: boolean; kind: "number"; max?: number; min?: number; minExclusive?: boolean }
  | { format?: "project-relative-png"; kind: "string"; minNonWhitespace?: number; nonEmpty?: boolean }
  | { kind: "json" }
  | { items: IGeneratedConstraint; kind: "array"; maxItems?: number; minItems?: number }
  | { items: readonly IGeneratedConstraint[]; kind: "tuple" }
  | { fields: readonly IGeneratedField[]; kind: "record"; rules?: readonly IGeneratedRule[]; unknownKeys?: "allow" | "reject" }
  | { kind: "literal"; values: readonly IGeneratedPrimitive[] }
  | { discriminator?: { field: string; presentVariant: number }; kind: "union"; variants: readonly IGeneratedConstraint[] };
type IGeneratedField = { constraints: IGeneratedConstraint; name: string; required: boolean; type: string };
type IGeneratedEntry = { cardinality: "array" | "object"; kind: keyof IPlaytestScenarioAssertions; minItems?: number; minItemsMessage?: string; schema: IGeneratedConstraint };

export const GENERATED_ASSERTION_SCHEMAS: readonly IGeneratedEntry[] = __SCHEMAS__;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return "the string " + JSON.stringify(value);
  return typeof value + " " + (JSON.stringify(value) ?? String(value));
}

function isSafeProjectRelativePng(value: unknown): boolean {
  if (
    typeof value !== "string"
    || !value.toLowerCase().endsWith(".png")
    || value.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(value)
  ) return false;
  return !value.split(/[\\/]/).includes("..");
}

function expectedType(constraint: IGeneratedConstraint, declaredType: string): string {
  if (constraint.kind === "string" && constraint.minNonWhitespace !== undefined) {
    return "a string with at least " + constraint.minNonWhitespace + " non-whitespace characters";
  }
  if (constraint.kind === "number" && declaredType === "number") {
    return "number (finite number)";
  }
  return declaredType;
}

function invalidType(
  value: unknown,
  constraint: IGeneratedConstraint,
  scenarioPath: string,
  objectPath: string,
  declaredType: string,
): never {
  throw invalidScenario(
    scenarioPath,
    "'" + objectPath + "' must be " + expectedType(constraint, declaredType) + ", received " + describeValue(value) + ".",
  );
}

function validateRecord(
  value: unknown,
  constraint: Extract<IGeneratedConstraint, { kind: "record" }>,
  scenarioPath: string,
  objectPath: string,
): Record<string, unknown> {
  if (!isRecord(value)) invalidType(value, constraint, scenarioPath, objectPath, "an object");
  const fields = new Map(constraint.fields.map((field) => [field.name, field]));
  if (constraint.unknownKeys !== "allow") {
    const unknown = Object.keys(value).find((key) => !fields.has(key));
    if (unknown !== undefined) {
      throw invalidScenario(
        scenarioPath,
        "Unknown key '" + unknown + "' at " + objectPath + "." + unknown + ". Supported keys: " + [...fields.keys()].sort().join(", ") + ".",
      );
    }
  }
  const result: Record<string, unknown> = {};
  for (const field of constraint.fields) {
    const present = hasOwn(value, field.name) && value[field.name] !== undefined;
    if (!present) continue;
    result[field.name] = validateConstraint(
      value[field.name],
      field.constraints,
      scenarioPath,
      objectPath + "." + field.name,
      field.type,
    );
  }
  for (const field of constraint.fields) {
    if (!hasOwn(value, field.name) || value[field.name] === undefined) {
      if (field.required) {
        invalidType(undefined, field.constraints, scenarioPath, objectPath + "." + field.name, field.type);
      }
    }
  }
  for (const rule of constraint.rules ?? []) validateRule(result, rule, scenarioPath, objectPath);
  return result;
}

function validateRule(
  value: Record<string, unknown>,
  rule: IGeneratedRule,
  scenarioPath: string,
  objectPath: string,
): void {
  if (rule.kind === "requireOneOf") {
    if (rule.fields.some((field) => hasOwn(value, field))) return;
    throw invalidScenario(scenarioPath, "'" + objectPath + "' " + (rule.message ?? ("must declare one of " + rule.fields.join(", "))));
  }
  if (rule.kind === "requireOneOfOrTrue") {
    if (rule.fields.some((field) => hasOwn(value, field)) || rule.trueFields.some((field) => value[field] === true)) return;
    throw invalidScenario(scenarioPath, "'" + objectPath + "' " + (rule.message ?? "must declare a binding predicate"));
  }
  if (rule.kind === "requireWhen") {
    if (value[rule.field] !== rule.equals) return;
    const reason = value[rule.required];
    if (typeof reason === "string" && reason.trim() !== "") return;
    throw invalidScenario(scenarioPath, "Assertion '" + objectPath + "." + rule.field + "' " + (rule.message ?? ("requires '" + rule.required + "'")));
  }
  if (rule.kind === "nonEmptyArray") {
    const entries = value[rule.field];
    if (Array.isArray(entries) && entries.length > 0) return;
    throw invalidScenario(scenarioPath, "'" + objectPath + "." + rule.field + "' " + (rule.message ?? "must contain at least one entry"));
  }
  const entries = value[rule.field];
  if (!Array.isArray(entries)) return;
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index] === entries[index - 1]) {
      throw invalidScenario(scenarioPath, rule.message ?? ("'" + objectPath + "." + rule.field + "' must not repeat a consecutive value."));
    }
  }
}

function validateConstraint(
  value: unknown,
  constraint: IGeneratedConstraint,
  scenarioPath: string,
  objectPath: string,
  declaredType: string,
): unknown {
  if (constraint.kind === "json") return value;
  if (constraint.kind === "boolean") {
    if (typeof value !== "boolean") invalidType(value, constraint, scenarioPath, objectPath, declaredType);
    return value;
  }
  if (constraint.kind === "number") {
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || (constraint.integer === true && !Number.isInteger(value))
      || (constraint.min !== undefined && (constraint.minExclusive === true ? value <= constraint.min : value < constraint.min))
      || (constraint.max !== undefined && value > constraint.max)
    ) invalidType(value, constraint, scenarioPath, objectPath, declaredType);
    return value;
  }
  if (constraint.kind === "string") {
    if (
      typeof value !== "string"
      || (constraint.nonEmpty === true && value.trim() === "")
      || (constraint.minNonWhitespace !== undefined && value.replace(/\s/gu, "").length < constraint.minNonWhitespace)
      || (constraint.format === "project-relative-png" && !isSafeProjectRelativePng(value))
    ) invalidType(value, constraint, scenarioPath, objectPath, declaredType);
    return value;
  }
  if (constraint.kind === "literal") {
    if (!constraint.values.some((candidate) => candidate === value)) invalidType(value, constraint, scenarioPath, objectPath, declaredType);
    return value;
  }
  if (constraint.kind === "array") {
    if (!Array.isArray(value)) invalidType(value, constraint, scenarioPath, objectPath, declaredType);
    if (constraint.minItems !== undefined && value.length < constraint.minItems) {
      throw invalidScenario(scenarioPath, "'" + objectPath + "' must contain at least " + constraint.minItems + " entries.");
    }
    if (constraint.maxItems !== undefined && value.length > constraint.maxItems) {
      throw invalidScenario(scenarioPath, "'" + objectPath + "' must contain no more than " + constraint.maxItems + " entries.");
    }
    return value.map((item, index) => validateConstraint(item, constraint.items, scenarioPath, objectPath + "[" + index + "]", "the declared item type"));
  }
  if (constraint.kind === "tuple") {
    if (!Array.isArray(value) || value.length !== constraint.items.length) invalidType(value, constraint, scenarioPath, objectPath, declaredType);
    return constraint.items.map((item, index) => validateConstraint(value[index], item, scenarioPath, objectPath + "[" + index + "]", "the declared tuple item type"));
  }
  if (constraint.kind === "record") return validateRecord(value, constraint, scenarioPath, objectPath);
  const variantIndex = constraint.discriminator === undefined
    ? undefined
    : isRecord(value) && hasOwn(value, constraint.discriminator.field)
      ? constraint.discriminator.presentVariant
      : constraint.variants.findIndex((_, index) => index !== constraint.discriminator?.presentVariant);
  if (variantIndex !== undefined && variantIndex >= 0) {
    return validateConstraint(value, constraint.variants[variantIndex]!, scenarioPath, objectPath, declaredType);
  }
  let firstError: unknown;
  for (const variant of constraint.variants) {
    try {
      return validateConstraint(value, variant, scenarioPath, objectPath, declaredType);
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError ?? invalidScenario(scenarioPath, "'" + objectPath + "' does not match any declared variant.");
}

function schemaFor(kind: keyof IPlaytestScenarioAssertions): IGeneratedEntry {
  const entry = GENERATED_ASSERTION_SCHEMAS.find((candidate) => candidate.kind === kind);
  if (entry === undefined) throw new Error("Generated assertion validator is missing '" + String(kind) + "'.");
  return entry;
}

export function validateGeneratedAssertion(
  kind: keyof IPlaytestScenarioAssertions,
  value: unknown,
  scenarioPath: string,
  objectPath = "assert." + String(kind),
): unknown {
  const entry = schemaFor(kind);
  if (entry.cardinality === "array" && !Array.isArray(value)) {
    throw invalidScenario(scenarioPath, "Assertion 'assert." + String(kind) + "' must be an array; the declared assertion cannot be executed.");
  }
  if (entry.cardinality === "object" && !isRecord(value)) {
    throw invalidScenario(scenarioPath, "Assertion 'assert." + String(kind) + "' must be an object; the declared assertion cannot be executed.");
  }
  if (entry.cardinality === "array" && entry.minItems !== undefined && (value as unknown[]).length < entry.minItems) {
    throw invalidScenario(
      scenarioPath,
      "Assertion 'assert." + String(kind) + "' " + (entry.minItemsMessage ?? ("must contain at least " + entry.minItems + " assertion.")),
    );
  }
  if (entry.cardinality === "array") {
    return (value as unknown[]).map((item, index) => validateConstraint(item, entry.schema, scenarioPath, objectPath + "[" + index + "]", "assertion"));
  }
  return validateConstraint(value, entry.schema, scenarioPath, objectPath, "assertion");
}

export function validateGeneratedAssertions(
  value: Record<string, unknown>,
  scenarioPath: string,
): IPlaytestScenarioAssertions {
  const result: Record<string, unknown> = {};
  for (const entry of GENERATED_ASSERTION_SCHEMAS) {
    if (value[entry.kind] === undefined) continue;
    result[entry.kind] = validateGeneratedAssertion(entry.kind, value[entry.kind], scenarioPath);
  }
  return result as IPlaytestScenarioAssertions;
}
`;

export function renderGeneratedAssertionValidators(
  registry: readonly IPlaytestAssertionSchemaEntry[] = PLAYTEST_ASSERTION_REGISTRY,
): string {
  assertPlaytestAssertionRegistryComplete(registry);
  const generatedSchemas = registry.map(compactEntry);
  return `/* Generated by scripts/generate-assertion-validators.ts — do not hand-edit. */\n${runtime.replace("__SCHEMAS__", JSON.stringify(generatedSchemas, null, 2))}`;
}

async function main(): Promise<void> {
  const source = renderGeneratedAssertionValidators();
  if (process.argv.includes("--check")) {
    let current: string;
    try {
      current = await readFile(target, "utf8");
    } catch {
      console.error(
        `assertion validators are stale or missing: ${path.relative(repoRoot, target)}`,
      );
      process.exitCode = 1;
      return;
    }
    if (current !== source) {
      console.error(
        `assertion validators are stale: regenerate ${path.relative(repoRoot, target)}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`assertion validators are current: ${PLAYTEST_ASSERTION_REGISTRY.length} kinds`);
    return;
  }
  await writeFile(target, source);
  console.log(
    `assertion validators: ${PLAYTEST_ASSERTION_REGISTRY.length} kinds -> ${path.relative(repoRoot, target)}`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
