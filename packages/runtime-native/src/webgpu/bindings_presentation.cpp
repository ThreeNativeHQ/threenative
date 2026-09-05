/** WebGPU presentation, acquisition, and surface lifecycle. */

#include "ablation.h"
#include "bindings_frame_stream.h"
#include "bindings_presentation.h"
#include "bindings_state.h"
#include "mystral/cold_start.h"
#include "mystral/js/engine.h"
#include "mystral/stall_budget.h"
#include "mystral/webgpu/bindings.h"
#include "bindings_resources.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#if defined(__APPLE__)
#include <os/log.h>
#endif

#if defined(__ANDROID__)
#include <android/log.h>
#endif

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
#include <webgpu/webgpu.h>

#if defined(MYSTRAL_WEBGPU_WGPU)
#if __has_include(<webgpu/wgpu.h>)
#include <webgpu/wgpu.h>
#else
#include <wgpu/wgpu.h>
#endif
#endif
#include "mystral/webgpu_compat.h"
#endif

namespace mystral {
namespace webgpu {
// ---------------------------------------------------------------------------
// Presentation ceiling (PRD-218)
// ---------------------------------------------------------------------------
//
// A convention that ships on: a game presents at most `g_presentationCapHz` frames a second, and
// runs uncapped only when it asks to.
//
// The measurement that bought this: on a Pixel 8, a build whose whole scene was a static dark
// screen with three textures held **119.8 presents per second, indefinitely**. `fifo` vsync was
// the only ceiling in the runtime, so on a 120 Hz panel a loading screen, a pause menu or a game
// that has finished drawing burns the SoC at the panel's rate for no visible benefit -- the phone
// warms and the battery drains to present the same pixels twice. Nothing in the frame was
// expensive; that was exactly the problem.
//
// 60 Hz is the default because it is the rate every game in this repository was authored against
// and half of the common high-refresh panel, so a frame is presented on every second vsync
// interval rather than at an unrelated period that would judder against it.
//
// Honesty when overridden is part of the convention, not a nicety: the effective cap rides along
// in every `TN_PRESENTS_TICK`, so a probe that reads 120 presents a second can tell "the game
// opted out" from "the cap is broken" without reading the game's source.
static uint32_t g_presentationCapHz = 60;

/** The pacing deadline for the next present. Zero until the first paced frame. */
static std::chrono::steady_clock::time_point g_nextPresentDeadline{};

bool setPresentationCapHz(uint32_t hz) {
    if (hz > 1000) return false;
    g_presentationCapHz = hz;
    g_nextPresentDeadline = std::chrono::steady_clock::time_point{};
    return true;
}

/**
 * Holds the loop back to the presentation ceiling, after a frame that actually presented.
 *
 * Only after a present, and never during startup: the launch stall this same PRD measures has no
 * presents in it at all, and pacing an unpresented loop would add sleep to the twelve seconds a
 * player already waits. A frame that misses its deadline resets the schedule instead of trying to
 * catch up, because a game running below the cap must not then be asked to present a burst.
 */
void paceToPresentationCap() {
    if (g_presentationCapHz == 0) return;
    using clock = std::chrono::steady_clock;
    const auto interval = std::chrono::nanoseconds(1000000000ull / g_presentationCapHz);
    const auto now = clock::now();
    if (g_nextPresentDeadline == clock::time_point{} || now > g_nextPresentDeadline + interval) {
        // First paced frame, or the loop fell far enough behind that the old schedule is stale.
        g_nextPresentDeadline = now + interval;
        return;
    }
    if (now < g_nextPresentDeadline) std::this_thread::sleep_until(g_nextPresentDeadline);
    g_nextPresentDeadline += interval;
}

bool isSrgbSurfaceFormat(WGPUTextureFormat format) {
    return format == WGPUTextureFormat_RGBA8UnormSrgb ||
           format == WGPUTextureFormat_BGRA8UnormSrgb;
}

WGPUTextureFormat linearSurfaceFormat(WGPUTextureFormat format) {
    if (format == WGPUTextureFormat_RGBA8UnormSrgb) return WGPUTextureFormat_RGBA8Unorm;
    if (format == WGPUTextureFormat_BGRA8UnormSrgb) return WGPUTextureFormat_BGRA8Unorm;
    return format;
}

static const char* presentModeName(WGPUPresentMode mode) {
    switch (mode) {
        case WGPUPresentMode_Immediate: return "immediate";
        case WGPUPresentMode_Mailbox: return "mailbox";
        case WGPUPresentMode_Fifo: return "fifo";
        default: return "unknown";
    }
}

void reportSurfaceFormatMarker(WGPUTextureFormat nativeFormat,
                               WGPUTextureFormat renderFormat,
                               bool usesSrgbBridge,
                               WGPUPresentMode presentMode) {
    std::cout << "TN_SURFACE_FORMAT:{\"native\":\"" << formatToString(nativeFormat)
              << "\",\"render\":\"" << formatToString(renderFormat)
              << "\",\"bridge\":" << (usesSrgbBridge ? "true" : "false")
              << ",\"present\":\"" << presentModeName(presentMode) << "\"}" << std::endl;
}

static bool readCanvasDimension(
    BindingsState* state,
    js::JSValueHandle canvas,
    const char* propertyName,
    uint32_t& dimension
) {
    if (!state->engine || state->engine->isNull(canvas) || state->engine->isUndefined(canvas)) return false;

    const double value = state->engine->toNumber(state->engine->getProperty(canvas, propertyName));
    if (!std::isfinite(value) || value <= 0 || std::floor(value) != value ||
        value > static_cast<double>(std::numeric_limits<uint32_t>::max())) {
        return false;
    }

    dimension = static_cast<uint32_t>(value);
    return true;
}

/**
 * Keep the native presentation surface in lockstep with renderer.setSize().
 * Three.js changes the canvas backing dimensions directly; unlike a browser
 * GPUCanvasContext, the native surface is not reconfigured by that property
 * write, so acquire must apply the pending size before creating the color view.
 */
bool syncSurfaceSizeToCanvas(BindingsState* state, js::JSValueHandle canvas) {
    if (!state->surface) return true;

    uint32_t width = 0;
    uint32_t height = 0;
    if (!readCanvasDimension(state, canvas, "width", width) ||
        !readCanvasDimension(state, canvas, "height", height)) {
        return false;
    }

    if (width == state->presentation.canvasWidth && height == state->presentation.canvasHeight)
        return true;

    // On a direct-presentation surface, a swapchain image acquired earlier in this scene's
    // life may still be held in state->presentation.currentTexture — the frame boundary that presents it has
    // not run. wgpu-native refuses to reconfigure a surface with an outstanding
    // SurfaceOutput: its panic reads "`SurfaceOutput` must be dropped before a new `Surface`
    // is made", and the panic aborts the process (PRD-183: the Android emulator died with a
    // silent SIGABRT exactly here, 67 ms into the first render after renderer.setSize).
    //
    // Discard that image rather than presenting it: the caller is already replacing the
    // frame's contents at the new size, an extra present would break the one-present-per-
    // frame invariant the device gates enforce, and releasing the texture back unwinds the
    // SurfaceOutput so the reconfigure below is accepted. Deferring the reconfigure instead
    // is worse on both platforms — the current frame would draw new-size depth onto
    // old-size colour, "attachments have differing sizes", the failure tier-1 day recorded
    // on desktop.
    //
    // The sRGB presentation bridge never holds a raw surface output across frames
    // (state->presentation.currentTexture is an offscreen linear texture there), so it keeps the immediate
    // reconfigure it always had.
    if (state->presentation.currentTexture != nullptr && !state->presentation.requiresSrgbPresentationBridge) {
        // setSize can be called between two submits in one JavaScript turn. Replay the safe
        // prefix before dropping view ids that the deferred stream still names, or its later
        // frame-boundary replay fails closed with an opaque "unknown texture view id".
        if (!flushRecordedFrameOps(state)) return false;
        state->presentation.framePresentPending = false;
        releaseCurrentSurfaceTextureViews(state);
        if (state->presentation.currentSurfaceTextureId != 0) {
            state->registries.textureRegistry.erase(state->presentation.currentSurfaceTextureId);
            state->presentation.currentSurfaceTextureId = 0;
        }
        wgpuTextureRelease(state->presentation.currentTexture);
        state->presentation.currentTexture = nullptr;
        state->presentation.surfaceRenderEncoder = nullptr;
        state->presentation.surfaceRenderPassEnded = false;
    }

    WGPUSurfaceConfiguration config = {};
    config.device = state->device;
    config.format = state->presentation.nativeSurfaceFormat;
    config.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
    config.alphaMode = WGPUCompositeAlphaMode_Auto;
    config.width = width;
    config.height = height;
    config.presentMode = state->presentation.presentMode;
    wgpuSurfaceConfigure(state->surface, &config);

    reportSurfaceFormatMarker(state->presentation.nativeSurfaceFormat,
                              state->presentation.surfaceFormat,
                              state->presentation.requiresSrgbPresentationBridge,
                              state->presentation.presentMode);

    state->presentation.canvasWidth = width;
    state->presentation.canvasHeight = height;
    if (state->verboseLogging) {
        std::cout << "[WebGPU] Surface resized from canvas: " << width << "x" << height << std::endl;
    }
    return true;
}

void trackCurrentSurfaceTextureView(BindingsState* state, uint64_t viewId, WGPUTextureView view) {
    if (!state || !view) return;
    state->presentation.currentSurfaceTextureViews[viewId] = view;
    state->presentation.currentTextureView = view;
    state->presentation.currentViewSourceTexture = state->presentation.currentTexture;
}

void untrackCurrentSurfaceTextureView(BindingsState* state, uint64_t viewId) {
    if (!state) return;
    const auto found = state->presentation.currentSurfaceTextureViews.find(viewId);
    if (found == state->presentation.currentSurfaceTextureViews.end()) return;
    const WGPUTextureView removed = found->second;
    state->presentation.currentSurfaceTextureViews.erase(found);
    if (state->presentation.currentTextureView == removed) {
        state->presentation.currentTextureView = state->presentation.currentSurfaceTextureViews.empty()
                                                     ? nullptr
                                                     : state->presentation.currentSurfaceTextureViews.begin()->second;
    }
}

bool isCurrentSurfaceTextureView(const BindingsState* state, WGPUTextureView view) {
    if (!state || !view) return false;
    for (const auto& [id, tracked] : state->presentation.currentSurfaceTextureViews) {
        (void)id;
        if (tracked == view) return true;
    }
    return false;
}

void releaseCurrentSurfaceTextureViews(BindingsState* state) {
    if (!state) return;
    for (const auto& [viewId, view] : state->presentation.currentSurfaceTextureViews) {
        if (state->registries.textureViewRegistry.erase(viewId) != 0 && view)
            wgpuTextureViewRelease(view);
    }
    state->presentation.currentSurfaceTextureViews.clear();
    state->presentation.currentTextureView = nullptr;
    state->presentation.currentViewSourceTexture = nullptr;
}

static WGPUTexture createLinearPresentationTexture(BindingsState* state) {
    WGPUTextureDescriptor descriptor = {};
    descriptor.size = {state->presentation.canvasWidth, state->presentation.canvasHeight, 1};
    descriptor.mipLevelCount = 1;
    descriptor.sampleCount = 1;
    descriptor.dimension = WGPUTextureDimension_2D;
    descriptor.format = state->presentation.surfaceFormat;
    descriptor.usage = WGPUTextureUsage_RenderAttachment |
                       WGPUTextureUsage_TextureBinding |
                       WGPUTextureUsage_CopySrc;
    return wgpuDeviceCreateTexture(state->device, &descriptor);
}

static bool ensureSrgbPresentationPipeline(BindingsState* state) {
    if (state->presentation.srgbPresentationPipeline)
        return true;

    const char* shaderCode = R"(
        @group(0) @binding(0) var sourceTexture: texture_2d<f32>;

        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
            var positions = array<vec2f, 3>(
                vec2f(-1.0, -1.0),
                vec2f(3.0, -1.0),
                vec2f(-1.0, 3.0)
            );
            return vec4f(positions[vertexIndex], 0.0, 1.0);
        }

