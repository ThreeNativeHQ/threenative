#include <iostream>
#include <vector>

#include "mystral/runtime.h"
#include "mystral/webgpu/registration_table.h"
#include "../src/webgpu/bindings_state.h"

namespace {

mystral::webgpu::BindingDestination atomicSecondDestination;
bool atomicProbePassed = false;
int teardownProbeCalls = 0;

mystral::js::JSValueHandle tableProbe(
    mystral::webgpu::BindingsState* state,
    mystral::webgpu::BindingDestination,
    const std::vector<mystral::js::JSValueHandle>&) {
    return state->engine->newUndefined();
}

mystral::js::JSValueHandle teardownProbe(
    mystral::webgpu::BindingsState*,
    mystral::webgpu::BindingDestination,
    const std::vector<mystral::js::JSValueHandle>&) {
    // installBindingTable's dispatch closure still captures the BindingsState. Avoid dereferencing
    // it here so the regression reports a deterministic call count instead of relying on a UAF
    // crash after Runtime has deleted that state.
    ++teardownProbeCalls;
    return {};
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

bool checkWholeTableVerification(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(
        runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    const auto failed = [](const char* message) {
        std::cerr << "whole-table binding proof failed: " << message << std::endl;
        return false;
    };
    struct FrameTrackingGuard {
        mystral::js::Engine* engine;
        ~FrameTrackingGuard() { engine->resumeFrameTracking(); }
    } frameTrackingGuard{engine};
    engine->suspendFrameTracking();

    if (!runtime.evalScript(R"JS((() => {
        globalThis.__tnCrossRowFirst = { first: "first-original" };
        globalThis.__tnCrossRowSecondTarget = {};
        globalThis.__tnCrossRowSecondProxy = new Proxy(__tnCrossRowSecondTarget, {
            set(target, property, value) {
                Reflect.set(target, property, value);
                delete __tnCrossRowFirst.first;
                return true;
            },
        });

        globalThis.__tnRollbackOrderFirstTarget = { first: "rollback-first-original" };
        globalThis.__tnRollbackOrderSecondTarget = {};
        globalThis.__tnRollbackOrderFirstProxy = new Proxy(__tnRollbackOrderFirstTarget, {
            set(target, property, value) {
                Reflect.set(target, property, value);
                if (typeof value !== "function") {
                    __tnRollbackOrderSecondTarget.second = "rollback-order-corruption";
                }
                return true;
            },
        });
        globalThis.__tnRollbackOrderSecondProxy = new Proxy(__tnRollbackOrderSecondTarget, {
            set(target, property, value) {
                Reflect.set(target, property, value);
                throw new Error("controlled cross-row rollback failure");
            },
        });
    })())JS", "webgpu-binding-whole-table-setup.js")) {
        return failed("setup");
    }

    const auto first = engine->getGlobalProperty("__tnCrossRowFirst");
    const auto second = engine->getGlobalProperty("__tnCrossRowSecondProxy");
    const auto table = mystral::webgpu::bindingTable({
        {"TestSurface", "first", 0, nullptr, &tableProbe, first},
        {"TestSurface", "second", 0, nullptr, &tableProbe, second},
    });
    if (!table.valid || mystral::webgpu::installBindingTable(engine, state, table) ||
        !engine->hasException()) {
        return failed("a later row deleted an earlier verified row without failing");
    }
    engine->getException();
    if (!runtime.evalScript(R"JS((() => {
        const firstDescriptor = Object.getOwnPropertyDescriptor(__tnCrossRowFirst, "first");
        if (firstDescriptor === undefined || firstDescriptor.value !== "first-original") {
            throw new Error("the earlier row snapshot was not restored");
        }
        if (Object.prototype.hasOwnProperty.call(__tnCrossRowSecondTarget, "second")) {
            throw new Error("the later row survived rollback");
        }
    })())JS", "webgpu-binding-whole-table-check.js")) {
        return failed("whole-table rollback state");
    }

    const auto rollbackFirst = engine->getGlobalProperty("__tnRollbackOrderFirstProxy");
    const auto rollbackSecond = engine->getGlobalProperty("__tnRollbackOrderSecondProxy");
    const auto rollbackOrderTable = mystral::webgpu::bindingTable({
        {"TestSurface", "first", 0, nullptr, &tableProbe, rollbackFirst},
        {"TestSurface", "second", 0, nullptr, &tableProbe, rollbackSecond},
    });
    if (!rollbackOrderTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, rollbackOrderTable) ||
        !engine->hasException()) {
        return failed("cross-row rollback corruption was not rejected");
    }
    const auto rollbackMessage = engine->getException();
    if (rollbackMessage.find("binding-table rollback was incomplete") == std::string::npos ||
        !runtime.evalScript(R"JS((() => {
            if (__tnRollbackOrderFirstTarget.first !== "rollback-first-original") {
                throw new Error("the first rollback snapshot was not restored");
            }
            if (__tnRollbackOrderSecondTarget.second !== "rollback-order-corruption") {
                throw new Error("the rollback-order corruption control did not survive");
            }
        })())JS", "webgpu-binding-rollback-order-check.js")) {
        return failed("whole-table final rollback verification");
    }
    return true;
}

