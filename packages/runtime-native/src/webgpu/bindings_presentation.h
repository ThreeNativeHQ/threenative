#pragma once

#include "bindings_state.h"
#include "mystral/webgpu/registration_table.h"

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

void paceToPresentationCap();
bool isSrgbSurfaceFormat(WGPUTextureFormat format);
WGPUTextureFormat linearSurfaceFormat(WGPUTextureFormat format);
void reportSurfaceFormatMarker(
    WGPUTextureFormat nativeFormat,
    WGPUTextureFormat renderFormat,
    bool usesSrgbBridge,
    WGPUPresentMode presentMode);
bool syncSurfaceSizeToCanvas(BindingsState* state, js::JSValueHandle canvas);
WGPUTexture getCurrentSwapchainTexture(BindingsState* state);
void trackCurrentSurfaceTextureView(BindingsState* state, uint64_t viewId, WGPUTextureView view);
void untrackCurrentSurfaceTextureView(BindingsState* state, uint64_t viewId);
bool isCurrentSurfaceTextureView(const BindingsState* state, WGPUTextureView view);
void releaseCurrentSurfaceTextureViews(BindingsState* state);
void presentPendingSurface(BindingsState* state);
void reportPresentTick(BindingsState* state, uint64_t frames);
js::JSValueHandle handleWebGpuPresentationCap(
    BindingsState* state,
    BindingDestination bindingDestination,
    const std::vector<js::JSValueHandle>& args);

#endif

}  // namespace mystral::webgpu