        fn srgbToLinear(value: vec3f) -> vec3f {
            let low = value / 12.92;
            let high = pow((value + 0.055) / 1.055, vec3f(2.4));
            return select(high, low, value <= vec3f(0.04045));
        }

        @fragment
        fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
            let encoded = textureLoad(sourceTexture, vec2i(position.xy), 0);
            return vec4f(srgbToLinear(encoded.rgb), encoded.a);
        }
    )";

    WGPUShaderModuleWGSLDescriptor_Compat wgslDescriptor = {};
    WGPUShaderModuleDescriptor shaderDescriptor = {};
    setupShaderModuleWGSL(&shaderDescriptor, &wgslDescriptor, shaderCode);
    WGPUShaderModule shaderModule = wgpuDeviceCreateShaderModule(state->device, &shaderDescriptor);
    if (!shaderModule) return false;

    WGPUBindGroupLayoutEntry bindGroupEntry = {};
    bindGroupEntry.binding = 0;
    bindGroupEntry.visibility = WGPUShaderStage_Fragment;
    bindGroupEntry.texture.sampleType = WGPUTextureSampleType_Float;
    bindGroupEntry.texture.viewDimension = WGPUTextureViewDimension_2D;
    bindGroupEntry.texture.multisampled = false;

    WGPUBindGroupLayoutDescriptor bindGroupLayoutDescriptor = {};
    bindGroupLayoutDescriptor.entryCount = 1;
    bindGroupLayoutDescriptor.entries = &bindGroupEntry;
    state->presentation.srgbPresentationBindGroupLayout =
        wgpuDeviceCreateBindGroupLayout(state->device, &bindGroupLayoutDescriptor);
    if (!state->presentation.srgbPresentationBindGroupLayout) {
        wgpuShaderModuleRelease(shaderModule);
        return false;
    }

    WGPUPipelineLayoutDescriptor pipelineLayoutDescriptor = {};
    pipelineLayoutDescriptor.bindGroupLayoutCount = 1;
    pipelineLayoutDescriptor.bindGroupLayouts = &state->presentation.srgbPresentationBindGroupLayout;
    WGPUPipelineLayout pipelineLayout =
        wgpuDeviceCreatePipelineLayout(state->device, &pipelineLayoutDescriptor);
    if (!pipelineLayout) {
        wgpuBindGroupLayoutRelease(state->presentation.srgbPresentationBindGroupLayout);
        state->presentation.srgbPresentationBindGroupLayout = nullptr;
        wgpuShaderModuleRelease(shaderModule);
        return false;
    }

    WGPUColorTargetState colorTarget = {};
    colorTarget.format = state->presentation.nativeSurfaceFormat;
    colorTarget.writeMask = WGPUColorWriteMask_All;

    WGPUFragmentState fragmentState = {};
    fragmentState.module = shaderModule;
    WGPU_SET_ENTRY_POINT(fragmentState, "fs_main");
    fragmentState.targetCount = 1;
    fragmentState.targets = &colorTarget;

    WGPURenderPipelineDescriptor pipelineDescriptor = {};
    pipelineDescriptor.layout = pipelineLayout;
    pipelineDescriptor.vertex.module = shaderModule;
    WGPU_SET_ENTRY_POINT(pipelineDescriptor.vertex, "vs_main");
    pipelineDescriptor.fragment = &fragmentState;
    pipelineDescriptor.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pipelineDescriptor.multisample.count = 1;
    pipelineDescriptor.multisample.mask = 0xffffffff;
    state->presentation.srgbPresentationPipeline = wgpuDeviceCreateRenderPipeline(state->device, &pipelineDescriptor);

    wgpuPipelineLayoutRelease(pipelineLayout);
    wgpuShaderModuleRelease(shaderModule);
    if (!state->presentation.srgbPresentationPipeline) {
        wgpuBindGroupLayoutRelease(state->presentation.srgbPresentationBindGroupLayout);
        state->presentation.srgbPresentationBindGroupLayout = nullptr;
        return false;
    }
    return true;
}

