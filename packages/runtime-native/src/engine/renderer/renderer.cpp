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
    const shader::StandardPrograms standard = shader::buildStandard(shader::StandardMaterial{});
    vertex_ = shader::buildStage(standard.vertex, 0);
    fragment_ = shader::buildStage(standard.fragment, 1);
    if (!vertex_.wgsl.ok() || !fragment_.wgsl.ok()) throw std::runtime_error("TN_NATIVE_SHADER_INVALID: standard program");

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
    setSize(1, 1);
}

Renderer::~Renderer() {
    for (auto& [key, r] : records_) {
        wgpuBindGroupRelease(r.vertexGroup);
        wgpuBindGroupRelease(r.fragmentGroup);
    }
    releaseTargets();
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
    colorView_ = depthView_ = nullptr;
    depth_ = nullptr;
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
    colorView_ = view2d(gpu_.texture(color_), WGPUTextureFormat_RGBA8Unorm);
    depthView_ = view2d(depth_, WGPUTextureFormat_Depth32Float);
}

Renderer::Record& Renderer::record(uint64_t key, WGPURenderPipeline pipeline) {
    auto [it, isNew] = records_.try_emplace(key);
    Record& r = it->second;
    if (!isNew) return r;
    r.vertexUniforms = gpu_.createBuffer(vertex_.uniformBlockSize, WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
    r.fragmentUniforms = gpu_.createBuffer(fragment_.uniformBlockSize, WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
    for (const bool fragment : {false, true}) {
        WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(pipeline, fragment ? 1 : 0);
        WGPUBindGroupEntry entries[3] = {};
        entries[0].binding = 0;
        entries[0].buffer = gpu_.buffer(fragment ? r.fragmentUniforms : r.vertexUniforms);
        entries[0].size = fragment ? fragment_.uniformBlockSize : vertex_.uniformBlockSize;
        entries[1].binding = 1;
        entries[1].textureView = lutView_;
        entries[2].binding = 2;
        entries[2].sampler = lutSampler_;
        WGPUBindGroupDescriptor desc = {};
        desc.layout = layout;
        desc.entryCount = fragment ? 3 : 1;
        desc.entries = entries;
        (fragment ? r.fragmentGroup : r.vertexGroup) = wgpuDeviceCreateBindGroup(device_, &desc);
        wgpuBindGroupLayoutRelease(layout);
    }
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
    WGPURenderPipeline pipeline = pipelines_.get(vertex_, &fragment_, PipelineTarget{});
    if (!pipeline) throw std::runtime_error("TN_NATIVE_PIPELINE_REFUSED: standard program");
    const Matrix& view = camera.matrixWorldInverse;

    WGPUCommandEncoderDescriptor encoderDesc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, &encoderDesc);
    WGPURenderPassColorAttachment color = {};
    color.view = colorView_;
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
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);

    std::vector<uint8_t> vblock(vertex_.uniformBlockSize), fblock(fragment_.uniformBlockSize);
    for (const DrawItem& item : items) {
        if (!item.positions || !item.normals || !item.material) continue;
        Record& r = record(item.key, pipeline);
        const Matrix modelView = multiply(view, item.matrixWorld);
        put(vblock, vertex_, "modelMatrix", item.matrixWorld);
        put(vblock, vertex_, "viewMatrix", view);
        put(vblock, vertex_, "projectionMatrix", camera.projectionMatrix);
        put(vblock, vertex_, "normalMatrix", normalMatrix(modelView));
        const shader::StandardMaterial& m = *item.material;
        put(fblock, fragment_, "diffuse", std::array<double, 4>{m.color[0], m.color[1], m.color[2], m.opacity});
        put(fblock, fragment_, "roughness", std::array<double, 1>{m.roughness});
        put(fblock, fragment_, "metalness", std::array<double, 1>{m.metalness});
        put(fblock, fragment_, "emissive",
            std::array<double, 3>{m.emissive[0] * m.emissiveIntensity, m.emissive[1] * m.emissiveIntensity,
                                  m.emissive[2] * m.emissiveIntensity});
        put(fblock, fragment_, "directionalDirection", rotate(view, lights.directionalDirection));
        put(fblock, fragment_, "directionalColor", lights.directionalColor);
        put(fblock, fragment_, "hemisphereSky", lights.hemisphereSky);
        put(fblock, fragment_, "hemisphereGround", lights.hemisphereGround);
        put(fblock, fragment_, "hemisphereDirection", rotate(view, lights.hemisphereUp));
        put(fblock, fragment_, "ambient", lights.ambient);
        gpu_.writeBuffer(r.vertexUniforms, 0, vblock.data(), vblock.size());
        gpu_.writeBuffer(r.fragmentUniforms, 0, fblock.data(), fblock.size());

        const Handle positions = geometry_.sync(*item.positions, WGPUBufferUsage_Vertex);
        const Handle normals = geometry_.sync(*item.normals, WGPUBufferUsage_Vertex);
        for (const shader::VertexAttribute& a : vertex_.attributes) {
            const bool isPosition = a.name == "position";
            const BufferStore& store = isPosition ? *item.positions : *item.normals;
            wgpuRenderPassEncoderSetVertexBuffer(pass, a.location, gpu_.buffer(isPosition ? positions : normals), 0,
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
    WGPUCommandBufferDescriptor commandDesc = {};
    gpu_.submit(wgpuCommandEncoderFinish(encoder, &commandDesc));
    wgpuCommandEncoderRelease(encoder);
    return id;
}

GpuStatus Renderer::readPixels(ReadbackCallback done) { return gpu_.readTexture(color_, std::move(done)); }

}  // namespace tn::engine