bool checkPropertyDescriptorAndExceptionControls(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    const auto failed = [](const char* message) {
        std::cerr << "property binding proof failed: " << message << std::endl;
        return false;
    };
    struct FrameTrackingGuard {
        mystral::js::Engine* engine;
        ~FrameTrackingGuard() { engine->resumeFrameTracking(); }
    } frameTrackingGuard{engine};
    engine->suspendFrameTracking();

    if (!runtime.evalScript(R"JS((() => {
        const prototype = { inheritedData: "inherited-original" };
        globalThis.__tnInheritedRollbackTarget = Object.create(prototype);
        globalThis.__tnRollbackProxy = new Proxy({}, {
            set(target, property, value) {
                if (property === "fail") throw new Error("controlled set failure");
                return Reflect.set(target, property, value);
            },
        });
        const silentPrototype = { silent: "inherited-silent" };
        globalThis.__tnSilentProxy = new Proxy(Object.create(silentPrototype), {
            set() {
                return true;
            },
        });
        globalThis.__tnFalseSetTarget = {};
        globalThis.__tnFalseSetProxy = new Proxy(__tnFalseSetTarget, {
            set(target, property, value) {
                Reflect.set(target, property, value);
                return false;
            },
        });
        globalThis.__tnAttributeTarget = {};
        Object.defineProperty(__tnAttributeTarget, "attributes", {
            configurable: true,
            enumerable: false,
            value: "attribute-original",
            writable: true,
        });
        globalThis.__tnAttributeProxy = new Proxy(__tnAttributeTarget, {
            set(target, property, value) {
                Object.defineProperty(target, property, {
                    configurable: false,
                    enumerable: true,
                    value,
                    writable: true,
                });
                return true;
            },
        });

        globalThis.__tnPartialWriteTarget = {};
        globalThis.__tnPartialWriteProxy = new Proxy(__tnPartialWriteTarget, {
            set(target, property, value) {
                Object.defineProperty(target, property, {
                    configurable: true,
                    enumerable: true,
                    value,
                    writable: true,
                });
                throw new Error("controlled partial write failure");
            },
        });
        globalThis.__tnDishonestDeleteTarget = {};
        globalThis.__tnDishonestDeleteProxy = new Proxy(__tnDishonestDeleteTarget, {
            set(target, property, value) {
                Object.defineProperty(target, property, {
                    configurable: true,
                    enumerable: true,
                    value,
                    writable: true,
                });
                if (property === "partial") {
                    throw new Error("controlled dishonest partial write failure");
                }
                return true;
            },
            deleteProperty() {
                return true;
            },
        });
        globalThis.__tnDishonestRestoreTarget = { restore: "restore-original" };
        globalThis.__tnDishonestRestoreProxy = new Proxy(__tnDishonestRestoreTarget, {
            set(target, property, value) {
                if (typeof value === "function") {
                    target[property] = value;
                }
                return true;
            },
        });

        globalThis.__tnAccessorSetterCalls = 0;
        globalThis.__tnAccessorGetterCalls = 0;
        globalThis.__tnAccessorTarget = {};
        Object.defineProperty(__tnAccessorTarget, "ownAccessor", {
            configurable: true,
            get() {
                __tnAccessorGetterCalls += 1;
                return "accessor-value";
            },
            set() {
                __tnAccessorSetterCalls += 1;
            },
        });
        const setterPrototype = {};
        Object.defineProperty(setterPrototype, "inheritedSetter", {
            configurable: true,
            set() {
                __tnAccessorSetterCalls += 1;
            },
        });
        globalThis.__tnPrototypeTrapCalls = 0;
        globalThis.__tnInheritedSetterTarget = new Proxy({}, {
            getPrototypeOf() {
                __tnPrototypeTrapCalls += 1;
                return setterPrototype;
            },
        });
        const readonlyPrototype = {};
        Object.defineProperty(readonlyPrototype, "inheritedReadonly", {
            configurable: true,
            value: "readonly-original",
            writable: false,
        });
        globalThis.__tnInheritedReadonlyTarget = new Proxy({}, {
            getPrototypeOf() {
                __tnPrototypeTrapCalls += 1;
                return readonlyPrototype;
            },
        });
        globalThis.__tnThrowingPrototypeTarget = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("controlled getPrototypeOf failure");
            },
        });
        globalThis.__tnSelfPrototypeTrapCalls = 0;
        let selfPrototypeCycle;
        selfPrototypeCycle = new Proxy({}, {
            getPrototypeOf() {
                __tnSelfPrototypeTrapCalls += 1;
                if (__tnSelfPrototypeTrapCalls > 64) {
                    throw new Error("controlled self traversal exhaustion");
                }
                return selfPrototypeCycle;
            },
        });
        globalThis.__tnSelfPrototypeCycle = selfPrototypeCycle;
        globalThis.__tnMultiPrototypeTrapCalls = 0;
        let firstPrototypeCycle;
        let secondPrototypeCycle;
        firstPrototypeCycle = new Proxy({}, {
            getPrototypeOf() {
                __tnMultiPrototypeTrapCalls += 1;
                if (__tnMultiPrototypeTrapCalls > 64) {
                    throw new Error("controlled multi traversal exhaustion");
                }
                return secondPrototypeCycle;
            },
        });
        secondPrototypeCycle = new Proxy({}, {
            getPrototypeOf() {
                __tnMultiPrototypeTrapCalls += 1;
                if (__tnMultiPrototypeTrapCalls > 64) {
                    throw new Error("controlled multi traversal exhaustion");
                }
                return firstPrototypeCycle;
            },
        });
        globalThis.__tnMultiPrototypeCycle = firstPrototypeCycle;
        globalThis.__tnAccessorEarlier = {};
        globalThis.__tnReadonlyEarlier = {};
    })())JS", "webgpu-binding-property-controls-setup.js")) {
        return failed("setup");
    }

    const auto inheritedTarget = engine->getGlobalProperty("__tnInheritedRollbackTarget");
    const auto rollbackProxy = engine->getGlobalProperty("__tnRollbackProxy");
    const auto silentProxy = engine->getGlobalProperty("__tnSilentProxy");
    const auto falseSetProxy = engine->getGlobalProperty("__tnFalseSetProxy");
    const auto attributeProxy = engine->getGlobalProperty("__tnAttributeProxy");
    const auto partialWriteProxy = engine->getGlobalProperty("__tnPartialWriteProxy");
    const auto dishonestDeleteProxy = engine->getGlobalProperty("__tnDishonestDeleteProxy");
    const auto dishonestRestoreProxy = engine->getGlobalProperty("__tnDishonestRestoreProxy");
    const auto accessorTarget = engine->getGlobalProperty("__tnAccessorTarget");
    const auto inheritedSetterTarget = engine->getGlobalProperty("__tnInheritedSetterTarget");
    const auto inheritedReadonlyTarget =
        engine->getGlobalProperty("__tnInheritedReadonlyTarget");
    const auto throwingPrototypeTarget =
        engine->getGlobalProperty("__tnThrowingPrototypeTarget");
    const auto selfPrototypeCycle = engine->getGlobalProperty("__tnSelfPrototypeCycle");
    const auto multiPrototypeCycle = engine->getGlobalProperty("__tnMultiPrototypeCycle");
    const auto accessorEarlier = engine->getGlobalProperty("__tnAccessorEarlier");
    const auto readonlyEarlier = engine->getGlobalProperty("__tnReadonlyEarlier");

    const auto rollbackTable = mystral::webgpu::bindingTable({
        {"TestSurface", "inheritedData", 0, nullptr, &tableProbe, inheritedTarget},
        {"TestSurface", "fail", 0, nullptr, &tableProbe, rollbackProxy},
    });
    if (!rollbackTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, rollbackTable) ||
        !engine->hasException()) {
        return failed("inherited-data rollback did not fail closed");
    }
    engine->getException();
    if (!runtime.evalScript(
            "if (Object.prototype.hasOwnProperty.call(__tnInheritedRollbackTarget, 'inheritedData')) "
            "throw new Error('inherited data became an own property after rollback'); "
            "if (__tnInheritedRollbackTarget.inheritedData !== 'inherited-original') "
            "throw new Error('inherited data lookup changed after rollback');",
            "webgpu-binding-inherited-rollback-check.js")) {
        return failed("inherited-data rollback state");
    }

    const auto silentTable = mystral::webgpu::bindingTable({
        {"TestSurface", "silent", 0, nullptr, &tableProbe, silentProxy},
    });
    if (!silentTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, silentTable) ||
        !engine->hasException()) {
        return failed("silent proxy setter was accepted without an own binding");
    }
    engine->getException();
    if (!runtime.evalScript(
            "if (Object.prototype.hasOwnProperty.call(__tnSilentProxy, 'silent')) "
            "throw new Error('silent proxy acquired an own binding'); "
            "if (__tnSilentProxy.silent !== 'inherited-silent') "
            "throw new Error('silent proxy inherited lookup changed');",
            "webgpu-binding-silent-setter-check.js")) {
        return failed("silent proxy rollback state");
    }

    const auto falseSetTable = mystral::webgpu::bindingTable({
        {"TestSurface", "falseWrite", 0, nullptr, &tableProbe, falseSetProxy},
    });
    if (!falseSetTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, falseSetTable) ||
        !engine->hasException()) {
        return failed("false-returning mutating proxy setter was accepted");
    }
    engine->getException();
    if (!runtime.evalScript(
            "if (Object.prototype.hasOwnProperty.call(__tnFalseSetTarget, 'falseWrite')) "
            "throw new Error('false-returning proxy mutation survived rollback');",
            "webgpu-binding-false-set-check.js")) {
        return failed("false-returning proxy rollback state");
    }

    const auto attributeTable = mystral::webgpu::bindingTable({
        {"TestSurface", "attributes", 0, nullptr, &tableProbe, attributeProxy},
    });
    if (!attributeTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, attributeTable) ||
        !engine->hasException()) {
        return failed("attribute-corrupting proxy setter was accepted");
    }
    const auto attributeMessage = engine->getException();
    if (attributeMessage.find("rollback") == std::string::npos ||
        !runtime.evalScript(R"JS((() => {
            const descriptor = Object.getOwnPropertyDescriptor(
                __tnAttributeTarget, "attributes");
            if (descriptor.value !== "attribute-original" || descriptor.enumerable !== true ||
                descriptor.configurable !== false || descriptor.writable !== true) {
                throw new Error("attribute-corruption control did not retain the expected mutation");
            }
        })())JS", "webgpu-binding-attribute-corruption-check.js")) {
        return failed("attribute-corrupting rollback failure was not reported");
    }

    const auto partialWriteTable = mystral::webgpu::bindingTable({
        {"TestSurface", "partial", 0, nullptr, &tableProbe, partialWriteProxy},
    });
    if (!partialWriteTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, partialWriteTable) ||
        !engine->hasException()) {
        return failed("partial proxy write did not fail closed");
    }
    engine->getException();
    if (!runtime.evalScript(
            "if (Object.prototype.hasOwnProperty.call(__tnPartialWriteTarget, 'partial')) "
            "throw new Error('partial proxy write survived rollback');",
            "webgpu-binding-partial-write-check.js")) {
        return failed("partial proxy write rollback state");
    }

    const auto dishonestDeleteTable = mystral::webgpu::bindingTable({
        {"TestSurface", "partial", 0, nullptr, &tableProbe, dishonestDeleteProxy},
    });
    if (!dishonestDeleteTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, dishonestDeleteTable) ||
        !engine->hasException()) {
        return failed("dishonest delete proxy did not fail closed");
    }
    const auto dishonestDeleteMessage = engine->getException();
    if (dishonestDeleteMessage.find("rollback") == std::string::npos ||
        !runtime.evalScript(
            "if (!Object.prototype.hasOwnProperty.call(__tnDishonestDeleteTarget, 'partial')) "
            "throw new Error('dishonest delete control did not retain its mutation');",
            "webgpu-binding-dishonest-delete-check.js")) {
        return failed("dishonest delete rollback failure was not reported");
    }

    const auto dishonestRestoreTable = mystral::webgpu::bindingTable({
        {"TestSurface", "restore", 0, nullptr, &tableProbe, dishonestRestoreProxy},
        {"TestSurface", "fail", 0, nullptr, &tableProbe, rollbackProxy},
    });
    if (!dishonestRestoreTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, dishonestRestoreTable) ||
        !engine->hasException()) {
        return failed("dishonest restore proxy did not fail closed");
    }
    const auto dishonestRestoreMessage = engine->getException();
    if (dishonestRestoreMessage.find("rollback") == std::string::npos ||
        !runtime.evalScript(
            "if (typeof __tnDishonestRestoreTarget.restore !== 'function') "
            "throw new Error('dishonest restore control unexpectedly restored its value');",
            "webgpu-binding-dishonest-restore-check.js")) {
        return failed("dishonest restore rollback failure was not reported");
    }

    const auto accessorTable = mystral::webgpu::bindingTable({
        {"TestSurface", "earlier", 0, nullptr, &tableProbe, accessorEarlier},
        {"TestSurface", "ownAccessor", 0, nullptr, &tableProbe, accessorTarget},
        {"TestSurface", "inheritedSetter", 0, nullptr, &tableProbe, inheritedSetterTarget},
    });
    if (!accessorTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, accessorTable) ||
        !engine->hasException()) {
        return failed("accessor preflight did not fail closed");
    }
    engine->getException();
    if (!runtime.evalScript(R"JS((() => {
        const own = Object.getOwnPropertyDescriptor(__tnAccessorTarget, "ownAccessor");
        const inherited = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(__tnInheritedSetterTarget), "inheritedSetter");
        if (own === undefined || typeof own.get !== "function" || typeof own.set !== "function") {
            throw new Error("own accessor descriptor changed");
        }
        if (inherited === undefined || typeof inherited.set !== "function") {
            throw new Error("inherited setter descriptor changed");
        }
        if (__tnAccessorSetterCalls !== 0 || __tnAccessorGetterCalls !== 0) {
            throw new Error("accessor getter or setter ran during preflight");
        }
        if (Object.prototype.hasOwnProperty.call(__tnAccessorEarlier, "earlier")) {
            throw new Error("an earlier row survived accessor rejection");
        }
    })())JS", "webgpu-binding-accessor-check.js")) {
        return failed("accessor rollback state");
    }

    const auto inheritedAccessorTable = mystral::webgpu::bindingTable({
        {"TestSurface", "earlier", 0, nullptr, &tableProbe, accessorEarlier},
        {"TestSurface", "inheritedSetter", 0, nullptr, &tableProbe, inheritedSetterTarget},
    });
    if (!inheritedAccessorTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, inheritedAccessorTable) ||
        !engine->hasException()) {
        return failed("proxied inherited accessor preflight did not fail closed");
    }
    engine->getException();

    const auto inheritedReadonlyTable = mystral::webgpu::bindingTable({
        {"TestSurface", "earlier", 0, nullptr, &tableProbe, readonlyEarlier},
        {"TestSurface", "inheritedReadonly", 0, nullptr, &tableProbe, inheritedReadonlyTarget},
    });
    if (!inheritedReadonlyTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, inheritedReadonlyTable) ||
        !engine->hasException()) {
        return failed("proxied inherited non-writable preflight did not fail closed");
    }
    engine->getException();
    if (!runtime.evalScript(
            "if (__tnPrototypeTrapCalls < 2) "
            "throw new Error('getPrototypeOf traps did not run during descriptor traversal'); "
            "if (Object.prototype.hasOwnProperty.call(__tnAccessorEarlier, 'earlier') || "
            "Object.prototype.hasOwnProperty.call(__tnReadonlyEarlier, 'earlier')) "
            "throw new Error('proxied prototype preflight wrote an earlier row');",
            "webgpu-binding-prototype-trap-check.js")) {
        return failed("proxied prototype preflight state");
    }

    const auto throwingPrototypeTable = mystral::webgpu::bindingTable({
        {"TestSurface", "missing", 0, nullptr, &tableProbe, throwingPrototypeTarget},
    });
    if (!throwingPrototypeTable.valid ||
        mystral::webgpu::installBindingTable(engine, state, throwingPrototypeTable) ||
        !engine->hasException()) {
        return failed("throwing getPrototypeOf trap was not latched");
    }
    if (engine->getException().find("getPrototypeOf") == std::string::npos) {
        return failed("throwing getPrototypeOf exception was not retained");
    }

    const auto expectPrototypeCycleFailure = [&](const char* label,
                                                 mystral::js::JSValueHandle destination) {
        const auto table = mystral::webgpu::bindingTable({
            {"TestSurface", "missing", 0, nullptr, &tableProbe, destination},
        });
        if (!table.valid || mystral::webgpu::installBindingTable(engine, state, table) ||
            !engine->hasException()) {
            return failed(label);
        }
        const auto message = engine->getException();
        if (message.find("detected a cycle") == std::string::npos) {
            return failed(label);
        }
        return true;
    };
    if (!expectPrototypeCycleFailure(
            "self prototype cycle was not detected", selfPrototypeCycle) ||
        !expectPrototypeCycleFailure(
            "multi-proxy prototype cycle was not detected", multiPrototypeCycle) ||
        !runtime.evalScript(
            "if (__tnSelfPrototypeTrapCalls > 2 || __tnMultiPrototypeTrapCalls > 3) "
            "throw new Error('prototype cycle traversal was not bounded');",
            "webgpu-binding-prototype-cycle-check.js")) {
        return failed("prototype cycle controls");
    }

    if (!runtime.evalScript(
            "const __tnRevoked = Proxy.revocable({}, {}); "
            "globalThis.__tnRevokedProperty = __tnRevoked.proxy; "
            "__tnRevoked.revoke();",
            "webgpu-binding-exception-controls-setup.js")) {
        return failed("exception-control setup");
    }
    const auto revoked = engine->getGlobalProperty("__tnRevokedProperty");
    const auto getResult = engine->getProperty(revoked, "missing");
    if ((getResult.ptr != nullptr && !engine->isUndefined(getResult)) ||
        !engine->hasException()) {
        return failed("getProperty did not return safely and latch a revoked-proxy exception");
    }
    const auto getMessage = engine->getException();
    if (getMessage.empty()) return failed("getProperty exception was empty");
    if (engine->hasProperty(revoked, "missing") || !engine->hasException()) {
        return failed("hasProperty did not latch a revoked-proxy exception");
    }
    const auto hasMessage = engine->getException();
    if (hasMessage.empty()) return failed("hasProperty exception was empty");
    if (engine->deleteProperty(revoked, "missing") || !engine->hasException()) {
        return failed("deleteProperty did not latch a revoked-proxy exception");
    }
    const auto deleteMessage = engine->getException();
    if (deleteMessage.empty()) return failed("deleteProperty exception was empty");
    if (engine->setProperty(revoked, "missing", engine->newNumber(1)) ||
        !engine->hasException()) {
        return failed("setProperty did not latch a revoked-proxy exception");
    }
    engine->gc();
    engine->gc();
    return !engine->getException().empty();
}