static bool presentLinearTextureToSrgbSurface(BindingsState* state, WGPUTextureView sourceView) {
    if (!sourceView || !ensureSrgbPresentationPipeline(state)) return false;

    WGPUSurfaceTexture surfaceTexture = {};
    wgpuSurfaceGetCurrentTexture(state->surface, &surfaceTexture);
    if (!wgpuSurfaceTextureStatusIsSuccess(surfaceTexture.status)) return false;

    WGPUTextureViewDescriptor surfaceViewDescriptor = {};
    surfaceViewDescriptor.format = state->presentation.nativeSurfaceFormat;
    surfaceViewDescriptor.dimension = WGPUTextureViewDimension_2D;
    surfaceViewDescriptor.baseMipLevel = 0;
    surfaceViewDescriptor.mipLevelCount = 1;
    surfaceViewDescriptor.baseArrayLayer = 0;
    surfaceViewDescriptor.arrayLayerCount = 1;
    surfaceViewDescriptor.aspect = WGPUTextureAspect_All;
    WGPUTextureView surfaceView =
        wgpuTextureCreateView(surfaceTexture.texture, &surfaceViewDescriptor);
    if (!surfaceView) {
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }

    WGPUBindGroupEntry bindGroupEntry = {};
    bindGroupEntry.binding = 0;
    bindGroupEntry.textureView = sourceView;
    WGPUBindGroupDescriptor bindGroupDescriptor = {};
    bindGroupDescriptor.layout = state->presentation.srgbPresentationBindGroupLayout;
    bindGroupDescriptor.entryCount = 1;
    bindGroupDescriptor.entries = &bindGroupEntry;
    WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup(state->device, &bindGroupDescriptor);
    if (!bindGroup) {
        wgpuTextureViewRelease(surfaceView);
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }

    WGPUCommandEncoderDescriptor encoderDescriptor = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(state->device, &encoderDescriptor);
    if (!encoder) {
        wgpuBindGroupRelease(bindGroup);
        wgpuTextureViewRelease(surfaceView);
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }
    WGPURenderPassColorAttachment colorAttachment = {};
    colorAttachment.view = surfaceView;
    colorAttachment.loadOp = WGPULoadOp_Clear;
    colorAttachment.storeOp = WGPUStoreOp_Store;
    colorAttachment.clearValue = {0.0, 0.0, 0.0, 1.0};
#if defined(MYSTRAL_WEBGPU_DAWN)
    colorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif
    WGPURenderPassDescriptor renderPassDescriptor = {};
    renderPassDescriptor.colorAttachmentCount = 1;
    renderPassDescriptor.colorAttachments = &colorAttachment;
    WGPURenderPassEncoder renderPass =
        wgpuCommandEncoderBeginRenderPass(encoder, &renderPassDescriptor);
    if (!renderPass) {
        wgpuCommandEncoderRelease(encoder);
        wgpuBindGroupRelease(bindGroup);
        wgpuTextureViewRelease(surfaceView);
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }
    wgpuRenderPassEncoderSetPipeline(renderPass, state->presentation.srgbPresentationPipeline);
    wgpuRenderPassEncoderSetBindGroup(renderPass, 0, bindGroup, 0, nullptr);
    wgpuRenderPassEncoderDraw(renderPass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(renderPass);
    wgpuRenderPassEncoderRelease(renderPass);

    WGPUCommandBufferDescriptor commandBufferDescriptor = {};
    WGPUCommandBuffer commandBuffer =
        wgpuCommandEncoderFinish(encoder, &commandBufferDescriptor);
    const bool encoded = commandBuffer != nullptr;
    if (encoded) {
        flushUploadStaging(state);
        wgpuQueueSubmit(state->queue, 1, &commandBuffer);
        wgpuSurfacePresent(state->surface);
    }

    if (commandBuffer) wgpuCommandBufferRelease(commandBuffer);
    wgpuCommandEncoderRelease(encoder);
    wgpuBindGroupRelease(bindGroup);
    wgpuTextureViewRelease(surfaceView);
    wgpuTextureRelease(surfaceTexture.texture);
    return encoded;
}

/**
 * Names a failed swapchain acquire, at most once a second and always the first one.
 *
 * `TN_SURFACE_ACQUIRE_FAILED` is the marker a logcat filter finds when a device shows a black
 * screen; the status is wgpu's own `WGPUSurfaceGetCurrentTextureStatus`, so an outdated or lost
 * surface is distinguishable from a device that simply has no window.
 */
static void reportSurfaceAcquireFailure(uint32_t status) {
    static uint64_t suppressed = 0;
    static std::chrono::steady_clock::time_point lastReport{};
    const auto now = std::chrono::steady_clock::now();
    const bool first = lastReport.time_since_epoch().count() == 0;
    if (!first && now - lastReport < std::chrono::seconds(1)) {
        suppressed += 1;
        return;
    }
    lastReport = now;
    std::ostringstream out;
    out << "TN_SURFACE_ACQUIRE_FAILED:{\"status\":" << status << ",\"suppressed\":" << suppressed
        << "}";
    suppressed = 0;
    const std::string marker = out.str();
    std::cerr << "[WebGPU] " << marker << " the surface handed out no texture, so this frame "
                 "presents nothing" << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_ERROR, "MystralRuntime", "%s", marker.c_str());
#endif
}

