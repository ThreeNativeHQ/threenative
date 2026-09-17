import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "runtime-scripts", "frame-op-stream.js"),
  "utf8",
);
const bindingsState = readFileSync(
  join(import.meta.dirname, "..", "src", "webgpu", "bindings_state.h"),
  "utf8",
);
const factory = Function(`"use strict"; let factory; factory = ${source}\nreturn factory;`)();

const MAGIC = 0x544e4652;
const CAPTURE_MODE = 1;
const PATCH_MODE = 2;

// A recorder with a device and queue that record nothing themselves: every command below reaches
// the frame stream, which is the only thing under test here.
function recorder(compiledFramePlans) {
  const device = {
    createBuffer: () => ({ _bufferId: 40, destroy() {} }),
    createTexture: () => ({ _textureId: 41, destroy() {} }),
    createCommandEncoder: () => ({}),
  };
  const queue = {
    writeBuffer() {},
    writeTexture() {},
    copyExternalImageToTexture() {},
    submit() {},
  };
  const host = compiledFramePlans ? { device, queue, compiledFramePlans: true } : { device, queue };
  return { drain: factory(host), device, queue };
}

// Header fields plus the record body that follows the header. A v2 packet's header is 16 bytes and
// a v3 packet's is 24, which is the whole reason every offset in the recorder is relative. Both the
// fields and the body are copies: the recorder hands back an arena it reuses.
function packet(buffer, headerBytes) {
  const declared = new DataView(buffer).getUint32(8, true);
  expect(declared).toBeLessThanOrEqual(buffer.byteLength);
  const raw = new Uint8Array(buffer, 0, declared).slice();
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  expect(view.getUint32(0, true)).toBe(MAGIC);
  return {
    view,
    raw,
    version: view.getUint32(4, true),
    bytes: declared,
    mode: headerBytes === 24 ? view.getUint32(12, true) : 0,
    sequence: headerBytes === 24 ? view.getUint32(16, true) : 0,
    count: view.getUint32(headerBytes === 24 ? 20 : 12, true),
    body: raw.slice(headerBytes),
  };
}

function recordOpcodes(body) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const opcodes = [];
  for (let at = 0; at < body.byteLength; at += view.getUint32(at + 4, true))
    opcodes.push(view.getUint32(at, true));
  return opcodes;
}

// Applies one patch packet to a retained body: the record index comes from the body's own record
// boundaries, exactly as the host's compiled layout does, and each run writes its bytes at the
// entry's record. The result is what the host replays.
function patched(body, patch) {
  const offsets = [];
  {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    for (let at = 0; at < body.byteLength; ) {
      offsets.push(at);
      at += view.getUint32(at + 4, true);
    }
  }
  const out = body.slice();
  const view = patch.view;
  let at = 24;
  for (let entry = 0; entry < patch.count; entry++) {
    const index = view.getUint32(at, true);
    const runs = view.getUint32(at + 4, true);
    at += 8;
    for (let run = 0; run < runs; run++) {
      const offset = view.getUint32(at, true);
      const length = view.getUint32(at + 4, true);
      at += 8;
      out.set(new Uint8Array(patch.view.buffer, at, length), offsets[index] + offset);
      at += length;
    }
  }
  expect(at).toBe(patch.bytes);
  return out;
}

// One frame of a scene that changes what a game changes between frames: an upload payload, and the
// wire ids a new frame allocates for its encoder, its pass and its command buffer.
function scene(device, queue, tick, extraDraw = 0) {
  queue.writeBuffer({ _bufferId: 7 }, 0, new Uint32Array([tick, 0, 0, 0]));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: { _textureViewId: 3 }, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
    ],
  });
  pass.setPipeline({ _pipelineId: 5 });
  pass.setBindGroup(0, { _bindGroupId: 4 });
  for (let draw = 0; draw <= extraDraw; draw++) pass.draw(3);
  pass.end();
  queue.submit([encoder.finish()]);
}

