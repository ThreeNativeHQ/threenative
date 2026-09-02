#include "mystral/runtime.h"
#include "mystral/webgpu/bindings.h"

#include "../src/webgpu/bindings_state.h"

#include <iostream>
#include <sstream>
#include <string>

namespace {

int failures = 0;
int frameReplayBackendEntries = 0;

void observeFrameReplayBackendEntry(const char*) {
    frameReplayBackendEntries += 1;
}

void expect(bool condition, const std::string& what) {
    if (!condition) {
        std::cerr << "FAIL: " << what << std::endl;
        failures += 1;
    }
}

void expectMalformed(mystral::webgpu::BindingsState* state, const std::string& expression,
                     const std::string& expected, const std::string& what,
                     int expectedBackendEntries = 0) {
    auto* engine = state->engine;
    const int backendEntriesBefore = frameReplayBackendEntries;
    state->profiling.frameOpStreamDrain =
        engine->evalScriptWithResult(expression.c_str(), "tn-malformed-frame.js");
    mystral::webgpu::endDawnFrame(state);
    const std::string exception = engine->hasException() ? engine->getException() : "";
    expect(exception.find(expected) != std::string::npos, what + ": " + exception);
    expect(frameReplayBackendEntries - backendEntriesBefore == expectedBackendEntries,
           what + ": malformed replay entered wgpu-native");
}

void runContract(bool disableStreamControl) {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;
    const auto runtime = mystral::Runtime::create(config);
    if (!runtime || !runtime->getWebGPUBindingsState()) {
        expect(false, "headless runtime with WebGPU bindings created");
        return;
    }
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime->getWebGPUBindingsState());
    auto* engine = state->engine;
    expect(!state->profiling.captureFrameOpStreamTrace, "production replay does not allocate an operation-name trace");
    state->profiling.captureFrameOpStreamTrace = true;

    expect(engine->evalScript(
        R"JS((async () => {
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          globalThis.__tnDevice = device; // reused by the same-frame readback contract below.
          const src = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST});
          const dst = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
          globalThis.__tnUploadDst = dst;
          const renderTarget = device.createTexture({
            size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
          const renderView = renderTarget.createView();
          globalThis.__tnRenderView = renderView;
          requestAnimationFrame(() => {
            const upload = new Uint32Array([1, 2, 3, 4]);
            device.queue.writeBuffer(src, 0, upload);
            upload.fill(99); // eager-copy negative control: replay must retain 1,2,3,4.
            const encoder = device.createCommandEncoder();
            encoder.clearBuffer(dst, 0, 16);
            encoder.copyBufferToBuffer(src, 0, dst, 0, 16);
            const render = encoder.beginRenderPass({colorAttachments: [{
              view: renderView, loadOp: "clear", storeOp: "store",
              clearValue: [0.25, 0.5, 0.75, 1],
            }]});
            render.end();
            const pass = encoder.beginComputePass();
            pass.end();
            device.queue.submit([encoder.finish()]);
            src.destroy(); // must stay ordered after submit; direct destruction invalidates replay.
            globalThis.__tnFrameCallbackRan = true;
          });
        })())JS",
        "tn-frame-op-stream-contract.js"),
        "frame command script evaluated");

    for (int pump = 0; pump < 200; ++pump) {
        if (!engine->isUndefined(engine->getGlobalProperty("__tnFrameCallbackRan"))) break;
        engine->processMicrotasks();
    }
    expect(state->profiling.frameOpStreamDrain.ptr, "production frame op stream is installed");
    const auto installedDrain = state->profiling.frameOpStreamDrain;
    if (disableStreamControl)
        state->profiling.frameOpStreamDrain = {};
    runtime->pollEvents();
    expect(engine->toBoolean(engine->getGlobalProperty("__tnFrameCallbackRan")),
           "commands ran inside a real requestAnimationFrame callback");
    expect(state->profiling.frameOpStreamReplayCrossings == 1,
           "writeBuffer, encoder, finish, and submit replay in one crossing");
    expect(state->profiling.frameOpStreamDirectCommandCalls == 0,
           "no recorded command reached a direct command callback");
    if (disableStreamControl) {
        // Restore ownership so teardown frees the protected handle and the remaining fail-closed
        // parser controls can run. The crossing assertion above must already be red.
        state->profiling.frameOpStreamDrain = installedDrain;
    }
    const std::vector<std::string> expectedOrder = {
        "writeBuffer", "createCommandEncoder", "clearBuffer", "copyBufferToBuffer",
        "beginRenderPass", "render.end",
        "beginComputePass", "compute.end", "finish", "submit", "buffer.destroy"};
    if (state->profiling.frameOpStreamLastOrder != expectedOrder) {
        std::cerr << "observed order:";
        for (const auto& op : state->profiling.frameOpStreamLastOrder)
            std::cerr << " " << op;
        std::cerr << std::endl;
    }
    expect(state->profiling.frameOpStreamLastOrder == expectedOrder,
           "native replay preserves the exact operation order and census");
    expect(state->profiling.frameOpStreamLastOpCount == expectedOrder.size(),
           "native replay reports every operation exactly once");
