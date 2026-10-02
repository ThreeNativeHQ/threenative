import { describe, expect, it } from "vitest";
import { summarizeVelocityPixels } from "../../examples/abyss-framework/src/render/velocityReadback.js";
import { assertVelocityCaptureDiagnostics } from "../velocity-capture-proof.js";

describe("real velocity capture proof", () => {
  it("measures separate static and moving halves from rendered RGBA pixels", () => {
    const data = new Float32Array(4 * 2 * 4);
    data[2 * 4] = 0.05;
    data[6 * 4 + 1] = -0.025;
    expect(summarizeVelocityPixels(data, 4, 2)).toEqual({
      staticMax: 0,
      movingMax: 0.05000000074505806,
      movingPixels: 2,
    });
  });
  it("rejects missing, nonfinite and wrongly shaped GPU readbacks", () => {
    expect(() => summarizeVelocityPixels(new Float32Array(), 4, 2)).toThrow(/RGBA/);
    expect(() => summarizeVelocityPixels(new Float32Array(32).fill(Number.NaN), 4, 2)).toThrow(
      /finite/,
    );
    expect(() => summarizeVelocityPixels(new Float32Array(32), 0, 2)).toThrow(/dimensions/);
  });
  it("does not mistake a static scene for moving output", () => {
    expect(summarizeVelocityPixels(new Float32Array(32), 4, 2)).toEqual({
      staticMax: 0,
      movingMax: 0,
      movingPixels: 0,
    });
  });
  it("rejects device loss even when the software runner downgraded it", () => {
    expect(() =>
      assertVelocityCaptureDiagnostics(
        [{ code: "TN_PLAYTEST_SOFTWARE_DEVICE_LOST", severity: "warning", message: "lost" }],
        false,
      ),
    ).toThrow(/DEVICE_LOST/);
  });
  it("allows only the expected mutation assertion error", () => {
    expect(() =>
      assertVelocityCaptureDiagnostics(
        [
          {
            code: "TN_PLAYTEST_RESOURCE_ASSERTION_FAILED",
            severity: "error",
            message: "no motion",
          },
        ],
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertVelocityCaptureDiagnostics(
        [{ code: "TN_PLAYTEST_CONSOLE_ERROR", severity: "error", message: "compile" }],
        true,
      ),
    ).toThrow(/CONSOLE_ERROR/);
  });
});
