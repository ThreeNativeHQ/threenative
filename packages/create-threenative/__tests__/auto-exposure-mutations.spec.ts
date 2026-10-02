import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mutateExposureSource } from "./fixtures/auto-exposure/mutations.js";

const source = readFileSync(new URL("../template-assets/autoExposure.ts", import.meta.url), "utf8");
const entry = readFileSync(new URL("./fixtures/auto-exposure/main.ts", import.meta.url), "utf8");

describe("exposure mutation controls", () => {
  it.each(["linear", "disabled", "meter"] as const)(
    "changes exactly one declared %s shader seam",
    (mutation) => {
      const mutated = mutateExposureSource(source, mutation);
      expect(mutated).not.toBe(source);
      expect(() => mutateExposureSource(mutated, mutation)).toThrow(/exactly one/);
    },
  );
  it("uses the existing fixed-step clock only in the negative-control entry", () => {
    expect(mutateExposureSource(entry, "clock")).toContain(
      "Reflect.deleteProperty(globalThis, PLAYTEST_CLOCK_GLOBAL)",
    );
  });
  it("fails closed if the target disappeared or became ambiguous", () => {
    expect(() => mutateExposureSource("unrelated", "linear")).toThrow(/exactly one/);
    expect(() => mutateExposureSource(source + source, "linear")).toThrow(/exactly one/);
  });
});
