#include "mystral/runtime.h"
#include "mystral/webgpu/bindings.h"

#include "../src/webgpu/bindings_state.h"

#include <iostream>
#include <string>

namespace {

int failures = 0;

void expect(bool condition, const std::string& what) {
    if (!condition) {
        std::cerr << "FAIL: " << what << std::endl;
        failures += 1;
    }
}

void expectMalformed(mystral::webgpu::BindingsState* state, const char* expression,
                     const std::string& expected, const std::string& what) {
    auto* engine = state->engine;
    state->frameOpStreamDrain = engine->evalScriptWithResult(expression, "tn-malformed-frame.js");
    mystral::webgpu::endDawnFrame(state);
    const std::string exception = engine->hasException() ? engine->getException() : "";
    expect(exception.find(expected) != std::string::npos, what + ": " + exception);
}

void runContract() {
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

    expect(engine->evalScript(
        R"JS((async () => {
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const src = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST});
          const dst = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
          globalThis.__tnUploadDst = dst;
          const renderTarget = device.createTexture({
            size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
          const renderView = renderTarget.createView();
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
            globalThis.__tnFrameCallbackRan = true;
          });
        })())JS",
        "tn-frame-op-stream-contract.js"),
        "frame command script evaluated");

    for (int pump = 0; pump < 200; ++pump) {
        if (!engine->isUndefined(engine->getGlobalProperty("__tnFrameCallbackRan"))) break;
        engine->processMicrotasks();
    }
    expect(state->frameOpStreamDrain.ptr, "production frame op stream is installed");
    runtime->pollEvents();
    expect(engine->toBoolean(engine->getGlobalProperty("__tnFrameCallbackRan")),
           "commands ran inside a real requestAnimationFrame callback");
    expect(state->frameOpStreamReplayCrossings == 1,
           "writeBuffer, encoder, finish, and submit replay in one crossing");
    expect(state->frameOpStreamDirectCommandCalls == 0,
           "no recorded command reached a direct command callback");
    const std::vector<std::string> expectedOrder = {
        "writeBuffer", "createCommandEncoder", "clearBuffer", "copyBufferToBuffer",
        "beginRenderPass", "render.end",
        "beginComputePass", "compute.end", "finish", "submit"};
    if (state->frameOpStreamLastOrder != expectedOrder) {
        std::cerr << "observed order:";
        for (const auto& op : state->frameOpStreamLastOrder) std::cerr << " " << op;
        std::cerr << std::endl;
    }
    expect(state->frameOpStreamLastOrder == expectedOrder,
           "native replay preserves the exact operation order and census");
    expect(state->frameOpStreamLastOpCount == expectedOrder.size(),
           "native replay reports every operation exactly once");
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
        "() => { const b=new ArrayBuffer(40),v=new DataView(b); v.setUint32(0,0x544e4652,true); v.setUint32(4,1,true); v.setUint32(8,40,true); v.setUint32(12,1,true); v.setUint32(16,1,true); v.setUint32(20,24,true); v.setUint32(24,0xffffffff,true); return b; }",
        "unknown buffer id", "native parser rejects an unknown resource id");
    state->frameOpStreamDrain = {};
}

}  // namespace

int main() {
    runContract();
    if (failures != 0) {
        std::cerr << failures << " frame op stream assertion(s) failed" << std::endl;
        return 1;
    }
    std::cout << "frame op stream replay contract passed" << std::endl;
    return 0;
}
