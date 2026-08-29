#pragma once

#include "bindings_state.h"
#include "mystral/webgpu/registration_table.h"

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

js::JSValueHandle handleGpuDeviceCreateRenderBundleEncoder(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle tnWebgpuHandlerCreateQuerySet(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateCommandEncoder(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);

#if TN_ANDROID_JS_PROFILE
std::chrono::steady_clock::time_point beginProfiledBinding();
ProfiledBufferUsage profiledBufferUsage(WGPUBufferUsage usage);
uint64_t endProfiledBinding(BindingsState* state, ProfiledRenderCommand command, std::chrono::steady_clock::time_point start, uint64_t count = 1);
#endif

#endif

}  // namespace mystral::webgpu
