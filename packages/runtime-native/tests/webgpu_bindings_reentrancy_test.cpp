#include <iostream>
#include <vector>

#include "mystral/runtime.h"
#include "mystral/webgpu/registration_table.h"
#include "../src/webgpu/bindings_state.h"

namespace {

mystral::webgpu::BindingDestination atomicSecondDestination;
bool atomicProbePassed = false;

mystral::js::JSValueHandle tableProbe(
    mystral::webgpu::BindingsState* state,
    mystral::webgpu::BindingDestination,
    const std::vector<mystral::js::JSValueHandle>&) {
    return state->engine->newUndefined();
}

mystral::js::JSValueHandle atomicTableProbe(
    mystral::webgpu::BindingsState* state,
    mystral::webgpu::BindingDestination firstDestination,
    const std::vector<mystral::js::JSValueHandle>&) {
    auto* engine = state->engine;
    const auto mixedSurfaces = mystral::webgpu::bindingTable({
        {"TestSurface", "mixedFirst", 0, nullptr, &tableProbe, firstDestination},
        {"OtherSurface", "mixedSecond", 0, nullptr, &tableProbe, atomicSecondDestination},
    });
    if (mixedSurfaces.valid ||
        mystral::webgpu::installBindingTable(engine, state, mixedSurfaces) ||
        !engine->hasException()) {
        return engine->newUndefined();
    }
    engine->getException();
    if (!engine->isUndefined(engine->getProperty(firstDestination, "mixedFirst")) ||
        !engine->isUndefined(engine->getProperty(atomicSecondDestination, "mixedSecond"))) {
        return engine->newUndefined();
    }

    const auto invalidDestination = mystral::webgpu::bindingTable({
        {"TestSurface", "invalidFirst", 0, nullptr, &tableProbe, firstDestination},
        {"TestSurface", "invalidSecond", 0, nullptr, &tableProbe, {}},
    });
    if (invalidDestination.valid ||
        mystral::webgpu::installBindingTable(engine, state, invalidDestination) ||
        !engine->hasException()) {
        return engine->newUndefined();
    }
    engine->getException();
    atomicProbePassed =
        engine->isUndefined(engine->getProperty(firstDestination, "invalidFirst"));
    return engine->newUndefined();
}

bool checkRowOwnedAndAtomicInstall(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    struct FrameTrackingGuard {
        mystral::js::Engine* engine;
        ~FrameTrackingGuard() { engine->resumeFrameTracking(); }
    } frameTrackingGuard{engine};
    engine->suspendFrameTracking();
    if (!runtime.evalScript(
            "globalThis.__tnTableFirst = {}; globalThis.__tnTableSecond = {};",
            "webgpu-binding-row-ownership-setup.js")) {
        return false;
    }
    const auto firstDestination = engine->getGlobalProperty("__tnTableFirst");
    const auto secondDestination = engine->getGlobalProperty("__tnTableSecond");
    atomicSecondDestination = secondDestination;
    atomicProbePassed = false;

    const auto separateRows = mystral::webgpu::bindingTable({
        {"TestSurface", "first", 0, nullptr, &tableProbe, firstDestination},
        {"TestSurface", "second", 0, nullptr, &tableProbe, secondDestination},
        {"TestSurface", "trigger", 0, nullptr, &atomicTableProbe, firstDestination},
    });
    if (!separateRows.valid ||
        !mystral::webgpu::installBindingTable(engine, state, separateRows)) {
        return false;
    }
    if (!runtime.evalScript(
            "if (typeof __tnTableFirst.first !== 'function' || "
            "typeof __tnTableFirst.second !== 'undefined' || "
            "typeof __tnTableSecond.second !== 'function' || "
            "typeof __tnTableSecond.first !== 'undefined' || "
            "typeof __tnTableFirst.trigger !== 'function') "
            "throw new Error('binding row destination was copied'); "
            "__tnTableFirst.trigger();",
            "webgpu-binding-row-ownership.js")) {
        return false;
    }
    return atomicProbePassed;
}

bool checkAtomicRollbackAndDestinationValidation(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    const auto failed = [](const char* message) {
        std::cerr << "atomic binding proof failed: " << message << std::endl;
        return false;
    };
    struct FrameTrackingGuard {
        mystral::js::Engine* engine;
        ~FrameTrackingGuard() { engine->resumeFrameTracking(); }
    } frameTrackingGuard{engine};
    engine->suspendFrameTracking();

    if (!runtime.evalScript(
            "globalThis.__tnAtomicObject = {}; "
            "globalThis.__tnAtomicBlocked = {}; "
            "Object.defineProperty(__tnAtomicBlocked, 'blocked', "
            "{value: 'original', writable: false, configurable: false});",
            "webgpu-binding-atomic-rollback-setup.js")) {
        return failed("setup");
    }

    const auto objectDestination = engine->getGlobalProperty("__tnAtomicObject");
    const auto blockedDestination = engine->getGlobalProperty("__tnAtomicBlocked");
    const auto nonObjectDestination = engine->newNumber(7);

    if (!engine->setProperty(
            objectDestination, "existing", engine->newString("before"))) {
        return failed("initial property write");
    }

    const auto nonWritableTable = mystral::webgpu::bindingTable({
        {"TestSurface", "existing", 0, nullptr, &tableProbe, objectDestination},
        {"TestSurface", "newRow", 0, nullptr, &tableProbe, objectDestination},
        {"TestSurface", "blocked", 0, nullptr, &tableProbe, blockedDestination},
    });
    if (!nonWritableTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, nonWritableTable) ||
        !engine->hasException()) {
        return failed("non-writable install did not fail");
    }
    engine->getException();
    if (!engine->hasProperty(objectDestination, "existing") ||
        engine->toString(engine->getProperty(objectDestination, "existing")) != "before" ||
        engine->hasProperty(objectDestination, "newRow") ||
        !engine->hasProperty(blockedDestination, "blocked") ||
        engine->toString(engine->getProperty(blockedDestination, "blocked")) != "original" ||
        engine->isFunction(engine->getProperty(blockedDestination, "blocked"))) {
        return failed("non-writable rollback state");
    }

