import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BENCHMARK_GEOMETRY,
  assertNativeGeometry,
  assertTimedCollisionGeometry,
  createBenchmarkReport,
} from "../scripts/measure-continuous-collision.mjs";

function nativeGeometry() {
  return {
    bodyCount: BENCHMARK_GEOMETRY.bodyCount,
    bodySpeed: BENCHMARK_GEOMETRY.bodySpeed,
    bodyStartFarthestX: BENCHMARK_GEOMETRY.bodyStartFarthestX,
    bodyStartNearestX: BENCHMARK_GEOMETRY.bodyStartNearestX,
    dt: BENCHMARK_GEOMETRY.dt,
    measuredSteps: BENCHMARK_GEOMETRY.measuredSteps,
    projectileRadius: BENCHMARK_GEOMETRY.projectileRadius,
    wallHalfDepth: BENCHMARK_GEOMETRY.wallHalfDepth,
    wallHalfHeight: BENCHMARK_GEOMETRY.wallHalfHeight,
    wallThickness: BENCHMARK_GEOMETRY.wallThickness,
    wallX: BENCHMARK_GEOMETRY.wallX,
    warmupSteps: BENCHMARK_GEOMETRY.warmupSteps,
  };
}

test("the timed price scene crosses the wall during measurement", () => {
  assert.doesNotThrow(assertTimedCollisionGeometry);
});

test("the report and native runner must keep the measured radius and geometry", () => {
  const report = createBenchmarkReport({}, { geometry: nativeGeometry() });
  assert.equal(report.scene.geometry.projectileRadius, 0.05);
  assert.match(report.scene.definition, /0\.05 m radius projectile/u);
  assert.doesNotThrow(() => assertNativeGeometry(report.native));
  assert.throws(
    () => assertNativeGeometry({ geometry: { ...nativeGeometry(), projectileRadius: 0.1 } }),
    /GEOMETRY_MISMATCH.*projectileRadius/u,
  );
});
