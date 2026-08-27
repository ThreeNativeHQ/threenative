import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "runtime-scripts", "frame-op-stream.js"),
  "utf8",
);
const factory = Function(`"use strict"; let factory; factory = ${source}\nreturn factory;`)();

function harness() {
  const device = {
    createBuffer() {
      return { _bufferId: 40, destroy() {} };
    },
    createCommandEncoder() {},
    createTexture() {
      return { _textureId: 41, destroy() {} };
    },
  };
  const queue = {
    writeBuffer() {},
    writeTexture() {},
    copyExternalImageToTexture() {},
    submit() {},
  };
  const drain = factory({ device, queue });
  return { device, queue, drain };
}

function records(buffer) {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(0x544e4652);
  expect(view.getUint32(4, true)).toBe(1);
  expect(view.getUint32(8, true)).toBe(buffer.byteLength);
  const result = [];
  let cursor = 16;
  while (cursor < buffer.byteLength) {
    const bytes = view.getUint32(cursor + 4, true);
    result.push({ opcode: view.getUint32(cursor, true), cursor, bytes });
    expect(bytes).toBeGreaterThanOrEqual(8);
    expect(bytes % 8).toBe(0);
    cursor += bytes;
  }
  expect(result).toHaveLength(view.getUint32(12, true));
  return { view, result };
}

describe("packed frame op stream", () => {
  it("returns one packed buffer with eager upload bytes and ordered frame ops", () => {
    const { device, queue, drain } = harness();
    const source = new Uint32Array([1, 2, 3, 4]);
    queue.writeBuffer({ _bufferId: 7 }, 0, source);
    source.fill(99);
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer({ _bufferId: 8 }, 0, 16);
    queue.submit([encoder.finish()]);
    const frame = drain();
    expect(frame).toBeInstanceOf(ArrayBuffer);
    const { view, result } = records(frame);
    expect(result.map(({ opcode }) => opcode)).toEqual([1, 2, 27, 28, 29]);
    const upload = result[0].cursor;
    expect(Array.from(new Uint32Array(frame, upload + 24, 4))).toEqual([1, 2, 3, 4]);
    expect(drain()).toBeNull();
  });

  it("fails synchronously on invalid upload ranges, offsets, and resource ids", () => {
    const { device, queue, drain } = harness();
    const buffer = { _bufferId: 1 };
    expect(() => queue.writeBuffer(buffer, 2, new Uint32Array(1))).toThrow(/multiple of 4/);
    expect(() => queue.writeBuffer(buffer, 0, new Uint32Array(1), -1)).toThrow(/range/);
    expect(() => queue.writeBuffer({}, 0, new Uint32Array(1))).toThrow(/numeric id/);
    queue.writeBuffer(buffer, 0, new Uint32Array(1));
    expect(() => device.createCommandEncoder().clearBuffer({}, 0, 4)).toThrow(/numeric id/);
    queue.writeBuffer(buffer, 0, new Uint32Array(1));
    const frame = drain();
    expect(() => records(frame)).not.toThrow();
    expect(records(frame).result.map(({ opcode }) => opcode)).toEqual([1, 2, 1]);
  });

  it("serializes every steady-state command family without a native fallback", () => {
    const { device, queue, drain } = harness();
    const buffer = { _bufferId: 1 };
    const texture = { _textureId: 2 };
    const view = { _textureViewId: 3 };
    const group = { _bindGroupId: 4 };
    const pipeline = { _pipelineId: 5 };
    const bundle = { _renderBundleId: 6 };
    const encoder = device.createCommandEncoder();
    const render = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    render.setPipeline(pipeline);
    render.setBindGroup(0, group, [4]);
    render.setVertexBuffer(0, buffer);
    render.setIndexBuffer(buffer, "uint32");
    render.draw(3);
    render.drawIndexed(3, 1, 0, -1, 0);
    render.drawIndirect(buffer, 0);
    render.drawIndexedIndirect(buffer, 0);
    render.setViewport(0, 0, 1, 1, 0, 1);
    render.setScissorRect(0, 0, 1, 1);
    render.setBlendConstant([0, 0, 0, 1]);
    render.setStencilReference(1);
    render.executeBundles([bundle]);
    render.end();
    const compute = encoder.beginComputePass();
    compute.setPipeline(pipeline);
    compute.setBindGroup(0, group);
    compute.dispatchWorkgroups(1);
    compute.end();
    encoder.copyBufferToBuffer(buffer, 0, buffer, 0, 4);
    encoder.copyBufferToTexture({ buffer }, { texture }, [1, 1, 1]);
    encoder.copyTextureToBuffer({ texture }, { buffer }, [1, 1, 1]);
    encoder.copyTextureToTexture({ texture }, { texture }, [1, 1, 1]);
    encoder.clearBuffer(buffer);
    const textureUpload = new Uint8Array([1, 2, 3, 4]);
    queue.writeTexture({ texture }, textureUpload, { bytesPerRow: 4 }, [1, 1, 1]);
    textureUpload.fill(99);
    const external = new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12]);
    queue.copyExternalImageToTexture(
      { source: { width: 2, height: 1, data: external }, origin: [1, 0], flipY: true },
      { texture },
      [1, 1, 1],
    );
    external.fill(99);
    queue.submit([encoder.finish()]);
    device.createBuffer({}).destroy();
    device.createTexture({}).destroy();
    const frame = drain();
    const { view: packed, result } = records(frame);
    const opcodes = result.map(({ opcode }) => opcode);
    expect(opcodes).toEqual(
      expect.arrayContaining(Array.from({ length: 32 }, (_, index) => index + 2)),
    );
    const writeTexture = result.find(({ opcode }) => opcode === 30);
    expect(writeTexture).toBeDefined();
    expect(Array.from(new Uint8Array(frame, writeTexture.cursor + 64, 4))).toEqual([1, 2, 3, 4]);
    const externalCopy = result.find(({ opcode }) => opcode === 31);
    expect(externalCopy).toBeDefined();
    expect(packed.getUint32(externalCopy.cursor + 16, true)).toBe(1);
    expect(packed.getUint32(externalCopy.cursor + 20, true)).toBe(0);
    expect(packed.getUint32(externalCopy.cursor + 24, true)).toBe(1);
    expect(Array.from(new Uint8Array(frame, externalCopy.cursor + 68, 8))).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});
