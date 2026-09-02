import { describe, expect, it } from "vitest";
import { assertNoArmFailures, steadyWindows } from "../env-cost-report.js";

const budget = (gpuMs: number, fps = 60): string =>
  `TN_FRAME_BUDGET:${JSON.stringify({ fps, gpuMs })}`;

describe("assertNoArmFailures", () => {
  it("fails an arm even when it collected valid steady windows", () => {
    const windows = steadyWindows([budget(99), budget(2), budget(2.1)]);
    expect(windows).toHaveLength(2);

    expect(() => assertNoArmFailures("static", ["PAGEERROR renderer crashed"])).toThrow(
      /Arm static failed.*PAGEERROR renderer crashed/,
    );
  });

  it("does nothing for an arm with no recorded failures", () => {
    expect(() => assertNoArmFailures("static", [])).not.toThrow();
  });
});
