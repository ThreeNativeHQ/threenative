#include "renderer.h"

#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <vector>

#include "engine/shader/dfg_lut.h"
#include "mystral/webgpu_compat.h"

namespace tn::engine {

namespace {

using Matrix3 = std::array<double, 9>;

Matrix multiply(const Matrix& a, const Matrix& b) {
    Matrix out{};
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r) {
            double s = 0;
            for (int k = 0; k < 4; ++k) s += a[k * 4 + r] * b[c * 4 + k];
            out[c * 4 + r] = s;
        }
    return out;
}

// three's Matrix3.getNormalMatrix: the inverse transpose of the upper-left 3x3.
Matrix3 normalMatrix(const Matrix& m) {
    const double a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const double t11 = i * e - f * h, t12 = f * g - i * d, t13 = h * d - e * g;
    const double det = a * t11 + b * t12 + c * t13;
    if (det == 0) return {};
    const double s = 1 / det;
    // inverse (column-major), then transposed
    const Matrix3 inv{t11 * s, (c * h - i * b) * s, (f * b - c * e) * s,
                      t12 * s, (i * a - c * g) * s, (c * d - f * a) * s,
                      t13 * s, (b * g - h * a) * s, (e * a - b * d) * s};
    return {inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]};
}

std::array<double, 3> rotate(const Matrix& m, const std::array<double, 3>& v) {
    return {m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2]};
}

// Writes a uniform by name; absent names are skipped (a program that does not read it).
template <size_t N>
void put(std::vector<uint8_t>& block, const shader::StageModule& stage, const char* name, const std::array<double, N>& v) {
    for (const shader::UniformField& f : stage.uniforms) {
        if (f.name != name) continue;
        float data[N];
        for (size_t k = 0; k < N; ++k) data[k] = static_cast<float>(v[k]);
        if (f.type.isMatrix() && f.type.rows == 3) {  // mat3x3 columns are 16-byte aligned
            for (int c = 0; c < 3; ++c) std::memcpy(&block[f.offset + c * 16], data + c * 3, 12);
        } else {
            std::memcpy(&block[f.offset], data, N * 4);
        }
    }
}

WGPUTextureView view2d(WGPUTexture texture, WGPUTextureFormat format) {
    WGPUTextureViewDescriptor desc = {};
    desc.dimension = WGPUTextureViewDimension_2D;
    desc.mipLevelCount = 1;
    desc.arrayLayerCount = 1;
    desc.format = format;
    return wgpuTextureCreateView(texture, &desc);
}

}  // namespace

