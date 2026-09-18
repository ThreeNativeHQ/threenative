#!/usr/bin/env node

/**
 * CPU-only microbenchmark for the compiled frame plan transport (PRD-native-compiled-frame-plans).
 *
 * It measures the JavaScript half of the transport: what the recorder spends turning one frame
 * into a packet, and how many bytes that packet carries — for the forced v2 reference stream
 * and for the forced v3 plan transport that patches it. The automatic production policy has a
 * separate six-scenario benchmark in measure-frame-plan-auto.mjs. There is no GPU, renderer or
 * game here, so none of these numbers is a frame rate and nothing is extrapolated to one. The
 * native half (validate, apply, replay) belongs to `threenative-frame-op-stream-replay-test`, which
 * runs the same recorder through the real decoder.
 *
 *   node scripts/measure-frame-plan-transport.mjs [--draws=2000] [--uploads=64] [--frames=120]
 */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const source = readFileSync(
  new URL('../src/runtime-scripts/frame-op-stream.js', import.meta.url),
  'utf8',
);
const factory = Function(`"use strict"; let factory; factory = ${source}\nreturn factory;`)();

const options = { draws: 2000, uploads: 64, uploadBytes: 256, frames: 120, warmup: 5 };
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-zA-Z]+)=(\d+)$/u.exec(argument);
  if (!match) throw new Error(`unknown argument ${argument}`);
  if (!(match[1] in options)) throw new Error(`unknown option ${match[1]}`);
  options[match[1]] = Number(match[2]);
}
if (options.frames <= options.warmup) throw new Error('--frames must exceed the warmup frames');

function recorder(compiledFramePlans) {
  const device = {
    createBuffer: () => ({ _bufferId: 3, destroy() {} }),
    createTexture: () => ({ _textureId: 4, destroy() {} }),
    createCommandEncoder: () => ({}),
  };
  const queue = {
    writeBuffer() {},
    writeTexture() {},
    copyExternalImageToTexture() {},
    submit() {},
  };
  // False must remain explicit: absence now means automatic production selection, not v2.
  const host = { device, queue, compiledFramePlans };
  return { drain: factory(host), device, queue };
}

// One frame of a scene that is identical in structure every frame: the same draws in the same
// order, with the same bind groups, and uniform uploads whose payload moves — the shape of a game
// frame, not of a stress test.
function scene(device, queue, tick, state) {
  for (let upload = 0; upload < options.uploads; upload += 1) {
    // A per-object uniform buffer is rewritten whole every frame, so the uploads here are too:
    // a frame that moves only a few words of a large stable payload is the case this transport is
    // best at, and measuring the flattering shape by default would flatter the result.
    const payload = state.uniform[upload];
    payload[0] = tick + upload;
    for (let index = 1; index < payload.length; index += 1) payload[index] = tick - index;
    queue.writeBuffer(state.uniformBuffer[upload], 0, payload);
  }
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: state.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
    depthStencilAttachment: { view: state.depthView, depthLoadOp: 'clear', depthStoreOp: 'store' },
  });
  for (let draw = 0; draw < options.draws; draw += 1) {
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.group[draw % state.group.length], [((draw % 4) * 256) | 0]);
    pass.setVertexBuffer(0, state.vertex);
    pass.setIndexBuffer(state.index, 'uint32');
    pass.drawIndexed(36, 1, 0, 0, 0);
  }
  pass.end();
  queue.submit([encoder.finish()]);
}

function sceneState(device) {
  const uniformBytes = options.uploadBytes;
  const uniform = [];
  const uniformBuffer = [];
  for (let upload = 0; upload < options.uploads; upload += 1) {
    uniform.push(new Float32Array(uniformBytes / 4));
    uniformBuffer.push(device.createBuffer({ size: uniformBytes }));
  }
  return {
    uniform,
    uniformBuffer,
    view: { _textureViewId: 5 },
    depthView: { _textureViewId: 6 },
    pipeline: { _pipelineId: 7 },
    group: [0, 1, 2, 3].map((index) => ({ _bindGroupId: 8 + index })),
    vertex: device.createBuffer({ size: 1024 }),
    index: device.createBuffer({ size: 4096 }),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function measure(compiledFramePlans, epoch) {
  const { drain, device, queue } = recorder(compiledFramePlans);
  const state = sceneState(device);
  const encode = [];
  const drainTime = [];
  const bytes = [];
  let retained = 0;
  for (let frame = 0; frame < options.frames; frame += 1) {
    const encodeStart = performance.now();
    scene(device, queue, frame, state);
    const drainStart = performance.now();
    encode.push(drainStart - encodeStart);
    const packet = drain(undefined, epoch);
    drainTime.push(performance.now() - drainStart);
    if (!packet) throw new Error('the recorder drained no packet');
    // The recorder hands back the arena it recorded into, so the packet's size is the byte count
    // its header declares, never the buffer's capacity.
    const declared = new DataView(packet).getUint32(8, true);
    bytes.push(declared);
    retained = Math.max(retained, declared);
  }
  const steady = (values) => values.slice(options.warmup);
  return {
    encodeMs: median(steady(encode)),
    drainMs: median(steady(drainTime)),
    packetBytes: median(steady(bytes)),
    retainedBytes: retained,
  };
}

const v2 = process.env.TN_BENCH_ARM === "v3" ? null : measure(false, 1);
const v3 = process.env.TN_BENCH_ARM === "v2" ? null : measure(true, 1);
if (v2 === null || v3 === null) {
  // One arm at a time, for a CPU profile of that arm alone.
  console.log(JSON.stringify({ arm: v2 === null ? "v3" : "v2", result: v2 ?? v3 }, null, 2));
  process.exit(0);
}
const report = {
  scene: {
    draws: options.draws,
    uploads: options.uploads,
    uploadBytes: options.uploadBytes,
    frames: options.frames,
  },
  v2: { ...v2, totalMs: v2.encodeMs + v2.drainMs },
  v3: { ...v3, totalMs: v3.encodeMs + v3.drainMs },
  delta: {
    packetBytes: v3.packetBytes - v2.packetBytes,
    packetPercent: ((1 - v3.packetBytes / v2.packetBytes) * 100).toFixed(1) + '%',
    drainMs: v3.drainMs - v2.drainMs,
    totalMs: v3.encodeMs + v3.drainMs - (v2.encodeMs + v2.drainMs),
  },
  note: 'CPU-only transport measurement: no GPU, no renderer, no game, and no claim about frame rate',
};
console.log(JSON.stringify(report, null, 2));
