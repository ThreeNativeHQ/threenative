import { describe, expect, it } from "vitest";
import {
  assertNotIterating,
  autoFields,
  disposeEntity,
  snapshotEntities,
} from "../src/entity-snapshot.js";

describe("autoFields", () => {
  it("keeps number, string and boolean fields", () => {
    expect(autoFields({ x: 1, name: "player", active: true })).toEqual({
      x: 1,
      name: "player",
      active: true,
    });
  });

  it("copies values that expose a toArray method", () => {
    const v = { toArray: () => [1, 2, 3] };
    expect(autoFields({ position: v })).toEqual({ position: [1, 2, 3] });
  });

  it("drops values that are not primitives and not toArray", () => {
    expect(
      autoFields({
        object: { nested: 1 },
        list: [1, 2, 3],
        fn: () => {},
        nullish: null,
        undefinedish: undefined,
        nonFunctionToarray: { toArray: 42 },
      }),
    ).toEqual({});
  });

  it("keeps at most 24 fields", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) many[`f${i}`] = i;

    const fields = autoFields(many);

    expect(Object.keys(fields).length).toBe(24);
    expect(fields.f0).toBe(0);
    expect(fields.f23).toBe(23);
    expect(fields).not.toHaveProperty("f24");
  });

  it("keeps dropping out-of-24 keys in order and only fills slots for kept fields", () => {
    const entity: Record<string, unknown> = {
      drop: { nested: 1 },
      dropAgain: null,
      keep1: 1,
      keep2: "two",
      ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`k${i}`, i])),
      k25: 99,
      k26: 99,
      k27: 99,
      k28: 99,
    };

    const fields = autoFields(entity);

    expect(fields.keep1).toBe(1);
    expect(fields.keep2).toBe("two");
    expect(fields.k0).toBe(0);
    expect(fields.k21).toBe(21);
    expect(Object.keys(fields).length).toBe(24);
    expect(fields).not.toHaveProperty("k22");
    expect(fields).not.toHaveProperty("k25");
    expect(fields).not.toHaveProperty("drop");
  });
});

describe("disposeEntity", () => {
  it("calls dispose when it is a function", () => {
    const entity: { disposed: number; dispose?: () => void } = { disposed: 0 };
    entity.dispose = () => {
      entity.disposed += 1;
    };

    disposeEntity(entity);

    expect(entity.disposed).toBe(1);
  });

  it("does nothing when dispose is missing or not a function", () => {
    expect(() => disposeEntity({})).not.toThrow();
    expect(() => disposeEntity({ dispose: null })).not.toThrow();
    expect(() => disposeEntity({ dispose: "not a function" })).not.toThrow();
  });
});

describe("assertNotIterating", () => {
  it("throws a TypeError with the operation name when iteration is in progress", () => {
    expect(() => assertNotIterating(true, "remove")).toThrow(TypeError);

    expect(() => assertNotIterating(true, "remove")).toThrow(
      "Registry.remove() cannot mutate during snapshot.",
    );

    expect(() => assertNotIterating(true, "clear")).toThrow(
      "Registry.clear() cannot mutate during snapshot.",
    );
  });

  it("does nothing when iteration is not in progress", () => {
    expect(() => assertNotIterating(false, "remove")).not.toThrow();
    expect(() => assertNotIterating(false, "sweep")).not.toThrow();
  });
});

describe("snapshotEntities", () => {
  it("prefers debug() over autoFields", () => {
    const entity = {
      x: 1,
      y: 2,
      debug: () => ({ x: 100, y: 200 }),
    };

    const named = new Map([["a", entity]]);

    expect(snapshotEntities(named)).toEqual({ a: { x: 100, y: 200 } });
  });

  it("uses autoFields when there is no debug function", () => {
    const named = new Map([["a", { x: 1, y: "two" }]]);

    expect(snapshotEntities(named)).toEqual({ a: { x: 1, y: "two" } });
  });

  it("includes a copied tags array when tags are all strings", () => {
    const entity = { x: 1, tags: ["coin", "spawn"] };
    const named = new Map([["a", entity]]);

    const snap = snapshotEntities(named);
    const originalTags = entity.tags;

    expect(snap.a?.tags).toEqual(originalTags);
    expect(snap.a?.tags).not.toBe(originalTags);

    // Mutating the entity's array after the snapshot must not change it.
    originalTags.push("extra");
    expect(snap.a?.tags).toEqual(["coin", "spawn"]);
  });

  it("omits tags when the entity has no tags", () => {
    const named = new Map([["a", { x: 1 }]]);

    expect(snapshotEntities(named).a).not.toHaveProperty("tags");
  });

  it("omits tags when tags is not an array of strings", () => {
    const named = new Map([
      ["noTags", { tags: undefined }],
      ["nullTags", { tags: null }],
      ["badArray", { x: 1, tags: ["ok", 123] }],
      ["notArray", { x: 1, tags: "coin" }],
    ]);

    const snap = snapshotEntities(named);

    expect(snap.noTags).toEqual({});
    expect(snap.nullTags).toEqual({});
    expect(snap.badArray).toEqual({ x: 1 });
    // The tag logic does not copy a non-string-array tags; the string is
    // only present because autoFields copies plain strings as-is.
    expect(snap.notArray).toEqual({ x: 1, tags: "coin" });
  });

  it("keeps the result for multiple entities", () => {
    const named = new Map([
      ["a", { x: 1 }],
      ["b", { y: 2 }],
    ]);

    expect(snapshotEntities(named)).toEqual({
      a: { x: 1 },
      b: { y: 2 },
    });
  });
});