#if defined(MYSTRAL_WEBGPU_WGPU) && TN_WEBGPU_UPLOAD_STAGING
    expect(!state->registries.uploadStaging.retired.empty() || !state->registries.uploadStaging.ready.empty(),
           "packed writeBuffer uses the configured upload-staging backend");
#endif
    expect(engine->evalScript(
        R"JS((async () => {
          await __tnUploadDst.mapAsync(GPUMapMode.READ, 0, 16);
          globalThis.__tnUploadReadback = Array.from(new Uint32Array(__tnUploadDst.getMappedRange(0, 16)));
          __tnUploadDst.unmap();
        })())JS",
        "tn-upload-readback.js"),
        "upload readback requested");
    for (int pump = 0; pump < 200; ++pump) {
        engine->processMicrotasks();
        if (!engine->isUndefined(engine->getGlobalProperty("__tnUploadReadback"))) break;
        runtime->pollEvents();
    }
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "JSON.stringify(__tnUploadReadback) === '[1,2,3,4]'", "tn-upload-readback-check.js")),
        "writeBuffer payload was copied eagerly before source mutation");

    // Same-frame readback. `queue.submit` is recorded, not executed, so the copy a game hands the
    // queue only reaches the GPU when the frame drains. `buffer.mapAsync` is the one call that
    // lets JavaScript observe the queue before that: WebGPU says a map completes after the work
    // already submitted, so the map has to force the recorded stream out first. three.js's
    // `readRenderTargetPixelsAsync` is exactly this shape — copy, submit, map, read, destroy, all
    // inside one frame — and read zeros while the deferred submit later tripped
    // "used in submit while mapped".
    const uint64_t crossingsBeforeSameFrame = state->profiling.frameOpStreamReplayCrossings;
    expect(engine->evalScript(
        R"JS((() => {
          const device = globalThis.__tnDevice;
          const src = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST});
          const dst = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
          requestAnimationFrame(() => {
            device.queue.writeBuffer(src, 0, new Uint32Array([5, 6, 7, 8]));
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(src, 0, dst, 0, 16);
            device.queue.submit([encoder.finish()]);
            // The host maps synchronously and hands back an already-resolved promise, so the read
            // below is the same instant three.js reaches after its `await`.
            dst.mapAsync(GPUMapMode.READ, 0, 16);
            globalThis.__tnSameFrameReadback = Array.from(new Uint32Array(dst.getMappedRange(0, 16)));
            dst.destroy(); // three.js destroys instead of unmapping: the buffer stays mapped.
            globalThis.__tnSameFrameRan = true;
          });
        })())JS",
        "tn-same-frame-readback.js"),
        "same-frame readback script evaluated");
    runtime->pollEvents();
    expect(engine->toBoolean(engine->getGlobalProperty("__tnSameFrameRan")),
           "same-frame readback ran inside a requestAnimationFrame callback");
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "JSON.stringify(__tnSameFrameReadback) === '[5,6,7,8]'", "tn-same-frame-check.js")),
        std::string("mapAsync sees work submitted earlier in the same frame: ") +
            engine->toString(engine->evalScriptWithResult(
                "JSON.stringify(__tnSameFrameReadback)", "tn-same-frame-report.js")));
    expect(state->profiling.frameOpStreamReplayCrossings - crossingsBeforeSameFrame == 2,
           "mapAsync drains the recorded stream in its own crossing, ahead of the frame's");
    const std::vector<std::string> expectedSameFrameOrder = {"buffer.destroy"};
    if (state->profiling.frameOpStreamLastOrder != expectedSameFrameOrder) {
        std::cerr << "observed same-frame tail order:";
        for (const auto& op : state->profiling.frameOpStreamLastOrder)
            std::cerr << " " << op;
        std::cerr << std::endl;
    }
    expect(state->profiling.frameOpStreamLastOrder == expectedSameFrameOrder,
           "the copy and its submit left at mapAsync, leaving only the deferred destroy");

    // The same map, with a command encoder left half-recorded across it. The cut has to land
    // before that encoder was created — replaying a stream whose encoder is never finished is a
    // hard "frame ended with unfinished GPU objects" — so the tail keeps recording and drains at
    // the frame boundary, intact and in order.
    expect(engine->evalScript(
        R"JS((() => {
          const device = globalThis.__tnDevice;
          const src = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST});
          const dst = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
          requestAnimationFrame(() => {
            device.queue.writeBuffer(src, 0, new Uint32Array([9, 10, 11, 12]));
            const first = device.createCommandEncoder();
            first.copyBufferToBuffer(src, 0, dst, 0, 16);
            device.queue.submit([first.finish()]);
            const second = device.createCommandEncoder();
            const pass = second.beginRenderPass({colorAttachments: [{
              view: globalThis.__tnRenderView, loadOp: "clear", storeOp: "store",
              clearValue: [0, 0, 0, 1],
            }]});
            dst.mapAsync(GPUMapMode.READ, 0, 16);
            globalThis.__tnSplitReadback = Array.from(new Uint32Array(dst.getMappedRange(0, 16)));
            dst.unmap();
            pass.end();
            device.queue.submit([second.finish()]);
            globalThis.__tnSplitRan = true;
          });
        })())JS",
        "tn-split-flush.js"),
        "split-flush script evaluated");
    runtime->pollEvents();
    expect(engine->toBoolean(engine->getGlobalProperty("__tnSplitRan")),
           "split-flush readback ran inside a requestAnimationFrame callback");
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "JSON.stringify(__tnSplitReadback) === '[9,10,11,12]'", "tn-split-check.js")),
        std::string("mapAsync flushes the submitted copy while an encoder is still open: ") +
            engine->toString(engine->evalScriptWithResult(
                "JSON.stringify(__tnSplitReadback)", "tn-split-report.js")));
    const std::vector<std::string> expectedSplitTailOrder = {
        "createCommandEncoder", "beginRenderPass", "render.end", "finish", "submit"};
    if (state->profiling.frameOpStreamLastOrder != expectedSplitTailOrder) {
        std::cerr << "observed split tail order:";
        for (const auto& op : state->profiling.frameOpStreamLastOrder)
            std::cerr << " " << op;
        std::cerr << std::endl;
    }
    expect(state->profiling.frameOpStreamLastOrder == expectedSplitTailOrder,
           "the half-recorded encoder stayed behind and drained whole at the frame boundary");

    state->profiling.frameOpStreamNativeCallObserver = observeFrameReplayBackendEntry;
    frameReplayBackendEntries = 0;

    expectMalformed(state, "() => new ArrayBuffer(8)", "truncated header",
                    "native parser rejects a truncated header");
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(16),v=new DataView(b); v.setUint32(4,1,true); v.setUint32(8,16,true); return b; }",
        "invalid header", "native parser rejects invalid header magic");
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(28),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,1,true); v.setUint32(8,28,true); v.setUint32(12,1,true); v.setUint32(16,2,true); v.setUint32(20,12,true); v.setUint32(24,1,true); return b; }",
        "malformed record header", "native parser rejects an unaligned record length");
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(24),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,1,true); v.setUint32(8,24,true); v.setUint32(12,1,true); v.setUint32(16,99,true); v.setUint32(20,8,true); return b; }",
        "malformed record header", "native parser rejects an unknown opcode");
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(24),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,1,true); v.setUint32(8,24,true); v.setUint32(12,1,true); v.setUint32(16,35,true); v.setUint32(20,8,true); return b; }",
        "malformed record header", "native parser rejects unsupported query-set destroy opcode");
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(40),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,1,true); v.setUint32(8,40,true); v.setUint32(12,1,true); v.setUint32(16,1,true); v.setUint32(20,24,true); v.setUint32(24,0xffffffff,true); return b; }",
        "unknown buffer id", "native parser rejects an unknown resource id");
    if (!state->registries.bufferRegistry.empty()) {
        const uint64_t validBufferId = state->registries.bufferRegistry.begin()->first;
        std::ostringstream truncatedWriteBuffer;
        truncatedWriteBuffer
            << "() => { const b=new ArrayBuffer(32),v=new DataView(b); "
               "v.setUint32(0,0x544e4652,true); v.setUint32(4,2,true); "
               "v.setUint32(8,32,true); v.setUint32(12,1,true); "
               "v.setUint32(16,1,true); v.setUint32(20,16,true); "
            << "v.setUint32(24," << validBufferId << ",true); return b; }";
        expectMalformed(state, truncatedWriteBuffer.str(), "truncated writeBuffer record",
                        "native parser rejects a truncated writeBuffer with a valid buffer id");
    } else {
        expect(false, "malformed writeBuffer test found a valid buffer registry entry");
    }
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(40),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,2,true); v.setUint32(8,40,true); v.setUint32(12,1,true); v.setUint32(16,18,true); v.setUint32(20,24,true); v.setUint32(24,0xffffffff,true); v.setUint32(28,1,true); return b; }",
        "unknown command encoder id", "native parser rejects an unknown compute encoder");
    expectMalformed(state,
        "() => { const b=new ArrayBuffer(112),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,2,true); v.setUint32(8,112,true); v.setUint32(12,2,true); v.setUint32(16,2,true); v.setUint32(20,16,true); v.setUint32(24,1,true); v.setUint32(32,3,true); v.setUint32(36,80,true); v.setUint32(40,1,true); v.setUint32(44,2,true); v.setUint32(48,1,true); v.setUint32(52,0xffffffff,true); return b; }",
        "unknown texture view id", "native parser rejects an invalid texture-view id");
    state->profiling.frameOpStreamNativeCallObserver = nullptr;
    state->profiling.frameOpStreamDrain = {};
}

}  // namespace

int main(int argc, char** argv) {
    const bool disableStreamControl =
        argc > 1 && std::string(argv[1]) == "disabled-stream-control";
    runContract(disableStreamControl);
    if (failures != 0) {
        if (disableStreamControl) {
            std::cerr << "RED observed: disabled frame stream rejected" << std::endl;
        }
        std::cerr << failures << " frame op stream assertion(s) failed" << std::endl;
        return 1;
    }
    std::cout << "frame op stream replay contract passed" << std::endl;
    return 0;
}
