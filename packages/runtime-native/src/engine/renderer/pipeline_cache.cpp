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

WGPURenderPipeline PipelineCache::get(const shader::StageModule& vertex, const shader::StageModule* fragment,
                                      const PipelineTarget& target) {
    std::string key = vertex.wgsl.code;
    key += '\x1f';
    if (fragment) key += fragment->wgsl.code;
    key += '\x1f' + std::to_string(target.color) + ':' + std::to_string(target.depth) + ':' + std::to_string(target.cull);
    if (const auto found = pipelines_.find(key); found != pipelines_.end()) return found->second;

    // One vertex buffer per attribute, in location order: the renderer binds them the same way.
    std::vector<WGPUVertexAttribute> attributes(vertex.attributes.size());
    std::vector<WGPUVertexBufferLayout> buffers(vertex.attributes.size());
    for (size_t i = 0; i < vertex.attributes.size(); ++i) {
        const shader::Type& t = vertex.attributes[i].type;
        attributes[i] = {};
        attributes[i].format = vertexFormat(t);
        attributes[i].shaderLocation = vertex.attributes[i].location;
        buffers[i] = {};
        buffers[i].arrayStride = uint64_t{t.rows} * 4;
        buffers[i].stepMode = WGPUVertexStepMode_Vertex;
        buffers[i].attributeCount = 1;
        buffers[i].attributes = &attributes[i];
    }
    WGPUShaderModule vs = module(device_, vertex.wgsl.code);
    WGPUShaderModule fs = fragment ? module(device_, fragment->wgsl.code) : nullptr;
    WGPURenderPipelineDescriptor desc = {};
    desc.vertex.module = vs;
    WGPU_SET_ENTRY_POINT(desc.vertex, "main");
    desc.vertex.bufferCount = buffers.size();
    desc.vertex.buffers = buffers.data();
    desc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    desc.primitive.cullMode = target.cull;
    desc.primitive.frontFace = WGPUFrontFace_CCW;
    desc.multisample.count = 1;
    desc.multisample.mask = 0xffffffffu;
    WGPUDepthStencilState depth = {};
    depth.format = target.depth;
    depth.depthWriteEnabled = WGPU_OPTIONAL_BOOL_TRUE;
    depth.depthCompare = WGPUCompareFunction_LessEqual;
    if (target.depth != WGPUTextureFormat_Undefined) desc.depthStencil = &depth;
    WGPUColorTargetState color = {};
    color.format = target.color;
    color.writeMask = WGPUColorWriteMask_All;
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
    return pipeline;
}

}  // namespace tn::engine
