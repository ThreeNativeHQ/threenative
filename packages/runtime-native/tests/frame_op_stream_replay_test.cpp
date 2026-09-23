#include "mystral/runtime.h"
#include "mystral/webgpu/bindings.h"

#include "../src/webgpu/bindings_state.h"

#include <iostream>
#include <chrono>
#include <thread>
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

void awaitFlag(mystral::Runtime* runtime, mystral::js::Engine* engine, const char* flag) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (std::chrono::steady_clock::now() < deadline) {
        runtime->pollEvents();
        engine->processMicrotasks();
        mystral::js::JSValueGuard value(*engine, engine->getGlobalProperty(flag));
        if (engine->toBoolean(value.get())) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    expect(false, std::string("timed out awaiting ") + flag);
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
          try {
            await __tnUploadDst.mapAsync(GPUMapMode.READ, 0, 16);
            globalThis.__tnUploadReadback = Array.from(new Uint32Array(__tnUploadDst.getMappedRange(0, 16)));
            __tnUploadDst.unmap();
          } catch (error) {
            globalThis.__tnUploadReadbackError = String(error);
          } finally {
            globalThis.__tnUploadReadbackDone = true;
          }
        })())JS",
        "tn-upload-readback.js"),
        "upload readback requested");
    // Metal can deliver a spontaneous Dawn map callback on the next run-loop turn. Yield between
    // polls so this contract waits for the same backend completion it is asserting rather than
    // exhausting a tight loop before the driver has had a chance to signal it.
    for (int pump = 0; pump < 5000; ++pump) {
        engine->processMicrotasks();
        if (!engine->isUndefined(engine->getGlobalProperty("__tnUploadReadbackDone"))) break;
        runtime->pollEvents();
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    expect(engine->toBoolean(engine->getGlobalProperty("__tnUploadReadbackDone")),
           "upload readback promise settled");
    expect(engine->isUndefined(engine->getGlobalProperty("__tnUploadReadbackError")),
           "upload readback completed without an error");
    if (!engine->isUndefined(engine->getGlobalProperty("__tnUploadReadback"))) {
        expect(engine->toBoolean(engine->evalScriptWithResult(
            "JSON.stringify(__tnUploadReadback) === '[1,2,3,4]'", "tn-upload-readback-check.js")),
            "writeBuffer payload was copied eagerly before source mutation");
    }

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
          requestAnimationFrame(async () => {
            device.queue.writeBuffer(src, 0, new Uint32Array([5, 6, 7, 8]));
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(src, 0, dst, 0, 16);
            device.queue.submit([encoder.finish()]);
            const mapping = dst.mapAsync(GPUMapMode.READ, 0, 16);
            globalThis.__tnSameFrameMapState = dst.mapState;
            await mapping;
            globalThis.__tnSameFrameReadback = Array.from(new Uint32Array(dst.getMappedRange(0, 16)));
            dst.destroy(); // three.js destroys instead of unmapping: the buffer stays mapped.
            globalThis.__tnSameFrameRan = true;
          });
        })())JS",
        "tn-same-frame-readback.js"),
        "same-frame readback script evaluated");
    awaitFlag(runtime.get(), engine, "__tnSameFrameRan");
    expect(engine->toBoolean(engine->getGlobalProperty("__tnSameFrameRan")),
           "same-frame readback ran inside a requestAnimationFrame callback");
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "__tnSameFrameMapState === 'pending'", "tn-same-frame-map-state-check.js")),
        std::string("mapAsync returns while the mapping is pending: ") +
            engine->toString(engine->evalScriptWithResult(
                "String(__tnSameFrameMapState)", "tn-same-frame-map-state-report.js")));
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "JSON.stringify(__tnSameFrameReadback) === '[5,6,7,8]'", "tn-same-frame-check.js")),
        std::string("mapAsync sees work submitted earlier in the same frame: ") +
            engine->toString(engine->evalScriptWithResult(
                "JSON.stringify(__tnSameFrameReadback)", "tn-same-frame-report.js")));
    runtime->pollEvents(); // The awaited continuation records destroy for the next drain.
    expect(state->profiling.frameOpStreamReplayCrossings - crossingsBeforeSameFrame >= 2,
           "mapAsync and the awaited destroy both drain the recorded stream");
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
            const mapping = dst.mapAsync(GPUMapMode.READ, 0, 16);
            mapping.then(() => {
              globalThis.__tnSplitReadback = Array.from(new Uint32Array(dst.getMappedRange(0, 16)));
              dst.unmap();
              globalThis.__tnSplitReadDone = true;
            });
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
    const auto splitTailOrder = state->profiling.frameOpStreamLastOrder;
    awaitFlag(runtime.get(), engine, "__tnSplitReadDone");
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "JSON.stringify(__tnSplitReadback) === '[9,10,11,12]'", "tn-split-check.js")),
        std::string("mapAsync flushes the submitted copy while an encoder is still open: ") +
            engine->toString(engine->evalScriptWithResult(
                "JSON.stringify(__tnSplitReadback)", "tn-split-report.js")));
    const std::vector<std::string> expectedSplitTailOrder = {
        "createCommandEncoder", "beginRenderPass", "render.end", "finish", "submit"};
    if (splitTailOrder != expectedSplitTailOrder) {
        std::cerr << "observed split tail order:";
        for (const auto& op : splitTailOrder)
            std::cerr << " " << op;
        std::cerr << std::endl;
    }
    expect(splitTailOrder == expectedSplitTailOrder,
           "the half-recorded encoder stayed behind and drained whole at the frame boundary");

    // No pollEvents between request and inspection: the native registry, not a JS wrapper,
    // must still own both requests. Cancellation must allow an immediate replacement map.
    expect(engine->evalScript(R"JS((() => {
      const make = () => __tnDevice.createBuffer({size:16, usage:GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
      globalThis.__tnMapA = make(); globalThis.__tnMapB = make();
      globalThis.__tnMapErrors = [];
      const check = (ok, label) => { if (!ok) __tnMapErrors.push(label); };
      const first = __tnMapA.mapAsync(1);
      const second = __tnMapB.mapAsync(1);
      globalThis.__tnConcurrentMaps = Promise.all([first, second]).then(async () => {
        check(__tnMapA.mapState === 'mapped' && __tnMapB.mapState === 'mapped', 'concurrent mapped');
        await __tnMapA.mapAsync(1).then(() => check(false, 'mapped request accepted'), () => {});
        check(__tnMapA.mapState === 'mapped', 'mapped rejection changed state');
        __tnMapA.unmap(); __tnMapB.unmap();
        const cancelled = __tnMapA.mapAsync(1).then(() => check(false, 'unmap did not cancel'), () => {});
        __tnMapA.unmap();
        const replacement = __tnMapA.mapAsync(1);
        await cancelled;
        check(__tnMapA.mapState === 'pending', 'old cancellation changed replacement state');
        await replacement;
        check(__tnMapA.mapState === 'mapped', 'replacement not mapped');
        __tnMapA.destroy();
        check(__tnMapA.mapState === 'unmapped', 'destroy did not clear mapState');
        const doomed = __tnMapB.mapAsync(1).then(() => check(false, 'destroy did not cancel'), () => {});
        __tnMapB.destroy();
        check(__tnMapB.mapState === 'unmapped', 'pending destroy state');
        await doomed;
        await __tnMapB.mapAsync(1).then(() => check(false, 'destroyed map accepted'), () => {});
        check(__tnBufferMapPendingCount() === 0, 'unsettled maps');
        globalThis.__tnMapLifecycleDone = true;
      }).catch(e => { __tnMapErrors.push(String(e)); globalThis.__tnMapLifecycleDone = true; });
      __tnMapA.mapAsync(1).then(() => check(false, 'duplicate accepted'), () => {
        check(__tnMapA.mapState === 'pending', 'duplicate rejection changed pending state');
      });
    })())JS", "tn-map-lifecycle.js"), "map lifecycle script evaluated");
    expect(state->asyncBufferMaps.pending.size() == 2,
           "two native map requests remain deferred without polling");
    for (const auto& entry : state->asyncBufferMaps.pending) {
        const auto& info = state->registries.bufferRegistry.at(entry.second->bufferId);
        expect(info.mapPending && !info.isMapped, "native map state stays pending until drain");
    }
    engine->processMicrotasks();
    awaitFlag(runtime.get(), engine, "__tnMapLifecycleDone");
    expect(engine->toBoolean(engine->evalScriptWithResult("__tnMapErrors.length === 0", "tn-map-check.js")),
           "buffer map lifecycle: " + engine->toString(engine->evalScriptWithResult("JSON.stringify(__tnMapErrors)", "tn-map-errors.js")));

    // Exercise a backend completion with an error, not just cancellation. The failed request must
    // leave both pending maps empty so the same buffer can be mapped successfully immediately
    // afterwards; otherwise a driver validation error turns into a permanent map-state leak.
    expect(engine->evalScript(R"JS((() => {
      globalThis.__tnMapFailure = __tnDevice.createBuffer({size:16, usage:GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
      globalThis.__tnMapFailureErrors = [];
      globalThis.__tnMapFailureDone = false;
      (async () => {
        const buffer = __tnMapFailure;
        await buffer.mapAsync(1, 0, 15).then(
          () => __tnMapFailureErrors.push('invalid map resolved'),
          () => {
            if (buffer.mapState !== 'unmapped') __tnMapFailureErrors.push('failed map state');
          });
        await buffer.mapAsync(1, 0, 16);
        if (buffer.mapState !== 'mapped') __tnMapFailureErrors.push('reused map state');
        buffer.unmap();
        buffer.destroy();
        globalThis.__tnMapFailureDone = true;
      })().catch((error) => {
        __tnMapFailureErrors.push(String(error));
        globalThis.__tnMapFailureDone = true;
      });
    })())JS", "tn-map-failure.js"), "backend map failure requested");
    awaitFlag(runtime.get(), engine, "__tnMapFailureDone");
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "__tnMapFailureErrors.length === 0 && __tnBufferMapPendingCount() === 0",
        "tn-map-failure-check.js")),
           "backend map failures clear every promise: " +
               engine->toString(engine->evalScriptWithResult(
                   "JSON.stringify(__tnMapFailureErrors)", "tn-map-failure-errors.js")));
    expect(state->asyncBufferMaps.pending.empty(),
           "backend map failures clear every native pending request");

    expect(engine->evalScript(R"JS((() => {
      globalThis.__tnShutdownBuffer = __tnDevice.createBuffer({size:16, usage:GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
      globalThis.__tnShutdownSettlements = 0;
      __tnShutdownBuffer.mapAsync(1).then(
        () => { __tnShutdownSettlements++; globalThis.__tnShutdownResult = 'resolved'; },
        () => { __tnShutdownSettlements++; globalThis.__tnShutdownResult = __tnShutdownBuffer.mapState; });
    })())JS", "tn-map-shutdown.js"), "shutdown map requested");
    const auto shutdownRequest = state->asyncBufferMaps.pending.begin()->second;
    mystral::webgpu::shutdownAsyncBufferMaps(state);
    mystral::webgpu::shutdownAsyncBufferMaps(state); // idempotent, including late callbacks
    engine->processMicrotasks();
    expect(state->asyncBufferMaps.pending.empty(), "shutdown clears pending native maps");
    expect(!state->registries.bufferRegistry.at(shutdownRequest->bufferId).mapPending,
           "shutdown cancels the backend map and clears pending state");
    expect(engine->toBoolean(engine->evalScriptWithResult(
        "__tnShutdownResult === 'unmapped' && __tnShutdownSettlements === 1 && __tnBufferMapPendingCount() === 0",
        "tn-shutdown-map-check.js")), "shutdown rejects each promise exactly once");
    expect(engine->evalScript(R"JS(
      __tnShutdownBuffer.mapAsync(1).then(
        () => { globalThis.__tnAfterShutdown = false; },
        () => { globalThis.__tnAfterShutdown = true; });
    )JS", "tn-map-after-shutdown.js"), "map after shutdown requested");
    engine->processMicrotasks();
    expect(engine->toBoolean(engine->getGlobalProperty("__tnAfterShutdown")),
           "shutdown refuses new map requests");

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
