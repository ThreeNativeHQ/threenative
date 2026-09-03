import { describe, expect, it } from "vitest";
import {
  checkCapabilityExamples,
  checkExampleInstrument,
} from "../../../scripts/check-capability-examples.js";

/**
 * The manifest's example is the line a user's agent copies. It has to compile.
 *
 * Eleven did not. Every physics constructor named options its type does not have —
 * `new RigidBody3D({ context, object, mode: "dynamic" })` against a type whose options are
 * `physics`, `object`, `shape` and `type`, with `shape` required — and `Joint3D` and
 * `CollisionShape3D` were shown being constructed through private constructors that only their
 * static factories can reach. An agent following the manifest wrote code that did not build, in
 * the one place the framework gets to teach its own API.
 */
describe("capability examples", () => {
  it("resolves the real package types and still rejects a wrong option", () => {
    const control = checkExampleInstrument();

    expect(control, "the example checker must resolve @threenative types").toMatchObject({
      rejects: true,
      resolves: true,
    });
  });

  it("type-checks every hand-authored example against the type it demonstrates", () => {
    const result = checkCapabilityExamples();

    expect(
      result.checked,
      "no example was compiled — the manifest or the paths moved",
    ).toBeGreaterThan(150);
    expect(
      result.failures.map(
        (failure) => `${failure.symbol} (${failure.importPath}): ${failure.messages[0] ?? ""}`,
      ),
    ).toEqual([]);
  });
});
