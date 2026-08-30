import { clamp, mix, uv, vec3 } from "three/tsl";
import * as three from "three/webgpu";
import { FluidField2D } from "../../../packages/core/src/fluid-field.ts";
import { warmUpScene } from "../../../packages/core/src/warmup.ts";
import {
  assertCondition,
  startVisualScene,
} from "../../../packages/runtime-native/conformance/scenes/shared/scene-support.js";

const MEAN_ABSOLUTE_DIVERGENCE_THRESHOLD = 0.0025;

async function waitForSubmittedWork(renderer) {
  await renderer.backend?.device?.queue?.onSubmittedWorkDone?.();
}

function isNativeConformanceRuntime() {
  return String(globalThis.__TN_ASSET_BASE__ ?? "").endsWith(":0/");
}

async function readTexture(renderer, textureNode, resolution) {
  const texture = textureNode.value ?? textureNode;
  const backend = renderer.backend;
  const device = backend?.device;
  const textureGPU = backend?.get(texture)?.texture;
  if (!device || !textureGPU) throw new Error("fluid field conformance needs texture readback");
  const bytesPerTexel = 16;
  const bytesPerRow = Math.ceil((resolution * bytesPerTexel) / 256) * 256;
  const buffer = device.createBuffer({
    size: (resolution - 1) * bytesPerRow + resolution * bytesPerTexel,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture: textureGPU, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
    { buffer, offset: 0, bytesPerRow, rowsPerImage: resolution },
    { width: resolution, height: resolution, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = buffer.getMappedRange().slice();
  buffer.unmap();
  buffer.destroy();
  const padded = new Float32Array(mapped);
  const values = new Float32Array(resolution * resolution * 4);
  const rowValues = resolution * 4;
  const rowStride = bytesPerRow / 4;
  for (let row = 0; row < resolution; row += 1) {
    values.set(padded.subarray(row * rowStride, row * rowStride + rowValues), row * rowValues);
  }
  return values;
}

async function readVelocity(renderer, field, resolution) {
  return readTexture(renderer, field.velocity.sample(uv()), resolution);
}

async function readDye(renderer, field, resolution) {
  return readTexture(renderer, field.dye.sample(uv()), resolution);
}

function range(values, channel) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = channel; index < values.length; index += 4) {
    const value = values[index];
    if (Number.isFinite(value)) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return { minimum, maximum, span: maximum - minimum };
}

function meanAbsoluteDivergence(values, resolution) {
  let total = 0;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const at = (column, row, channel) => values[(row * resolution + column) * 4 + channel] ?? 0;
      const left = at(Math.max(0, x - 1), y, 0);
      const right = at(Math.min(resolution - 1, x + 1), y, 0);
      const bottom = at(x, Math.max(0, y - 1), 1);
      const top = at(x, Math.min(resolution - 1, y + 1), 1);
      total += Math.abs((right - left + top - bottom) * 0.5);
    }
  }
  return total / (resolution * resolution);
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "fluid-field",
    async ({ camera, renderer, scene }) => {
      const field = new FluidField2D({
        pressureIterations: 2,
        resolution: 32,
        viscosity: 0,
      });
      scene.add(field);
      const computeRenderer = { compute: (node) => renderer.compute(node) };
      field.attachRenderer(computeRenderer);
      const warmup = await warmUpScene(renderer, scene, camera, {
        computeNodes: field.warmupNodes,
      });
      assertCondition(
        warmup.computeCompiled === field.warmupNodes.length,
        "fluid field warm-up must compile every ordered solver pass",
      );

      field.splat({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.15 }, 1);
      for (let index = 0; index < 4; index += 1) field.process(computeRenderer);
      await waitForSubmittedWork(renderer);
      assertCondition(field.steps === 4, "native fluid field must advance four fixed steps");
      assertCondition(
        field.splatsApplied === 1,
        "native fluid field must apply one non-zero splat",
      );
      let meanDivergence = null;
      let dyeRange = null;
      if (!isNativeConformanceRuntime()) {
        const velocity = await readVelocity(renderer, field, 32);
        const dye = await readDye(renderer, field, 32);
        meanDivergence = meanAbsoluteDivergence(velocity, 32);
        assertCondition(
          Number.isFinite(meanDivergence),
          "fluid field divergence readback is invalid",
        );
        assertCondition(
          meanDivergence < MEAN_ABSOLUTE_DIVERGENCE_THRESHOLD,
          `fluid field mean absolute divergence ${meanDivergence.toFixed(6)} must stay below ${MEAN_ABSOLUTE_DIVERGENCE_THRESHOLD}`,
        );
        dyeRange = range(dye, 0);
        assertCondition(dyeRange.span > 0.0001, "fluid field dye readback must be non-uniform");
        console.log(`FLUID_MEAN_DIVERGENCE:${meanDivergence}`);
        console.log(`FLUID_DYE_RANGE:${JSON.stringify(dyeRange)}`);
      } else {
        console.log("FLUID_NATIVE_READBACK:skipped; native texture readback is unavailable");
      }

      const nodeMaterial = new three.MeshBasicNodeMaterial({ transparent: true });
      const density = clamp(field.dye.sample(uv()).x, 0, 1);
      nodeMaterial.colorNode = mix(vec3(0.02, 0.04, 0.08), vec3(0.85, 0.95, 1), density);
      nodeMaterial.opacityNode = 1;
      const mesh = new three.Mesh(new three.PlaneGeometry(1.8, 1.8), nodeMaterial);
      scene.add(mesh);
      return {
        field,
        mesh,
        detail: {
          fixedSteps: field.steps,
          meanAbsoluteDivergence:
            meanDivergence === null ? null : Number(meanDivergence.toFixed(6)),
          meanAbsoluteDivergenceThreshold: MEAN_ABSOLUTE_DIVERGENCE_THRESHOLD,
          dyeRange,
          nonZeroSplats: field.splatsApplied,
          passesPerStep: 11,
          samplerReads: 1,
          warmupNodes: field.warmupNodes.length,
        },
      };
    },
    { background: 0x05070e },
  );
}
