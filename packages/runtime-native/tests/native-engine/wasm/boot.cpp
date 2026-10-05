// PRD-532 phase 1-2: the engine boots in a browser over its WebGPU (emdawnwebgpu) and reports what
// it found. Initialization is asynchronous end to end: the adapter and device arrive by callback,
// and a per-frame tick (emscripten_set_main_loop) polls the device and drains the engine's event
// queue at the frame boundary, as the native host does. Nothing here waits or blocks.
//
// What the page reads back, as globalThis.__tnNativeCore (the playtest bridge publishes it):
//   boot       adapter info, the lit-render fixture's frame and how much of it is covered (the
//              page compares that frame with the desktop's, PRD-532 box 61);
//   memory     a retained buffer view across Wasm memory growth and a store reallocation;
//   callbacks  callbacks delivered (a readback every 10 ticks after boot) and how many ran inside a
//              renderer call (must stay zero);
//   threads    whether this build has threads (it has none: the engine is single-threaded).

#include "engine/foundation/buffers.h"
#include "engine/renderer/render_database.h"
#include "engine/scene/geometries.h"

#include <emscripten/emscripten.h>
#include <emscripten/heap.h>
#include <webgpu/webgpu.h>

#include <array>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace tn::engine;

namespace {

std::string text(WGPUStringView view) {
    if (view.data == nullptr) return {};
    return view.length == WGPU_STRLEN ? std::string(view.data) : std::string(view.data, view.length);
}

std::string quoted(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') out += '\\';
        if (static_cast<unsigned char>(c) >= 0x20) out += c;
    }
    return out + "\"";
}

struct Boot {
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    std::string adapterInfo;
    std::string error;
    EventQueue events;
    std::unique_ptr<Renderer> renderer;
    std::unique_ptr<RenderDatabase> database;
    std::unique_ptr<Scene> scene;
    std::unique_ptr<PerspectiveCamera> camera;
    std::unique_ptr<Mesh> mesh;
    std::unique_ptr<DirectionalLight> light;
    std::unique_ptr<HemisphereLight> sky;
    enum class Phase { Adapter, Device, Render, Readback, Done } phase = Phase::Adapter;
    int frames = 0;
    double covered = -1;
    std::string memory = "null";
    // Callback delivery (box 55): set while the engine is inside a renderer call.
    bool insideRenderer = false;
    int callbacks = 0;
    int reentrant = 0;
};

Boot boot;

void publish(const std::string& memory) {
    std::string json = "{\"initialized\": " + std::string(boot.phase == Boot::Phase::Done && boot.error.empty() ? "true" : "false") +
                       ", \"adapter\": " + quoted(boot.adapterInfo) + ", \"error\": " + quoted(boot.error) +
                       ", \"frames\": " + std::to_string(boot.frames) + ", \"covered\": " + std::to_string(boot.covered) +
                       ", \"callbacks\": " + std::to_string(boot.callbacks) + ", \"reentrantCallbacks\": " +
                       std::to_string(boot.reentrant) + ", \"threads\": " +
#if defined(__EMSCRIPTEN_PTHREADS__)
                       "true"
#else
                       "false"
#endif
                       + ", \"memory\": " + memory + "}";
    EM_ASM({ globalThis.__tnNativeCore = JSON.parse(UTF8ToString($0)); }, json.c_str());
}

void fail(const std::string& message) {
    boot.error = message;
    boot.phase = Boot::Phase::Done;
    publish("null");
}

