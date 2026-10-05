/**
 * The compatibility fixture format, its goldens, and the reader that fails closed.
 *
 * One fixture is a script plus a non-empty observation set: `ops` build state, `observe` reads
 * it, and the tolerance decides when the native engine's answer matches. The same fixture is
 * executed twice — once in Node against the pinned `three` to produce a golden
 * (`tests/compatibility/run-reference.ts`), once against a native driver that speaks the line
 * protocol (`tests/compatibility/run-native.ts`).
 *
 * A golden records every number as its 16-hex-digit IEEE-754 binary64 bit string, because JSON
 * cannot hold `-0`, `NaN` or a NaN payload and those are exactly the values a compatibility
 * fixture exists to compare. The decimal next to it is for humans and is never compared.
 *
 *   pnpm --filter @threenative/three-native test:reference
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The package root. Derived from this file so a spec and a package script agree. */
export const PACKAGE_ROOT = path.join(import.meta.dirname, "..");
export const REPO_ROOT = path.join(PACKAGE_ROOT, "..", "..");
export const FIXTURES_DIR = path.join(PACKAGE_ROOT, "tests", "compatibility", "fixtures");
export const GOLDENS_DIR = path.join(PACKAGE_ROOT, "tests", "compatibility", "goldens");

/** Kinds a golden can carry. Anything else is a typo, and a typo must not read as a match. */
export const OBSERVATION_KINDS = ["number", "numbers", "boolean", "string", "json"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** JSON has no NaN, Infinity or -0, so those numbers travel under a name. */
export type FixtureNumberName = "NaN" | "Infinity" | "-Infinity" | "-0";
export const FIXTURE_NUMBER_NAMES: readonly FixtureNumberName[] = [
  "NaN",
  "Infinity",
  "-Infinity",
  "-0",
];

export interface IFixtureRef {
  readonly ref: string;
}

export interface IFixtureNumber {
  readonly num: FixtureNumberName;
}

/** Every argument an op or observation carries. */
export type FixtureArg = number | string | boolean | null | IFixtureRef | IFixtureNumber;

/** `abs` is an absolute difference; `ulps` is a distance in representable doubles. At least one. */
export interface IFixtureTolerance {
  readonly abs?: number;
  readonly ulps?: number;
}

export interface INewOp {
  readonly op: "new";
  readonly id: string;
  readonly class: string;
  readonly args: readonly FixtureArg[];
}

export interface ICallOp {
  readonly op: "call";
  readonly id: string;
  readonly method: string;
  readonly args: readonly FixtureArg[];
  /** The id the return value is bound to. Absent means the value is discarded. */
  readonly result?: string;
}

export interface ISetOp {
  readonly op: "set";
  readonly id: string;
  readonly path: string;
  readonly value: FixtureArg;
}

export type FixtureOp = INewOp | ICallOp | ISetOp;

/** Reads `path` or calls `method`, never both: one observation, one source. */
export interface IObservation {
  readonly id: string;
  readonly kind: ObservationKind;
  readonly path?: string;
  readonly method?: string;
}

export interface IFixture {
  readonly name: string;
  readonly adaptedFrom: string;
  readonly tolerance: IFixtureTolerance;
  readonly ops: readonly FixtureOp[];
  readonly observe: readonly IObservation[];
  /** A fixture that needs a real renderer. `run-reference` reports it blocked, never passed. */
  readonly render?: boolean;
}

/** One recorded observation. `value` is exactly what a driver prints on the wire. */
export interface IGoldenObservation {
  readonly index: number;
  readonly id: string;
  readonly kind: ObservationKind;
  readonly path?: string;
  readonly method?: string;
  readonly value: string;
  /** Human-readable form of `value`. Never compared. */
  readonly decimal?: string;
}

export interface IFixtureGolden {
  readonly name: string;
  readonly threeVersion: string;
  readonly adaptedFrom: string;
  /** Non-null when the reference could not execute this fixture; `observations` is then empty. */
  readonly blocked: string | null;
  readonly observations: readonly IGoldenObservation[];
}

/** Protocol tokens share one alphabet: no spaces, no separators, no escaping. */
const TOKEN = /^[A-Za-z_$][\w$]*$/u;
/** A fixture name may also carry hyphens, because the corpus is named like a test file. */
const NAME = /^[A-Za-z_$][\w$-]*$/u;
const PATH_SEGMENT = /^(?:[A-Za-z_$][\w$]*|\d+)$/u;
const HEX_BITS = /^[0-9a-f]{16}$/u;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isPath(value: string): boolean {
  return value.split(".").every((segment) => PATH_SEGMENT.test(segment));
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const BUFFER = new DataView(new ArrayBuffer(8));

/**
 * The binary64 bits of `value` as 16 hex digits: the only lossless form a golden can hold.
 *
 * A NaN is recorded as the canonical quiet NaN. Hardware raises several NaN bit patterns for the
 * same invalid operation — `0 * Infinity` alone yields both signs on x86 — so the payload is not
 * part of the claim, and a golden carrying one would fail `--repeat` for reasons that have nothing
 * to do with compatibility. `-0` keeps its sign, which is the sign that carries meaning.
 */
export function numberBits(value: number): string {
  if (Number.isNaN(value)) return "7ff8000000000000";
  BUFFER.setFloat64(0, value, false);
  return BUFFER.getBigUint64(0, false).toString(16).padStart(16, "0");
}

/** The inverse of {@link numberBits}. Throws on anything that is not 16 hex digits. */
export function bitsNumber(bits: string): number {
  if (!HEX_BITS.test(bits))
    throw new Error(`TN_FIXTURE_BITS_INVALID: ${bits} is not 16 lowercase hex digits`);
  BUFFER.setBigUint64(0, BigInt(`0x${bits}`), false);
  return BUFFER.getFloat64(0, false);
}

/** A decimal form a human can read. `-0` needs `Object.is`, and `String` already says NaN. */
export function decimalOf(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

/** Key-sorted JSON, so two drivers that build the same object compare equal regardless of order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const entries = Object.entries(item as Record<string, unknown>);
    return Object.fromEntries(
      entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  });
}

/**
 * Every rule the format states, as messages. Fails closed: an empty array is the only pass, so a
 * caller cannot forget to read the result.
 */
export function fixtureErrors(value: unknown, expectedName?: string): readonly string[] {
  const errors: string[] = [];
  const root = record(value);
  const name = root.name;
  if (typeof name !== "string" || !NAME.test(name))
    errors.push("$.name: required, and must match /^[A-Za-z_$][\\w$-]*$/");
  if (expectedName !== undefined && name !== expectedName)
    errors.push(`$.name: ${JSON.stringify(name)} does not match its file name ${expectedName}`);
  if (typeof root.adaptedFrom !== "string" || root.adaptedFrom.trim() === "")
    errors.push("$.adaptedFrom: required, and must name the upstream test or `original`");
  if (root.render !== undefined && typeof root.render !== "boolean")
    errors.push("$.render: must be a boolean when present");

  const tolerance = record(root.tolerance);
  if (root.tolerance === undefined) errors.push("$.tolerance: required");
  else if (tolerance.abs === undefined && tolerance.ulps === undefined)
    errors.push("$.tolerance: needs at least one of abs or ulps");
  for (const key of ["abs", "ulps"] as const) {
    if (tolerance[key] !== undefined && !nonNegative(tolerance[key]))
      errors.push(`$.tolerance.${key}: must be a non-negative finite number`);
  }

  if (!Array.isArray(root.ops) || root.ops.length === 0)
    errors.push("$.ops: required, and a fixture with no operations has nothing to observe");
  if (!Array.isArray(root.observe) || root.observe.length === 0)
    errors.push("$.observe: required, and a fixture with no observations asserts nothing");

  // Ids are resolved as operations are read, so a reference can only name something that exists.
  const defined = new Set<string>();
  const bind = (id: unknown, path: string): void => {
    if (typeof id !== "string" || !TOKEN.test(id)) {
      errors.push(`${path}: required, and must match /^[A-Za-z_$][\\w$]*$/`);
      return;
    }
    if (defined.has(id)) {
      errors.push(`${path}: id ${id} is already bound`);
      return;
    }
    defined.add(id);
  };
  const argument = (arg: unknown, path: string): void => {
    if (arg === null || typeof arg === "boolean" || typeof arg === "string") return;
    if (typeof arg === "number") {
      if (!Number.isFinite(arg))
        errors.push(`${path}: write ${String(arg)} as { "num": "${String(arg)}" }`);
      return;
    }
    const node = record(arg);
    const keys = Object.keys(node);
    if (keys.length === 1 && "ref" in node) {
      if (typeof node.ref !== "string" || !TOKEN.test(node.ref))
        errors.push(`${path}.ref: required, and must match /^[A-Za-z_$][\\w$]*$/`);
      else if (!defined.has(node.ref)) errors.push(`${path}.ref: ${node.ref} is not a bound id`);
      return;
    }
    if (keys.length === 1 && "num" in node) {
      if (!FIXTURE_NUMBER_NAMES.includes(node.num as FixtureNumberName))
        errors.push(`${path}.num: must be one of ${FIXTURE_NUMBER_NAMES.join(", ")}`);
      return;
    }
    errors.push(
      `${path}: must be a number, string, boolean, null, { "ref": id } or { "num": name }`,
    );
  };

  for (const [index, op] of (Array.isArray(root.ops) ? root.ops : []).entries()) {
    const at = `$.ops[${index}]`;
    const node = record(op);
    const args = node.args === undefined ? [] : node.args;
    if (node.op !== "new" && node.op !== "call" && node.op !== "set") {
      errors.push(`${at}.op: must be new, call or set`);
      continue;
    }
    if (!Array.isArray(args)) errors.push(`${at}.args: must be an array`);
    else args.forEach((arg, position) => argument(arg, `${at}.args[${position}]`));

    if (node.op === "new") {
      if (typeof node.class !== "string" || !TOKEN.test(node.class))
        errors.push(`${at}.class: required, and must match /^[A-Za-z_$][\\w$]*$/`);
      bind(node.id, `${at}.id`);
      continue;
    }
    if (typeof node.id !== "string" || !defined.has(node.id)) {
      errors.push(`${at}.id: ${JSON.stringify(node.id)} is not a bound id`);
    }
    if (node.op === "call" && (typeof node.method !== "string" || !TOKEN.test(node.method)))
      errors.push(`${at}.method: required, and must match /^[A-Za-z_$][\\w$]*$/`);
    if (node.op === "call" && node.result !== undefined) bind(node.result, `${at}.result`);
    if (node.op === "set") {
      if (typeof node.path !== "string" || !isPath(node.path))
        errors.push(`${at}.path: required, and must be dotted identifiers or indices`);
      argument(node.value, `${at}.value`);
    }
  }

  for (const [index, observation] of (Array.isArray(root.observe) ? root.observe : []).entries()) {
    const at = `$.observe[${index}]`;
    const node = record(observation);
    if (typeof node.id !== "string" || !defined.has(node.id))
      errors.push(`${at}.id: ${JSON.stringify(node.id)} is not a bound id`);
    if (!OBSERVATION_KINDS.includes(node.kind as ObservationKind))
      errors.push(`${at}.kind: must be one of ${OBSERVATION_KINDS.join(", ")}`);
    const hasPath = node.path !== undefined;
    const hasMethod = node.method !== undefined;
    // Neither is legal: an id bound to a returned value (a `toArray()` array) is read directly.
    if (hasPath && hasMethod) errors.push(`${at}: path and method are mutually exclusive`);
    if (hasPath && node.path !== undefined && (typeof node.path !== "string" || !isPath(node.path)))
      errors.push(`${at}.path: required, and must be dotted identifiers or indices`);
    if (
      hasMethod &&
      node.method !== undefined &&
      (typeof node.method !== "string" || !TOKEN.test(node.method))
    )
      errors.push(`${at}.method: required, and must match /^[A-Za-z_$][\\w$]*$/`);
  }
  return errors;
}

/** Parses a fixture or throws. One error message names every disagreement. */
export function parseFixture(value: unknown, expectedName?: string): IFixture {
  const errors = fixtureErrors(value, expectedName);
  if (errors.length > 0)
    throw new Error(`TN_FIXTURE_INVALID:\n${errors.map((line) => `  ${line}`).join("\n")}`);
  return value as IFixture;
}

/** The reasons a golden cannot be trusted. A blocked golden is the only one with no observations. */
export function goldenErrors(value: unknown, expectedName?: string): readonly string[] {
  const errors: string[] = [];
  const root = record(value);
  if (typeof root.name !== "string" || !NAME.test(root.name)) errors.push("$.name: required");
  else if (expectedName !== undefined && root.name !== expectedName)
    errors.push(`$.name: ${root.name} does not match its file name ${expectedName}`);
  if (typeof root.threeVersion !== "string" || root.threeVersion === "")
    errors.push("$.threeVersion: required, and must record the reference version");
  if (root.blocked !== null && typeof root.blocked !== "string")
    errors.push("$.blocked: must be null or a reason");
  const observations = root.observations;
  if (!Array.isArray(observations)) errors.push("$.observations: must be an array");
  else {
    if (root.blocked === null && observations.length === 0)
      errors.push("$.observations: a golden that ran asserts nothing");
    observations.forEach((entry, index) => {
      const node = record(entry);
      if (!Number.isInteger(node.index) || node.index !== index)
        errors.push(`$.observations[${index}].index: must equal ${index}`);
      if (!OBSERVATION_KINDS.includes(node.kind as ObservationKind))
        errors.push(
          `$.observations[${index}].kind: must be one of ${OBSERVATION_KINDS.join(", ")}`,
        );
      if (typeof node.id !== "string" || !TOKEN.test(node.id))
        errors.push(`$.observations[${index}].id: required`);
      if (typeof node.value !== "string" || node.value === "")
        errors.push(`$.observations[${index}].value: required`);
    });
  }
  return errors;
}

export function parseGolden(value: unknown, expectedName?: string): IFixtureGolden {
  const errors = goldenErrors(value, expectedName);
  if (errors.length > 0)
    throw new Error(`TN_GOLDEN_INVALID:\n${errors.map((line) => `  ${line}`).join("\n")}`);
  return value as IFixtureGolden;
}

/**
 * The reference version goldens are keyed by: the workspace catalog pin.
 *
 * `three` is not hoisted, so each package that declares `three: catalog:` owns its own link to the
 * same store copy. This reads the pin the way `run-conformance.mjs` does, so a golden can never be
 * recorded against a version the workspace does not name.
 */
export function pinnedThreeVersion(root: string = REPO_ROOT): string {
  const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const version = workspace.match(/^\s*three:\s*['"]?([^\s'"]+)['"]?\s*$/mu)?.[1];
  if (version === undefined)
    throw new Error(
      `TN_FIXTURE_THREE_UNPINNED: ${path.join(root, "pnpm-workspace.yaml")} has no three pin`,
    );
  return version;
}

export function goldenPath(name: string, version: string): string {
  return path.join(GOLDENS_DIR, version, `${name}.json`);
}

export function readGolden(name: string, version: string): IFixtureGolden | null {
  const file = goldenPath(name, version);
  if (!existsSync(file)) return null;
  return parseGolden(JSON.parse(readFileSync(file, "utf8")), name);
}

export function writeGolden(golden: IFixtureGolden, version: string): string {
  const file = goldenPath(golden.name, version);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(golden, null, 2)}\n`);
  return file;
}

/** Every fixture in the corpus, sorted by name, each parsed against its own file name. */
export function loadFixtures(directory: string = FIXTURES_DIR): readonly IFixture[] {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`TN_FIXTURE_EMPTY: ${directory} holds no fixtures`);
  return files.map((file) =>
    parseFixture(
      JSON.parse(readFileSync(path.join(directory, file), "utf8")),
      path.basename(file, ".json"),
    ),
  );
}

/** The distance between two doubles in representable steps. Used by a `ulps` tolerance. */
export function ulpDistance(left: number, right: number): number {
  const ordered = (value: number): bigint => {
    BUFFER.setFloat64(0, value, false);
    const bits = BUFFER.getBigUint64(0, false);
    return bits >= 0x8000000000000000n ? bits - 0x8000000000000000n : -(bits & 0x7fffffffffffffffn);
  };
  const distance = ordered(left) - ordered(right);
  return Number(distance < 0n ? -distance : distance);
}
