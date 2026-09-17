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

function passFrame(plans, record, compute = false) {
  const encoder = plans.device.createCommandEncoder();
  const pass = compute
    ? encoder.beginComputePass()
    : encoder.beginRenderPass({ colorAttachments: [] });
  record(pass);
  pass.end();
  const command = encoder.finish();
  plans.queue.submit([command]);
  return { encoder, pass, command };
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
    expect(plans.drain(1, 1)).toBeNull();
    // A partial drain is not a frame boundary. Close the now-empty frame before recording another.
    expect(plans.drain(undefined, 1)).toBeNull();

    scene(plans.device, plans.queue, 3);
    const next = packet(plans.drain(undefined, 1), 24);
    expect(next.mode).toBe(CAPTURE_MODE);
    expect(next.count).toBe(9);
    scene(plans.device, plans.queue, 3);
    expect(packet(plans.drain(undefined, 1), 24).mode).toBe(PATCH_MODE);
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

  it("consumes a partial prefix while preserving a reused unfinished encoder tail", () => {
    const plans = recorder(true);
    const beginTail = () => {
      const encoder = plans.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [] });
      pass.setPipeline({ _pipelineId: 5 });
      return { encoder, pass };
    };
    const finishTail = ({ encoder, pass }) => {
      pass.draw(7);
      pass.end();
      plans.queue.submit([encoder.finish()]);
    };
    scene(plans.device, plans.queue, 1);
    finishTail(beginTail());
    const expected = packet(plans.drain(undefined, 1), 24);

    // Both the submitted prefix and the unfinished tail now contain records reused from the plan.
    scene(plans.device, plans.queue, 1);
    const tail = beginTail();
    const prefix = packet(plans.drain(1, 1), 16);
    expect(prefix.count).toBe(9);
    expect(plans.drain(1, 2)).toBeNull();
    finishTail(tail);
    const suffix = packet(plans.drain(undefined, 2), 16);
    expect(suffix.version).toBe(2);
    expect(recordOpcodes(suffix.body)).toEqual([2, 3, 4, 8, 17, 28, 29]);
    expect([...prefix.body, ...suffix.body]).toEqual(Array.from(expected.body));
    expect(plans.drain()).toBeNull();

    scene(plans.device, plans.queue, 1);
    finishTail(beginTail());
    const recovered = packet(plans.drain(undefined, 3), 24);
    expect(recovered.mode).toBe(CAPTURE_MODE);
    expect(Array.from(recovered.body)).toEqual(Array.from(expected.body));
  });

  it("expires wire wrappers at an empty boundary after a complete partial drain", () => {
    const plans = recorder(true);
    const { encoder, pass, command } = passFrame(plans, (render) => render.draw(3));
    expect(packet(plans.drain(1, 1), 16).version).toBe(2);
    expect(plans.drain(undefined, 2)).toBeNull();
    expect(() => encoder.finish()).toThrow(/stale command encoder/u);
    expect(() => pass.draw(3)).toThrow(/stale render pass/u);
    expect(() => plans.queue.submit([command])).toThrow(/stale command buffer/u);
  });

  it("falls back above the native retained-body bound and recovers capture then patch", () => {
    const plans = recorder(true);
    const payload = new Uint8Array((32 << 20) - 16);
    payload[0] = 7;
    payload[payload.length - 1] = 9;
    // writeBuffer adds 24 bytes, making this body eight bytes larger than the native ceiling.
    plans.queue.writeBuffer({ _bufferId: 7 }, 0, payload);
    const frame = plans.drain(undefined, 1);
    const header = new DataView(frame);
    expect(header.getUint32(4, true)).toBe(2);
    expect(header.getUint32(8, true)).toBe(16 + 24 + payload.byteLength);
    expect(header.getUint32(12, true)).toBe(1);
    const upload = new Uint8Array(frame, 40, payload.byteLength);
    expect(upload[0]).toBe(7);
    expect(upload[upload.length - 1]).toBe(9);

    scene(plans.device, plans.queue, 1);
    expect(packet(plans.drain(undefined, 2), 24).mode).toBe(CAPTURE_MODE);
    scene(plans.device, plans.queue, 1);
    expect(packet(plans.drain(undefined, 2), 24).mode).toBe(PATCH_MODE);
  });

  it("allows a captured body exactly at the native bound, excluding its header", () => {
    const plans = recorder(true);
    plans.queue.writeBuffer({ _bufferId: 7 }, 0, new Uint8Array((32 << 20) - 24));
    const header = new DataView(plans.drain(undefined, 1));
    expect(header.getUint32(4, true)).toBe(3);
    expect(header.getUint32(8, true)).toBe((32 << 20) + 24);
    expect(header.getUint32(12, true)).toBe(CAPTURE_MODE);
  });

  for (const compute of [false, true]) {
    it(`forgets stale ${compute ? "compute" : "render"} bind-group snapshots after a wide record`, () => {
      const plans = recorder(true);
      const group = { _bindGroupId: 4 };
      const narrow = [0, 256, 512, 768];
      passFrame(plans, (pass) => pass.setBindGroup(0, group, narrow), compute);
      const expected = packet(plans.drain(undefined, 1), 24);
      passFrame(plans, (pass) => pass.setBindGroup(0, group, [...narrow, 1024]), compute);
      const wide = packet(plans.drain(undefined, 1), 24);
      expect(wide.mode).toBe(CAPTURE_MODE);
      passFrame(plans, (pass) => pass.setBindGroup(0, group, narrow), compute);
      const recovered = packet(plans.drain(undefined, 1), 24);
      const body = recovered.mode === PATCH_MODE ? patched(wide.body, recovered) : recovered.body;
      expect(Array.from(body)).toEqual(Array.from(expected.body));
    });
  }

  it("does not reuse an old draw snapshot after a non-reusable opcode occupies its slot", () => {
    const plans = recorder(true);
    passFrame(plans, (pass) => pass.draw(3));
    const expected = packet(plans.drain(undefined, 1), 24);
    passFrame(plans, (pass) => pass.executeBundles([]));
    const middle = packet(plans.drain(undefined, 1), 24);
    passFrame(plans, (pass) => pass.draw(3));
    const last = packet(plans.drain(undefined, 1), 24);
    const body = last.mode === PATCH_MODE ? patched(middle.body, last) : last.body;
    expect(Array.from(body)).toEqual(Array.from(expected.body));
  });

  it("does not publish a partly written snapshot when numeric coercion throws", () => {
    const plans = recorder(true);
    passFrame(plans, (pass) => pass.draw(3));
    const first = packet(plans.drain(undefined, 1), 24);
    passFrame(plans, (pass) => {
      expect(() => pass.draw(7, 1, 0, 0n)).toThrow(TypeError);
      pass.draw(7);
    });
    const recovered = packet(plans.drain(undefined, 1), 24);
    const body = recovered.mode === PATCH_MODE ? patched(first.body, recovered) : recovered.body;
    const reference = recorder(false);
    passFrame(reference, (pass) => pass.draw(7));
    expect(Array.from(body)).toEqual(Array.from(packet(reference.drain(), 16).body));
  });

  it("invalidates a prepared snapshot when encoding fails before a corrected retry", () => {
    const plans = recorder(true);
    passFrame(plans, (pass) => pass.setPipeline({ _pipelineId: 5 }));
    const first = packet(plans.drain(undefined, 1), 24);
    passFrame(plans, (pass) => {
      let reads = 0;
      const unstable = {
        get _pipelineId() {
          return ++reads === 1 ? 9 : 0;
        },
      };
      expect(() => pass.setPipeline(unstable)).toThrow(/no numeric id/u);
      pass.setPipeline({ _pipelineId: 9 });
    });
    const recovered = packet(plans.drain(undefined, 1), 24);
    const body = recovered.mode === PATCH_MODE ? patched(first.body, recovered) : recovered.body;
    const reference = recorder(false);
    passFrame(reference, (pass) => pass.setPipeline({ _pipelineId: 9 }));
    expect(Array.from(body)).toEqual(Array.from(packet(reference.drain(), 16).body));
  });

  it("matches fresh v2 bytes across 300 deterministic structural and value changes", () => {
    const plans = recorder(true);
    let body = null;
    let seed = 275;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let tick = 0; tick < 300; tick += 1) {
      const width = random() % 7;
      const compute = (random() & 4) !== 0;
      const bundle = (random() & 8) !== 0;
      const count = (random() % 20) + 1;
      const values = Uint32Array.of(random(), random(), random(), random());
      const record = (target) => {
        target.queue.writeBuffer({ _bufferId: 7 }, 0, values);
        passFrame(target, (pass) => {
          pass.setPipeline({ _pipelineId: compute ? 6 : 5 });
          pass.setBindGroup(0, { _bindGroupId: 4 }, Array.from({ length: width }, (_, i) => i * 256));
          if (compute) pass.dispatchWorkgroups(count);
          else if (bundle) pass.executeBundles([{ _renderBundleId: 9 }]);
          else pass.draw(count);
        }, compute);
      };
      record(plans);
      const current = packet(plans.drain(undefined, 1), 24);
      body = current.mode === PATCH_MODE ? patched(body, current) : current.body;
      const reference = recorder(false);
      record(reference);
      expect(Array.from(body), `frame ${tick}`).toEqual(Array.from(packet(reference.drain(), 16).body));
    }
  });

  it("preserves earlier patch entries when the packet buffer grows", () => {
    const plans = recorder(true);
    const payload = new Uint8Array(40 << 10);
    const frame = (value) => {
      payload.fill(value);
      plans.queue.writeBuffer({ _bufferId: 7 }, 0, payload);
      plans.queue.writeBuffer({ _bufferId: 8 }, 0, payload);
      passFrame(plans, (pass) => {
        for (let draw = 0; draw < 10000; draw += 1) pass.draw(3);
      });
    };
    frame(1);
    const capture = packet(plans.drain(undefined, 1), 24);
    frame(2);
    const patch = packet(plans.drain(undefined, 1), 24);
    expect(patch.mode).toBe(PATCH_MODE);
    expect(patch.bytes).toBeGreaterThan(1 << 16);
    expect(patch.count).toBe(2);
    expect(patch.view.getUint32(24, true)).toBe(0);
    expect(patch.view.getUint32(28, true)).toBe(1);
    frame(2);
    const recaptured = packet(plans.drain(undefined, 2), 24);
    expect(patched(capture.body, patch)).toEqual(recaptured.body);
  });
});