/**
 * Get the current swapchain texture (or offscreen texture in no-SDL mode)
 */
WGPUTexture getCurrentSwapchainTexture(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    // In no-SDL mode, use the offscreen texture
    if (!state->surface) {
        if (state->presentation.offscreenTexture) {
            return state->presentation.offscreenTexture;
        }
        std::cerr << "[WebGPU] No surface and no offscreen texture available" << std::endl;
        return nullptr;
    }

    if (state->presentation.requiresSrgbPresentationBridge) {
        return createLinearPresentationTexture(state);
    }

    WGPUSurfaceTexture surfaceTexture;
    wgpuSurfaceGetCurrentTexture(state->surface, &surfaceTexture);

    if (!wgpuSurfaceTextureStatusIsSuccess(surfaceTexture.status)) {
        // Fail by name. A surface that stops handing out images presents nothing, and the loop is
        // no longer paced by presenting, so this fires hundreds of times a second, which is
        // precisely how the resume defect looked from the outside: frames running away, presents
        // frozen, a black screen, and no line in the log that said why. Rate-limited so the marker
        // stays readable instead of becoming a flood.
        reportSurfaceAcquireFailure(static_cast<uint32_t>(surfaceTexture.status));
        return nullptr;
    }

    return surfaceTexture.texture;
#else
    return nullptr;
#endif
}

