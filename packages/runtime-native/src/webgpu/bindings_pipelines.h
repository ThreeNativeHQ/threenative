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

// PRD-368. One cache per device, created before the first pipeline and released after the compile
// pool has been joined. Both are safe to call on a backend without the cache API: they record why.
void initPipelineCache(BindingsState* state);
void releasePipelineCache(BindingsState* state);
void pollPipelineCachePersistence(BindingsState* state);
WGPURenderPipeline createCachedRenderPipeline(BindingsState* state, WGPUDevice device,
                                              const WGPURenderPipelineDescriptor* descriptor);
WGPUComputePipeline createCachedComputePipeline(BindingsState* state, WGPUDevice device,
                                                const WGPUComputePipelineDescriptor* descriptor);
// Shared by the census and persistence reporter, so concurrent marker lines cannot interleave.
std::string pipelineJsonString(const std::string& value);
const char* pipelineBackendName(WGPUBackendType backend);
std::mutex& pipelineOutputMutex();
/** Bytes the live cache serializes right now; 0 when there is no cache. */
size_t pipelineCacheSerializedBytes(BindingsState* state);
/** The `TN_PIPELINE_CACHE` line: mode, reason, attachments and serialized size. */
void reportPipelineCacheState(BindingsState* state, const char* phase);
double pipelineClockMs();
std::string pipelineSourceHash(const std::string& code);
void reportPipelineCaptureMetadata(WGPUAdapter adapter);
void reportPipelineFirstPresent();
void reportPipelineCaptureComplete(uint64_t eventCount);
// A capture boundary for a process nobody gets to exit. Emitted only when the counts changed.
void reportPipelineCheckpoint(BindingsState* state, uint64_t presentCount);

#endif

}  // namespace mystral::webgpu
