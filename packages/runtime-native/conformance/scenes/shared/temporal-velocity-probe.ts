import {
  DataUtils,
  HalfFloatType,
  Matrix4,
  type PerspectiveCamera,
  type Scene,
  type Vector3,
} from "three";
import { velocity } from "three/tsl";
import type { PassNode, WebGPURenderer } from "three/webgpu";

export function projectedMotion(
  current: Vector3,
  previous: Vector3,
  view: Matrix4,
  previousView: Matrix4,
  projection: Matrix4,
  previousProjection: Matrix4,
): Vector3 {
  return current
    .clone()
    .applyMatrix4(view)
    .applyMatrix4(projection)
    .sub(previous.clone().applyMatrix4(previousView).applyMatrix4(previousProjection));
}

/** Fixture-only readback: never used for a performance claim or as the engine's motion source. */
export function createTemporalVelocityProbe(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  scenePass: PassNode,
  points: () => Record<string, Vector3>,
) {
  const projection = new Matrix4();
  const drawProjection = new Matrix4();
  const previousView = new Matrix4();
  const previousProjection = new Matrix4();
  let previousPoints: Record<string, Vector3> | undefined;
  let projectionError: number | null = null;
  let last: unknown = null;
  const beforeRender = scene.onBeforeRender;
  scene.onBeforeRender = (...args) => {
    drawProjection.copy(camera.projectionMatrix);
    projectionError =
      velocity.projectionMatrix === null
        ? null
        : Math.max(
            ...projection.elements.map((value, index) =>
              Math.abs(value - (velocity.projectionMatrix?.elements[index] ?? Number.NaN)),
            ),
          );
    beforeRender.apply(scene, args);
  };
  return {
    before: () => {
      projection.copy(camera.projectionMatrix);
    },
    observation: () => last,
    read: async () => {
      const current = points();
      const target = scenePass.renderTarget;
      const velocityIndex = target.textures.findIndex((texture) => texture.name === "velocity");
      if (velocityIndex < 0)
        throw new Error("Velocity diagnostic requires an actual MRT attachment");
      const samples = [];
      if (previousPoints)
        for (const [name, world] of Object.entries(current)) {
          const previous = previousPoints[name];
          if (!previous) throw new Error(`Missing previous diagnostic point: ${name}`);
          const ndc = world
            .clone()
            .applyMatrix4(camera.matrixWorldInverse)
            .applyMatrix4(drawProjection);
          const x = Math.floor((ndc.x * 0.5 + 0.5) * target.width);
          const y = Math.floor((-ndc.y * 0.5 + 0.5) * target.height);
          if (x < 0 || x >= target.width || y < 0 || y >= target.height)
            throw new Error(`Diagnostic point outside raster: ${name}`);
          const data = await renderer.readRenderTargetPixelsAsync(
            target,
            x,
            y,
            1,
            1,
            velocityIndex,
          );
          const decode = (value: number) =>
            target.textures[velocityIndex]?.type === HalfFloatType
              ? DataUtils.fromHalfFloat(value)
              : value;
          const rawX = data[0];
          const rawY = data[1];
          if (rawX === undefined || rawY === undefined)
            throw new Error("Incomplete velocity readback");
          const actual: [number, number] = [decode(rawX), decode(rawY)];
          const expected = projectedMotion(
            world,
            previous,
            camera.matrixWorldInverse,
            previousView,
            projection,
            previousProjection,
          );
          if (![...actual, expected.x, expected.y].every(Number.isFinite))
            throw new Error("Nonfinite motion diagnostic");
          samples.push({
            name,
            pixel: [x, y],
            actualNdc: actual,
            expectedNdc: [expected.x, expected.y],
            errorPixels: Math.hypot(
              ((actual[0] - expected.x) * target.width) / 2,
              ((actual[1] - expected.y) * target.height) / 2,
            ),
          });
        }
      last = { projectionError, samples };
      previousPoints = current;
      previousView.copy(camera.matrixWorldInverse);
      previousProjection.copy(projection);
    },
    dispose: () => {
      scene.onBeforeRender = beforeRender;
    },
  };
}
