// PRD-540: the product browser host. `WebGPURenderer` on the Wasm engine
// (packages/three-native/src/browser-renderer.ts) drives it: init on the game's canvas, resize, and
// one presented frame per render() call. Rendering is the same RenderDatabase and Renderer as
// desktop; this file owns only device bring-up and the canvas surface. The test host
// (tests/native-engine/wasm/browser.cpp) keeps its fixed-canvas bench and package proofs.
#include "engine/abi/abi_internal.h"
#include "engine/renderer/render_database.h"

#include <emscripten/emscripten.h>

#include <memory>
#include <optional>
#include <string>

using namespace tn::engine;

namespace {
enum WebState : int { Pending = 0, Ready = 1, Failed = 2 };

WebState state = Pending;
bool started = false;
std::string failure;
std::string adapterFacts[3];  // vendor, architecture, description
uint32_t width = 1, height = 1;
WGPUInstance instance = nullptr;
WGPUDevice device = nullptr;
WGPUQueue queue = nullptr;
WGPUSurface surface = nullptr;
WGPUTextureFormat surfaceFormat = WGPUTextureFormat_Undefined;
EventQueue events;
std::unique_ptr<Renderer> renderer;
RenderDatabase database;
tn::engine::shader::graph::Node pendingPost;  // a RenderPipeline set before the device was ready

std::string text(WGPUStringView value) {
    if (value.data == nullptr) return {};
    return value.length == WGPU_STRLEN ? std::string(value.data) : std::string(value.data, value.length);
}

int fail(const std::string& message) {
    if (state != Failed) failure = message;
    state = Failed;
    return 1;
}

void configureSurface() {
    WGPUSurfaceConfiguration config = {};
    config.device = device;
    config.format = surfaceFormat;
    config.usage = WGPUTextureUsage_RenderAttachment;
    config.width = width;
    config.height = height;
    config.presentMode = WGPUPresentMode_Fifo;
    config.alphaMode = WGPUCompositeAlphaMode_Opaque;
    wgpuSurfaceConfigure(surface, &config);
    renderer->setSize(width, height);
}

void onDevice(WGPURequestDeviceStatus status, WGPUDevice result, WGPUStringView message, void*, void*) {
    if (status != WGPURequestDeviceStatus_Success) return static_cast<void>(fail("TN_WASM_DEVICE: " + text(message)));
    device = result;
    queue = wgpuDeviceGetQueue(device);
    renderer = std::make_unique<Renderer>(instance, device, queue, events);
    configureSurface();
    if (pendingPost) renderer->setPostGraph(pendingPost);
    state = Ready;
}

void onAdapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message, void*, void*) {
    if (status != WGPURequestAdapterStatus_Success) return static_cast<void>(fail("TN_WASM_ADAPTER: " + text(message)));
    WGPUAdapterInfo info = {};
    wgpuAdapterGetInfo(adapter, &info);
    adapterFacts[0] = text(info.vendor);
    adapterFacts[1] = text(info.architecture);
    adapterFacts[2] = text(info.description);
    wgpuAdapterInfoFreeMembers(info);
    WGPUSurfaceCapabilities caps = {};
    if (wgpuSurfaceGetCapabilities(surface, adapter, &caps) != WGPUStatus_Success || caps.formatCount == 0) {
        wgpuAdapterRelease(adapter);
        return static_cast<void>(fail("TN_WASM_SURFACE: no supported format"));
    }
    surfaceFormat = caps.formats[0];
    wgpuSurfaceCapabilitiesFreeMembers(caps);
    WGPURequestDeviceCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onDevice;
    WGPUDeviceDescriptor desc = {};
    desc.uncapturedErrorCallbackInfo.callback = [](WGPUDevice const*, WGPUErrorType, WGPUStringView message, void*, void*) {
        events.post([message = text(message)] { fail("TN_WASM_DEVICE_ERROR: " + message); });
    };
    desc.deviceLostCallbackInfo.mode = WGPUCallbackMode_AllowProcessEvents;
    desc.deviceLostCallbackInfo.callback = [](WGPUDevice const*, WGPUDeviceLostReason, WGPUStringView message, void*, void*) {
        events.post([message = text(message)] { fail("TN_WASM_DEVICE_LOST: " + message); });
    };
    wgpuAdapterRequestDevice(adapter, &desc, callback);
    wgpuAdapterRelease(adapter);
}

bool validSize(uint32_t w, uint32_t h) { return w >= 1 && h >= 1 && w <= 8192 && h <= 8192; }

template <class T>
T* objectAs(const tn_handle_t* handle, const char* cls) {
    auto* object = handle == nullptr ? nullptr : tn::abi::objectOf(*handle);
    if (object == nullptr || object->cls != cls) return nullptr;
    return static_cast<T*>(object->ptr.get());
}