uint64_t presentCount(BindingsState* state) { return state->profiling.presentCount; }

/**
 * Drops every reference to the live presentation surface, ahead of a rebuild.
 *
 * Android destroys the `ANativeWindow` behind a backgrounded app, so on resume the surface is
 * replaced rather than reconfigured. Any swapchain image acquired and not yet presented has to be
 * released first: wgpu-native refuses to tear a surface down with an outstanding `SurfaceOutput`
 * ("`SurfaceOutput` must be dropped before a new `Surface` is made") and that panic aborts the
 * process, which is how PRD-183's silent SIGABRT happened on the resize path.
 */
void detachSurfaceForRebuild(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    if (!state) return;
    state->presentation.framePresentPending = false;
    releaseCurrentSurfaceTextureViews(state);
    if (state->presentation.currentSurfaceTextureId != 0) {
        state->registries.textureRegistry.erase(state->presentation.currentSurfaceTextureId);
        state->presentation.currentSurfaceTextureId = 0;
    }
    if (state->presentation.currentTexture != nullptr) {
        wgpuTextureRelease(state->presentation.currentTexture);
        state->presentation.currentTexture = nullptr;
    }
    state->presentation.currentViewSourceTexture = nullptr;
    state->presentation.surfaceRenderEncoder = nullptr;
    state->presentation.surfaceRenderPassEnded = false;
    state->screenshot.screenshotCapturedThisFrame = false;
    state->surface = nullptr;
#else
    (void)state;
#endif
}

