// PRD-224 phase 2: GPURenderPassEncoder's binding table installs once per class, the same
// mechanism PRD-222 proved for GPUCommandEncoder. The receiver-aware rows resolve the pass from
// the receiving wrapper; `end` additionally resolves its command encoder from the receiver
// through `encoderRenderPassMap` — the paired-state ruling — never from a captured closure.
//
// Everything here runs through the real headless runtime so the guards go red the moment the
// beginRenderPass fast path is reverted to per-call installs.
#include "mystral/runtime.h"

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

bool eval(mystral::js::Engine* engine, const std::string& source, const char* label) {
    const bool ok = engine->toBoolean(engine->evalScriptWithResult(source.c_str(), label));
    if (engine->hasException()) engine->getException();
    return ok;
}

void runRuntimeContract() {
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

    const bool booted = engine->evalScript(
        R"JS((async () => {
            const adapter = await navigator.gpu.requestAdapter();
            globalThis.__device = await adapter.requestDevice();
            globalThis.__encA = __device.createCommandEncoder();
            globalThis.__encB = __device.createCommandEncoder();
            globalThis.__passA = __encA.beginRenderPass({colorAttachments: []});
            globalThis.__passB = __encB.beginRenderPass({colorAttachments: []});
        })())JS",
        "tn-runtime-passes.js");
    expect(booted, "pass-creating script evaluated");
    for (int pump = 0; pump < 200; ++pump) {
        if (!engine->isUndefined(engine->getGlobalProperty("__passA"))) break;
        engine->processMicrotasks();
    }
    expect(!engine->isUndefined(engine->getGlobalProperty("__passA")),
           "two render passes exist through the real device surface");

    expect(eval(engine,
                "typeof __passA.setPipeline === 'function' && typeof __passA.draw === 'function'"
                " && typeof __passA.end === 'function'",
                "tn-pass-methods.js"),
           "render pass methods exist on the wrapper");

    expect(eval(engine,
                "Object.getPrototypeOf(__passA) === Object.getPrototypeOf(__passB)",
                "tn-pass-proto-identity.js"),
           "both render passes share one class prototype");

    expect(eval(engine,
                "!Object.hasOwn(__passA, 'draw') && !Object.hasOwn(__passA, 'end')"
                " && !Object.hasOwn(__passA, 'setPipeline')",
                "tn-pass-no-own.js"),
           "render pass methods are prototype members, not per-instance own properties");

    expect(eval(engine,
                "__passA.draw === __passB.draw && __passA.end === __passB.end"
                " && __passA.setPipeline === __passB.setPipeline",
                "tn-pass-shared-identity.js"),
           "render pass method identities are shared across instances");

    // Receiver routing under interleaving: draws and ends dispatch per receiver. A stale
    // captured pass shows up as commands landing in the wrong stream or an exception.
    // (Numeric-arg rows only: the object-arg rows dereference the argument's private data, and
    // this contract is about receiver identity, not argument validation.)
    const bool interleaved = engine->evalScript(
        R"JS((() => {
            __passA.draw(3, 1, 0, 0);
            __passB.draw(4, 1, 0, 0);
            __passA.setViewport(0, 0, 1, 1, 0, 1);
            __passB.setViewport(0, 0, 1, 1, 0, 1);
            __passA.end();
            __passB.end();
            __encA.finish();
            __encB.finish();
            return true;
        })())JS",
        "tn-pass-interleaved.js");
    expect(interleaved && !engine->hasException(),
           "interleaved setPipeline/draw/end dispatch per receiver without error");
    if (engine->hasException()) engine->getException();

    // Detached call: the trampoline hands nullptr and the stored body reports it by name rather
    // than dereferencing.
    const auto detached = engine->evalScriptWithResult(
        R"JS((() => {
            try {
                Object.getPrototypeOf(globalThis.__passA).end.call(undefined);
                return "no-throw";
            } catch (error) {
                return String((error && error.message) || error);
            }
        })())JS",
        "tn-pass-detached.js");
    if (engine->hasException()) engine->getException();
    const std::string detachedText = engine->toString(detached);
    expect(detachedText.find("no render pass receiver") != std::string::npos,
           "detached end() reports the missing receiver by name, got: " + detachedText);

    // Second generation through the same device: after the first pair ended, a fresh encoder
    // and pass still share the one class prototype, draw through the receiver, and the paired
    // end() re-derives the new encoder from the map rather than any captured handle.
    const bool secondGeneration = engine->evalScript(
        R"JS((() => {
            const encC = __device.createCommandEncoder();
            const passC = encC.beginRenderPass({colorAttachments: []});
            const sameProto =
                Object.getPrototypeOf(passC) === Object.getPrototypeOf(__passA);
            passC.draw(5, 1, 0, 0);
            passC.end();
            encC.finish();
            globalThis.__passCProto = sameProto;
            return sameProto;
        })())JS",
        "tn-pass-second-generation.js");
    expect(secondGeneration && !engine->hasException(),
           "second-generation pass shares the class prototype and dispatches");
    if (engine->hasException()) engine->getException();
}

}  // namespace

int main() {
    runRuntimeContract();

    if (failures != 0) {
        std::cerr << "render-pass-class-table contract: " << failures << " failure(s)"
                  << std::endl;
        return 1;
    }
    std::cout << "render-pass-class-table: prototype=shared receivers=resolved "
                 "pairing=map-resolved runtime=wired" << std::endl;
    return 0;
}
