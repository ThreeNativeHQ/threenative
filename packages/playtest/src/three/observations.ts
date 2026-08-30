import type {
  IPlaytestEntityObservation,
  IPlaytestObservationSnapshot,
  IPlaytestRenderChainObservation,
  IPlaytestRuntimeDiagnosticsSample,
  IPlaytestSampleRequest,
  JsonValue,
  PlaytestClockMode,
} from "../protocol.js";
import { Box3, Frustum, Matrix4, Vector2, Vector3, type Camera, type Object3D, type Scene } from "three";

import type { ThreePlaytestEntityRegistry } from "./entities.js";

export interface IThreeObservationInput {
  camera: Camera;
  clockMode: PlaytestClockMode;
  diagnostics?: () => JsonValue[];
  registry: ThreePlaytestEntityRegistry;
  renderer: IThreePlaytestRenderer;
  runtimeDiagnosticsSeries?: () => readonly IPlaytestRuntimeDiagnosticsSample[];
  resources?: () => Record<string, JsonValue>;
  renderChain?: () => IPlaytestRenderChainObservation | undefined;
  scene: Scene;
  gameplay?: () => IPlaytestObservationSnapshot["gameplay"];
  tick?: number;
}

export interface IThreePlaytestRenderer {
  getDrawingBufferSize(target: Vector2): Vector2;
  info?: {
    render?: {
      drawCalls?: unknown;
      calls?: unknown;
      triangles?: unknown;
    };
  };
}

export function sampleThreeObservations(input: IThreeObservationInput, request: IPlaytestSampleRequest): IPlaytestObservationSnapshot {
  input.scene.updateMatrixWorld(true);
  input.camera.updateMatrixWorld(true);
  const rendererSize = input.renderer.getDrawingBufferSize(new Vector2());
  const entities = input.registry.select(request.entities).map(({ id, object }) =>
    observeEntity(id, object, input.camera, rendererSize.x, rendererSize.y));
  const renderPerformance = rendererPerformance(input.renderer);
  const renderChain = input.renderChain?.();
  return {
    clock: {
      mode: input.clockMode,
      ...(input.tick === undefined ? { timeMs: performance.now() } : { tick: input.tick }),
    },
    ...(input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics() }),
    entities,
    ...(input.gameplay === undefined ? {} : { gameplay: input.gameplay() }),
    ...(renderPerformance === undefined ? {} : { performance: renderPerformance }),
    ...(renderChain === undefined ? {} : { renderChain }),
    ...(input.runtimeDiagnosticsSeries === undefined
      ? {}
      : { runtimeDiagnosticsSeries: input.runtimeDiagnosticsSeries().map((sample) => ({ ...sample })) }),
    ...(input.resources === undefined ? {} : { resources: input.resources() }),
  };
}

function rendererPerformance(
  renderer: IThreePlaytestRenderer,
): IPlaytestObservationSnapshot["performance"] {
  const render = renderer.info?.render;
  const drawCalls = finiteNumber(render?.drawCalls) ? render.drawCalls : undefined;
  const triangles = finiteNumber(render?.triangles) ? render.triangles : undefined;
  if (drawCalls === undefined && triangles === undefined) return undefined;
  return {
    ...(drawCalls === undefined ? {} : { drawCalls }),
    ...(triangles === undefined ? {} : { triangles }),
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function observeEntity(
  id: string,
  object: Object3D,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): IPlaytestEntityObservation {
  const position = object.getWorldPosition(new Vector3());
  const bounds = projectedBounds(object, camera, viewportWidth, viewportHeight);
  return {
    ...(bounds === undefined ? {} : { bounds }),
    id,
    transform: {
      position: [position.x, position.y, position.z],
      rotation: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    },
    visible: object.visible && bounds !== undefined && bounds.width > 0 && bounds.height > 0,
  };
}

function projectedBounds(
  object: Object3D,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): IPlaytestEntityObservation["bounds"] | undefined {
  const worldBounds = new Box3().setFromObject(object);
  if (worldBounds.isEmpty()) return undefined;
  const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  if (!new Frustum().setFromProjectionMatrix(projection).intersectsBox(worldBounds)) return undefined;
  const min = worldBounds.min;
  const max = worldBounds.max;
  const points = [
    new Vector3(min.x, min.y, min.z), new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z), new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, min.y, min.z), new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, min.z), new Vector3(max.x, max.y, max.z),
  ].map((point) => point.project(camera));
  const minX = Math.min(...points.map(({ x }) => x));
  const maxX = Math.max(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxY = Math.max(...points.map(({ y }) => y));
  return {
    height: Math.max(0, (maxY - minY) * 0.5 * viewportHeight),
    width: Math.max(0, (maxX - minX) * 0.5 * viewportWidth),
    x: (minX + 1) * 0.5 * viewportWidth,
    y: (1 - maxY) * 0.5 * viewportHeight,
  };
}
