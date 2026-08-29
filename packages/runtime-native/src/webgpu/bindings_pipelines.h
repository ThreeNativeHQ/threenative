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

#endif

}  // namespace mystral::webgpu
