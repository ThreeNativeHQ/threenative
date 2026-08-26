#include "mystral/js/engine.h"

#include <cstdlib>
#include <iostream>

namespace {

bool checkBridgePropertySemantics(mystral::js::Engine& engine) {
    const auto object = engine.newObject();
    const auto initialValue = engine.newNumber(41);
    if (!object.ptr || !initialValue.ptr ||
        !engine.setGlobalProperty("__tnBridgeObject", object) ||
        !engine.evalScript(R"JS((() => {
            globalThis.__tnInheritedSetterCalls = 0;
            Object.setPrototypeOf(__tnBridgeObject, {
                set bridgeValue(value) {
                    globalThis.__tnInheritedSetterCalls += 1;
                },
            });
        })())JS", "v8-property-contract-setup.js") ||
        !engine.setProperty(object, "bridgeValue", initialValue)) {
        engine.freeHandle(initialValue);
        engine.freeHandle(object);
        return false;
    }

    const bool passed = engine.evalScript(R"JS((() => {
        const descriptor = Object.getOwnPropertyDescriptor(__tnBridgeObject, "bridgeValue");
        if (!descriptor || descriptor.value !== 41)
            throw new Error("bridge write did not create an own data property");
        if (!descriptor.writable || !descriptor.enumerable || !descriptor.configurable)
            throw new Error("bridge property flags differ from an ordinary assignment");
        if (__tnInheritedSetterCalls !== 0)
            throw new Error("bridge write invoked an inherited setter");
        __tnBridgeObject.bridgeValue = 42;
        if (__tnBridgeObject.bridgeValue !== 42)
            throw new Error("bridge property is not writable");
        if (!Object.keys(__tnBridgeObject).includes("bridgeValue"))
            throw new Error("bridge property is not enumerable");
        if (!delete __tnBridgeObject.bridgeValue ||
            Object.hasOwn(__tnBridgeObject, "bridgeValue"))
            throw new Error("bridge property is not configurable");
    })())JS", "v8-property-contract.js");

    const auto global = engine.getGlobal();
    engine.deleteProperty(global, "__tnBridgeObject");
    engine.deleteProperty(global, "__tnInheritedSetterCalls");
    engine.freeHandle(global);
    engine.freeHandle(initialValue);
    engine.freeHandle(object);
    engine.clearFrameHandles();
    return passed;
}

bool checkNestedNativeCallbacks(mystral::js::Engine& engine) {
    int outerCalls = 0;
    int innerCalls = 0;
    int throwingOuterCalls = 0;
    int throwingInnerCalls = 0;

    const auto inner = engine.newFunction(
        "nestedInner",
        [&engine, &innerCalls](void*, const std::vector<mystral::js::JSValueHandle>& args) {
            innerCalls += 1;
            const double value = args.empty() ? 0 : engine.toNumber(args[0]);
            return engine.newNumber(value + 1);
        });
    const auto throwingInner = engine.newFunction(
        "nestedThrowingInner",
        [&engine, &throwingInnerCalls](
            void*, const std::vector<mystral::js::JSValueHandle>&) {
            throwingInnerCalls += 1;
            engine.throwException("nested native failure");
            return mystral::js::JSValueHandle{};
        });
    const auto outer = engine.newFunction(
        "nestedOuter",
        [&engine, inner, &outerCalls](
            void*, const std::vector<mystral::js::JSValueHandle>& args) {
            outerCalls += 1;
            const auto receiver = engine.newUndefined();
            const auto result = engine.call(inner, receiver, args);
            engine.freeHandle(receiver);
            return result;
        });
    const auto throwingOuter = engine.newFunction(
        "nestedThrowingOuter",
        [&engine, throwingInner, &throwingOuterCalls](
            void*, const std::vector<mystral::js::JSValueHandle>& args) {
            throwingOuterCalls += 1;
            const auto receiver = engine.newUndefined();
            const auto result = engine.call(throwingInner, receiver, args);
            engine.freeHandle(receiver);
            return result;
        });

    if (!inner.ptr || !throwingInner.ptr || !outer.ptr || !throwingOuter.ptr ||
        !engine.setGlobalProperty("__tnNestedOuter", outer) ||
        !engine.setGlobalProperty("__tnNestedThrowingOuter", throwingOuter)) {
        return false;
    }

    const bool passed = engine.evalScript(R"JS((() => {
        if (__tnNestedOuter(41) !== 42)
            throw new Error("nested native callback lost its return value");
        let caught = false;
        try {
            __tnNestedThrowingOuter();
        } catch (error) {
            caught = String(error).includes("nested native failure");
        }
        if (!caught)
            throw new Error("nested native callback lost its exception");
        if (__tnNestedOuter(1) !== 2)
            throw new Error("caught nested exception poisoned later reentrancy");
    })())JS", "v8-nested-native-callback-contract.js");

    const auto global = engine.getGlobal();
    engine.deleteProperty(global, "__tnNestedOuter");
    engine.deleteProperty(global, "__tnNestedThrowingOuter");
    engine.freeHandle(global);
    engine.freeHandle(throwingOuter);
    engine.freeHandle(outer);
    engine.freeHandle(throwingInner);
    engine.freeHandle(inner);
    engine.clearFrameHandles();

    return passed && !engine.hasException() && outerCalls == 2 && innerCalls == 2 &&
        throwingOuterCalls == 1 && throwingInnerCalls == 1 &&
        engine.outstandingHandleCount() == 0;
}

}  // namespace

int main() {
    auto engine = mystral::js::createEngine(mystral::js::EngineType::V8);
    if (!engine) {
        std::cout << "SKIP: V8 is not compiled in" << std::endl;
        return 77;
    }

    if (!checkBridgePropertySemantics(*engine)) {
        std::cerr << "v8-engine-contract: bridge property semantics failed" << std::endl;
        return EXIT_FAILURE;
    }
    if (!checkNestedNativeCallbacks(*engine)) {
        std::cerr << "v8-engine-contract: nested callback semantics failed" << std::endl;
        return EXIT_FAILURE;
    }

    std::cout << "v8-engine-contract: property=own-data nested=return+exception+cleanup+reentrant"
              << std::endl;
    return EXIT_SUCCESS;
}
