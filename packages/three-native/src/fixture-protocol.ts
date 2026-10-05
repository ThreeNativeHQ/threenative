/**
 * The fixture line protocol: one fixture in, one reply per observation out.
 *
 * A native driver is a plain process. It reads commands on stdin and writes replies on stdout,
 * so it can be the C++ engine, a test binary, or the fake driver in `__tests__/fixtures/`. Tokens
 * are separated by single spaces and carry no other separator: strings are percent-encoded, and
 * every number travels as its binary64 bits.
 *
 *   fixture <name>
 *   new <id> <Class> <arg>*
 *   call <id> <method> <resultId|-> <arg>*
 *   set <id> <path> <arg>
 *   observe <index> <id> <path|-> <method|-> <kind>
 *   end
 *
 *   args:  n:<16 hex digits> | s:<percent-encoded> | b:1 | b:0 | null | r:<id>
 *   obs <index> <kind> <value>
 *   unsupported <index|-> <percent-encoded reason>
 *   error <percent-encoded message>
 *
 * The C++ driver implements the other half of this file.
 */

import {
  FIXTURE_NUMBER_NAMES,
  type FixtureArg,
  type FixtureNumberName,
  type IFixture,
  type ObservationKind,
  bitsNumber,
  canonicalJson,
  decimalOf,
  numberBits,
} from "./fixture-format.js";

/** Encodes one argument. `r:` is a reference, `n:` the binary64 bits of any number. */
export function encodeArg(arg: FixtureArg): string {
  if (arg === null) return "null";
  if (typeof arg === "boolean") return arg ? "b:1" : "b:0";
  if (typeof arg === "number") return `n:${numberBits(arg)}`;
  if (typeof arg === "string") return `s:${encodeURIComponent(arg)}`;
  if ("ref" in arg) return `r:${arg.ref}`;
  if (FIXTURE_NUMBER_NAMES.includes(arg.num)) return `n:${numberBits(namedNumber(arg.num))}`;
  throw new Error(
    `TN_PROTOCOL_ARG_INVALID: ${JSON.stringify(arg)} is not an argument this protocol encodes`,
  );
}

/** The value behind `{ "num": "NaN" }` and its three siblings. */
export function namedNumber(name: FixtureNumberName): number {
  if (name === "NaN") return Number.NaN;
  if (name === "Infinity") return Number.POSITIVE_INFINITY;
  if (name === "-Infinity") return Number.NEGATIVE_INFINITY;
  return -0;
}

/** The inverse of {@link encodeArg}. Fails closed on a token this protocol does not define. */
export function decodeArg(token: string): FixtureArg {
  if (token === "null") return null;
  if (token === "b:1") return true;
  if (token === "b:0") return false;
  if (token.startsWith("r:")) {
    const id = token.slice(2);
    if (id === "") throw new Error(`TN_PROTOCOL_ARG_INVALID: ${token} names no id`);
    return { ref: id };
  }
  if (token.startsWith("n:")) return bitsNumber(token.slice(2));
  if (token.startsWith("s:")) return decodeURIComponent(token.slice(2));
  throw new Error(`TN_PROTOCOL_ARG_INVALID: ${token} is not an argument this protocol decodes`);
}

const NUMBER_TOKEN = /^n:([0-9a-f]{16})$/u;

/** Every number in an observation value, in order. `-0` and NaN keep their bits. */
export function decodeNumbers(value: string): readonly number[] {
  return value.split(",").map((token) => {
    const bits = NUMBER_TOKEN.exec(token)?.[1];
    if (bits === undefined)
      throw new Error(`TN_PROTOCOL_VALUE_INVALID: ${token} is not n:<16 hex digits>`);
    return bitsNumber(bits);
  });
}

/** The text of a `string` or `json` value, percent-decoded. */
export function decodeText(value: string): string {
  if (!value.startsWith("s:"))
    throw new Error(`TN_PROTOCOL_VALUE_INVALID: ${value} is not s:<text>`);
  return decodeURIComponent(value.slice(2));
}

export interface IEncodedObservation {
  readonly value: string;
  readonly decimal: string;
}

/**
 * The wire form of an observed value, plus the decimal a human reads next to it.
 *
 * `json` compares as canonical JSON text. Two drivers that build the same object agree; a driver
 * that formats a float differently does not, which is the honest answer for a structural check.
 */
