import {
  type IPlaytestAssertionResult,
  type IPlaytestObservationSnapshot,
  type IPlaytestScenario,
} from "../index.js";
import { entityPosition, length, subtract } from "./shared.js";

export function pixelBoundsToNdc(
  bounds: { height: number; width: number; x: number; y: number },
  viewport: { height: number; width: number },
) {
  return {
    max: [2 * (bounds.x + bounds.width) / viewport.width - 1, 1 - 2 * bounds.y / viewport.height],
    min: [2 * bounds.x / viewport.width - 1, 1 - 2 * (bounds.y + bounds.height) / viewport.height],
  };
}

export function cameraReport(
  scenario: IPlaytestScenario,
  before: IPlaytestObservationSnapshot | undefined,
  after: IPlaytestObservationSnapshot | undefined,
) {
  const assertion = scenario.assert?.camera;
  const cameraId = assertion?.entity ?? "camera";
  const targetId = assertion?.follows ?? scenario.subject ?? "";
  const beforeCamera = entityPosition(before, cameraId);
  const afterCamera = entityPosition(after, cameraId);
  const target = entityPosition(after, targetId);
  return {
    ...(afterCamera === undefined ? {} : { after: { frame: scenario.steps.length, position: afterCamera, tick: after?.clock.tick ?? 0 } }),
    ...(beforeCamera === undefined ? {} : { before: { frame: 0, position: beforeCamera, tick: before?.clock.tick ?? 0 } }),
    entity: cameraId,
    separation: afterCamera === undefined || target === undefined ? undefined : length(subtract(afterCamera, target)),
    within: assertion?.within ?? Number.POSITIVE_INFINITY,
  };
}

export function evaluateCamera(
  scenario: IPlaytestScenario,
  snapshot: IPlaytestObservationSnapshot | undefined,
): IPlaytestAssertionResult | undefined {
  const assertion = scenario.assert?.camera;
  if (assertion === undefined) return undefined;
  const cameraId = assertion.entity ?? "camera";
  const targetId = assertion.follows ?? scenario.subject ?? "";
  const camera = entityPosition(snapshot, cameraId);
  const targetEntity = snapshot?.entities?.find(({ id }) => id === targetId);
  const target = targetEntity?.transform?.position;
  const separation = camera === undefined || target === undefined ? undefined : length(subtract(camera, target));
  return {
    details: { camera: cameraId, separation, target: targetId, visible: targetEntity?.visible },
    id: "camera",
    pass: (assertion.within === undefined || (separation !== undefined && separation <= assertion.within))
      && (assertion.targetInViewport !== true || targetEntity?.visible === true),
  };
}