Renderer::Renderer(WGPUInstance instance, WGPUDevice device, WGPUQueue queue, EventQueue& events)
    : device_(device), events_(events), gpu_(instance, device, queue, events, 1), geometry_(gpu_), pipelines_(device) {
    const shader::StandardPrograms sources[2] = {shader::buildStandard(shader::StandardMaterial{}), shader::buildBasic()};
    for (int kind = 0; kind < 2; ++kind) {
        programs_[kind] = {shader::buildStage(sources[kind].vertex, 0), shader::buildStage(sources[kind].fragment, 1)};
        if (!programs_[kind].vertex.wgsl.ok() || !programs_[kind].fragment.wgsl.ok())
            throw std::runtime_error("TN_NATIVE_SHADER_INVALID: material program " + std::to_string(kind));
    }

    // The DFG lookup the standard BRDF samples: three's 16x16 RG half-float table, linear filtered.
    WGPUTextureDescriptor lutDesc = {};
    lutDesc.dimension = WGPUTextureDimension_2D;
    lutDesc.size = {shader::kDfgLutSize, shader::kDfgLutSize, 1};
    lutDesc.format = WGPUTextureFormat_RG16Float;
    lutDesc.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
    lutDesc.mipLevelCount = 1;
    lutDesc.sampleCount = 1;
    lut_ = wgpuDeviceCreateTexture(device, &lutDesc);
    WGPUImageCopyTexture_Compat dst = {};
    dst.texture = lut_;
    dst.aspect = WGPUTextureAspect_All;
    WGPUTextureDataLayout_Compat layout = {};
    layout.bytesPerRow = shader::kDfgLutSize * 4;
    layout.rowsPerImage = shader::kDfgLutSize;
    const WGPUExtent3D extent = {shader::kDfgLutSize, shader::kDfgLutSize, 1};
    wgpuQueueWriteTexture(queue, &dst, shader::kDfgLut, sizeof shader::kDfgLut, &layout, &extent);
    lutView_ = wgpuTextureCreateView(lut_, nullptr);
    WGPUSamplerDescriptor sampler = {};
    sampler.magFilter = WGPUFilterMode_Linear;
    sampler.minFilter = WGPUFilterMode_Linear;
    sampler.addressModeU = sampler.addressModeV = sampler.addressModeW = WGPUAddressMode_ClampToEdge;
    sampler.maxAnisotropy = 1;
    lutSampler_ = wgpuDeviceCreateSampler(device, &sampler);

    // One triangle covers the frame; the output pass samples the scene target texel for texel.
    const float triangle[6] = {-1, -1, 3, -1, -1, 3};
    outputTriangle_ = gpu_.createBuffer(sizeof triangle, WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst);
    gpu_.writeBuffer(outputTriangle_, 0, triangle, sizeof triangle);
    outputUniforms_ = gpu_.createBuffer(16, WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
    WGPUSamplerDescriptor nearest = {};
    nearest.magFilter = WGPUFilterMode_Nearest;
    nearest.minFilter = WGPUFilterMode_Nearest;
    nearest.addressModeU = nearest.addressModeV = nearest.addressModeW = WGPUAddressMode_ClampToEdge;
    nearest.maxAnisotropy = 1;
    outputSampler_ = wgpuDeviceCreateSampler(device, &nearest);
    setOutput(OutputState{});
    setSize(1, 1);
}

Renderer::~Renderer() {
    for (auto& [key, r] : records_) {
        wgpuBindGroupRelease(r.vertexGroup);
        wgpuBindGroupRelease(r.fragmentGroup);
    }
    releaseTargets();
    releaseOutputGroup();
    wgpuSamplerRelease(outputSampler_);
    wgpuSamplerRelease(lutSampler_);
    wgpuTextureViewRelease(lutView_);
    wgpuTextureRelease(lut_);
}

void Renderer::releaseTargets() {
    if (colorView_) {  // the color texture exists exactly while its view does
        wgpuTextureViewRelease(colorView_);
        gpu_.destroy(color_);
    }
    if (depthView_) wgpuTextureViewRelease(depthView_);
    if (depth_) wgpuTextureRelease(depth_);
    if (sceneView_) wgpuTextureViewRelease(sceneView_);
    if (sceneColor_) wgpuTextureRelease(sceneColor_);
    colorView_ = depthView_ = sceneView_ = nullptr;
    depth_ = sceneColor_ = nullptr;
    releaseOutputGroup();  // it binds the scene target
}

void Renderer::releaseOutputGroup() {
    if (outputGroup_) wgpuBindGroupRelease(outputGroup_);
    outputGroup_ = nullptr;
}

void Renderer::setOutput(const OutputState& output) {
    const bool programChanged = outputVertex_.wgsl.code.empty() || output.toneMapping != output_.toneMapping || output.srgb != output_.srgb;
    output_ = output;
    if (!programChanged) return;
    const shader::OutputPrograms programs = shader::buildOutput(output.toneMapping, output.srgb);
    outputVertex_ = shader::buildStage(programs.vertex, 0);
    outputFragment_ = shader::buildStage(programs.fragment, 0);
    if (!outputVertex_.wgsl.ok() || !outputFragment_.wgsl.ok()) throw std::runtime_error("TN_NATIVE_SHADER_INVALID: output program");
    releaseOutputGroup();  // its layout belongs to the previous program
}

void Renderer::setSize(uint32_t width, uint32_t height) {
    width = std::max(width, 1u);
    height = std::max(height, 1u);
    if (width == width_ && height == height_) return;
    releaseTargets();
    width_ = width;
    height_ = height;
    color_ = gpu_.createTexture(width, height, WGPUTextureFormat_RGBA8Unorm,
                                WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc);
    WGPUTextureDescriptor depthDesc = {};
    depthDesc.dimension = WGPUTextureDimension_2D;
    depthDesc.size = {width, height, 1};
    depthDesc.format = WGPUTextureFormat_Depth32Float;
    depthDesc.usage = WGPUTextureUsage_RenderAttachment;
    depthDesc.mipLevelCount = 1;
    depthDesc.sampleCount = 1;
    depth_ = wgpuDeviceCreateTexture(device_, &depthDesc);
    WGPUTextureDescriptor sceneDesc = depthDesc;
    sceneDesc.format = WGPUTextureFormat_RGBA16Float;
    sceneDesc.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_TextureBinding;
    sceneColor_ = wgpuDeviceCreateTexture(device_, &sceneDesc);
    sceneView_ = view2d(sceneColor_, WGPUTextureFormat_RGBA16Float);
    colorView_ = view2d(gpu_.texture(color_), WGPUTextureFormat_RGBA8Unorm);
    depthView_ = view2d(depth_, WGPUTextureFormat_Depth32Float);
}

// One stage's bind group, from the bindings its package declares: the uniform block, and for a
// texture/sampler pair the view and sampler given.
WGPUBindGroup Renderer::bindGroup(WGPURenderPipeline pipeline, uint32_t group, const shader::StageModule& stage,
                                  Handle uniforms, WGPUTextureView view, WGPUSampler sampler) {
    std::vector<WGPUBindGroupEntry> entries;
    for (const shader::Binding& b : stage.bindings) {
        WGPUBindGroupEntry e = {};
        e.binding = b.binding;
        if (b.kind == shader::BindingKind::Uniform) {
            e.buffer = gpu_.buffer(uniforms);
            e.size = stage.uniformBlockSize;
        } else if (b.kind == shader::BindingKind::Texture) {
            e.textureView = view;
        } else if (b.kind == shader::BindingKind::Sampler) {
            e.sampler = sampler;
        } else {
            throw std::runtime_error("TN_NATIVE_BINDING_UNSUPPORTED: " + b.name);
        }
        entries.push_back(e);
    }
    WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(pipeline, group);
    WGPUBindGroupDescriptor desc = {};
    desc.layout = layout;
    desc.entryCount = entries.size();
    desc.entries = entries.data();
    WGPUBindGroup out = wgpuDeviceCreateBindGroup(device_, &desc);
    wgpuBindGroupLayoutRelease(layout);
    return out;
}

Renderer::Record& Renderer::record(uint64_t key, MaterialKind kind, const Program& program, WGPURenderPipeline pipeline) {
    if (const auto it = records_.find(key); it != records_.end()) {
        if (it->second.kind == kind) return it->second;
        forget(key);  // a different program: its layouts differ
    }
    Record& r = records_[key];
    r.kind = kind;
    // A stage with no uniforms still gets a 16-byte buffer so every record has the same shape.
    r.vertexUniforms = gpu_.createBuffer(std::max<uint32_t>(program.vertex.uniformBlockSize, 16), WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
    r.fragmentUniforms = gpu_.createBuffer(std::max<uint32_t>(program.fragment.uniformBlockSize, 16), WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
    r.vertexGroup = bindGroup(pipeline, 0, program.vertex, r.vertexUniforms, lutView_, lutSampler_);
    r.fragmentGroup = bindGroup(pipeline, 1, program.fragment, r.fragmentUniforms, lutView_, lutSampler_);
    return r;
}

void Renderer::forget(uint64_t key) {
    const auto it = records_.find(key);
    if (it == records_.end()) return;
    wgpuBindGroupRelease(it->second.vertexGroup);
    wgpuBindGroupRelease(it->second.fragmentGroup);
    gpu_.destroy(it->second.vertexUniforms);
    gpu_.destroy(it->second.fragmentUniforms);
    records_.erase(it);
}

uint64_t Renderer::render(std::span<const DrawItem> items, const CameraState& camera, const LightState& lights,
                          std::array<double, 4> clear) {
    const uint64_t id = ++renderId_;
    const Matrix& view = camera.matrixWorldInverse;

    WGPUCommandEncoderDescriptor encoderDesc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, &encoderDesc);
    WGPURenderPassColorAttachment color = {};
    color.view = sceneView_;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = {clear[0], clear[1], clear[2], clear[3]};
#if defined(MYSTRAL_WEBGPU_DAWN)
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif
    WGPURenderPassDepthStencilAttachment depth = {};
    depth.view = depthView_;
    depth.depthLoadOp = WGPULoadOp_Clear;
    depth.depthStoreOp = WGPUStoreOp_Store;
    depth.depthClearValue = 1.0f;
    WGPURenderPassDescriptor passDesc = {};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &color;
    passDesc.depthStencilAttachment = &depth;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);

    // RenderList: z is the object origin's clip-space depth (setFromMatrixPosition, then the
    // projection-view matrix); painterSortStable for opaques, reversePainterSortStable for the rest.
    const Matrix projView = multiply(camera.projectionMatrix, view);
    std::vector<std::pair<double, const DrawItem*>> opaque, transparent;
    for (const DrawItem& item : items) {
        const Matrix& m = item.matrixWorld;
        const double z = projView[2] * m[12] + projView[6] * m[13] + projView[10] * m[14] + projView[14];
        const double w = projView[3] * m[12] + projView[7] * m[13] + projView[11] * m[14] + projView[15];
        (item.transparent ? transparent : opaque).push_back({z / w, &item});
    }
    std::sort(opaque.begin(), opaque.end(), [](const auto& a, const auto& b) {
        if (a.second->renderOrder != b.second->renderOrder) return a.second->renderOrder < b.second->renderOrder;
        if (a.first != b.first) return a.first < b.first;
        return a.second->id < b.second->id;
    });
    std::sort(transparent.begin(), transparent.end(), [](const auto& a, const auto& b) {
        if (a.second->renderOrder != b.second->renderOrder) return a.second->renderOrder < b.second->renderOrder;
        if (a.first != b.first) return a.first > b.first;
        return a.second->id < b.second->id;
    });
    opaque.insert(opaque.end(), transparent.begin(), transparent.end());

    std::vector<uint8_t> vblock, fblock;
    WGPURenderPipeline bound = nullptr;
    for (const auto& [depthKey, drawn] : opaque) {
        const DrawItem& item = *drawn;
        const Program& program = programs_[static_cast<int>(item.kind)];
        const shader::StageModule& vs = program.vertex;
        const shader::StageModule& fs = program.fragment;
        const bool lit = item.kind == MaterialKind::Standard;
        if (!item.positions || (lit && !item.normals) || !item.material) continue;
        WGPURenderPipeline pipeline =
            pipelines_.get(vs, &fs, PipelineTarget{WGPUTextureFormat_RGBA16Float, WGPUTextureFormat_Depth32Float,
                                                   WGPUCullMode_Back, item.transparent, item.depthWrite});
        if (!pipeline) throw std::runtime_error("TN_NATIVE_PIPELINE_REFUSED: material program");
        if (pipeline != bound) wgpuRenderPassEncoderSetPipeline(pass, bound = pipeline);
        Record& r = record(item.key, item.kind, program, pipeline);
        vblock.assign(std::max<uint32_t>(vs.uniformBlockSize, 16), 0);
        fblock.assign(std::max<uint32_t>(fs.uniformBlockSize, 16), 0);
        const Matrix modelView = multiply(view, item.matrixWorld);
        put(vblock, vs, "modelMatrix", item.matrixWorld);
        put(vblock, vs, "viewMatrix", view);
        put(vblock, vs, "projectionMatrix", camera.projectionMatrix);
        put(vblock, vs, "normalMatrix", normalMatrix(modelView));
        const shader::StandardMaterial& m = *item.material;
        put(fblock, fs, "diffuse", std::array<double, 4>{m.color[0], m.color[1], m.color[2], m.opacity});
        put(fblock, fs, "roughness", std::array<double, 1>{m.roughness});
        put(fblock, fs, "metalness", std::array<double, 1>{m.metalness});
        put(fblock, fs, "emissive",
            std::array<double, 3>{m.emissive[0] * m.emissiveIntensity, m.emissive[1] * m.emissiveIntensity,
                                  m.emissive[2] * m.emissiveIntensity});
        put(fblock, fs, "directionalDirection", rotate(view, lights.directionalDirection));
        put(fblock, fs, "directionalColor", lights.directionalColor);
        put(fblock, fs, "hemisphereSky", lights.hemisphereSky);
        put(fblock, fs, "hemisphereGround", lights.hemisphereGround);
        put(fblock, fs, "hemisphereDirection", lights.hemisphereUp);  // world space: it meets normalWorld
        put(fblock, fs, "ambient", lights.ambient);
        gpu_.writeBuffer(r.vertexUniforms, 0, vblock.data(), vblock.size());
        gpu_.writeBuffer(r.fragmentUniforms, 0, fblock.data(), fblock.size());

        for (const shader::VertexAttribute& a : vs.attributes) {
            BufferStore& store = a.name == "position" ? *item.positions : *item.normals;
            wgpuRenderPassEncoderSetVertexBuffer(pass, a.location, gpu_.buffer(geometry_.sync(store, WGPUBufferUsage_Vertex)), 0,
                                                 store.byteLength());
        }
        wgpuRenderPassEncoderSetBindGroup(pass, 0, r.vertexGroup, 0, nullptr);
        wgpuRenderPassEncoderSetBindGroup(pass, 1, r.fragmentGroup, 0, nullptr);
        if (item.indices) {
            const Handle indices = geometry_.sync(*item.indices, WGPUBufferUsage_Index);
            const bool wide = item.indices->scalar() == Scalar::U32;
            wgpuRenderPassEncoderSetIndexBuffer(pass, gpu_.buffer(indices),
                                                wide ? WGPUIndexFormat_Uint32 : WGPUIndexFormat_Uint16, 0,
                                                (item.indices->byteLength() + 3) & ~uint64_t{3});
            wgpuRenderPassEncoderDrawIndexed(pass, static_cast<uint32_t>(item.indices->byteLength() / (wide ? 4 : 2)), 1,
                                             0, 0, 0);
        } else {
            wgpuRenderPassEncoderDraw(pass, static_cast<uint32_t>(item.positions->byteLength() / 12), 1, 0, 0);
        }
    }
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    outputPass(encoder);
    WGPUCommandBufferDescriptor commandDesc = {};
    gpu_.submit(wgpuCommandEncoderFinish(encoder, &commandDesc));
    wgpuCommandEncoderRelease(encoder);
    return id;
}

void Renderer::outputPass(WGPUCommandEncoder encoder) {
    WGPURenderPipeline pipeline = pipelines_.get(
        outputVertex_, &outputFragment_, PipelineTarget{WGPUTextureFormat_RGBA8Unorm, WGPUTextureFormat_Undefined, WGPUCullMode_None});
    if (!pipeline) throw std::runtime_error("TN_NATIVE_PIPELINE_REFUSED: output program");
    std::vector<uint8_t> block(std::max<uint32_t>(outputFragment_.uniformBlockSize, 4));
    put(block, outputFragment_, "toneMappingExposure", std::array<double, 1>{output_.toneMappingExposure});
    if (outputFragment_.uniformBlockSize) gpu_.writeBuffer(outputUniforms_, 0, block.data(), outputFragment_.uniformBlockSize);
    if (!outputGroup_) outputGroup_ = bindGroup(pipeline, 0, outputFragment_, outputUniforms_, sceneView_, outputSampler_);
    WGPURenderPassColorAttachment color = {};
    color.view = colorView_;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
#if defined(MYSTRAL_WEBGPU_DAWN)
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif
    WGPURenderPassDescriptor passDesc = {};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &color;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, outputGroup_, 0, nullptr);
    wgpuRenderPassEncoderSetVertexBuffer(pass, outputVertex_.attributes.at(0).location, gpu_.buffer(outputTriangle_), 0, 24);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
}

GpuStatus Renderer::readPixels(ReadbackCallback done) { return gpu_.readTexture(color_, std::move(done)); }

}  // namespace tn::engine