    const auto nonObjectTable = mystral::webgpu::bindingTable({
        {"TestSurface", "nonObjectEarlier", 0, nullptr, &tableProbe, objectDestination},
        {"TestSurface", "nonObjectFailure", 0, nullptr, &tableProbe, nonObjectDestination},
    });
    if (!nonObjectTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, nonObjectTable) ||
        !engine->hasException()) {
        return failed("non-object install did not fail");
    }
    engine->getException();
    return !engine->hasProperty(objectDestination, "nonObjectEarlier") &&
           !engine->hasProperty(objectDestination, "nonObjectFailure");
}

bool checkDynamicCanvasOwnership(mystral::Runtime& runtime) {
    return runtime.evalScript(R"JS((() => {
        const first = document.createElement("canvas");
        const second = document.createElement("canvas");
        first.id = "dynamic-first";
        second.id = "dynamic-second";
        const firstContext = first.getContext("2d");
        const secondContext = second.getContext("2d");
        if (!firstContext || !secondContext || firstContext === secondContext) {
            throw new Error("dynamic canvases did not get distinct native contexts");
        }

        // Both the public DOM id and the exposed native-id diagnostic are mutable. The binding
        // must retain the native id captured when each row was installed.
        first.id = second.id;
        first._offscreenCanvasId = second._offscreenCanvasId;
        const firstAfterMutation = first.getContext("2d");
        const secondAfterMutation = second.getContext("2d");
        if (firstAfterMutation !== firstContext || secondAfterMutation !== secondContext ||
            firstAfterMutation === secondAfterMutation) {
            throw new Error("dynamic canvas getContext followed a mutable public id");
        }
    })())JS", "webgpu-binding-dynamic-canvas.js");
}

bool runProbe(mystral::Runtime& runtime, const char* marker) {
    const std::string script = std::string(R"JS((() => {
        const adapter = navigator.gpu.requestAdapter();
        if (!adapter || typeof adapter.requestDevice !== "function") {
            throw new Error("WebGPU adapter registration missing");
        }
        const device = adapter.requestDevice();
        if (!device || typeof device.createBuffer !== "function") {
            throw new Error("WebGPU device registration missing");
        }
        globalThis.__tnReentrancyMarker = ")JS") + marker + R"JS(";
        globalThis.__tnReentrancyFormat = navigator.gpu.getPreferredCanvasFormat();
        globalThis.__tnReentrancyBuffer = device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.COPY_DST,
        });
    })())JS";
    if (!runtime.evalScript(script, "webgpu-bindings-reentrancy.js")) return false;
    return runtime.evalScript(
        "if (__tnReentrancyMarker !== '" + std::string(marker) +
            "' || typeof __tnReentrancyFormat !== 'string' || !__tnReentrancyBuffer) "
            "throw new Error('binding state was aliased');",
        "webgpu-bindings-reentrancy-check.js");
}

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto first = mystral::Runtime::create(config);
    auto second = mystral::Runtime::create(config);
    if (!first || !second || !first->getWebGPUBindingsState() || !second->getWebGPUBindingsState() ||
        first->getWebGPUBindingsState() == second->getWebGPUBindingsState()) {
        return 1;
    }

    if (!checkRowOwnedAndAtomicInstall(*first)) return 1;
    if (!checkAtomicRollbackAndDestinationValidation(*first)) return 1;
    if (!checkDynamicCanvasOwnership(*first)) return 1;

    if (!runProbe(*first, "first") || !runProbe(*second, "second") ||
        !first->evalScript(
            "if (__tnReentrancyMarker !== 'first') throw new Error('first binding state changed');",
            "webgpu-bindings-reentrancy-first-check.js") ||
        !second->evalScript(
            "if (__tnReentrancyMarker !== 'second') throw new Error('second binding state changed');",
            "webgpu-bindings-reentrancy-second-check.js")) {
        return 1;
    }

    std::cout << "native WebGPU bindings reentrancy passed" << std::endl;
    return 0;
}
