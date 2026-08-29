import { Group } from "three";
import { Fn } from "three/tsl";
import { SpriteNodeMaterial } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { GPUParticles3D } from "../src/particles.js";
import type { IRendererLike } from "../src/renderer.js";

function computeNode() {
  return Fn(() => {})().compute(1);
}

function particles(options: Partial<ConstructorParameters<typeof GPUParticles3D>[0]> = {}) {
  return new GPUParticles3D({
    amount: 4,
    material: new SpriteNodeMaterial(),
    process: () => computeNode(),
    start: () => computeNode(),
    ...options,
  });
}

function renderer(dispatched: unknown[]): IRendererLike {
  const canvas = new EventTarget() as HTMLCanvasElement;
  return {
    compileAsync: async () => undefined,
    compute: (node) => dispatched.push(node),
    dispose: () => undefined,
    domElement: canvas,
    info: {},
    kind: "webgpu",
    raw: {},
    render: () => undefined,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    gpuFrameMs: () => undefined,
    resolveGpuFrame: () => undefined,
    setResolutionScale: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned" as const,
    }),
  };
}

describe("GPUParticles3D", () => {
  it("fails closed for invalid amount, material, and compute callbacks", () => {
    expect(() => particles({ amount: 0 })).toThrow("GPUParticles3D.amount");
    expect(
      () =>
        new GPUParticles3D({
          amount: 1,
          process: () => computeNode(),
          start: () => computeNode(),
        } as never),
    ).toThrow("GPUParticles3D.material");
    expect(() => particles({ start: () => ({}) as never })).toThrow("GPUParticles3D.start");
    expect(() => particles({ process: () => ({}) as never })).toThrow("GPUParticles3D.process");
  });

  it("dispatches start, process, restart, and releases both buffers on removal", () => {
    const dispatched: unknown[] = [];
    const particle = particles();
    const parent = new Group();
    const positionsDispose = vi.spyOn(particle.buffers.positions.value, "dispose");
    const velocitiesDispose = vi.spyOn(particle.buffers.velocities.value, "dispose");
    parent.add(particle);
    const gpu = renderer(dispatched);

    expect(particle.processCadence).toBe("render");
    particle.attachRenderer(gpu);
    expect(dispatched).toHaveLength(1);
    particle.process();
    expect(dispatched).toHaveLength(2);
    particle.emitting = false;
    particle.process();
    expect(dispatched).toHaveLength(2);
    particle.emitting = true;
    particle.restart();
    expect(dispatched).toHaveLength(3);

    parent.remove(particle);
    expect(particle.released).toBe(true);
    expect(positionsDispose).toHaveBeenCalledOnce();
    expect(velocitiesDispose).toHaveBeenCalledOnce();
    particle.process();
    expect(dispatched).toHaveLength(3);
  });
});
