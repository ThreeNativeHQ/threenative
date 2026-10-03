import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { projectedMotion } from "../conformance/scenes/shared/temporal-velocity-probe.js";

describe("temporal fixture CPU motion oracle", () => {
  const camera = new PerspectiveCamera(90, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  it("uses current minus previous NDC, without converting it to UV twice", () => {
    const result = projectedMotion(
      new Vector3(1, 0, -5),
      new Vector3(0, 0, -5),
      new Matrix4(),
      new Matrix4(),
      camera.projectionMatrix,
      camera.projectionMatrix,
    );
    expect(result.x).toBeCloseTo(0.2);
    expect(result.y).toBe(0);
  });
  it("subtracts camera movement and preserves the upward-positive NDC convention", () => {
    const view = new Matrix4().makeTranslation(-1, 0, 0);
    const result = projectedMotion(
      new Vector3(1, 1, -5),
      new Vector3(0, 0, -5),
      view,
      new Matrix4(),
      camera.projectionMatrix,
      camera.projectionMatrix,
    );
    expect(result.x).toBe(0);
    expect(result.y).toBeCloseTo(0.2);
  });
});
