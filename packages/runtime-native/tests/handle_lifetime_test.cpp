#include "mystral/js/engine.h"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {

mystral::js::EngineType parseEngine(const char* name) {
    if (std::string(name) == "quickjs") return mystral::js::EngineType::QuickJS;
    if (std::string(name) == "v8") return mystral::js::EngineType::V8;
    return mystral::js::EngineType::Unknown;
}

}  // namespace

int main(int argc, char** argv) {
    const char* engineName = argc > 1 ? argv[1] : "quickjs";
    const auto engineType = parseEngine(engineName);
    if (engineType == mystral::js::EngineType::Unknown) {
        std::cerr << "usage: handle_lifetime_test [quickjs|v8]" << std::endl;
        return EXIT_FAILURE;
    }

    auto engine = mystral::js::createEngine(engineType);
    if (!engine) {
        std::cout << "SKIP: " << engineName << " is not compiled in" << std::endl;
        return 77;
    }

    const uint64_t callbackChurn = argc > 2 ? std::strtoull(argv[2], nullptr, 10) : 0;
    if (callbackChurn > 0) {
        auto* enginePtr = engine.get();
        uint64_t callbackCount = 0;
        double callbackChecksum = 0;
        auto churnCallback = engine->newFunction("callbackChurn", [
            enginePtr,
            &callbackCount,
            &callbackChecksum
        ](void*, const std::vector<mystral::js::JSValueHandle>& args) {
            callbackCount += 1;
            for (const auto argument : args) callbackChecksum += enginePtr->toNumber(argument);
            return enginePtr->newUndefined();
        });
        if (!engine->setGlobalProperty("__tnCallbackChurn", churnCallback)) return EXIT_FAILURE;
        const std::string script = "for (let i = 0; i < " + std::to_string(callbackChurn) +
            "; i++) globalThis.__tnCallbackChurn(i, i + 1, i + 2);";
        const auto start = std::chrono::steady_clock::now();
        if (!engine->evalScript(script.c_str(), "callback-churn.js")) return EXIT_FAILURE;
        const auto elapsed = std::chrono::steady_clock::now() - start;
        const double elapsedSeconds = std::chrono::duration<double>(elapsed).count();
        const double callbacksPerSecond = static_cast<double>(callbackCount) / elapsedSeconds;
        std::cout << "callback-churn=" << callbackCount
                  << " callbacks-per-second=" << callbacksPerSecond
                  << " checksum=" << callbackChecksum << std::endl;
        engine->freeHandle(churnCallback);
        if (callbackCount != callbackChurn) return EXIT_FAILURE;
    }

    constexpr size_t kChurn = 512;
    std::vector<mystral::js::JSValueHandle> handles;
    handles.reserve(kChurn);
    for (size_t i = 0; i < kChurn; ++i) {
        handles.push_back(engine->newObject());
    }

    for (auto handle : handles) {
        engine->freezeHandle(handle);
        engine->freeHandle(handle);
    }
    handles.clear();

    {
        mystral::js::JSValueGuard guard(*engine, engine->newObject());
        if (!guard) return EXIT_FAILURE;
    }

    auto* enginePtr = engine.get();
    mystral::js::JSValueHandle retainedCallbackArgument;
    auto retainingCallback = engine->newFunction("retain", [enginePtr, &retainedCallbackArgument](
        void*, const std::vector<mystral::js::JSValueHandle>& args) {
        if (!args.empty()) {
            retainedCallbackArgument = args[0];
            enginePtr->freezeHandle(retainedCallbackArgument);
        }
        return enginePtr->newUndefined();
    });
    auto callbackArgument = engine->newObject();
    auto callbackThis = engine->newUndefined();
    auto callbackResult = engine->call(retainingCallback, callbackThis, {callbackArgument});
    if (callbackResult.ptr) engine->freeHandle(callbackResult);
    engine->freeHandle(callbackThis);
    engine->freeHandle(callbackArgument);
    if (retainedCallbackArgument.ptr) engine->freeHandle(retainedCallbackArgument);
    engine->freeHandle(retainingCallback);

    const size_t outstanding = engine->outstandingHandleCount();
    std::cout << "engine=" << engineName << " handles-created=" << kChurn
              << " handles-freed=" << kChurn << " outstanding=" << outstanding << std::endl;
    return outstanding == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
