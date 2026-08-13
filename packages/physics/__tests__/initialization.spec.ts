import { describe, expect, it } from "vitest";
import "../src/web.js";
import { physicsSimulationBackend } from "../src/simulation.js";

describe("web physics initialization", () => {
  it("does not expose Rapier's generated loader deprecation warning", async () => {
    const warnings: string[] = [];
    const previousWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    try {
      await physicsSimulationBackend().initialize();
    } finally {
      console.warn = previousWarn;
    }

    expect(warnings).not.toContain(
      "using deprecated parameters for the initialization function; pass a single object instead",
    );
  });
});
