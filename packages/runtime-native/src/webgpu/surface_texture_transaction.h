#pragma once

#include <functional>

#include "bindings_state.h"

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

using SurfaceTextureAcquire = std::function<WGPUTexture(BindingsState*)>;
using SurfaceTextureWrapper = std::function<js::JSValueHandle(
    BindingsState*,
    WGPUTexture,
    uint64_t,
    uint32_t,
    uint32_t,
    const char*,
    bool)>;
using SurfaceTextureRelease = std::function<void(
    BindingsState*, WGPUTexture, WGPUTexture)>;

// This is the transaction used by GPUCanvasContext.getCurrentTexture() after the surface has
// been acquired. It is also callable with controlled acquire/wrap/release functions so lifecycle
// rollback can be tested without a window, display, or GPU backend claim.
js::JSValueHandle acquireSurfaceTexture(
    BindingsState* state,
    const SurfaceTextureAcquire& acquire,
    const SurfaceTextureWrapper& wrap,
    const SurfaceTextureRelease& release);

#endif

}  // namespace mystral::webgpu
