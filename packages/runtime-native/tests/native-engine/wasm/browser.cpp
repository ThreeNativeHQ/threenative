// PRD-532: browser host seam only. Scene algorithms, WGSL generation, rendering and TNPK loading
// are the same C++ libraries as desktop; JS authors objects through the existing catalog ABI.
#include "engine/abi/abi_internal.h"
#include "engine/renderer/package_loader.h"
#include "engine/renderer/render_database.h"

#include <emscripten/emscripten.h>

#include <cmath>
#include <cstring>
#include <memory>
#include <string>

using namespace tn::engine;

namespace {
constexpr uint32_t kWidth = 320, kHeight = 240;
WGPUInstance instance = nullptr;
WGPUDevice device = nullptr;
WGPUQueue queue = nullptr;
WGPUSurface surface = nullptr;
WGPUTextureFormat surfaceFormat = WGPUTextureFormat_Undefined;
EventQueue events;
std::unique_ptr<Renderer> renderer;
RenderDatabase database;
std::shared_ptr<Scene> scene;
std::shared_ptr<PerspectiveCamera> camera;
bool reading = false, loading = false, failed = false;

std::string text(WGPUStringView value) {
    if (value.data == nullptr) return {};
    return value.length == WGPU_STRLEN ? std::string(value.data) : std::string(value.data, value.length);
}

int fail(const std::string& message) {
    failed = true;
    EM_ASM({ globalThis.__tnWasmAssets = globalThis.__tnWasmAssets || {}; globalThis.__tnWasmAssets.error = UTF8ToString($0); }, message.c_str());
    return 1;
}

template <class T>
std::shared_ptr<T> unwrap(const tn_handle_t* handle, const char* expected) {
    if (handle == nullptr) return {};
    auto* object = tn::abi::objectOf(*handle);
    if (object == nullptr || object->cls != expected) return {};
    return std::static_pointer_cast<T>(object->ptr);
}

// Shared by the CPU check and GPU load. No malformed or unverified bytes reach the GPU.
bool packageOf(const uint8_t* bytes, uint32_t size, assets::Package& package, assets::PackageError& error) {
    if (!assets::parsePackage({bytes, size}, package, error) ||
        !assets::verifyPackage(package, assets::targetDecoders(), error)) return false;
    if (package.entries.size() != 1 || package.entries[0].name != "geometry/positions" ||
        package.entries[0].kind != static_cast<uint16_t>(assets::EntryKind::Buffer)) {
        error = {"TN_PACKAGE_ENTRY", "expected one geometry/positions buffer"};
        return false;
    }
    auto data = package.data(package.entries[0]);
    if (data.empty() || data.size() % (9 * sizeof(float)) != 0) {
        error = {"TN_PACKAGE_ENTRY", "positions must contain complete f32 triangles"};
        return false;
    }
    for (size_t i = 0; i < data.size(); i += sizeof(float)) {
        float value;
        std::memcpy(&value, data.data() + i, sizeof value);
        if (!std::isfinite(value)) {
            error = {"TN_PACKAGE_ENTRY", "positions must be finite"};
            return false;
        }
    }
    return true;
}

void tick() {
    static int ticks = 0;
    EM_ASM({ globalThis.__tnWasmAssets.ticks = $0; }, ++ticks);
    if (renderer) {
        renderer->poll();
    } else if (instance) wgpuInstanceProcessEvents(instance);
    events.drain();
    if (failed || !renderer || !scene || !camera) return;
    database.render(*renderer, *scene, *camera, {0.02, 0.03, 0.04, 1});
    if (!database.diagnostics().empty()) return static_cast<void>(fail(database.diagnostics().front()));
    WGPUSurfaceTexture frame = {};
    wgpuSurfaceGetCurrentTexture(surface, &frame);
    if (frame.texture == nullptr) return static_cast<void>(fail("TN_WASM_SURFACE: no canvas texture"));
    WGPUTextureView view = wgpuTextureCreateView(frame.texture, nullptr);
    const bool presented = renderer->blitTo(queue, view, surfaceFormat);
    wgpuTextureViewRelease(view);
    wgpuTextureRelease(frame.texture);
    // Emdawn presents at the browser's animation boundary, not wgpuSurfacePresent (native-only).
    if (!presented) return static_cast<void>(fail("TN_WASM_SURFACE: blit refused"));
    if (reading) {
        reading = false;
        const auto stats = renderer->lastFrame();
        const auto status = renderer->readPixels([stats](GpuStatus status, std::vector<uint8_t> pixels) {
            if (status != GpuStatus::Ok || pixels.size() != size_t(kWidth) * kHeight * 4)
                return static_cast<void>(fail("TN_WASM_READBACK: failed"));
            size_t covered = 0;
            for (size_t i = 0; i < pixels.size(); i += 4)
                covered += pixels[i] != pixels[0] || pixels[i + 1] != pixels[1] || pixels[i + 2] != pixels[2];
            EM_ASM({
                Object.assign(globalThis.__tnWasmAssets, {
                    rendered: (globalThis.__tnWasmAssets.rendered ?? 0) + 1,
                    draws: $0, triangles: $1, covered: $2,
                });
            }, stats.draws, static_cast<double>(stats.triangles), double(covered) / (kWidth * kHeight));
        });
        if (status != GpuStatus::Ok) fail("TN_WASM_READBACK: refused");
    }
}

void onDevice(WGPURequestDeviceStatus status, WGPUDevice result, WGPUStringView message, void*, void*) {
    if (status != WGPURequestDeviceStatus_Success) return static_cast<void>(fail("requestDevice: " + text(message)));
    device = result;
    queue = wgpuDeviceGetQueue(device);
    WGPUSurfaceConfiguration config = {};
    config.device = device;
    config.format = surfaceFormat;
    config.usage = WGPUTextureUsage_RenderAttachment;
    config.width = kWidth;
    config.height = kHeight;
    config.presentMode = WGPUPresentMode_Fifo;
    config.alphaMode = WGPUCompositeAlphaMode_Opaque;
    wgpuSurfaceConfigure(surface, &config);
    renderer = std::make_unique<Renderer>(instance, device, queue, events);
    renderer->setSize(kWidth, kHeight);
    EM_ASM({ globalThis.__tnWasmAssets.initialized = true; });
}

void onAdapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message, void*, void*) {
    if (status != WGPURequestAdapterStatus_Success) return static_cast<void>(fail("requestAdapter: " + text(message)));
    WGPUAdapterInfo info = {};
    wgpuAdapterGetInfo(adapter, &info);
    const auto vendor = text(info.vendor), architecture = text(info.architecture), description = text(info.description);
    EM_ASM({ globalThis.__tnWasmAssets.adapter = Object.assign({}, {
        vendor: UTF8ToString($0), architecture: UTF8ToString($1), description: UTF8ToString($2),
    }); }, vendor.c_str(), architecture.c_str(), description.c_str());
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
} // namespace