bool queueQuickJSTeardownProbe(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(
        runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    if (engine->getType() != mystral::js::EngineType::QuickJS) return true;

    if (!runtime.evalScript(R"JS((() => {
        globalThis.__tnTeardownQueueProxy = new Proxy({}, {
            set(target, property, value) {
                Reflect.set(target, property, value);
                Promise.resolve().then(() => value());
                return true;
            },
        });
    })())JS", "webgpu-binding-teardown-queue-setup.js")) {
        return false;
    }
    const auto destination = engine->getGlobalProperty("__tnTeardownQueueProxy");
    const auto table = mystral::webgpu::bindingTable({
        {"TestSurface", "queuedAtTeardown", 0, nullptr, &teardownProbe, destination},
    });
    teardownProbeCalls = 0;
    return table.valid && mystral::webgpu::installBindingTable(engine, state, table) &&
           teardownProbeCalls == 0;
}

bool checkQuickJSExceptionReplacement(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(
        runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    if (engine->getType() != mystral::js::EngineType::QuickJS) return true;

    if (engine->evalWithResult(
            "const =",
            "quickjs-first-unconsumed.js").ptr != nullptr ||
        !engine->hasException()) {
        std::cerr << "QuickJS did not retain the first exception" << std::endl;
        return false;
    }
    if (engine->evalScriptWithResult(
            "throw new Error('quickjs-second-unconsumed')",
            "quickjs-second-unconsumed.js").ptr != nullptr ||
        !engine->hasException()) {
        std::cerr << "QuickJS did not replace the first exception" << std::endl;
        return false;
    }
    const auto secondMessage = engine->getException();
    if (secondMessage.find("quickjs-second-unconsumed") == std::string::npos) {
        std::cerr << "QuickJS returned the wrong replacement exception" << std::endl;
        return false;
    }

    const auto thrower = engine->evalScriptWithResult(
        "(() => { throw new Error('quickjs-call-unconsumed'); })",
        "quickjs-call-unconsumed-setup.js");
    if (!thrower.ptr) return false;
    engine->protect(thrower);
    engine->throwException("quickjs-prior-unconsumed");
    const auto callResult = engine->call(thrower, {}, {});
    engine->unprotect(thrower);
    if (callResult.ptr != nullptr || !engine->hasException() ||
        engine->getException().find("quickjs-call-unconsumed") == std::string::npos) {
        std::cerr << "QuickJS call did not replace an unconsumed exception" << std::endl;
        return false;
    }
    return true;
}

bool leaveQuickJSOutstandingException(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(
        runtime.getWebGPUBindingsState());
    auto* engine = state->engine;
    if (engine->getType() != mystral::js::EngineType::QuickJS) return true;

    if (engine->evalWithResult(
            "const =",
            "quickjs-outstanding-at-teardown.js").ptr != nullptr ||
        !engine->hasException()) {
        std::cerr << "QuickJS teardown exception was not left outstanding" << std::endl;
        return false;
    }
    return true;
}

bool checkDynamicCanvasOwnership(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime.getWebGPUBindingsState());
    const size_t protectedBefore = state->protectedHandles.size();
    const size_t nativeContextsBefore = state->canvas2DContexts.size();
    if (!runtime.evalScript(R"JS((() => {
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
    })())JS", "webgpu-binding-dynamic-canvas.js")) {
        return false;
    }
    if (state->protectedHandles.size() != protectedBefore + 4) {
        std::cerr << "binding protection proof failed: each dynamic canvas and context must be "
                     "state-owned exactly once"
                  << std::endl;
        return false;
    }
    if (state->canvas2DContexts.size() != nativeContextsBefore + 2) {
        std::cerr << "binding protection proof failed: native Canvas2D contexts were not "
                     "state-owned"
                  << std::endl;
        return false;
    }
    return true;
}

