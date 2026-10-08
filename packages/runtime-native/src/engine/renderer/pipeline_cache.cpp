#include "pipeline_cache.h"

#include "mystral/webgpu_compat.h"

namespace tn::engine {

namespace {

WGPUVertexFormat vertexFormat(const shader::Type& t) {
    using S = shader::Type::Scalar;
    if (t.scalar == S::U32) return t.rows == 4 ? WGPUVertexFormat_Uint32x4 : WGPUVertexFormat_Uint32;
    switch (t.rows) {
        case 1: return WGPUVertexFormat_Float32;
        case 2: return WGPUVertexFormat_Float32x2;
        case 3: return WGPUVertexFormat_Float32x3;
        default: return WGPUVertexFormat_Float32x4;
    }
}

WGPUShaderModule module(WGPUDevice device, const std::string& code) {
    WGPUShaderModuleWGSLDescriptor_Compat wgsl = {};
    WGPUShaderModuleDescriptor desc = {};
    setupShaderModuleWGSL(&desc, &wgsl, code.c_str());
    return wgpuDeviceCreateShaderModule(device, &desc);
}

}  // namespace

PipelineCache::~PipelineCache() {
    for (auto& [key, pipeline] : pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
}

bool PipelineCache::IdKey::operator==(const IdKey& o) const {
    return vertex == o.vertex && fragment == o.fragment && target.color == o.target.color &&
           target.depth == o.target.depth && target.cull == o.target.cull && target.blend == o.target.blend &&
           target.depthWrite == o.target.depthWrite && target.layout == o.target.layout &&
           target.skinIndex == o.target.skinIndex && target.frontFace == o.target.frontFace &&
           target.depthCompare == o.target.depthCompare;
}

size_t PipelineCache::IdKeyHash::operator()(const IdKey& key) const {
    size_t h = 0;
    const auto mix = [&](uint64_t v) { h = (h ^ v) * 0x9e3779b97f4a7c15ull; h ^= h >> 29; };
    mix(key.vertex);
    mix(key.fragment);
    mix(uint64_t(key.target.color) | uint64_t(key.target.depth) << 32);
    mix(uint64_t(key.target.cull) | uint64_t(key.target.frontFace) << 8 | uint64_t(key.target.depthCompare) << 16 |
        uint64_t(key.target.skinIndex) << 32 | uint64_t(key.target.blend) << 56 | uint64_t(key.target.depthWrite) << 57);
    mix(reinterpret_cast<uintptr_t>(key.target.layout));
    return h;
}

WGPURenderPipeline PipelineCache::get(const shader::StageModule& vertex, const shader::StageModule* fragment,
                                      const PipelineTarget& target) {
    // Emitted stages carry an id for their text; two ids and the target name a pipeline already
    // compiled without touching the text. An unnamed stage (id 0) falls back to the text itself.
    const bool named = vertex.wgsl.id != 0 && (!fragment || fragment->wgsl.id != 0);
    const IdKey idKey{vertex.wgsl.id, fragment ? fragment->wgsl.id : 0, target};
    if (named)
        if (const auto found = byId_.find(idKey); found != byId_.end()) return found->second;
    ++textLookups_;
    std::string key = vertex.wgsl.code;
    key += '\x1f';
    if (fragment) key += fragment->wgsl.code;
    key += '\x1f' + std::to_string(target.color) + ':' + std::to_string(target.depth) + ':' +
           std::to_string(target.cull) + ':' + std::to_string(target.blend) + ':' + std::to_string(target.depthWrite) +
           ':' + std::to_string(reinterpret_cast<uintptr_t>(target.layout)) + ':' + std::to_string(target.skinIndex) +
           ':' + std::to_string(target.frontFace) + ':' + std::to_string(target.depthCompare);
    if (const auto found = pipelines_.find(key); found != pipelines_.end()) {
        if (named) byId_.emplace(idKey, found->second);  // the same text under another id
        return found->second;
    }

    // One vertex buffer per attribute, in location order: the renderer binds them the same way. The
    // instance attributes step per instance; the four instance-matrix columns are one mat4 per
    // instance, the same buffer bound four times at offsets 0, 16, 32 and 48.
    std::vector<WGPUVertexAttribute> attributes(vertex.attributes.size());
    std::vector<WGPUVertexBufferLayout> buffers(vertex.attributes.size());
    for (size_t i = 0; i < vertex.attributes.size(); ++i) {
        const shader::Type& t = vertex.attributes[i].type;
        const std::string& name = vertex.attributes[i].name;
        const bool matrixColumn = name.rfind("instanceMatrix", 0) == 0;
        attributes[i] = {};
        const bool skinIndex = name == "skinIndex";
        attributes[i].format = skinIndex ? target.skinIndex : vertexFormat(t);
        attributes[i].shaderLocation = vertex.attributes[i].location;
        buffers[i] = {};
        buffers[i].arrayStride = matrixColumn ? 64
                                 : skinIndex  ? (target.skinIndex == WGPUVertexFormat_Uint8x4    ? 4
                                                 : target.skinIndex == WGPUVertexFormat_Uint16x4 ? 8
                                                                                                 : 16)
                                              : uint64_t{t.rows} * 4;
        buffers[i].stepMode = matrixColumn || name == "instanceColor" ? WGPUVertexStepMode_Instance : WGPUVertexStepMode_Vertex;
        buffers[i].attributeCount = 1;
        buffers[i].attributes = &attributes[i];
    }
    WGPUShaderModule vs = module(device_, vertex.wgsl.code);
    WGPUShaderModule fs = fragment ? module(device_, fragment->wgsl.code) : nullptr;
    WGPURenderPipelineDescriptor desc = {};
    desc.layout = target.layout;
    desc.vertex.module = vs;
    WGPU_SET_ENTRY_POINT(desc.vertex, "main");
    desc.vertex.bufferCount = buffers.size();
    desc.vertex.buffers = buffers.data();
    desc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    desc.primitive.cullMode = target.cull;
    desc.primitive.frontFace = target.frontFace;
    desc.multisample.count = 1;
    desc.multisample.mask = 0xffffffffu;
    WGPUDepthStencilState depth = {};
    depth.format = target.depth;
    depth.depthWriteEnabled = target.depthWrite ? WGPU_OPTIONAL_BOOL_TRUE : WGPU_OPTIONAL_BOOL_FALSE;
    depth.depthCompare = target.depthCompare;
    if (target.depth != WGPUTextureFormat_Undefined) desc.depthStencil = &depth;
    WGPUColorTargetState color = {};
    color.format = target.color;
    color.writeMask = WGPUColorWriteMask_All;
    // WebGPUPipelineUtils._getBlending, NormalBlending without premultiplied alpha.
    WGPUBlendState blend = {};
    blend.color = {WGPUBlendOperation_Add, WGPUBlendFactor_SrcAlpha, WGPUBlendFactor_OneMinusSrcAlpha};
    blend.alpha = {WGPUBlendOperation_Add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha};
    if (target.blend) color.blend = &blend;
    WGPUFragmentState fragmentState = {};
    if (fs && target.color != WGPUTextureFormat_Undefined) {
        fragmentState.module = fs;
        WGPU_SET_ENTRY_POINT(fragmentState, "main");
        fragmentState.targetCount = 1;
        fragmentState.targets = &color;
        desc.fragment = &fragmentState;
    }
    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device_, &desc);
    wgpuShaderModuleRelease(vs);
    if (fs) wgpuShaderModuleRelease(fs);
    ++compiles_;
    pipelines_.emplace(std::move(key), pipeline);
    if (named) byId_.emplace(idKey, pipeline);
    return pipeline;
}

}  // namespace tn::engine