describe("compiled frame plan transport", () => {
  it("stays on the v2 stream unless the host asks for plans", () => {
    const plain = recorder(false);
    scene(plain.device, plain.queue, 1);
    expect(packet(plain.drain(undefined, 1), 16).version).toBe(2);
    scene(plain.device, plain.queue, 2);
    expect(packet(plain.drain(undefined, 1), 16).version).toBe(2);
  });

  it("captures one frame, then carries only the words that changed", () => {
    const full = recorder(false);
    scene(full.device, full.queue, 1);
    const fullFirst = packet(full.drain(undefined, 1), 16);

    const plans = recorder(true);
    scene(plans.device, plans.queue, 1);
    const capture = packet(plans.drain(undefined, 1), 24);
    expect(capture.version).toBe(3);
    expect(capture.mode).toBe(CAPTURE_MODE);
    expect(capture.count).toBe(recordOpcodes(capture.body).length);
    // The first frame is the frame: same records, same payloads, only the header differs.
    expect(Array.from(capture.body)).toEqual(Array.from(fullFirst.body));

    scene(plans.device, plans.queue, 2);
    const patch = packet(plans.drain(undefined, 1), 24);
    expect(patch.version).toBe(3);
    expect(patch.mode).toBe(PATCH_MODE);
    expect(patch.sequence).toBe(capture.sequence + 1);
    expect(patch.bytes).toBeLessThan(capture.bytes / 2);

    // The same frame once more, this time forced down the capture path by a host reporting a plan
    // it no longer holds. The one property that makes a delta safe: patching the retained frame
    // reproduces the frame the recorder would have sent whole, wire ids included.
    scene(plans.device, plans.queue, 2);
    const recaptured = packet(plans.drain(undefined, 99), 24);
    expect(recaptured.mode).toBe(CAPTURE_MODE);
    const applied = patched(capture.body, patch);
    expect(Array.from(applied)).toEqual(Array.from(recaptured.body));
    // And the delta is not the whole frame wearing a smaller header.
    let moved = 0;
    for (let at = 0; at < capture.body.byteLength; at++)
      if (recaptured.body[at] !== capture.body[at]) moved++;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(capture.body.byteLength / 4);
  });

  it("carries no entry at all when nothing moved", () => {
    const plans = recorder(true);
    scene(plans.device, plans.queue, 1);
    const capture = packet(plans.drain(undefined, 1), 24);
    // Recorded with the same values: every record is one the plan already holds, right down to the
    // per-frame encoder, pass and command buffer ids. The upload is the only record written again,
    // and its bytes are identical, so it carries no run either.
    scene(plans.device, plans.queue, 1);
    const patch = packet(plans.drain(undefined, 1), 24);
    expect(patch.mode).toBe(PATCH_MODE);
    expect(patch.count).toBe(0);
    expect(patch.bytes).toBe(24);
    expect(Array.from(patched(capture.body, patch))).toEqual(Array.from(capture.body));
  });

  it("recaptures when the record layout moves", () => {
    const plans = recorder(true);
    scene(plans.device, plans.queue, 1);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(CAPTURE_MODE);
    scene(plans.device, plans.queue, 2);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(PATCH_MODE);

    scene(plans.device, plans.queue, 3, 1);
    const recaptured = packet(plans.drain(undefined, 1), 24);
    expect(recaptured.mode).toBe(CAPTURE_MODE);
    expect(recaptured.sequence).toBe(3);
  });

  it("recaptures when the host reports a plan it no longer holds", () => {
    const plans = recorder(true);
    scene(plans.device, plans.queue, 1);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(CAPTURE_MODE);
    scene(plans.device, plans.queue, 2);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(PATCH_MODE);

    scene(plans.device, plans.queue, 3);
    // Epoch 2 is what the host reports after it dropped the plan this recorder patched against.
    expect(packet(plans.drain(undefined, 2), 24).mode).toBe(CAPTURE_MODE);
  });

  it("falls back to v2 for a partial drain and recaptures the next frame", () => {
    const plans = recorder(true);
    scene(plans.device, plans.queue, 1);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(CAPTURE_MODE);

    scene(plans.device, plans.queue, 2);
    const flushed = packet(plans.drain(1, 1), 16);
    expect(flushed.version).toBe(2);
    // The body moved eight bytes down to the header a v2 reader looks behind, and its records walk
    // cleanly from there: the fallback is a whole frame, not a plan-shaped one with a v2 header.
    expect(recordOpcodes(flushed.body)).toEqual([1, 2, 3, 4, 5, 8, 17, 28, 29]);
    expect(flushed.count).toBe(9);

    scene(plans.device, plans.queue, 3);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(CAPTURE_MODE);
  });

  it("sends the whole frame when the frame rewrote most of itself", () => {
    const plans = recorder(true);
    const payload = new Uint8Array(1 << 17);
    const frame = (value) => {
      payload.fill(value);
      plans.queue.writeBuffer({ _bufferId: 9 }, 0, payload);
      plans.queue.submit([plans.device.createCommandEncoder().finish()]);
    };
    frame(1);
    const first = packet(plans.drain(undefined, 1), 24);
    expect(first.mode).toBe(CAPTURE_MODE);
    frame(2);
    const second = packet(plans.drain(undefined, 1), 24);
    // The payload *is* the frame's bytes, so a patch would carry them anyway and touch them twice
    // more: the recorder sends the frame whole and keeps the plan in step with it.
    expect(second.mode).toBe(CAPTURE_MODE);
    expect(second.bytes).toBe(first.bytes);
  });

  it("mirrors the native retained-frame bound", () => {
    const native = /static constexpr uint32_t maxBytes = (\d+)u << (\d+);/u.exec(bindingsState);
    expect(native, "FramePlanState::maxBytes is declared").not.toBeNull();
    const script = /const maxPlanBytes = (\d+) << (\d+);/u.exec(source);
    expect(script, "the recorder declares maxPlanBytes").not.toBeNull();
    expect(Number(script[1]) * 2 ** Number(script[2])).toBe(
      Number(native[1]) * 2 ** Number(native[2]),
    );
  });
});
