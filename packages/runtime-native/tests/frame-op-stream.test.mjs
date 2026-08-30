import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { nativeDefinition } from "../../../test-support/native-definition.js";

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
  const declaredBytes = view.getUint32(8, true);
  expect(declaredBytes).toBeLessThanOrEqual(buffer.byteLength);
  const result = [];
  let cursor = 16;
  while (cursor < declaredBytes) {
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
  // PRD-229 Phase 5. This used to slice bindings.cpp by indexOf; once PRD-230 moves the definition
  // out of that file indexOf returns -1, the slice is empty, and the assertion passes on nothing.
  // Looking the definition up by symbol survives the move and still reds on the regression.
  it("keeps native replay compatible with the runtime's C++17 toolchains", () => {
    const replay = nativeDefinition("replayPackedFrameOpStream");

    expect(replay.text).not.toMatch(/\b[A-Za-z][A-Za-z0-9_]*\.contains\(/u);
  });

  it("keeps resource id loads class-specific so V8 inline caches stay polymorphic", () => {
    expect(source).not.toMatch(/v\?\.\[field\]|v\[field\]/u);
    expect(source).toMatch(/const bufferId = \(v\) => resourceId\(v, v\?\._bufferId/u);
    expect(source).toMatch(/const textureId = \(v\) => resourceId\(v, v\?\._textureId/u);
    expect(source).toMatch(/const pipelineId = \(v/u);
  });

  it("bounds upload property loads by typed-array width", () => {
    expect(source).not.toMatch(/data\.BYTES_PER_ELEMENT/u);
    expect(source).toMatch(/const uploadView4 =/u);
    expect(source).toMatch(/data instanceof Float32Array/u);
    expect(source).toMatch(/data instanceof Uint16Array/u);
  });

  it("reuses its arena after the host synchronously drains a frame", () => {
    const { queue, drain } = harness();
    queue.writeBuffer({ _bufferId: 1 }, 0, new Uint32Array(1));
    const first = drain();
    queue.writeBuffer({ _bufferId: 1 }, 0, new Uint32Array(1));

    expect(drain()).toBe(first);
  });

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

  // `buffer.mapAsync` drains partially, mid-frame: WebGPU completes a map only after the work
  // already submitted, and a recorded `queue.submit` has not reached the GPU yet.
  it("drains everything already submitted when the host asks for a partial frame", () => {
    const { device, queue, drain } = harness();
    queue.writeBuffer({ _bufferId: 1 }, 0, new Uint32Array(1));
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer({ _bufferId: 2 }, 0, 4);
    queue.submit([encoder.finish()]);

    const flushed = drain(1);
    expect(records(flushed).result.map(({ opcode }) => opcode)).toEqual([1, 2, 27, 28, 29]);
    expect(drain(1)).toBeNull();
    expect(drain()).toBeNull();
  });

  // The cut has to land before a half-recorded encoder: replaying a stream whose encoder is never
  // finished fails closed on the native side with "frame ended with unfinished GPU objects".
  it("leaves a half-recorded encoder behind and drains it whole at the frame boundary", () => {
    const { device, queue, drain } = harness();
    const first = device.createCommandEncoder();
    first.clearBuffer({ _bufferId: 2 }, 0, 4);
    queue.submit([first.finish()]);
    const second = device.createCommandEncoder();
    const pass = second.beginRenderPass({ colorAttachments: [] });

    const flushed = drain(1);
    expect(records(flushed).result.map(({ opcode }) => opcode)).toEqual([2, 27, 28, 29]);
    expect(drain(1)).toBeNull();

    pass.end();
    queue.submit([second.finish()]);
    const tail = drain();
    expect(tail).not.toBe(flushed);
    expect(records(tail).result.map(({ opcode }) => opcode)).toEqual([2, 3, 17, 28, 29]);
    expect(drain()).toBeNull();
  });

  it("keeps render and compute pass methods on shared receiver-aware prototypes", () => {
    const { device, drain } = harness();
    const encoderA = device.createCommandEncoder();
    const encoderB = device.createCommandEncoder();
    const renderA = encoderA.beginRenderPass({ colorAttachments: [] });
    const renderB = encoderB.beginRenderPass({ colorAttachments: [] });
    const computeA = encoderA.beginComputePass();
    const computeB = encoderB.beginComputePass();
    const buffer = { _bufferId: 40 };
    const group = { _bindGroupId: 41 };
    const renderPipeline = { _pipelineId: 42 };
    const computePipeline = { _pipelineId: 43 };
    const bundle = { _renderBundleId: 44 };
    const renderMethods = [
      ["setPipeline", 4, [renderPipeline]],
      ["setBindGroup", 5, [0, group]],
      ["setVertexBuffer", 6, [0, buffer]],
      ["setIndexBuffer", 7, [buffer, "uint32"]],
      ["draw", 8, [3]],
      ["drawIndexed", 9, [3]],
      ["drawIndirect", 10, [buffer, 0]],
      ["drawIndexedIndirect", 11, [buffer, 0]],
      ["setViewport", 12, [0, 0, 1, 1, 0, 1]],
      ["setScissorRect", 13, [0, 0, 1, 1]],
      ["setBlendConstant", 14, [[0, 0, 0, 1]]],
      ["setStencilReference", 15, [1]],
      ["executeBundles", 16, [[bundle]]],
      ["end", 17, []],
    ];
    const computeMethods = [
      ["setPipeline", 19, [computePipeline]],
      ["setBindGroup", 20, [0, group]],
      ["dispatchWorkgroups", 21, [1]],
      ["end", 22, []],
    ];

    expect(Object.getPrototypeOf(renderA)).toBe(Object.getPrototypeOf(renderB));
    for (const [name, , args] of renderMethods) {
      expect(Object.hasOwn(renderA, name), name).toBe(false);
      expect(renderA[name], name).toBe(renderB[name]);
      expect(() => renderA[name].call(undefined, ...args), name).toThrow(
        /no render pass receiver/u,
      );
      renderA[name](...args);
      renderB[name](...args);
    }

    expect(Object.getPrototypeOf(computeA)).toBe(Object.getPrototypeOf(computeB));
    for (const [name, , args] of computeMethods) {
      expect(Object.hasOwn(computeA, name), name).toBe(false);
      expect(computeA[name], name).toBe(computeB[name]);
      expect(() => computeA[name].call(undefined, ...args), name).toThrow(
        /no compute pass receiver/u,
      );
      computeA[name](...args);
      computeB[name](...args);
    }

    const frameRecords = records(drain());
    for (const [, opcode] of renderMethods) {
      const calls = frameRecords.result.filter((record) => record.opcode === opcode);
      expect(calls, `render opcode ${opcode}`).toHaveLength(2);
      expect(calls.map((record) => frameRecords.view.getUint32(record.cursor + 8, true))).toEqual([
        3, 4,
      ]);
    }
    for (const [, opcode] of computeMethods) {
      const calls = frameRecords.result.filter((record) => record.opcode === opcode);
      expect(calls, `compute opcode ${opcode}`).toHaveLength(2);
      expect(calls.map((record) => frameRecords.view.getUint32(record.cursor + 8, true))).toEqual([
        5, 6,
      ]);
    }
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
