import { describe, expect, test } from "vitest";

import type { IPlaytestObservationSnapshot, IPlaytestScenario } from "../src/index.js";
import type { IPlaytestEntityObservation } from "../src/protocol.js";
import { cameraReport, evaluateCamera, pixelBoundsToNdc } from "../src/runner/camera.js";

function scenario(
  camera: NonNullable<IPlaytestScenario["assert"]>["camera"],
  subject = "player",
): IPlaytestScenario {
  return {
    assert: camera === undefined ? undefined : { camera },
    name: "camera-test",
    schemaVersion: 1,
    steps: [],
    subject,
    target: "web",
    viewport: { height: 100, width: 200 },
    warmupFrames: 0,
  };
}

function snapshot(entities: IPlaytestEntityObservation[], tick?: number): IPlaytestObservationSnapshot {
  return {
    clock: { mode: "fixed-step", ...(tick === undefined ? {} : { tick }) },
    entities,
  };
}

function entity(id: string, position?: [number, number, number], visible?: boolean): IPlaytestEntityObservation {
  return {
    id,
    ...(position === undefined ? {} : { transform: { position } }),
    ...(visible === undefined ? {} : { visible }),
  };
}

describe("playtest camera assertions", () => {
  test("converts a pixel rectangle to the expected lower-left and upper-right NDC bounds", () => {
    expect(pixelBoundsToNdc(
      { height: 30, width: 40, x: 10, y: 20 },
      { height: 100, width: 200 },
    )).toEqual({
      max: [-0.5, 0.6],
      min: [-0.9, 0],
    });
  });

  test("reports camera and target positions with measured separation and bridge ticks", () => {
    const result = cameraReport(
      { ...scenario({ entity: "camera.main", follows: "player", within: 3 }), steps: [{ release: false }] },
      snapshot([entity("camera.main", [0, 2, 4])], 7),
      snapshot([entity("camera.main", [1, 3, 5]), entity("player", [1, 1, 5])], 12),
    );

    expect(result).toEqual({
      after: { frame: 1, position: [1, 3, 5], tick: 12 },
      before: { frame: 0, position: [0, 2, 4], tick: 7 },
      entity: "camera.main",
      separation: 2,
      within: 3,
    });
  });

  test("uses defaults and reports missing observations without inventing a pass", () => {
    const result = cameraReport(scenario(undefined), undefined, snapshot([entity("player", [0, 0, 0])]));

    expect(result).toEqual({
      entity: "camera",
      separation: undefined,
      within: Number.POSITIVE_INFINITY,
    });
    expect(evaluateCamera(scenario(undefined), snapshot([]))).toBeUndefined();
  });

  test("evaluates distance and viewport visibility independently", () => {
    const assertion = { entity: "camera.main", follows: "player", targetInViewport: true, within: 5 };
    const passing = evaluateCamera(
      scenario(assertion),
      snapshot([entity("camera.main", [0, 0, 0]), entity("player", [3, 4, 0], true)]),
    );
    expect(passing).toEqual({
      details: { camera: "camera.main", separation: 5, target: "player", visible: true },
      id: "camera",
      pass: true,
    });

    expect(evaluateCamera(
      scenario(assertion),
      snapshot([entity("camera.main", [0, 0, 0]), entity("player", [3, 4, 0], false)]),
    )?.pass).toBe(false);
    expect(evaluateCamera(
      scenario(assertion),
      snapshot([entity("camera.main", [0, 0, 0]), entity("player", [6, 0, 0], true)]),
    )?.pass).toBe(false);
  });

  test("fails closed when either endpoint is not observed and allows an unbounded distance", () => {
    expect(evaluateCamera(
      scenario({ follows: "player", targetInViewport: true, within: 5 }),
      snapshot([entity("player", [0, 0, 0], true)]),
    )).toMatchObject({ details: { separation: undefined }, pass: false });

    expect(evaluateCamera(
      scenario({ follows: "player" }),
      snapshot([entity("camera", [0, 0, 0]), entity("player", [100, 0, 0])]),
    )?.pass).toBe(true);
  });
});
