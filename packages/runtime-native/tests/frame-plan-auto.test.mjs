import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

const source = readFileSync(
  new URL("../src/runtime-scripts/frame-op-stream.js", import.meta.url),
  "utf8",
);
const factory = Function(`"use strict"; return (${source.trim().replace(/;$/u, "")});`)();

function recorder(mode) {
  const device = {
    createBuffer: () => ({ _bufferId: 40, destroy() {} }),
    createTexture: () => ({ _textureId: 41, destroy() {} }),
    createCommandEncoder: () => ({}),
  };
  const queue = { writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {}, submit() {} };
  const host = { device, queue };
  if (mode !== undefined) host.compiledFramePlans = mode;
  return { device, queue, drain: factory(host) };
}

function frame(r, { draws = 256, tick = 0, upload = 16, dynamic = false, compute = false } = {}) {
  if (upload) r.queue.writeBuffer({ _bufferId: 7 }, 0, new Uint8Array(upload).fill(tick & 255));
  const encoder = r.device.createCommandEncoder();
  const pass = compute ? encoder.beginComputePass() : encoder.beginRenderPass({ colorAttachments: [
    { view: { _textureViewId: 3 }, loadOp: "clear", storeOp: "store", clearValue: [tick / 255, 0, 0, 1] },
  ] });
  pass.setPipeline({ _pipelineId: 5 });
  for (let i = 0; i < draws; i++) {
    if (compute) pass.dispatchWorkgroups(dynamic ? tick + i + 1 : i + 1, 1, 1);
    else pass.draw(dynamic ? tick + i + 3 : i + 3);
  }
  pass.end();
  const command = encoder.finish();
  r.queue.submit([command]);
  return { encoder, pass, command };
}

function packet(buffer) {
  assert.ok(buffer instanceof ArrayBuffer);
  const length = new DataView(buffer).getUint32(8, true);
  assert.ok(length <= buffer.byteLength);
  const bytes = new Uint8Array(buffer, 0, length).slice();
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x544e4652);
  const version = view.getUint32(4, true);
  assert.ok(version === 2 || version === 3);
  return { bytes, view, version, mode: version === 3 ? view.getUint32(12, true) : 0 };
}

function decoded(previous, p) {
  if (p.version === 2) return p.bytes.slice(16);
  if (p.mode === 1) return p.bytes.slice(24);
  assert.ok(previous, "a patch must follow a retained capture");
  const offsets = [];
  const before = new DataView(previous.buffer, previous.byteOffset, previous.byteLength);
  for (let at = 0; at < previous.length; ) {
    offsets.push(at);
    const length = before.getUint32(at + 4, true);
    assert.ok(length >= 8 && !(length & 7));
    at += length;
  }
  const result = previous.slice();
  let at = 24;
  for (let i = 0; i < p.view.getUint32(20, true); i++) {
    const index = p.view.getUint32(at, true);
    const runs = p.view.getUint32(at + 4, true);
    at += 8;
    assert.ok(index < offsets.length);
    for (let j = 0; j < runs; j++) {
      const offset = p.view.getUint32(at, true);
      const length = p.view.getUint32(at + 4, true);
      at += 8;
      result.set(p.bytes.subarray(at, at + length), offsets[index] + offset);
      at += length;
    }
  }
  assert.equal(at, p.bytes.length);
  return result;
}

function run(r, options, epoch = 1) {
  frame(r, options);
  return packet(r.drain(undefined, epoch));
}

function warm(r) {
  let p;
  for (let tick = 0; tick < 6; tick++) p = run(r, { tick });
  assert.equal(p.version, 3);
  assert.equal(p.mode, 2);
  return p;
}