// Box 54: a retained view over a store, across Wasm memory growth and then a reallocation of the
// store itself. Growth never moves linear-memory addresses, so the view stays valid; the
// reallocation moves the bytes, so the view reports stale and its next read resolves the new
// storage. Either way it never reads freed memory.
std::string memoryCheck() {
    BufferStore store(Scalar::F32, 4);
    const float values[4] = {1, 2, 3, 4};
    store.write(0, values, sizeof values);
    BufferView view(store);
    const std::byte* before = view.bytes().data();
    const size_t heapBefore = emscripten_get_heap_size();
    std::vector<std::unique_ptr<std::vector<std::byte>>> ballast;  // forces WebAssembly.Memory.grow
    while (emscripten_get_heap_size() < heapBefore + (64u << 20)) {
        ballast.push_back(std::make_unique<std::vector<std::byte>>(8u << 20));
    }
    const size_t heapAfter = emscripten_get_heap_size();
    const bool samePlaceAfterGrowth = view.bytes().data() == before && !view.stale();
    float afterGrowth[4];
    std::memcpy(afterGrowth, view.bytes().data(), sizeof afterGrowth);
    store.resize(1 << 16);  // the store reallocates
    const bool staleAfterResize = view.stale();
    float afterResize[4];
    std::memcpy(afterResize, view.bytes().data(), sizeof afterResize);
    const bool refreshed = !view.stale() && std::memcmp(afterResize, values, sizeof values) == 0;
    const bool intact = std::memcmp(afterGrowth, values, sizeof values) == 0;
    return "{\"heapBefore\": " + std::to_string(heapBefore) + ", \"heapAfter\": " + std::to_string(heapAfter) +
           ", \"grew\": " + (heapAfter > heapBefore ? "true" : "false") +
           ", \"validAcrossGrowth\": " + (samePlaceAfterGrowth && intact ? "true" : "false") +
           ", \"staleAfterReallocation\": " + (staleAfterResize ? "true" : "false") +
           ", \"refreshedAfterReallocation\": " + (refreshed ? "true" : "false") + "}";
}

constexpr int kWidth = 320;
constexpr int kHeight = 240;
constexpr std::array<double, 4> kClear = {0.05, 0.06, 0.08, 1};

// The lit-render fixture's scene, exactly as the desktop's native_engine_renderer_scene_lit builds it
// (render_database_test.cpp LitScene), so the two frames can be compared (box 61).
void buildScene() {
    boot.renderer = std::make_unique<Renderer>(boot.instance, boot.device, wgpuDeviceGetQueue(boot.device), boot.events);
    boot.renderer->setSize(kWidth, kHeight);
    boot.renderer->setOutput(OutputState{shader::ToneMapping::ACESFilmic, 1, true});
    boot.database = std::make_unique<RenderDatabase>();
    boot.scene = std::make_unique<Scene>();
    boot.camera = std::make_unique<PerspectiveCamera>();
    boot.camera->fov = 60;
    boot.camera->aspect = 4.0 / 3;
    boot.camera->near = 0.1;
    boot.camera->far = 100;
    boot.camera->position.y = 1.4;
    boot.camera->position.z = 3.2;
    boot.camera->lookAt(0, 0, 0);
    boot.camera->updateProjectionMatrix();
    auto material = std::make_shared<Material>(MaterialType::Standard);
    material->color.setRGB(0.8, 0.35, 0.2);
    material->roughness = 0.35;
    material->metalness = 0.1;
    boot.mesh = std::make_unique<Mesh>(makeSphereGeometry(1, 32, 16), material);
    boot.light = std::make_unique<DirectionalLight>(Color().setHex(0xffffff), 3);
    boot.light->position.set(2, 3, 1);
    boot.sky = std::make_unique<HemisphereLight>(Color().setHex(0xaabb91), Color().setHex(0x222222), 0.6);
    boot.scene->add(*boot.mesh);
    boot.scene->add(*boot.light);
    boot.scene->add(*boot.sky);
    boot.scene->updateMatrixWorld(true);
}

