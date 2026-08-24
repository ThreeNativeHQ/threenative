#include "mystral/webgpu/checked_handle.h"

#include "mystral/js/engine.h"

#include <iostream>

#if defined(__ANDROID__)
#include <android/log.h>
#endif

namespace mystral {
namespace webgpu {

const char* const kNullHandleMarker = "TN_WGPU_NULL_HANDLE";

std::string nullHandleMessage(const char* op, const std::string& args) {
    std::string message = std::string(kNullHandleMarker) + ": " + (op != nullptr ? op : "unknown") +
                          " returned no handle";
    if (!args.empty()) message += " (" + args + ")";
    message += "; refusing to pass NULL to wgpu";
    return message;
}

void reportNullHandle(const char* op, const std::string& args) {
    const std::string message = nullHandleMessage(op, args);
#if defined(__ANDROID__)
    // logcat is the only place a phone crash report can be read from, so the op goes there
    // whether or not anything is attached to stdio.
    __android_log_print(ANDROID_LOG_ERROR, "MystralRuntime", "%s", message.c_str());
#endif
    std::cerr << "[WebGPU] " << message << std::endl;
}

bool requireHandle(js::Engine* engine, const void* handle, const char* op,
                   const std::string& args) {
    if (handle != nullptr) return true;
    reportNullHandle(op, args);
    // Fail closed. Without an engine there is nothing to throw into, but the caller still learns
    // the handle is unusable and must not continue with it.
    if (engine != nullptr) engine->throwException(nullHandleMessage(op, args).c_str());
    return false;
}

bool requireHandleHostSide(const void* handle, const char* op, const std::string& args) {
    if (handle != nullptr) return true;
    reportNullHandle(op, args);
    return false;
}

}  // namespace webgpu
}  // namespace mystral
