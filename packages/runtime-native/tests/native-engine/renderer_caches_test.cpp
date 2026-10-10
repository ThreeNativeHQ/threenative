#include "check.h"
#include "engine/renderer/geometry_cache.h"
#include "engine/renderer/pipeline_cache.h"
#include "engine/renderer/render_database.h"
#include "engine/scene/geometries.h"
#include "engine/shader/standard.h"
#include "mystral/webgpu/context.h"
#include "mystral/webgpu_compat.h"

#include <chrono>
#include <cstring>
#include <thread>

using namespace tn::engine;

namespace {

struct Device {
    mystral::webgpu::Context context;
    EventQueue events;
    bool ok = context.initializeHeadless();
};

std::vector<uint8_t> readBack(GpuResources& gpu, EventQueue& events, Handle buffer, uint64_t size) {
    std::vector<uint8_t> out;
    bool done = false;
    gpu.readBuffer(buffer, 0, size, [&](GpuStatus, std::vector<uint8_t> b) {
        out = std::move(b);
        done = true;
    });
    for (int i = 0; i < 2000 && !done; ++i) {
        gpu.poll();
        events.drain();
        if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return out;
}

std::vector<uint8_t> bytesOf(const BufferStore& s, uint64_t size) {
    return std::vector<uint8_t>(reinterpret_cast<const uint8_t*>(s.data()), reinterpret_cast<const uint8_t*>(s.data()) + size);
}

void geometry() {
    Device d;
    CHECK(d.ok);
    if (!d.ok) return;
    GpuResources gpu(d.context.getInstance(), d.context.getDevice(), d.context.getQueue(), d.events, 1);
    GeometryCache cache(gpu);
    BufferStore positions(Scalar::F32, 300);
    for (int i = 0; i < 300; ++i) {
        const float v = i * 0.5f;
        positions.write(i * 4, &v, 4);
    }
    const uint32_t usage = WGPUBufferUsage_Vertex | WGPUBufferUsage_CopySrc;
    const Handle first = cache.sync(positions, usage);
    CHECK(cache.stats().fullUploads == 1);
    // A new store's first copy is written into the buffer as it is created, as three's backend does:
    // a browser queue write of that size waits on the GPU process's command stream.
    CHECK(gpu.queueWriteBytes() == 0);
    CHECK(readBack(gpu, d.events, first, 1200) == bytesOf(positions, 1200));

    for (int frame = 0; frame < 300; ++frame) CHECK(cache.sync(positions, usage).index == first.index);
    CHECK(cache.stats().fullUploads == 1 && cache.stats().rangeUploads == 0);  // unchanged: nothing moves

    const float changed = 42;
    positions.write(10 * 4, &changed, 4);
    positions.write(11 * 4, &changed, 4);
    positions.addUpdateRange(10, 2);
    positions.needsUpdate();
    cache.sync(positions, usage);
    CHECK(cache.stats().rangeUploads == 1 && cache.stats().fullUploads == 1);
    CHECK(positions.updateRanges().empty());                                  // consumed, as three's renderer does
    CHECK(gpu.queueWriteBytes() == 8);                                        // an update writes only its range
    CHECK(readBack(gpu, d.events, first, 1200) == bytesOf(positions, 1200));

    positions.write(0, &changed, 4);
    positions.needsUpdate();                                                  // no ranges: the whole store
    cache.sync(positions, usage);
    CHECK(cache.stats().fullUploads == 2);
    CHECK(readBack(gpu, d.events, first, 1200) == bytesOf(positions, 1200));

    positions.resize(600);                                                    // storage moved: a new GPU copy
    const Handle grown = cache.sync(positions, usage);
    CHECK(grown.index != first.index || grown.generation != first.generation);
    CHECK(readBack(gpu, d.events, grown, 2400) == bytesOf(positions, 2400));

    BufferStore index(Scalar::U16, 3);                                        // 6 bytes: a partial final word
    const uint16_t tri[3] = {7, 8, 9};
    index.write(0, tri, 6);
    const Handle indexBuffer = cache.sync(index, WGPUBufferUsage_Index | WGPUBufferUsage_CopySrc);
    const auto got = readBack(gpu, d.events, indexBuffer, 8);
    CHECK(got.size() == 8 && std::memcmp(got.data(), tri, 6) == 0);

    // three's geometry.dispose(): the next sweep lets the GPU copy go while the store lives on, and
    // drawing the store again uploads it whole.
    auto shared = std::make_shared<BufferStore>(Scalar::F32, 30);
    cache.sync(*shared, usage);
    const size_t held = cache.entries();
    const uint64_t uploads = cache.stats().fullUploads;
    shared->releaseGpuCopy();
    cache.sweep();
    CHECK(cache.entries() == held - 1);
    cache.sync(*shared, usage);
    CHECK(cache.entries() == held && cache.stats().fullUploads == uploads + 1);
    // A released store's copy goes at the next sweep, which reads no field of the freed store.
    shared.reset();
    cache.sweep();
    CHECK(cache.entries() == held - 1);
}

// Dawn's Null backend validates the real renderer/cache path without a GPU or browser.
struct CompileDevice {
    WGPUInstance instance = wgpuCreateInstance(nullptr);
    WGPUDevice device = nullptr;
    WGPUQueue queue = nullptr;
    EventQueue events;
    CompileDevice() {
        WGPUAdapter adapter = nullptr;
        bool done = false;
        WGPURequestAdapterOptions options = {};
        options.backendType = WGPUBackendType_Null;
        WGPURequestAdapterCallbackInfo callback = {};
        callback.mode = WGPUCallbackMode_AllowProcessEvents;
        callback.userdata1 = &adapter; callback.userdata2 = &done;
        callback.callback = [](WGPURequestAdapterStatus, WGPUAdapter result, WGPUStringView, void* out, void* done) {
            *static_cast<WGPUAdapter*>(out) = result; *static_cast<bool*>(done) = true;
        };
        wgpuInstanceRequestAdapter(instance, &options, callback);
        while (!done) wgpuInstanceProcessEvents(instance);
        if (!adapter) return;
        done = false;
        WGPURequestDeviceCallbackInfo deviceCallback = {};
        deviceCallback.mode = WGPUCallbackMode_AllowProcessEvents;
        deviceCallback.userdata1 = &device; deviceCallback.userdata2 = &done;
        deviceCallback.callback = [](WGPURequestDeviceStatus, WGPUDevice result, WGPUStringView, void* out, void* done) {
            *static_cast<WGPUDevice*>(out) = result; *static_cast<bool*>(done) = true;
        };
        wgpuAdapterRequestDevice(adapter, nullptr, deviceCallback);
        while (!done) wgpuInstanceProcessEvents(instance);
        wgpuAdapterRelease(adapter);
        if (device) queue = wgpuDeviceGetQueue(device);
    }
    ~CompileDevice() {
        if (queue) wgpuQueueRelease(queue);
        if (device) wgpuDeviceRelease(device);
        if (instance) wgpuInstanceRelease(instance);
    }
};

void pipelines() {
    CompileDevice d;
    CHECK(d.device != nullptr);
    if (!d.device) return;
    const shader::StandardPrograms standard = shader::buildStandard(shader::StandardMaterial{});
    const shader::StageModule vs = shader::buildStage(standard.vertex, 0);
    const shader::StageModule fs = shader::buildStage(standard.fragment, 1);
    PipelineCache cache(d.device);
    const PipelineTarget color{};
    WGPURenderPipeline first = cache.get(vs, &fs, color);
    CHECK(first != nullptr);
    for (int frame = 0; frame < 300; ++frame) CHECK(cache.get(vs, &fs, color) == first);
    CHECK(cache.compiles() == 1);
    const PipelineTarget shadow{WGPUTextureFormat_Undefined, WGPUTextureFormat_Depth32Float, WGPUCullMode_Back};
    WGPURenderPipeline depthOnly = cache.get(vs, nullptr, shadow);
    CHECK(depthOnly != nullptr && depthOnly != first);
    CHECK(cache.get(vs, nullptr, shadow) == depthOnly);
    CHECK(cache.compiles() == 2);

    // Emitted stages answer from their ids: after the first lookup of each, no text is built.
    const uint64_t texts = cache.textLookups();
    for (int frame = 0; frame < 300; ++frame)
        CHECK(cache.get(vs, &fs, color) == first && cache.get(vs, nullptr, shadow) == depthOnly);
    CHECK(cache.textLookups() == texts);

    // The same programs emitted again have new ids and the same text: one pipeline, still.
    const shader::StageModule vs2 = shader::buildStage(standard.vertex, 0);
    const shader::StageModule fs2 = shader::buildStage(standard.fragment, 1);
    CHECK(vs2.wgsl.id != 0 && vs2.wgsl.id != vs.wgsl.id && vs2.wgsl.code == vs.wgsl.code);
    CHECK(cache.get(vs2, &fs2, color) == first);
    CHECK(cache.get(vs2, &fs2, color) == first && cache.compiles() == 2);

    // An unnamed stage (id 0) is keyed by its text; edited text is a different pipeline.
    shader::StageModule unnamed = vs;
    unnamed.wgsl.id = 0;
    CHECK(cache.get(unnamed, &fs, color) == first && cache.compiles() == 2);
    shader::StageModule edited = vs;
    edited.wgsl.id = 0;
    edited.wgsl.code += "\n// edited\n";
    WGPURenderPipeline other = cache.get(edited, &fs, color);
    CHECK(other != nullptr && other != first && cache.compiles() == 3);

    // Every field of the target is part of the key, by id as by text.
    PipelineTarget blended = color;
    blended.blend = true;
    WGPURenderPipeline blend = cache.get(vs, &fs, blended);
    CHECK(blend != nullptr && blend != first && cache.get(vs, &fs, blended) == blend);
    PipelineTarget noDepthWrite = color;
    noDepthWrite.depthWrite = false;
    PipelineTarget back = color;
    back.cull = WGPUCullMode_None;
    PipelineTarget cw = color;
    cw.frontFace = WGPUFrontFace_CW;
    PipelineTarget always = color;
    always.depthCompare = WGPUCompareFunction_Always;
    PipelineTarget wide = color;
    wide.skinIndex = WGPUVertexFormat_Uint32x4;
    for (const PipelineTarget& t : {noDepthWrite, back, cw, always, wide}) {
        WGPURenderPipeline p = cache.get(vs, &fs, t);
        CHECK(p != nullptr && p != first && p != blend && cache.get(vs, &fs, t) == p);
    }
    CHECK(cache.size() == 9);

    // A forgotten id reset: text edited after emit but still carrying the old id is a new key.
    shader::StageModule stale = vs;
    stale.wgsl.code += "\n// stale id\n";
    CHECK(stale.wgsl.id == vs.wgsl.id);
    WGPURenderPipeline staleP = cache.get(stale, &fs, color);
    CHECK(staleP != nullptr && staleP != first && staleP != other && cache.get(stale, &fs, color) == staleP);

    // The depth format and the pipeline layout are part of the key too.
    PipelineTarget depth24 = color;
    depth24.depth = WGPUTextureFormat_Depth24Plus;
    WGPURenderPipeline d24 = cache.get(vs, &fs, depth24);
    CHECK(d24 != nullptr && d24 != first && d24 != blend && cache.get(vs, &fs, depth24) == d24);
    WGPUBindGroupLayout groups[2] = {wgpuRenderPipelineGetBindGroupLayout(first, 0), wgpuRenderPipelineGetBindGroupLayout(first, 1)};
    WGPUPipelineLayoutDescriptor layoutDesc = {};
    layoutDesc.bindGroupLayoutCount = 2;
    layoutDesc.bindGroupLayouts = groups;
    WGPUPipelineLayout layoutA = wgpuDeviceCreatePipelineLayout(d.device, &layoutDesc);
    WGPUPipelineLayout layoutB = wgpuDeviceCreatePipelineLayout(d.device, &layoutDesc);
    PipelineTarget withA = color, withB = color;
    withA.layout = layoutA;
    withB.layout = layoutB;
    WGPURenderPipeline pa = cache.get(vs, &fs, withA), pb = cache.get(vs, &fs, withB);
    CHECK(pa != nullptr && pb != nullptr && pa != pb && pa != first && cache.get(vs, &fs, withA) == pa && cache.get(vs, &fs, withB) == pb);
    wgpuPipelineLayoutRelease(layoutA);
    wgpuPipelineLayoutRelease(layoutB);
    wgpuBindGroupLayoutRelease(groups[0]);
    wgpuBindGroupLayoutRelease(groups[1]);
}

// Baseline has no native compile entry: the first render exposes the missed pipeline work.
template <class Database>
void compileScene(Database& database, Renderer& renderer, Object3D& root, Camera& camera, Object3D* scene = nullptr) {
    if constexpr (requires { database.compileAsync(renderer, root, camera, scene); }) {
        const auto pipelines = database.compileAsync(renderer, root, camera, scene);
        for (const auto& pipeline : pipelines) {
            for (int i = 0; i < 2000 && !pipeline->ready(); ++i)
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            CHECK(pipeline->ready());
            if (pipeline->ready()) CHECK(pipeline->get() != nullptr);
        }
    }
}

void compileBeforeRender() {
    CompileDevice d;
    CHECK(d.device != nullptr);
    if (!d.device) return;
    Renderer renderer(d.instance, d.device, d.queue, d.events);
    renderer.setSize(32, 32);
    RenderDatabase database;
    Scene scene;
    PerspectiveCamera camera;
    camera.position.z = 8;
    auto geometry = makeBoxGeometry();
    auto material = std::make_shared<Material>(MaterialType::Standard);
    auto map = std::make_shared<Texture>();
    map->width = map->height = 2;
    map->data.assign(16, 255);
    material->maps["map"] = map;
    std::vector<std::shared_ptr<Mesh>> meshes;
    for (int i = 0; i < 5; ++i) {
        auto mesh = std::make_shared<Mesh>(geometry, material);
        mesh->position.x = (i - 2) * 0.25;
        mesh->setCastShadow(true);
        mesh->setReceiveShadow(true);
        scene.add(*mesh);
        meshes.push_back(mesh);
    }
    auto glass = std::make_shared<Material>(MaterialType::Basic);
    glass->transparent = true;
    glass->side = Side::Double;
    glass->opacity = 0.3;
    Mesh transparent(geometry, glass);
    scene.add(transparent);
    DirectionalLight sun;
    sun.setCastShadow(true);
    scene.add(sun);
    database.shadowMapEnabled = true;
    compileScene(database, renderer, scene, camera);
    const uint64_t compiled = renderer.pipelines().compiles();
    CHECK(compiled > 0);
    CHECK(renderer.lastFrame().draws == 0);  // compiling must not draw a warm-up frame
    database.render(renderer, scene, camera);
    CHECK(renderer.pipelines().compiles() == compiled);  // after compileAsync, render compiles 0 pipelines
    CHECK(renderer.lastFrame().draws > 0);
    compileScene(database, renderer, scene, camera);
    CHECK(renderer.pipelines().compiles() == compiled);  // repeated compile is a lookup

    // The frame's synchronous fallback still builds a newly introduced material variant.
    auto changed = std::make_shared<Material>(MaterialType::Phong);
    transparent.material = changed;
    database.render(renderer, scene, camera);
    CHECK(renderer.pipelines().compiles() > compiled);

    // Three's three-argument form borrows lights and fog from the target scene, not its meshes.
    Scene context;
    Group root;
    Mesh object(geometry, material);
    root.add(object);
    context.add(root);
    DirectionalLight light;
    context.add(light);
    context.fog = std::make_shared<Fog>(Color(0.2, 0.3, 0.4), 1, 20);
    compileScene(database, renderer, root, camera, &context);
    const auto withContext = renderer.pipelines().compiles();
    database.render(renderer, context, camera);
    CHECK(renderer.pipelines().compiles() == withContext);
}

}  // namespace

TN_TEST_MAIN({"geometry", geometry}, {"pipelines", pipelines}, {"compile_before_render", compileBeforeRender})
