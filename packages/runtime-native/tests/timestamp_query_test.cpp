// `timestamp-query` must be acquirable and must resolve a monotonic, nonzero delta.
//
// Before PRD-228 the bindings answered `false` to the feature by name at two sites, so the entire
// GPU attribution in the perf record was wall-clock algebra around an ablated scene: a total per
// object, never a cost per pass stage. This drives the real bindings through the native Runtime
// with no SDL window, so it belongs to the native-contract lane rather than a device lane.
//
// It is a contract test, not a benchmark. What it asserts is that the feature is advertised only
// when the adapter has it, that a query set can be created, that a render pass can be timed at
// both ends, and that resolving those two writes yields end > begin. An adapter without the
// feature degrades to a reported skip rather than a failure, because "this GPU cannot" and "these
// bindings cannot" are different results and only the second is a red.

#include "mystral/runtime.h"

#include <iostream>

namespace {

constexpr const char* kSetup = R"JS((() => {
  const adapter = navigator.gpu.requestAdapter();
  const device = adapter.requestDevice();
  globalThis.__tnTs = { device, supported: device.features.has("timestamp-query") };
  if (!globalThis.__tnTs.supported) return;

  // Four slots: a render pass at 0/1 and a compute pass at 2/3.
  //
  // Both descriptor paths carry `timestampWrites` and both are exercised here. The strictly
  // positive delta is asserted on the compute pass because a desktop clear is a fast-clear that
  // finishes inside one tick of this GPU's 65536 ns timestamp clock — four back-to-back clears
  // reported zero on roughly half of runs, which is a real reading and a useless test. A dispatch
  // that actually runs 268M iterations cannot hide inside one tick on any GPU this lane targets.
  const querySet = device.createQuerySet({ type: "timestamp", count: 4 });
  if (querySet.count !== 4 || querySet.type !== "timestamp")
    throw new Error("createQuerySet returned " + querySet.type + " x" + querySet.count);

  const resolved = device.createBuffer({ size: 32, usage: 0x0200 | 0x0004 });  // QUERY_RESOLVE | COPY_SRC
  const readback = device.createBuffer({ size: 32, usage: 0x0001 | 0x0008 });  // MAP_READ | COPY_DST

  const target = device.createTexture({
    size: { width: 256, height: 256, depthOrArrayLayers: 1 },
    format: "rgba8unorm",
    usage: 0x10,                                                               // RENDER_ATTACHMENT
  });
  const view = device.createTextureView(target);

  const scratch = device.createBuffer({ size: 65536 * 4, usage: 0x0080 });     // STORAGE
  const module = device.createShaderModule({
    code: `
      @group(0) @binding(0) var<storage, read_write> data: array<u32>;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        var acc: u32 = id.x;
        for (var i: u32 = 0u; i < 4096u; i = i + 1u) {
          acc = acc * 1664525u + 1013904223u;
        }
        data[id.x] = acc;
      }
    `,
  });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: 4, buffer: { type: "storage" } }],     // COMPUTE
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: "main" },
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: scratch } }],
  });

  const encoder = device.createCommandEncoder();
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      { view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
    timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
  });
  renderPass.end();
  const computePass = encoder.beginComputePass({
    timestampWrites: { querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
  });
  computePass.setPipeline(pipeline);
  computePass.setBindGroup(0, bindGroup);
  computePass.dispatchWorkgroups(1024);
  computePass.end();
  encoder.resolveQuerySet(querySet, 0, 4, resolved, 0);
  encoder.copyBufferToBuffer(resolved, 0, readback, 0, 32);
  device.queue.submit([encoder.finish()]);
  globalThis.__tnTs.readback = readback;
})())JS";

// Read only after the host has drained and replayed the packed frame op stream: in production
// every command crosses that stream, so a test that maps straight after `submit()` reads a buffer
// the GPU has not been asked to fill yet — and two zeroed timestamps look exactly like a pass
// that took no time.
constexpr const char* kRead = R"JS((() => {
  if (!globalThis.__tnTs.supported) return;
  const readback = globalThis.__tnTs.readback;
  readback.mapAsync(0x0001).then(() => {
    // A rasteriser that advertises timestamp-query and then fails the map leaves getMappedRange
    // undefined. Without this the contract reported "Cannot read properties of undefined (reading
    // 'slice')", which names the JS line and not the thing that actually failed.
    const mapped = readback.getMappedRange();
    if (!mapped) throw new Error("readback buffer reported mapped but getMappedRange gave nothing");
    const stamps = new BigUint64Array(mapped.slice(0));
    readback.unmap();
    if (stamps.length !== 4) throw new Error("expected four timestamps, got " + stamps.length);
    for (let index = 0; index < 4; index += 1) {
      if (stamps[index] === 0n) throw new Error("query slot " + index + " was never written");
    }
    // The render pass may legitimately measure zero: a fast-clear can finish inside one tick.
    // What it may not do is run backwards, and it may not leave its slots unwritten.
    if (stamps[1] < stamps[0])
      throw new Error("render pass went backwards: " + stamps[0] + " then " + stamps[1]);
    const computeDelta = stamps[3] - stamps[2];
    if (computeDelta <= 0n)
      throw new Error("compute pass reported no elapsed time: " + stamps[2] + " then " + stamps[3]);
    console.log(
      "TN_TIMESTAMP_QUERY:" +
        JSON.stringify({
          supported: true,
          renderDeltaNs: Number(stamps[1] - stamps[0]),
          deltaNs: Number(computeDelta),
        }),
    );
    globalThis.__tnTsDone = true;
  }).catch((error) => {
    globalThis.__tnTsError = String(error && error.message ? error.message : error);
  });
})())JS";

constexpr const char* kAssert = R"JS((() => {
  if (!globalThis.__tnTs.supported) {
    console.log("TN_TIMESTAMP_QUERY:{\"supported\":false}");
    return;   // "this GPU cannot" is a different result from "these bindings cannot".
  }
  if (globalThis.__tnTsError) throw new Error(globalThis.__tnTsError);
  if (globalThis.__tnTsDone !== true) throw new Error("timestamp readback never completed");
})())JS";

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    if (!runtime->evalScript(kSetup, "timestamp_query_setup.js")) {
        std::cerr << "timestamp-query bindings failed to encode a timed pass";
        if (runtime->getExitCode() != 0) std::cerr << " (exit " << runtime->getExitCode() << ")";
        std::cerr << '\n';
        return 1;
    }

    // Frames, not ticks: the packed frame op stream is drained and replayed by the host once per
    // frame, and every command this test recorded is sitting in it.
    for (int frame = 0; frame < 60; frame += 1) {
        if (!runtime->pollEvents()) break;
    }

    if (!runtime->evalScript(kRead, "timestamp_query_read.js")) {
        std::cerr << "timestamp-query readback failed to start\n";
        return 1;
    }
    for (int frame = 0; frame < 60; frame += 1) {
        if (!runtime->pollEvents()) break;
    }

    if (!runtime->evalScript(kAssert, "timestamp_query_assert.js")) {
        std::cerr << "timestamp-query contract failed\n";
        return 1;
    }

    std::cout << "native timestamp-query bindings contract passed\n";
    return 0;
}
