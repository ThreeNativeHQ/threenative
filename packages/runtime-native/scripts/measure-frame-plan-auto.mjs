// CPU-only recorder benchmark: never interpret this as native replay time or game FPS.
// Run: node packages/runtime-native/scripts/measure-frame-plan-auto.mjs [output.json]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const source = readFileSync(new URL("../src/runtime-scripts/frame-op-stream.js", import.meta.url), "utf8");
const factory = Function(`"use strict"; return (${source.trim().replace(/;$/u, "")});`)();
const warmup = 80;
const frames = 240;
const rounds = 5;
const modes = [false, true, undefined];
const names = ["direct", "forced-plan", "automatic"];
const scenarios = [
  { name: "tiny", draws: 1 },
  { name: "stable-render", draws: 2000 },
  { name: "stable-compute", draws: 2000, compute: true },
  { name: "upload-heavy", draws: 64, upload: 2 << 20 },
  { name: "topology-churn", draws: 256, churn: true },
  { name: "all-draws-changing", draws: 256, dynamic: true },
];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function measure(scenario, mode) {
  const device = {
    createCommandEncoder() {},
    createBuffer: () => ({ _bufferId: 40, destroy() {} }),
    createTexture: () => ({ _textureId: 41, destroy() {} }),
  };
  const queue = { writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {}, submit() {} };
  const host = { device, queue, compiledFramePlans: mode };
  const drain = factory(host);
  const upload = new Uint8Array(scenario.upload || 16);
  const times = [];
  let bytes = 0;
  const packets = { direct: 0, capture: 0, patch: 0 };
  for (let tick = 0; tick < warmup + frames; tick++) {
    upload[0] = tick & 255;
    const start = performance.now();
    queue.writeBuffer({ _bufferId: 7 }, 0, upload);
    const encoder = device.createCommandEncoder();
    const pass = scenario.compute ? encoder.beginComputePass() : encoder.beginRenderPass({ colorAttachments: [] });
    pass.setPipeline({ _pipelineId: 5 });
    const draws = scenario.draws + (scenario.churn ? tick % 3 : 0);
    for (let i = 0; i < draws; i++) {
      const count = scenario.dynamic ? tick + i + 3 : i + 3;
      if (scenario.compute) pass.dispatchWorkgroups(count, 1, 1);
      else pass.draw(count);
    }
    pass.end();
    queue.submit([encoder.finish()]);
    const packet = drain(undefined, 1);
    const elapsed = performance.now() - start;
    if (tick < warmup) continue;
    const view = new DataView(packet);
    const kind = view.getUint32(4, true) === 2 ? "direct" : view.getUint32(12, true) === 1 ? "capture" : "patch";
    packets[kind]++;
    bytes += view.getUint32(8, true);
    times.push(elapsed);
  }
  // Deterministic selection checks, not flaky timing assertions.
  if (mode === undefined && ["tiny", "upload-heavy", "topology-churn"].includes(scenario.name))
    assert.equal(packets.direct, frames, `${scenario.name} must stay direct`);
  if (mode === undefined && scenario.name.startsWith("stable-"))
    assert.equal(packets.patch, frames, `${scenario.name} must reuse its plan`);
  if (mode === undefined && scenario.dynamic)
    assert.ok(packets.direct > frames * 0.8, "failed probes must back off");
  return { medianMs: median(times), bytesPerFrame: bytes / frames, packets };
}

const results = [];
for (const scenario of scenarios) {
  const samples = modes.map(() => []);
  for (let round = 0; round < rounds; round++) {
    // Rotate order so a mode is not always measured on the coldest or hottest process.
    for (let offset = 0; offset < modes.length; offset++) {
      const index = (round + offset) % modes.length;
      samples[index].push(measure(scenario, modes[index]));
    }
  }
  const measurements = samples.map((runs, index) => ({
    mode: names[index], medianMs: median(runs.map((run) => run.medianMs)),
    bytesPerFrame: median(runs.map((run) => run.bytesPerFrame)),
    packetsPerRound: runs[0].packets,
  }));
  results.push({ scenario: scenario.name, measurements,
    automaticVsDirectPercent: (measurements[2].medianMs / measurements[0].medianMs - 1) * 100 });
}
const report = { scope: "CPU-only mock-host recorder; no GPU, native replay or FPS claim", node: process.version,
  warmupFrames: warmup, measuredFrames: frames, rounds, results };
const json = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(json);
