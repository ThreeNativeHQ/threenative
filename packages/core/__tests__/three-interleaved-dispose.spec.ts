import { InterleavedBuffer, InterleavedBufferAttribute } from "three";
// @ts-expect-error Three's private renderer module has no public declaration; this test must exercise it directly.
import WebGPUAttributeUtils from "three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js";
import { describe, expect, it } from "vitest";

/**
 * Disposing a geometry whose attributes are interleaved — every cooked world GLB is — must forget
 * the destroyed GPU buffer, not only the attribute that named it. An interleaved attribute's buffer
 * lives on its `InterleavedBuffer` and several attributes share it, so without the forget the entry
 * stays in the backend's map: the next `createAttribute()` for that buffer finds the destroyed
 * `GPUBuffer` and the renderer submits a dead buffer every frame, which is a canvas that stops
 * updating after a world re-streams. The WebGL backend has always deleted it; this is the same
 * rule. The fix lives in `patches/three@0.185.1.patch`.
 */
interface IBackendLike {
  readonly get: (object: object) => { buffer?: { destroy: () => void } };
  readonly delete: (object: object) => boolean;
}

interface IBackendStub {
  readonly backend: IBackendLike;
  count: number;
}

function backendStub(): IBackendStub {
  const store = new WeakMap<object, { buffer?: { destroy: () => void } }>();
  const stub: IBackendStub = {
    backend: {
      get: (object) => {
        const found = store.get(object);
        if (found !== undefined) return found;
        const fresh: { buffer?: { destroy: () => void } } = {};
        store.set(object, fresh);
        return fresh;
      },
      delete: (object) => store.delete(object),
    },
    count: 0,
  };
  return stub;
}

describe("WebGPUAttributeUtils interleaved dispose", () => {
  it("destroys the shared GPU buffer once and forgets it, so createAttribute cannot find it", () => {
    const stub = backendStub();
    const { backend } = stub;
    const utils = new WebGPUAttributeUtils(backend);
    const interleaved = new InterleavedBuffer(new Float32Array(6 * 4), 6);
    const position = new InterleavedBufferAttribute(interleaved, 3, 0);
    const normal = new InterleavedBufferAttribute(interleaved, 3, 3);
    backend.get(interleaved).buffer = { destroy: () => (stub.count += 1) };

    utils.destroyAttribute(position);
    utils.destroyAttribute(normal);

    expect(stub.count, "the shared GPU buffer is destroyed once, not once per attribute").toBe(1);
    expect(
      backend.get(interleaved).buffer,
      "the destroyed buffer is still in the backend",
    ).toBeUndefined();
  });
});
