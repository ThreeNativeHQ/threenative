// A native callback must propagate the exception raised by its owning QuickJS context.
//
// Creating a second QuickJS engine used to overwrite the process-global engine pointer used
// by nativeCallback(). This test leaves the first callback alive, creates the second engine,
// and then verifies that the first context still reports its own pending exception.

#include "mystral/js/engine.h"

#include <iostream>
#include <memory>
#include <string>
#include <vector>

int main() {
    auto firstEngine = mystral::js::createEngine(mystral::js::EngineType::QuickJS);
    if (!firstEngine) {
        std::cout << "SKIP QuickJS: not compiled into this build\n";
        return 0;
    }

    auto* first = firstEngine.get();
    first->setGlobalProperty(
        "raiseFromFirst",
        first->newFunction(
            "raiseFromFirst",
            [first](void*, const std::vector<mystral::js::JSValueHandle>&) {
                first->throwException("first-engine exception");
                return first->newUndefined();
            }));

    auto secondEngine = mystral::js::createEngine(mystral::js::EngineType::QuickJS);
    if (!secondEngine) {
        std::cerr << "FAILED: could not create the second QuickJS engine\n";
        return 1;
    }

    auto result = first->evalScriptWithResult("raiseFromFirst();", "quickjs-context-test.js");
    if (result.ptr) {
        first->unprotect(result);
        std::cerr << "FAILED: first context returned a value instead of JS_EXCEPTION\n";
        return 1;
    }
    if (!first->hasException()) {
        std::cerr << "FAILED: first context did not retain its native callback exception\n";
        return 1;
    }

    const std::string exception = first->getException();
    if (exception.find("first-engine exception") == std::string::npos) {
        std::cerr << "FAILED: first context reported the wrong exception: " << exception << '\n';
        return 1;
    }

    std::cout << "PASS QuickJS: first context propagated its exception after the second engine existed\n";
    return 0;
}