/**
 * Publishes a rebuilt surface to the bindings, which is where every present reads it from.
 *
 * Without this the host would hold a fresh surface and JavaScript would keep presenting to the
 * dead one: the resume defect again, one indirection later.
 */
void republishSurface(BindingsState* state, void* wgpuSurface, uint32_t surfaceFormat,
                      uint32_t presentMode, uint32_t width, uint32_t height) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    if (!state) return;
    state->surface = (WGPUSurface)wgpuSurface;
    state->presentation.presentMode = static_cast<WGPUPresentMode>(presentMode);
    state->presentation.nativeSurfaceFormat = (WGPUTextureFormat)surfaceFormat;
    state->presentation.requiresSrgbPresentationBridge =
        state->surface != nullptr && isSrgbSurfaceFormat(state->presentation.nativeSurfaceFormat);
    state->presentation.surfaceFormat = state->presentation.requiresSrgbPresentationBridge
                                            ? linearSurfaceFormat(state->presentation.nativeSurfaceFormat)
                                            : state->presentation.nativeSurfaceFormat;
    // The same pairing startup makes: the canvas dimensions name the size the surface is
    // configured at, so `syncSurfaceSizeToCanvas` reconfigures on the next frame if the game is
    // rendering at a different one.
    state->presentation.canvasWidth = width;
    state->presentation.canvasHeight = height;
    reportSurfaceFormatMarker(state->presentation.nativeSurfaceFormat,
                              state->presentation.surfaceFormat,
                              state->presentation.requiresSrgbPresentationBridge,
                              state->presentation.presentMode);
    std::cout << "[WebGPU] Surface republished to bindings: " << wgpuSurface << " " << width << "x" << height
              << " (format=" << state->presentation.surfaceFormat << ")" << std::endl;
#else
    (void)state; (void)wgpuSurface; (void)surfaceFormat; (void)presentMode; (void)width; (void)height;
#endif
}

void setOffscreenTexture(BindingsState* state, void* texture, void* textureView) {
    state->presentation.offscreenTexture = (WGPUTexture)texture;
    state->presentation.offscreenTextureView = (WGPUTextureView)textureView;
    if (state->verboseLogging) std::cout << "[WebGPU] Offscreen texture set for headless rendering" << std::endl;
}

/**
 * Presents the frame, once, after every rAF callback has returned.
 *
 * The surface used to be presented from inside `queue.submit`. That is wrong for any frame that
 * submits more than once — three.js renders the world and then the framework renders the canvas
 * layer as a second pass — because each submit acquired and presented its own swapchain image.
 * Only the first reached the display, so overlays drew into an image nobody ever saw. Acquisition
 * is idempotent within a frame (see the canvas `getCurrentTexture` binding) and the present
 * happens here, so both passes land on one image and that image is presented once.
 */
