/**
 * JavaScript Engine Factory
 *
 * Creates the appropriate JS engine based on platform and build configuration.
 */

#include "mystral/js/engine.h"
#include <iostream>

namespace mystral {
namespace js {

// Forward declarations of engine factory functions
#if defined(MYSTRAL_JS_QUICKJS)
std::unique_ptr<Engine> createQuickJSEngine();
#endif

#if defined(MYSTRAL_JS_JSC) && defined(__APPLE__)
std::unique_ptr<Engine> createJSCEngine();
#endif

#if defined(MYSTRAL_JS_V8)
std::unique_ptr<Engine> createV8Engine();
#endif

std::unique_ptr<Engine> createEngine() {
    // Platform-specific defaults:
    // - macOS/iOS: Prefer JSC (0 bytes, system framework)
    // - Windows/Linux with V8: Use V8 (fastest)
    // - Fallback: QuickJS (always available, small)

#if defined(__APPLE__) && defined(MYSTRAL_JS_JSC)
    std::cout << "[JS] Creating JavaScriptCore engine (platform default)" << std::endl;
    return createJSCEngine();
#elif defined(MYSTRAL_JS_V8)
    std::cout << "[JS] Creating V8 engine (platform default)" << std::endl;
    return createV8Engine();
#elif defined(MYSTRAL_JS_QUICKJS)
    std::cout << "[JS] Creating QuickJS engine (fallback)" << std::endl;
    return createQuickJSEngine();
#else
    std::cerr << "[JS] No JavaScript engine available!" << std::endl;
    return nullptr;
#endif
}

std::unique_ptr<Engine> createEngine(EngineType type) {
    switch (type) {
        case EngineType::QuickJS:
#if defined(MYSTRAL_JS_QUICKJS)
            std::cout << "[JS] Creating QuickJS engine" << std::endl;
            return createQuickJSEngine();
#else
            std::cerr << "[JS] QuickJS not compiled in" << std::endl;
            return nullptr;
#endif

        case EngineType::V8:
#if defined(MYSTRAL_JS_V8)
            std::cout << "[JS] Creating V8 engine" << std::endl;
            return createV8Engine();
#else
            std::cerr << "[JS] V8 not compiled in" << std::endl;
            return nullptr;
#endif

        case EngineType::JavaScriptCore:
#if defined(MYSTRAL_JS_JSC) && defined(__APPLE__)
            std::cout << "[JS] Creating JavaScriptCore engine" << std::endl;
            return createJSCEngine();
#else
            std::cerr << "[JS] JavaScriptCore not available (Apple platforms only)" << std::endl;
            return nullptr;
#endif

        default:
            std::cerr << "[JS] Unknown engine type" << std::endl;
            return nullptr;
    }
}

}  // namespace js
}  // namespace mystral