describe("automatic frame-plan selection", () => {
  it("promotes stable repeated work without a host flag", () => {
    const r = recorder();
    assert.equal(run(r).version, 2);
    assert.equal(run(r).version, 2);
    const capture = run(r);
    assert.equal(capture.version, 3);
    assert.equal(capture.mode, 1);
    const patch = run(r);
    assert.equal(patch.mode, 2);
    assert.equal(patch.bytes.length, 24);
  });

  it("leaves tiny frames on the direct, unretained v2 path", () => {
    const r = recorder();
    for (let tick = 0; tick < 48; tick++) assert.equal(run(r, { tick, draws: 1 }).version, 2);
  });

  it("does not repeatedly capture upload-dominated frames", () => {
    const r = recorder();
    for (let tick = 0; tick < 48; tick++)
      assert.equal(run(r, { tick, draws: 256, upload: 1 << 18 }).version, 2);
  });

  it("does not promote continuously changing topology", () => {
    const r = recorder();
    for (let tick = 0; tick < 48; tick++)
      assert.equal(run(r, { tick, draws: 256 + tick % 3 }).version, 2);
  });

  it("backs off when an unchanged layout rewrites every draw", () => {
    const r = recorder();
    const packets = Array.from({ length: 64 }, (_, tick) => run(r, { tick, dynamic: true }));
    assert.ok(packets.some((p) => p.version === 3), "exercise an actual automatic probe");
    assert.ok(packets.slice(8, 32).every((p) => p.version === 2), "unprofitable probes need a cooldown");
  });

  it("recovers automatically when streaming is followed by stable rendering", () => {
    const r = recorder();
    warm(r);
    run(r, { upload: 1 << 18 });
    for (let tick = 1; tick < 12; tick++) assert.equal(run(r, { tick, upload: 1 << 18 }).version, 2);
    let last;
    for (let tick = 0; tick < 80; tick++) last = run(r, { tick });
    assert.equal(last.version, 3);
    assert.equal(last.mode, 2);
  });

  it("retains explicit v2 and v3 reference arms for transport diagnostics", () => {
    const plain = recorder(false);
    const plans = recorder(true);
    for (let tick = 0; tick < 12; tick++) {
      assert.equal(run(plain, { tick }).version, 2);
      assert.equal(run(plans, { tick, draws: 1 }).version, 3);
    }
  });

  it("optimizes stable compute dispatches as well as render draws", () => {
    const r = recorder();
    let last;
    for (let tick = 0; tick < 8; tick++) last = run(r, { tick, compute: true });
    assert.equal(last.version, 3);
    assert.equal(last.mode, 2);
  });

  it("replays byte-identical work across promotion, fallback, epochs and recovery", () => {
    const r = recorder();
    let previous = null;
    let captures = 0;
    let patches = 0;
    let direct = 0;
    for (let tick = 0; tick < 180; tick++) {
      const options = {
        tick,
        draws: tick >= 30 && tick < 42 ? 256 + tick % 4 : 256,
        upload: tick >= 65 && tick < 70 ? 1 << 18 : 16,
        dynamic: tick >= 100 && tick < 112,
        compute: tick >= 140,
      };
      const p = run(r, options, tick < 20 ? 1 : 2);
      const reference = run(recorder(false), options);
      const body = decoded(previous, p);
      assert.deepEqual(body, reference.bytes.slice(16), `frame ${tick}`);
      previous = p.version === 3 ? body : null;
      if (p.version === 2) direct++;
      else if (p.mode === 1) captures++;
      else patches++;
    }
    assert.ok(direct > 10 && captures >= 3 && patches > 40);
  });

  it("preserves an unfinished encoder through a partial readback and mode fallback", () => {
    const r = recorder();
    warm(r);
    const tail = (target) => {
      const encoder = target.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [] });
      return { encoder, pass };
    };
    const finish = (target, t) => {
      t.pass.draw(7);
      t.pass.end();
      target.queue.submit([t.encoder.finish()]);
    };
    const reference = recorder(false);
    frame(reference, { tick: 6 });
    finish(reference, tail(reference));
    const expected = packet(reference.drain()).bytes.slice(16);
    frame(r, { tick: 6 });
    const open = tail(r);
    const prefix = packet(r.drain(1, 1));
    assert.equal(prefix.version, 2);
    assert.equal(r.drain(1, 2), null);
    finish(r, open);
    const suffix = packet(r.drain(undefined, 2));
    assert.equal(suffix.version, 2);
    assert.deepEqual(new Uint8Array([...prefix.bytes.slice(16), ...suffix.bytes.slice(16)]), expected);
    assert.equal(run(r).version, 2);
    let last;
    for (let tick = 0; tick < 80; tick++) last = run(r, { tick });
    assert.equal(last.mode, 2);
  });

  it("does not promote a split v2 frame before its real boundary", () => {
    const r = recorder();
    run(r);
    frame(r);
    const encoder = r.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [] });
    assert.equal(packet(r.drain(1, 1)).version, 2);
    pass.draw(9);
    pass.end();
    r.queue.submit([encoder.finish()]);
    assert.equal(packet(r.drain(undefined, 2)).version, 2);
    assert.equal(run(r).version, 2);
  });

  it("expires wire wrappers on fallback and on an empty frame boundary", () => {
    const r = recorder();
    warm(r);
    const previous = frame(r, { upload: 1 << 18 });
    r.drain();
    assert.throws(() => r.queue.submit([previous.command]), /stale command buffer/u);
    assert.throws(() => previous.pass.draw(1), /stale render pass/u);
    const current = frame(r);
    r.drain(1, 1);
    assert.equal(r.drain(undefined, 1), null);
    assert.throws(() => current.encoder.finish(), /stale command encoder/u);
  });

  it("falls back without retaining a frame above the native memory bound", () => {
    const r = recorder();
    warm(r);
    const p = run(r, { upload: (32 << 20) + 8 });
    assert.equal(p.version, 2);
    assert.equal(run(r).version, 2);
  });
});
