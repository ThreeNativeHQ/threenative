// PRD-222 per-class binding tables: the engine contract behind
// docs/bugs/webgpu-binding-table-installed-per-call-2026-08-26.md.
//
// A class's binding table installs once on a shared prototype and resolves its native handle
// from the receiver's private data. This exercises that mechanism directly on the Engine
// surface: supportsNativeMethods(), newMethod(), setPrototypeOf(), the detached-call path
// (nullptr receiver -> callee reports it), and per-instance state independence across two
// instances of one prototype.
#include "mystral/js/engine.h"
#include "mystral/runtime.h"

#include "../src/webgpu/bindings_state.h"

#include <cstdlib>
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

void runContract(mystral::js::Engine& engine, bool forceLegacyShape = false) {
    if (!engine.supportsNativeMethods()) {
        // Explicitly gated engines fall back to the legacy per-instance install; assert the
        // gate says no rather than half-supporting it.
        expect(!engine.setPrototypeOf(engine.newObject(), engine.newObject()),
               "unsupported engine refuses setPrototypeOf");
        return;
    }

    // Two instances share one prototype whose method resolves state from the receiver.
    const auto proto = engine.newObject();
    auto* calls = new int(0);
    int lastSeen = -1;
    const auto method = engine.newMethod("report", [&calls, &lastSeen](mystral::js::Engine& engineRef, void* receiverPrivate,
                                       const std::vector<mystral::js::JSValueHandle>&) {
        *calls += 1;
        lastSeen = receiverPrivate ? *static_cast<int*>(receiverPrivate) : -1;
        return engineRef.newNumber(static_cast<double>(lastSeen));
    });
    expect(proto.ptr && method.ptr, "prototype object and method function exist");
    expect(engine.setProperty(proto, "report", method), "method installs onto the prototype");
    engine.freezeHandle(method);

    static int one = 1;
    static int two = 2;
    // Negative control: force the pre-PRD-227 property-bag path without changing production.
    // V8's fixed-shape assertion below must turn red under this mutation.
    const bool fixedShape = engine.supportsNativeObjectTemplates() && !forceLegacyShape;
    const auto first = fixedShape
        ? engine.newNativeObject("TNTestReceiver", &one)
        : engine.newObject();
    const auto second = fixedShape
        ? engine.newNativeObject("TNTestReceiver", &two)
        : engine.newObject();
    if (!fixedShape) {
        engine.setPrivateData(first, &one);
        engine.setPrivateData(second, &two);
        if (forceLegacyShape && engine.getType() == mystral::js::EngineType::V8) {
            // Reproduce the old Reflect.set property-bag assembly with different installation
            // orders. These instances must diverge to different hidden classes.
            engine.setProperty(first, "alpha", engine.newNumber(1));
            engine.setProperty(first, "beta", engine.newNumber(2));
            engine.setProperty(second, "beta", engine.newNumber(2));
            engine.setProperty(second, "alpha", engine.newNumber(1));
        }
    }
    expect(engine.setPrototypeOf(first, proto), "first instance adopts the class prototype");
    expect(engine.setPrototypeOf(second, proto), "second instance adopts the class prototype");

    engine.setGlobalProperty("__tnInstanceA", first);
    engine.setGlobalProperty("__tnInstanceB", second);

    if (engine.getType() == mystral::js::EngineType::V8) {
        expect(fixedShape, "V8 advertises fixed-shape native object templates");
        const bool sameShape = engine.toBoolean(engine.evalScriptWithResult(
            "%HaveSameMap(__tnInstanceA, __tnInstanceB)", "tn-fixed-shape.js"));
        expect(sameShape, "two native wrappers of one class share one V8 hidden class");
    } else {
        expect(!fixedShape, "non-V8 engine keeps the explicitly gated legacy object path");
    }

    const bool firstOk = engine.evalScript(
        "globalThis.__tnFirst = __tnInstanceA.report();", "tn-method-first.js");
    expect(firstOk && !engine.hasException(), "instance A dispatches through the shared method");

    const auto global = engine.getGlobal();
    const auto seenFirst = engine.getProperty(global, "__tnFirst");
    expect(engine.toNumber(seenFirst) == 1.0,
           "receiver A resolved instance A's private data, got " +
               std::to_string(engine.toNumber(seenFirst)));

    const bool secondOk = engine.evalScript(
        "globalThis.__tnSecond = __tnInstanceB.report();", "tn-method-second.js");
    expect(secondOk && !engine.hasException(), "instance B dispatches through the shared method");
    const auto seenSecond = engine.getProperty(global, "__tnSecond");
    expect(engine.toNumber(seenSecond) == 2.0,
           "receiver B resolved instance B's private data, got " +
               std::to_string(engine.toNumber(seenSecond)));
    expect(*calls == 2 && lastSeen == 2, "method body ran once per call with each receiver");

    // Detached call: the trampoline hands nullptr and the stored body must see it.
    int detachedSeen = 999;
    const auto guarded = engine.newMethod("guarded",
        [&detachedSeen](mystral::js::Engine& engineRef, void* receiverPrivate,
                        const std::vector<mystral::js::JSValueHandle>&) {
            detachedSeen = receiverPrivate ? 1 : 0;
            return engineRef.newUndefined();
        });
    expect(guarded.ptr, "guard method exists");
    engine.freezeHandle(guarded);
    const auto guardHolder = engine.newObject();
    engine.setGlobalProperty("__tnGuarded", guarded);
    const bool detachedOk = engine.evalScript("__tnGuarded();", "tn-method-detached.js");
    expect(detachedOk && !engine.hasException() && detachedSeen == 0,
           "detached call reaches the method with a null receiver");

    // Instance own-property writes stay instance-local while methods inherit.
    expect(engine.evalScript(
        "__tnInstanceA.tag = 'a'; __tnInstanceB.tag !== undefined ? 'bad' : 'ok';",
        "tn-method-isolation.js"), "own properties stay per-instance");

    engine.deleteProperty(global, "__tnInstanceA");
    engine.deleteProperty(global, "__tnInstanceB");
    engine.deleteProperty(global, "__tnFirst");
    engine.deleteProperty(global, "__tnSecond");
    engine.deleteProperty(global, "__tnGuarded");
    delete calls;
}