void presentPendingSurface(BindingsState* state) {
    // Exactly one acquire and one release per frame, whether or not anything was presented.
    // Returning early without releasing would strand the acquired swapchain image, and because
    // acquisition is idempotent within a frame every later frame would reuse that stranded image
    // and never present again — a black screen from the first frame that renders nothing.
    // Capture before presenting: the surface texture is still alive and now carries every pass.
    captureFrameScreenshot(state);
    const bool pending = state->presentation.framePresentPending;
    state->presentation.framePresentPending = false;
    if (!state->presentation.currentTexture)
        return;

    if (pending && state->surface) {
        if (state->verboseLogging)
            std::cout << "[WebGPU] Presenting surface" << std::endl;
        const auto presentStart = std::chrono::steady_clock::now();
        const uint64_t presentThreadCpuStart = readRenderThreadCpuNs();
        const bool presented = state->presentation.requiresSrgbPresentationBridge
                                   ? presentLinearTextureToSrgbSurface(state, state->presentation.currentTextureView)
                                   : (wgpuSurfacePresent(state->surface), true);
        const uint64_t presentThreadCpuEnd = readRenderThreadCpuNs();
        state->profiling.lastPresentThreadCpuNs =
            presentThreadCpuEnd > presentThreadCpuStart ? presentThreadCpuEnd - presentThreadCpuStart : 0;
        state->profiling.lastPresentNs = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - presentStart)
                .count());
#if TN_ANDROID_JS_PROFILE
        state->profiling.presentReportedSinceLastPresent = false;
#endif

        if (presented) {
            state->profiling.presentCount += 1;
            const bool hasSurfaceView = state->presentation.currentTextureView != nullptr;
            std::cout << "TN_SURFACE_FRAME:{\"view\":" << (hasSurfaceView ? "true" : "false")
                      << ",\"present\":" << state->profiling.presentCount << "}" << std::endl;
#if defined(__ANDROID__)
            __android_log_print(ANDROID_LOG_INFO, "MystralRuntime",
                                "TN_SURFACE_FRAME:{\"view\":%s,\"present\":%llu}",
                                hasSurfaceView ? "true" : "false",
                                static_cast<unsigned long long>(state->profiling.presentCount));
#endif
            // The last cold-start segment. Emitted from the present that actually reached the
            // display, so "first frame" means the player saw something rather than the loop merely ran.
            if (!state->profiling.firstPresentReported) {
                state->profiling.firstPresentReported = true;
                mystral::coldStartMark("first_frame");
                // Same clock, same instant: the attribution for everything that happened before this
                // present, reported against the gap the player just sat through. PRD-218.
                mystral::stallBudget().report(mystral::coldStartNowMs());
            }
            // Hitches are what the player feels after launch, and they are invisible to a mean.
            // This frame's drain of the late-compile accumulator rides along, so a synchronous
            // pipeline compile mid-game is a named hitch, not an anonymous spike (PRD-327 Phase 4).
            const mystral::StallBudget::PostPresentCompile lateCompile =
                mystral::stallBudget().takePostPresentPipelineCompile();
            mystral::frameHitches().record(lateCompile.ms, lateCompile.calls);
        } else {
            std::cerr << "[WebGPU] sRGB presentation bridge failed" << std::endl;
        }
    }

    // Reset surface render tracking for the next frame.
    state->presentation.surfaceRenderEncoder = nullptr;
    state->presentation.surfaceRenderPassEnded = false;
    state->screenshot.screenshotCapturedThisFrame = false;

    releaseCurrentSurfaceTextureViews(state);

    // Drop every alias so screenshot capture cannot dereference the just-presented surface
    // texture or the consumed linear bridge texture.
    if (state->presentation.currentSurfaceTextureId != 0) {
        state->registries.textureRegistry.erase(state->presentation.currentSurfaceTextureId);
        state->presentation.currentSurfaceTextureId = 0;
    }
    wgpuTextureRelease(state->presentation.currentTexture);
    state->presentation.currentTexture = nullptr;
    state->presentation.currentViewSourceTexture = nullptr;
}

/**
 * Reports frames and presents together, periodically, on every platform.
 *
 * The desktop CLI prints `TN_PRESENTS:<n>` once, at the end of a fixed-frame screenshot run. A
 * device run has no end: the app launches and keeps rendering, so a gate on Android or iOS has
 * nothing to read. Frames and presents are emitted as a pair because the number alone proves
 * nothing — the defect this guards was presents outrunning frames, and only the ratio shows it.
 * On Android `std::cout` goes nowhere, so this also writes to logcat.
 */