export function encodeObservation(kind: ObservationKind, value: unknown): IEncodedObservation {
  if (kind === "number") return numberValue(value as number);
  if (kind === "numbers") {
    if (!Array.isArray(value))
      throw new Error(`TN_OBSERVATION_INVALID: numbers observed ${typeof value}`);
    return {
      value: value.map((entry) => `n:${numberBits(entry as number)}`).join(","),
      decimal: value.map((entry) => decimalOf(entry as number)).join(", "),
    };
  }
  if (kind === "boolean") {
    if (typeof value !== "boolean")
      throw new Error(`TN_OBSERVATION_INVALID: boolean observed ${typeof value}`);
    return { value: value ? "b:1" : "b:0", decimal: String(value) };
  }
  if (kind === "string") {
    if (typeof value !== "string")
      throw new Error(`TN_OBSERVATION_INVALID: string observed ${typeof value}`);
    return { value: `s:${encodeURIComponent(value)}`, decimal: value };
  }
  if (kind === "pixels") {
    // The frame's own hash is the observation: two runs that drew the same pixels agree byte for
    // byte, and the driver that answers differently names a frame nobody compared.
    if (typeof value !== "string")
      throw new Error(`TN_OBSERVATION_INVALID: pixels observed ${typeof value}`);
    return { value: `s:${encodeURIComponent(value)}`, decimal: value };
  }
  const text = canonicalJson(value);
  return { value: `s:${encodeURIComponent(text)}`, decimal: text };
}

function numberValue(value: number): IEncodedObservation {
  if (typeof value !== "number")
    throw new Error(`TN_OBSERVATION_INVALID: number observed ${typeof value}`);
  return { value: `n:${numberBits(value)}`, decimal: decimalOf(value) };
}

/** The whole script for one fixture, including the `fixture` and `end` commands. */
export function encodeFixture(fixture: IFixture): readonly string[] {
  const lines = [`fixture ${fixture.name}`];
  for (const op of fixture.ops) {
    if (op.op === "set") {
      lines.push(["set", op.id, op.path, encodeArg(op.value)].join(" "));
      continue;
    }
    const args = op.args.map((arg) => encodeArg(arg));
    if (op.op === "new") lines.push(["new", op.id, op.class, ...args].join(" "));
    else lines.push(["call", op.id, op.method, op.result ?? "-", ...args].join(" "));
  }
  fixture.observe.forEach((observation, index) => {
    lines.push(
      [
        "observe",
        String(index),
        observation.id,
        observation.path ?? "-",
        observation.method ?? "-",
        observation.kind,
      ].join(" "),
    );
  });
  lines.push("end");
  return lines;
}

export interface IValueReply {
  readonly kind: "obs";
  readonly index: number;
  readonly observation: ObservationKind;
  readonly value: string;
}

export interface IUnsupportedReply {
  readonly kind: "unsupported";
  /** Null when the driver refused the fixture itself rather than one observation. */
  readonly index: number | null;
  readonly reason: string;
}

export interface IErrorReply {
  readonly kind: "error";
  readonly message: string;
}

export type DriverReply = IValueReply | IUnsupportedReply | IErrorReply;

/** Parses one stdout line. An unrecognized line throws, so a wrong driver cannot read as a pass. */
export function parseReply(line: string): DriverReply {
  const trimmed = line.trim();
  if (trimmed.startsWith("error "))
    return { kind: "error", message: decodeURIComponent(trimmed.slice(6)) };
  if (trimmed.startsWith("unsupported ")) {
    const [index, reason = ""] = trimmed.slice("unsupported ".length).split(" ");
    return {
      kind: "unsupported",
      index: index === "-" || index === "" ? null : Number(index),
      reason: decodeURIComponent(reason),
    };
  }
  if (trimmed.startsWith("obs ")) {
    const [index, observation, value] = trimmed.slice("obs ".length).split(" ");
    if (index === undefined || observation === undefined || value === undefined)
      throw new Error(`TN_PROTOCOL_REPLY_INVALID: ${JSON.stringify(trimmed)} is missing a field`);
    if (!OBSERVATIONS.has(observation))
      throw new Error(`TN_PROTOCOL_REPLY_INVALID: ${observation} is not an observation kind`);
    return {
      kind: "obs",
      index: Number(index),
      observation: observation as ObservationKind,
      value,
    };
  }
  throw new Error(`TN_PROTOCOL_REPLY_INVALID: ${JSON.stringify(trimmed)} is not a reply`);
}

const OBSERVATIONS: ReadonlySet<string> = new Set([
  "number",
  "numbers",
  "boolean",
  "string",
  "json",
  "pixels",
]);