bool checkBindingProtectionOwnership(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime.getWebGPUBindingsState());
    if (state->protectedHandles.size() < 4) {
        std::cerr << "binding protection proof failed: dynamic handles were not state-owned"
                  << std::endl;
        return false;
    }
    return true;
}

bool createEngineLocalCanvasContext(mystral::Runtime& runtime, const char* filename) {
    return runtime.evalScript(R"JS((() => {
        const canvas = document.createElement("canvas");
        globalThis.__tnEngineLocalCanvasContext = canvas.getContext("2d");
        if (!__tnEngineLocalCanvasContext) {
            throw new Error("engine-local Canvas2D context was not created");
        }
    })())JS", filename);
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
    if (!checkWholeTableVerification(*first)) return 1;
    if (!checkPropertyDescriptorAndExceptionControls(*first)) return 1;
    if (!checkDynamicCanvasOwnership(*first)) return 1;
    if (!checkBindingProtectionOwnership(*first)) return 1;

    // Create the second engine's context first so the first engine is the last creator. A
    // process-global callback engine would dangle when the first runtime is destroyed below.
    if (!createEngineLocalCanvasContext(*second, "webgpu-binding-second-canvas.js") ||
        !createEngineLocalCanvasContext(*first, "webgpu-binding-first-canvas.js")) {
        return 1;
    }

    if (!runProbe(*first, "first") || !runProbe(*second, "second") ||
        !first->evalScript(
            "if (__tnReentrancyMarker !== 'first') throw new Error('first binding state changed');",
            "webgpu-bindings-reentrancy-first-check.js") ||
        !second->evalScript(
            "if (__tnReentrancyMarker !== 'second') throw new Error('second binding state changed');",
            "webgpu-bindings-reentrancy-second-check.js")) {
        return 1;
    }

    if (!checkQuickJSExceptionReplacement(*first) ||
        !queueQuickJSTeardownProbe(*first) ||
        !leaveQuickJSOutstandingException(*first)) {
        return 1;
    }

    first.reset();
    if (teardownProbeCalls != 0) {
        std::cerr << "queued QuickJS callback executed during runtime teardown" << std::endl;
        return 1;
    }
    if (!second->evalScript(
            "if (__tnReentrancyMarker !== 'second') throw new Error('second engine lost state'); "
            "__tnEngineLocalCanvasContext.fillRect(0, 0, 1, 1); "
            "if (typeof __tnEngineLocalCanvasContext.measureText('x').width !== 'number') "
            "throw new Error('second engine Canvas2D callback lost its owning engine');",
            "webgpu-bindings-reentrancy-after-first-destroy.js")) {
        return 1;
    }

    auto replacement = mystral::Runtime::create(config);
    if (!replacement || !replacement->getWebGPUBindingsState() ||
        !createEngineLocalCanvasContext(
            *replacement, "webgpu-binding-replacement-canvas.js") ||
        !runProbe(*replacement, "replacement") ||
        !replacement->evalScript(
            "__tnEngineLocalCanvasContext.fillRect(0, 0, 1, 1);",
            "webgpu-binding-replacement-callback.js")) {
        return 1;
    }
    replacement.reset();
    if (!second->evalScript(
            "__tnEngineLocalCanvasContext.fillRect(0, 0, 1, 1); "
            "if (__tnReentrancyMarker !== 'second') "
            "throw new Error('surviving engine callback changed after replacement teardown');",
            "webgpu-bindings-reentrancy-after-replacement-destroy.js")) {
        return 1;
    }

    std::cout << "native WebGPU bindings reentrancy passed" << std::endl;
    return 0;
}
