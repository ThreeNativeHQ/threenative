#include "mystral/js/engine.h"

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