void tick() {
    static int ticks = 0;
    EM_ASM({ globalThis.__tnNativeTicks = $0; }, ++ticks);  // the playtest bridge's fixed step
    // The frame boundary: poll the device, then run what its callbacks posted.
    if (boot.renderer) {
        boot.renderer->poll();
        boot.callbacks += static_cast<int>(boot.events.drain());
    } else if (boot.instance) {
        wgpuInstanceProcessEvents(boot.instance);
    }
    switch (boot.phase) {
        case Boot::Phase::Render: {
            boot.insideRenderer = true;
            boot.database->render(*boot.renderer, *boot.scene, *boot.camera, kClear);
            boot.renderer->readPixels([](GpuStatus status, std::vector<uint8_t> px) {
                if (boot.insideRenderer) ++boot.reentrant;  // a callback inside a renderer call
                if (status != GpuStatus::Ok || px.size() != size_t(kWidth) * kHeight * 4) return fail("readPixels failed");
                // Covered: pixels that differ from the corner, which is the clear colour.
                size_t lit = 0;
                for (size_t i = 0; i + 3 < px.size(); i += 4)
                    lit += px[i] != px[0] || px[i + 1] != px[1] || px[i + 2] != px[2];
                boot.covered = double(lit) / double(kWidth * kHeight);
                // The frame itself, for the page's comparison with the desktop's.
                EM_ASM({ globalThis.__tnLitPixels = HEAPU8.slice($0, $0 + $1); }, px.data(), px.size());
                boot.memory = memoryCheck();
                boot.phase = Boot::Phase::Done;  // published on the next tick, with this drain counted
            });
            boot.insideRenderer = false;
            boot.phase = Boot::Phase::Readback;
            break;
        }
        case Boot::Phase::Readback:
            if (++boot.frames > 600) fail("readback never completed");
            break;
        case Boot::Phase::Done:
            if (!boot.error.empty()) break;
            // After boot the engine keeps rendering and reading back every 10 ticks, so callback
            // delivery is exercised for the whole scenario, not only once at startup.
            if (++boot.frames % 10 == 0) {
                boot.insideRenderer = true;
                boot.database->render(*boot.renderer, *boot.scene, *boot.camera, kClear);
                boot.renderer->readPixels([](GpuStatus, std::vector<uint8_t>) {
                    if (boot.insideRenderer) ++boot.reentrant;
                });
                boot.insideRenderer = false;
            }
            publish(boot.memory);
            break;
        default:
            break;
    }
}

void onDevice(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView message, void*, void*) {
    if (boot.insideRenderer) ++boot.reentrant;
    if (status != WGPURequestDeviceStatus_Success) return fail("requestDevice: " + text(message));
    boot.device = device;
    buildScene();
    boot.phase = Boot::Phase::Render;
}

void onAdapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message, void*, void*) {
    if (status != WGPURequestAdapterStatus_Success) return fail("requestAdapter: " + text(message));
    boot.adapter = adapter;
    WGPUAdapterInfo info = {};
    wgpuAdapterGetInfo(adapter, &info);
    boot.adapterInfo = text(info.vendor) + " " + text(info.architecture) + " " + text(info.description);
    wgpuAdapterInfoFreeMembers(info);
    WGPUDeviceDescriptor desc = {};
    if (wgpuAdapterHasFeature(adapter, WGPUFeatureName_TimestampQuery)) {
        static const WGPUFeatureName features[] = {WGPUFeatureName_TimestampQuery};
        desc.requiredFeatureCount = 1;
        desc.requiredFeatures = features;
    }
    WGPURequestDeviceCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onDevice;
    boot.phase = Boot::Phase::Device;
    wgpuAdapterRequestDevice(adapter, &desc, callback);
}

}  // namespace

int main() {
    boot.instance = wgpuCreateInstance(nullptr);
    if (boot.instance == nullptr) {
        fail("wgpuCreateInstance returned null (no WebGPU in this browser)");
        return 0;
    }
    WGPURequestAdapterCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onAdapter;
    wgpuInstanceRequestAdapter(boot.instance, nullptr, callback);
    publish("null");
    emscripten_set_main_loop(tick, 0, false);
    return 0;
}
