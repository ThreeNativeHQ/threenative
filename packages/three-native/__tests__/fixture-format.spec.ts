import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIXTURES_DIR,
  type IFixture,
  type IFixtureTolerance,
  bitsNumber,
  fixtureErrors,
  loadFixtures,
  numberBits,
  parseFixture,
  pinnedThreeVersion,
  readGolden,
} from "../src/fixture-format.js";

/** The format is readonly on purpose; a fixture that breaks one rule has to be mutable to do it. */
type Writable<T> = {
  -readonly [Key in keyof T]: T[Key] extends object ? Writable<T[Key]> : T[Key];
};

/** A fixture the validator must accept, before a test breaks exactly one rule in it. */
function fixture(): Writable<IFixture> {
  return {
    name: "sample",
    adaptedFrom: "original",
    tolerance: { abs: 0 },
    ops: [{ op: "new", id: "m", class: "Matrix4", args: [] }],
    observe: [{ id: "m", path: "elements", kind: "numbers" }],
  };
}

function copy(): Writable<IFixture> {
  return JSON.parse(JSON.stringify(fixture())) as Writable<IFixture>;
}

function messages(value: unknown): readonly string[] {
  return fixtureErrors(value, "sample");
}

function without(key: "tolerance" | "observe"): unknown {
  const value = copy();
  Reflect.deleteProperty(value, key);
  return value;
}

function withTolerance(tolerance: IFixtureTolerance): unknown {
  const value = copy();
  value.tolerance = tolerance;
  return value;
}

function withOp(op: unknown): unknown {
  const value = copy();
  value.ops[0] = op as never;
  return value;
}

function withObservation(observation: unknown): unknown {
  const value = copy();
  value.observe[0] = observation as never;
  return value;
}

/** Two rules broken at once, so the validator has to name both. */
function withNoToleranceAndNoObservations(): unknown {
  const value = withTolerance({});
  Reflect.deleteProperty(value as object, "observe");
  return value;
}

describe("fixture format", () => {
  it("accepts a minimal fixture", () => {
    expect(messages(fixture())).toEqual([]);
  });

  it("rejects a fixture with no observations", () => {
    expect(messages(without("observe"))).toContainEqual(expect.stringContaining("$.observe"));
  });

  it("rejects a fixture with no tolerance", () => {
    expect(messages(without("tolerance"))).toContainEqual(
      expect.stringContaining("$.tolerance: required"),
    );
  });

  it("rejects a tolerance with neither an absolute nor a ulp bound", () => {
    expect(messages(withTolerance({}))).toContainEqual(
      expect.stringContaining("$.tolerance: needs at least one"),
    );
  });

  it("rejects a negative tolerance", () => {
    expect(messages(withTolerance({ abs: -1 }))).toContainEqual(
      expect.stringContaining("$.tolerance.abs"),
    );
  });

  it("rejects an unknown observation kind", () => {
    expect(messages(withObservation({ id: "m", path: "x", kind: "colour" }))).toContainEqual(
      expect.stringContaining("$.observe[0].kind"),
    );
  });

  it("rejects an unknown operation", () => {
    expect(messages(withOp({ op: "bind" }))).toContainEqual(expect.stringContaining("$.ops[0].op"));
  });

  it("rejects a reference to an id no operation bound", () => {
    expect(
      messages(withOp({ op: "call", id: "ghost", method: "copy", args: [{ ref: "nowhere" }] })),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("$.ops[0].id"),
        expect.stringContaining("$.ops[0].args[0].ref"),
      ]),
    );
  });

  it("rejects an observation that reads both a path and a method", () => {
    expect(
      messages(withObservation({ id: "m", path: "x", method: "det", kind: "number" })),
    ).toEqual(expect.arrayContaining([expect.stringContaining("$.observe[0]")]));
  });

  it("rejects a fixture whose name does not match its file", () => {
    expect(fixtureErrors(fixture(), "other")).toContainEqual(
      expect.stringContaining("does not match its file"),
    );
  });

  it("names every disagreement and throws on the first call that reads them", () => {
    const broken = withNoToleranceAndNoObservations();
    expect(fixtureErrors(broken, "sample").length).toBeGreaterThanOrEqual(2);
    expect(() => parseFixture(broken, "sample")).toThrow(/TN_FIXTURE_INVALID/u);
  });

  it("reads every number's bits without losing -0", () => {
    expect(numberBits(-0)).toBe("8000000000000000");
    expect(numberBits(0)).toBe("0000000000000000");
    expect(Object.is(bitsNumber(numberBits(-0)), -0)).toBe(true);
    expect(Object.is(bitsNumber(numberBits(0)), -0)).toBe(false);
    expect(numberBits(Number.NaN)).toBe("7ff8000000000000");
    expect(Number.isNaN(bitsNumber(numberBits(Number.NaN)))).toBe(true);
    expect(numberBits(Number.POSITIVE_INFINITY)).toBe("7ff0000000000000");
    expect(bitsNumber(numberBits(Number.NEGATIVE_INFINITY))).toBe(Number.NEGATIVE_INFINITY);
    expect(() => bitsNumber("nope")).toThrow(/TN_FIXTURE_BITS_INVALID/u);
  });
});

describe("the seed corpus", () => {
  const fixtures = loadFixtures(FIXTURES_DIR);
  const version = pinnedThreeVersion();

  it("parses every fixture in the corpus", () => {
    expect(fixtures.map((entry) => entry.name)).toEqual([
      "euler-orders",
      "lit-render",
      "matrix4-compose-invert",
      "nan-and-signed-zero",
      "object3d-hierarchy-matrixworld",
      "quaternion-slerp",
      "vector3-apply-quaternion",
    ]);
  });

  it("covers the hierarchy, matrix and edge cases the PRD names", () => {
    const names = fixtures.map((entry) => entry.name).join(",");
    for (const required of [
      "matrix4-compose-invert",
      "object3d-hierarchy-matrixworld",
      "nan-and-signed-zero",
    ])
      expect(names).toContain(required);
  });

  it("has a recorded golden for every fixture at the pinned reference version", () => {
    for (const entry of fixtures) {
      const golden = readGolden(entry.name, version);
      expect(golden, `${entry.name} has no golden for three ${version}`).not.toBeNull();
      if (golden?.blocked === null) expect(golden.observations.length).toBeGreaterThan(0);
    }
  });

  it("records the sign of zero in the golden, because JSON cannot", () => {
    expect(readGolden("nan-and-signed-zero", version)?.observations[0]?.value).toBe(
      "n:8000000000000000",
    );
    expect(readFileSync(path.join(FIXTURES_DIR, "nan-and-signed-zero.json"), "utf8")).toContain(
      "-0",
    );
  });
});
