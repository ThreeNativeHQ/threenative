import { describe, expect, it } from "vitest";
import { validatePlaytestScenario } from "../src/scenario/schema-validate.js";

function scenarioWithCamera(camera: unknown) {
  return {
    assert: { camera },
    name: "camera-binding",
    schemaVersion: 1,
    steps: [{ waitFrames: 1 }],
    subject: "player",
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 1,
  };
}

// A camera assertion with no binding predicate (within / targetInViewport: true) evaluates
// to pass without consulting any observation — the vacuous-green shape this package fails
// closed against everywhere else.
describe("camera assertions must bind a predicate", () => {
  it("rejects an empty camera assertion", () => {
    expect(() => validatePlaytestScenario(scenarioWithCamera({}), "s.json")).toThrow(
      /assert\.camera/,
    );
  });

  it("rejects entity-only and follows-only assertions that observe but require nothing", () => {
    expect(() =>
      validatePlaytestScenario(scenarioWithCamera({ entity: "ghost.camera" }), "s.json"),
    ).toThrow(/assert\.camera/);
    expect(() =>
      validatePlaytestScenario(scenarioWithCamera({ follows: "player" }), "s.json"),
    ).toThrow(/assert\.camera/);
  });

  it("rejects targetInViewport: false, which is satisfied by any observation", () => {
    expect(() =>
      validatePlaytestScenario(scenarioWithCamera({ targetInViewport: false }), "s.json"),
    ).toThrow(/assert\.camera/);
  });

  it("accepts assertions bound by within or a positive targetInViewport", () => {
    expect(() =>
      validatePlaytestScenario(scenarioWithCamera({ within: 5 }), "s.json"),
    ).not.toThrow();
    expect(() =>
      validatePlaytestScenario(scenarioWithCamera({ targetInViewport: true }), "s.json"),
    ).not.toThrow();
    expect(() =>
      validatePlaytestScenario(
        scenarioWithCamera({ entity: "camera.main", targetInViewport: true, within: 10 }),
        "s.json",
      ),
    ).not.toThrow();
  });
});
