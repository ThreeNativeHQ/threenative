#pragma once

#include "bindings_state.h"
#include "mystral/webgpu/registration_table.h"

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

js::JSValueHandle handleGpuDeviceCreatePipelineLayout(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateBindGroup(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateBindGroupLayout(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateComputePipeline(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateRenderPipeline(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateShaderModule(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);

// PRD-327. The compile leaves the main loop; these settle it back onto the game thread.
js::JSValueHandle handleGpuDeviceCreateRenderPipelineAsync(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
js::JSValueHandle handleGpuDeviceCreateComputePipelineAsync(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args);
void drainAsyncPipelineCompiles(BindingsState* state);
void shutdownAsyncPipelineCompiles(BindingsState* state);

#endif

}  // namespace mystral::webgpu