void reportPresentTick(BindingsState* state, uint64_t frames) {
    std::ostringstream output;
    output << "TN_PRESENTS_TICK:{\"frames\":" << frames << ",\"presents\":" << state->profiling.presentCount
           << ",\"textureMB\":" << (state->profiling.textureBytesLive / 1048576)
           << ",\"textures\":" << state->profiling.textureCountLive
           << ",\"bufferMB\":" << (state->profiling.bufferBytesLive / 1048576) << ",\"capHz\":" << g_presentationCapHz
           << "}";
    const std::string marker = output.str();
    std::cout << marker << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", marker.c_str());
#endif
    // The per-bucket breakdown is the part that names a cause, so it goes out periodically rather
    // than every tick: the running total above is enough to watch growth, and this answers "which
    // allocation" once a run has settled.
    if ((state->profiling.reportTickIndex++ % 5) == 0 && !state->profiling.textureBuckets.empty()) {
        std::vector<std::pair<std::string, std::pair<uint64_t, uint64_t>>> sorted(
            state->profiling.textureBuckets.begin(), state->profiling.textureBuckets.end());
        std::sort(sorted.begin(), sorted.end(), [](const auto& a, const auto& b) {
            return a.second.second > b.second.second;
        });
        std::ostringstream buckets;
        buckets << "TN_GPU_TEXTURES:{\"totalMB\":" << (state->profiling.textureBytesLive / 1048576)
                << ",\"count\":" << state->profiling.textureCountLive << ",\"buckets\":[";
        const size_t limit = sorted.size() < 12 ? sorted.size() : 12;
        for (size_t i = 0; i < limit; i += 1) {
            if (i > 0) buckets << ",";
            buckets << "{\"k\":\"" << sorted[i].first << "\",\"n\":" << sorted[i].second.first
                    << ",\"mb\":" << (sorted[i].second.second / 1048576) << "}";
        }
        buckets << "],\"bucketsTotal\":" << sorted.size() << "}";
        const std::string bucketMarker = buckets.str();
        std::cout << bucketMarker << std::endl;
#if defined(__ANDROID__)
        __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", bucketMarker.c_str());
#endif
        std::vector<std::pair<std::string, std::pair<uint64_t, uint64_t>>> bufferSorted(
            state->profiling.bufferBuckets.begin(), state->profiling.bufferBuckets.end());
        std::sort(bufferSorted.begin(), bufferSorted.end(), [](const auto& a, const auto& b) {
            return a.second.second > b.second.second;
        });
        std::ostringstream buffers;
        buffers << "TN_GPU_BUFFERS:{\"totalMB\":" << (state->profiling.bufferBytesLive / 1048576)
                << ",\"count\":" << state->profiling.bufferCountLive << ",\"buckets\":[";
        const size_t bufferLimit = bufferSorted.size() < 10 ? bufferSorted.size() : 10;
        for (size_t i = 0; i < bufferLimit; i += 1) {
            if (i > 0) buffers << ",";
            buffers << "{\"k\":\"" << bufferSorted[i].first << "\",\"n\":"
                    << bufferSorted[i].second.first << ",\"mb\":"
                    << (bufferSorted[i].second.second / 1048576) << "}";
        }
        buffers << "]}";
        const std::string bufferMarker = buffers.str();
        std::cout << bufferMarker << std::endl;
#if defined(__ANDROID__)
        __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", bufferMarker.c_str());
#endif
    }
#if defined(__APPLE__)
    // The iOS gate reads the unified log, which `std::cout` does not reach -- the JSC console
    // calls NSLog beside its cout for the same reason. os_log is the C entry point to the same
    // place, so this stays in a .cpp.
    os_log(OS_LOG_DEFAULT, "%{public}s", marker.c_str());
#endif
}

js::JSValueHandle handleWebGpuPresentationCap(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
    // Read with no argument, set with one. Hz, where 0 means uncapped and is the only way a game
    // presents above the ceiling. This global is a private diagnostic seam; the supported
    // game-facing override is static `display.maxFps` config, applied before the runtime starts.
    //
    // Fail closed on a rate the runtime cannot honour: a game that asks for -1 or 5000 has a bug,
    // and silently clamping it would make the next frame-rate measurement a fiction.
    if (args.empty()) return state->engine->newNumber(static_cast<double>(g_presentationCapHz));
    const double requested = state->engine->toNumber(args[0]);
    const int32_t hz = static_cast<int32_t>(requested);
    if (!(requested >= 0.0) || requested > 1000.0 || static_cast<double>(hz) != requested) {
        state->engine->throwException(
            "TN_PRESENTATION_CAP_INVALID: the presentation cap is a whole number of frames "
            "per second between 0 (uncapped) and 1000.");
        return state->engine->newUndefined();
    }
    setPresentationCapHz(static_cast<uint32_t>(hz));
    return state->engine->newNumber(static_cast<double>(g_presentationCapHz));
}
}  // namespace webgpu
}  // namespace mystral
