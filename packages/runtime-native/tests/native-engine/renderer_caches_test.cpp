#include "check.h"
#include "engine/renderer/geometry_cache.h"
#include "engine/renderer/pipeline_cache.h"
#include "engine/shader/standard.h"
#include "mystral/webgpu/context.h"

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
}

void pipelines() {
    Device d;
    CHECK(d.ok);
    if (!d.ok) return;
    const shader::StandardPrograms standard = shader::buildStandard(shader::StandardMaterial{});
    const shader::StageModule vs = shader::buildStage(standard.vertex, 0);
    const shader::StageModule fs = shader::buildStage(standard.fragment, 1);
    PipelineCache cache(d.context.getDevice());
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
    WGPUPipelineLayout layoutA = wgpuDeviceCreatePipelineLayout(d.context.getDevice(), &layoutDesc);
    WGPUPipelineLayout layoutB = wgpuDeviceCreatePipelineLayout(d.context.getDevice(), &layoutDesc);
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

}  // namespace

TN_TEST_MAIN({"geometry", geometry}, {"pipelines", pipelines})