Camera* cameraOf(const tn_handle_t* handle) {
    if (auto* camera = objectAs<PerspectiveCamera>(handle, "PerspectiveCamera")) return camera;
    return objectAs<OrthographicCamera>(handle, "OrthographicCamera");
}
} // namespace

/** Starts adapter and device requests on the canvas `selector` names; poll until Ready or Failed. */
extern "C" int tnw_web_init(const char* selector, uint32_t w, uint32_t h) {
    if (started) return fail("TN_WASM_INIT: already initialized");
    started = true;
    if (selector == nullptr || !validSize(w, h)) return fail("TN_WASM_INIT: canvas selector or size invalid");
    width = w;
    height = h;
    instance = wgpuCreateInstance(nullptr);
    if (instance == nullptr) return fail("TN_WASM_INIT: no WebGPU instance");
    WGPUEmscriptenSurfaceSourceCanvasHTMLSelector canvas = {};
    canvas.chain.sType = WGPUSType_EmscriptenSurfaceSourceCanvasHTMLSelector;
    canvas.selector = {selector, WGPU_STRLEN};
    WGPUSurfaceDescriptor desc = {};
    desc.nextInChain = &canvas.chain;
    surface = wgpuInstanceCreateSurface(instance, &desc);
    if (surface == nullptr) return fail("TN_WASM_SURFACE: canvas missing");
    WGPURequestAdapterOptions options = {};
    options.compatibleSurface = surface;
    WGPURequestAdapterCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onAdapter;
    wgpuInstanceRequestAdapter(instance, &options, callback);
    return 0;
}

/** Delivers pending WebGPU callbacks at this boundary; returns Pending, Ready or Failed. */
extern "C" int tnw_web_poll() {
    if (renderer) renderer->poll();
    else if (instance) wgpuInstanceProcessEvents(instance);
    events.drain();
    return state;
}

extern "C" const char* tnw_web_error() { return failure.c_str(); }

extern "C" const char* tnw_web_adapter(int field) {
    return field >= 0 && field < 3 ? adapterFacts[field].c_str() : "";
}

extern "C" int tnw_web_resize(uint32_t w, uint32_t h) {
    if (!validSize(w, h)) return fail("TN_WASM_RESIZE: size invalid");
    width = w;
    height = h;
    if (renderer) configureSurface();
    return 0;
}

/** Draws `scene` from `camera` into the canvas; the browser presents it at its animation boundary. */
extern "C" int tnw_web_render(const tn_handle_t* sceneHandle, const tn_handle_t* cameraHandle, double r, double g,
                              double b, double a) {
    tnw_web_poll();
    if (state != Ready) return fail(state == Pending ? "TN_WASM_RENDER: device not ready" : failure);
    auto* scene = objectAs<Scene>(sceneHandle, "Scene");
    auto* camera = cameraOf(cameraHandle);
    if (scene == nullptr || camera == nullptr) return fail("TN_WASM_RENDER: scene or camera handle invalid");
    WGPUSurfaceTexture frame = {};
    wgpuSurfaceGetCurrentTexture(surface, &frame);
    if (frame.texture == nullptr) return fail("TN_WASM_SURFACE: no canvas texture");
    WGPUTextureView view = wgpuTextureCreateView(frame.texture, nullptr);
    {
        Renderer::PresentScope present(*renderer, view, surfaceFormat);
        database.render(*renderer, *scene, *camera, {r, g, b, a});
    }
    wgpuTextureViewRelease(view);
    wgpuTextureRelease(frame.texture);
    if (!database.diagnostics().empty()) return fail(database.diagnostics().front());
    return 0;
}

/**
 * three's RenderPipeline: the TSL graph between the scene and the output, by its tn_tsl_* id in
 * `context`, or none (null). The same graph again is a no-op, as RenderPipeline.render() hands it
 * every frame (PRD-540; the V8 player's setPostGraph).
 */
extern "C" int tnw_web_set_post(tn_context_t* context, const uint64_t* node) {
    static shader::graph::Node current;
    shader::graph::Node graph;
    if (node != nullptr) {
        graph = tn::abi::tslNode(context, *node);
        if (!graph) return fail("TN_WASM_POST: not a TSL node of this context");
    }
    if (graph == current) return 0;
    current = graph;
    if (state == Ready && renderer) renderer->setPostGraph(graph);
    else pendingPost = graph;
    return 0;
}

/** The last frame's draws (0) and triangles (1), as three's `renderer.info.render` reports them. */
extern "C" double tnw_web_frame(int field) {
    if (!renderer) return 0;
    return field == 0 ? double(renderer->lastFrame().draws) : double(renderer->lastFrame().triangles);
}
