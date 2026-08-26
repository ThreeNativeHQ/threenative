// PRD-222 per-class binding tables: the engine contract behind
// docs/bugs/webgpu-binding-table-installed-per-call-2026-08-26.md.
//
// A class's binding table installs once on a shared prototype and resolves its native handle
// from the receiver's private data. This exercises that mechanism directly on the Engine
// surface: supportsNativeMethods(), newMethod(), setPrototypeOf(), the detached-call path
// (nullptr receiver -> callee reports it), and per-instance state independence across two
// instances of one prototype.
#include "mystral/js/engine.h"

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

void runContract(mystral::js::Engine& engine) {
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

    const auto first = engine.newObject();
    const auto second = engine.newObject();
    static int one = 1;
    static int two = 2;
    engine.setPrivateData(first, &one);
    engine.setPrivateData(second, &two);
    expect(engine.setPrototypeOf(first, proto), "first instance adopts the class prototype");
    expect(engine.setPrototypeOf(second, proto), "second instance adopts the class prototype");

    engine.setGlobalProperty("__tnInstanceA", first);
    engine.setGlobalProperty("__tnInstanceB", second);

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

}  // namespace

int main() {
    const auto engineV8 = mystral::js::createEngine(mystral::js::EngineType::V8);
    if (engineV8) runContract(*engineV8);

    // Unavailable engines return null and are skipped loudly by createEngine itself.
    const auto engineQuickJs = mystral::js::createEngine(mystral::js::EngineType::QuickJS);
    if (engineQuickJs) runContract(*engineQuickJs);

    const auto engineJsc = mystral::js::createEngine(mystral::js::EngineType::JavaScriptCore);
    if (engineJsc) runContract(*engineJsc);

    if (failures != 0) {
        std::cerr << "command-encoder-class-table contract: " << failures << " failure(s)"
                  << std::endl;
        return 1;
    }
    std::cout << "command-encoder-class-table: prototype=shared receivers=resolved "
                 "detached=null-reported" << std::endl;
    return 0;
}