extern "C" int tnw_init() {
    if (instance != nullptr) return fail("TN_WASM_INIT: already initialized");
    EM_ASM({ globalThis.__tnWasmAssets = Object.assign({}, { initialized: false, rendered: 0, packageLoaded: false }); });
    instance = wgpuCreateInstance(nullptr);
    if (instance == nullptr) return fail("TN_WASM_INIT: no WebGPU instance");
    WGPUEmscriptenSurfaceSourceCanvasHTMLSelector canvas = {};
    canvas.chain.sType = WGPUSType_EmscriptenSurfaceSourceCanvasHTMLSelector;
    canvas.selector = {"#c", WGPU_STRLEN};
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
    emscripten_set_main_loop(tick, 0, false);
    return 0;
}

extern "C" int tnw_render(const tn_handle_t* sceneHandle, const tn_handle_t* cameraHandle) {
    auto nextScene = unwrap<Scene>(sceneHandle, "Scene");
    auto nextCamera = unwrap<PerspectiveCamera>(cameraHandle, "PerspectiveCamera");
    if (!renderer || !nextScene || !nextCamera) return fail("TN_WASM_RENDER: device or scene/camera handle invalid");
    scene = std::move(nextScene);
    camera = std::move(nextCamera);
    reading = true;
    return 0;
}

extern "C" int tnw_verify_package(const uint8_t* bytes, uint32_t size) {
    assets::Package package;
    assets::PackageError error;
    if (!packageOf(bytes, size, package, error)) return fail(error.code + ": " + error.detail);
    return 0;
}

extern "C" int tnw_load_package(const uint8_t* bytes, uint32_t size, const tn_handle_t* geometryHandle) {
    assets::Package package;
    assets::PackageError error;
    if (!packageOf(bytes, size, package, error)) return fail(error.code + ": " + error.detail);
    auto geometry = unwrap<BufferGeometry>(geometryHandle, "BufferGeometry");
    if (!renderer || !geometry || loading) return fail("TN_WASM_PACKAGE: device/geometry invalid or load pending");
    std::vector<LoadedEntry> loaded;
    if (!loadPackage(package, renderer->gpu(), loaded, error)) return fail(error.code + ": " + error.detail);
    if (loaded.size() != 1) return fail("TN_WASM_PACKAGE: positions were not uploaded");
    const auto data = package.data(package.entries[0]);
    std::vector<uint8_t> expected(data.begin(), data.end());
    const Handle buffer = loaded[0].resource;
    loading = true;
    const auto status = renderer->gpu().readBuffer(buffer, 0, data.size(),
        [geometry, buffer, expected = std::move(expected)](GpuStatus status, std::vector<uint8_t> vertices) {
            loading = false;
            renderer->gpu().destroy(buffer);
            if (status != GpuStatus::Ok || vertices != expected)
                return static_cast<void>(fail("TN_WASM_PACKAGE: uploaded vertices differ"));
            auto attribute = std::make_shared<BufferAttribute>(Scalar::F32, vertices.size() / sizeof(float), 3);
            attribute->store->write(0, vertices.data(), vertices.size());
            geometry->setIndex(nullptr);
            geometry->setAttribute("position", attribute);
            EM_ASM({ globalThis.__tnWasmAssets.packageLoaded = true; globalThis.__tnWasmAssets.uploadedBytes = $0; }, vertices.size());
        });
    if (status != GpuStatus::Ok) {
        loading = false;
        renderer->gpu().destroy(buffer);
        return fail("TN_WASM_PACKAGE: readback refused");
    }
    return 0;
}