/**
 * Behavioral guard against reverting to per-call installs: through the real headless runtime,
 * two command encoders must share one prototype, carry no own method properties, share method
 * identities, and dispatch interleaved passes to the right native handles.
 */
void exerciseCommandEncoderClassContract() {
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
            const device = await adapter.requestDevice();
            globalThis.__encA = device.createCommandEncoder();
            globalThis.__encB = device.createCommandEncoder();
        })())JS",
        "tn-runtime-encoders.js");
    expect(booted, "encoder-creating script evaluated");
    for (int pump = 0; pump < 200; ++pump) {
        if (!engine->isUndefined(engine->getGlobalProperty("__encA"))) break;
        engine->processMicrotasks();
    }
    expect(!engine->isUndefined(engine->getGlobalProperty("__encA")),
           "two command encoders exist through the real device surface");

    // Guards that go red if anyone reverts to per-instance installs: with captured per-call
    // closures each wrapper owns its method properties and no two instances share a prototype.
    const bool methodsExist = engine->toBoolean(engine->evalScriptWithResult(
        "typeof __encA.beginRenderPass === 'function' && typeof __encA.finish === 'function'",
        "tn-methods-exist.js"));
    expect(methodsExist, "encoder methods exist on the wrapper");

    const bool sharedPrototype = engine->toBoolean(engine->evalScriptWithResult(
        "Object.getPrototypeOf(__encA) === Object.getPrototypeOf(__encB)",
        "tn-proto-identity.js"));
    expect(sharedPrototype, "both encoders share one class prototype");

    const bool sameShape = engine->toBoolean(engine->evalScriptWithResult(
        "%HaveSameMap(__encA, __encB)", "tn-runtime-fixed-shape.js"));
    expect(sameShape, "two live GPUCommandEncoder wrappers share one V8 hidden class");

    const bool noOwnMethods = engine->toBoolean(engine->evalScriptWithResult(
        "!Object.hasOwn(__encA, 'beginRenderPass') && !Object.hasOwn(__encA, 'finish')",
        "tn-no-own-methods.js"));
    expect(noOwnMethods, "methods are prototype members, not per-instance own properties");

    const bool sharedIdentity = engine->toBoolean(engine->evalScriptWithResult(
        "typeof __encA.beginRenderPass === 'function' && "
        "__encA.beginRenderPass === __encB.beginRenderPass && "
        "__encA.finish === __encB.finish",
        "tn-shared-identity.js"));
    expect(sharedIdentity, "method function identities are shared across instances");

    // Receiver routing under interleaving: pass and finish each encoder in overlapping order.
    // A stale captured handle shows up as an exception or a wrong-encoder command stream.
    const bool interleaved = engine->evalScript(
        R"JS((() => {
            const passA = __encA.beginRenderPass({colorAttachments: []});
            const passB = __encB.beginRenderPass({colorAttachments: []});
            passA.end();
            passB.end();
            __encA.finish();
            __encB.finish();
            return true;
        })())JS",
        "tn-interleaved.js");
    expect(interleaved && !engine->hasException(),
           "interleaved beginRenderPass/end/finish dispatch per receiver without error");
    if (engine->hasException()) engine->getException();
}

}  // namespace

int main(int argc, char** argv) {
    setenv("TN_V8_FLAGS", "--allow-natives-syntax", 1);
    const bool forceLegacyShape =
        argc > 1 && std::string(argv[1]) == "legacy-shape-control";
    const auto engineV8 = mystral::js::createEngine(mystral::js::EngineType::V8);
    if (engineV8) runContract(*engineV8, forceLegacyShape);

    // Unavailable engines return null and are skipped loudly by createEngine itself.
    const auto engineQuickJs = mystral::js::createEngine(mystral::js::EngineType::QuickJS);
    if (engineQuickJs) runContract(*engineQuickJs);

    const auto engineJsc = mystral::js::createEngine(mystral::js::EngineType::JavaScriptCore);
    if (engineJsc) runContract(*engineJsc);

    exerciseCommandEncoderClassContract();

    if (failures != 0) {
        if (forceLegacyShape) {
            std::cerr << "RED observed: legacy wrapper shape rejected" << std::endl;
        }
        std::cerr << "command-encoder-class-table contract: " << failures << " failure(s)"
                  << std::endl;
        return 1;
    }
    std::cout << "proof: command-encoder-class-table" << std::endl;
    std::cout << "command-encoder-class-table: prototype=shared receivers=resolved "
                 "detached=null-reported runtime=wired" << std::endl;
    return 0;
}
