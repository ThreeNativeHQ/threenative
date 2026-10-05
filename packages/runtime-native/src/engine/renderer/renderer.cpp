#include "renderer.h"

#include <algorithm>
#include <cctype>
#include <iterator>
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

// A point through a column-major matrix (w = 1): a light's view-space position, as three's
// lightViewPosition computes it on the CPU before it becomes a uniform.
std::array<double, 3> transformPoint(const Matrix& m, const std::array<double, 3>& v) {
    return {m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]};
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

// Writes a uniform through its resolved field; a null field is a uniform this program does not read.
template <size_t N>
void put(std::vector<uint8_t>& block, size_t base, const shader::UniformField* f, const std::array<double, N>& v) {
    if (f == nullptr) return;
    float data[N];
    for (size_t k = 0; k < N; ++k) data[k] = static_cast<float>(v[k]);
    if (f->type.isMatrix() && f->type.rows == 3) {  // mat3x3 columns are 16-byte aligned
        for (int c = 0; c < 3; ++c) std::memcpy(&block[base + f->offset + c * 16], data + c * 3, 12);
    } else {
        std::memcpy(&block[base + f->offset], data, N * 4);
    }
}

constexpr const char* kSlotNames[] = {
    "modelMatrix", "viewMatrix", "projectionMatrix", "normalMatrix", "diffuse", "alphaTest", "opaque", "roughness",
    "metalness", "emissive", "specular", "shininess", "ior", "specularIntensity", "specularColor",
    "hemisphereSky", "hemisphereGround", "hemisphereDirection", "ambient"};
constexpr const char* kLightFieldNames[] = {"Color", "Direction", "Position", "Distance", "Decay", "Axis",
                                            "ConeCos", "PenumbraCos"};

constexpr uint64_t kUniformAlign = 256;  // minUniformBufferOffsetAlignment's WebGPU default
uint64_t aligned(uint64_t size) { return (size + kUniformAlign - 1) / kUniformAlign * kUniformAlign; }

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
    if (wgpuDeviceHasFeature(device, WGPUFeatureName_TimestampQuery)) {
        WGPUQuerySetDescriptor queries = {};
        queries.type = WGPUQueryType_Timestamp;
        queries.count = 4;
        timestamps_ = wgpuDeviceCreateQuerySet(device, &queries);
        timestampResolve_ = gpu_.createBuffer(32, WGPUBufferUsage_QueryResolve | WGPUBufferUsage_CopySrc);
    }
    setOutput(OutputState{});
    setSize(1, 1);
}

Renderer::~Renderer() {
    if (timestamps_) wgpuQuerySetRelease(timestamps_);
    for (auto& [key, program] : programs_) {
        for (int g = 0; g < 2; ++g) {
            if (program->groups[g]) wgpuBindGroupRelease(program->groups[g]);
            if (program->layouts[g]) wgpuBindGroupLayoutRelease(program->layouts[g]);
        }
        if (program->pipelineLayout) wgpuPipelineLayoutRelease(program->pipelineLayout);
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
// A stage's bind group: its uniform slice of `uniforms` (dynamic offset when the layout says so), and
// for a texture/sampler pair the view and sampler given.
WGPUBindGroup Renderer::bindGroup(WGPUBindGroupLayout layout, const shader::StageModule& stage, Handle uniforms,
                                  WGPUTextureView view, WGPUSampler sampler) {
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
    WGPUBindGroupDescriptor desc = {};
    desc.layout = layout;
    desc.entryCount = entries.size();
    desc.entries = entries.data();
    return wgpuDeviceCreateBindGroup(device_, &desc);
}

// Each stage's layout from the bindings its package declares, the uniform block with a dynamic
// offset; the uniform slots resolved to fields once, so a draw never looks a name up.
void Renderer::buildLayouts(Program& program) {
    const shader::StageModule* stages[2] = {&program.vertex, &program.fragment};
    for (int g = 0; g < 2; ++g) {
        std::vector<WGPUBindGroupLayoutEntry> entries;
        for (const shader::Binding& b : stages[g]->bindings) {
            WGPUBindGroupLayoutEntry e = {};
            e.binding = b.binding;
            e.visibility = g == 0 ? WGPUShaderStage_Vertex : WGPUShaderStage_Fragment;
            if (b.kind == shader::BindingKind::Uniform) {
                e.buffer.type = WGPUBufferBindingType_Uniform;
                e.buffer.hasDynamicOffset = true;
                e.buffer.minBindingSize = stages[g]->uniformBlockSize;
            } else if (b.kind == shader::BindingKind::Texture) {
                e.texture.sampleType = WGPUTextureSampleType_Float;
                e.texture.viewDimension = WGPUTextureViewDimension_2D;
            } else if (b.kind == shader::BindingKind::Sampler) {
                e.sampler.type = WGPUSamplerBindingType_Filtering;
            } else {
                throw std::runtime_error("TN_NATIVE_BINDING_UNSUPPORTED: " + b.name);
            }
            entries.push_back(e);
        }
        WGPUBindGroupLayoutDescriptor desc = {};
        desc.entryCount = entries.size();
        desc.entries = entries.data();
        program.layouts[g] = wgpuDeviceCreateBindGroupLayout(device_, &desc);
    }
    WGPUPipelineLayoutDescriptor desc = {};
    desc.bindGroupLayoutCount = 2;
    desc.bindGroupLayouts = program.layouts;
    program.pipelineLayout = wgpuDeviceCreatePipelineLayout(device_, &desc);
    for (int s = 0; s < kSlotCount; ++s) {
        for (const shader::UniformField& f : program.vertex.uniforms)
            if (f.name == kSlotNames[s]) program.vertexSlots[s] = &f;
        for (const shader::UniformField& f : program.fragment.uniforms)
            if (f.name == kSlotNames[s]) program.fragmentSlots[s] = &f;
    }
    for (const shader::UniformField& f : program.fragment.uniforms) {
        if (f.name.rfind("light", 0) != 0) continue;
        std::size_t end = 5;
        while (end < f.name.size() && std::isdigit(static_cast<unsigned char>(f.name[end]))) ++end;
        if (end == 5) continue;
        const std::size_t index = std::stoul(f.name.substr(5, end - 5));
        if (program.lightSlots.size() <= index) program.lightSlots.resize(index + 1);
        for (int field = 0; field < kLightFieldCount; ++field)
            if (f.name.compare(end, std::string::npos, kLightFieldNames[field]) == 0) program.lightSlots[index][field] = &f;
    }
}

Renderer::Program& Renderer::program(MaterialKind kind, int variant, const std::string& lights) {
    const std::string key = std::to_string(static_cast<int>(kind)) + "|" + std::to_string(variant) + "|" + lights;
    if (const auto found = programs_.find(key); found != programs_.end()) return *found->second;
    static const shader::VertexVariant kVariants[3] = {{}, {true, false}, {true, true}};
    const shader::VertexVariant& vv = kVariants[variant];
    const shader::LightLayout layout{lights};
    shader::StandardPrograms source;
    switch (kind) {
    case MaterialKind::Standard: source = shader::buildStandard(shader::StandardMaterial{}, vv, layout); break;
    case MaterialKind::Basic: source = shader::buildBasic(vv); break;
    case MaterialKind::Lambert: source = shader::buildLambert(vv, layout); break;
    case MaterialKind::Phong: source = shader::buildPhong(vv, layout); break;
    case MaterialKind::Physical: source = shader::buildPhysical(shader::StandardMaterial{}, vv, layout); break;
    }
    auto built = std::make_unique<Program>();
    built->vertex = shader::buildStage(source.vertex, 0);
    built->fragment = shader::buildStage(source.fragment, 1);
    if (!built->vertex.wgsl.ok() || !built->fragment.wgsl.ok())
        throw std::runtime_error("TN_NATIVE_SHADER_INVALID: material program " + key);
    buildLayouts(*built);
    if (uniformCapacity_ != 0) {
        for (int g = 0; g < 2; ++g)
            built->groups[g] = bindGroup(built->layouts[g], g == 0 ? built->vertex : built->fragment, uniformBuffer_,
                                         lutView_, lutSampler_);
    }
    return *programs_.emplace(key, std::move(built)).first->second;
}

uint64_t Renderer::render(std::span<const DrawItem> items, const CameraState& camera, const LightState& lights,
                          std::array<double, 4> clear) {
    const uint64_t id = ++renderId_;
    const Matrix& view = camera.matrixWorldInverse;
    geometry_.sweep();  // GPU copies of attributes released since the last frame

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
    const bool timed = timestamps_ && !timing_->pending;
    WGPURenderPassTimestampWrites_Compat sceneTimes = {};
    if (timed) {
        sceneTimes.querySet = timestamps_;
        // Both indices on both passes: a browser rejects the "undefined" index sentinel.
        sceneTimes.beginningOfPassWriteIndex = 0;
        sceneTimes.endOfPassWriteIndex = 1;
        passDesc.timestampWrites = &sceneTimes;
    }
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

    // The light layout every lit program this frame is specialized for, in three's light order.
    std::string lightKinds;
    for (const DirectLight& l : lights.direct)
        lightKinds += l.kind == DirectLight::Kind::Directional ? 'd' : l.kind == DirectLight::Kind::Point ? 'p' : 's';

    // Plan: each draw's program, pipeline and uniform slices, all uniforms into one CPU block.
    struct Planned {
        const DrawItem* item;
        Program* program;
        WGPURenderPipeline pipeline;
        uint32_t vertexOffset, fragmentOffset;
    };
    std::vector<Planned> plan;
    plan.reserve(opaque.size());
    frameUniforms_.clear();
    for (const auto& [depthKey, drawn] : opaque) {
        const DrawItem& item = *drawn;
        const int variant = item.instanceMatrices ? (item.instanceColors ? 2 : 1) : 0;
        Program& program = this->program(item.kind, variant, item.kind == MaterialKind::Basic ? "" : lightKinds);
        if (item.instanceCount == 0) continue;  // three draws nothing for count 0
        const bool lit = item.kind != MaterialKind::Basic;
        if (!item.positions || (lit && !item.normals) || !item.material) continue;
        PipelineTarget target{WGPUTextureFormat_RGBA16Float, WGPUTextureFormat_Depth32Float, WGPUCullMode_Back,
                              item.transparent, item.depthWrite};
        target.layout = program.pipelineLayout;
        WGPURenderPipeline pipeline = pipelines_.get(program.vertex, &program.fragment, target);
        if (!pipeline) throw std::runtime_error("TN_NATIVE_PIPELINE_REFUSED: material program");
        const uint64_t v = frameUniforms_.size();
        const uint64_t f = v + aligned(program.vertex.uniformBlockSize);
        frameUniforms_.resize(f + aligned(program.fragment.uniformBlockSize), 0);
        const auto* vs = program.vertexSlots;
        const auto* fs = program.fragmentSlots;
        put(frameUniforms_, v, vs[kModelMatrix], item.matrixWorld);
        put(frameUniforms_, v, vs[kViewMatrix], view);
        put(frameUniforms_, v, vs[kProjectionMatrix], camera.projectionMatrix);
        put(frameUniforms_, v, vs[kNormalMatrix], normalMatrix(multiply(view, item.matrixWorld)));
        const shader::StandardMaterial& m = *item.material;
        put(frameUniforms_, f, fs[kDiffuse], std::array<double, 4>{m.color[0], m.color[1], m.color[2], m.opacity});
        put(frameUniforms_, f, fs[kViewMatrix], view);  // normalWorld is derived in the fragment, as three does
        put(frameUniforms_, f, fs[kAlphaTest], std::array<double, 1>{m.alphaTest});
        put(frameUniforms_, f, fs[kOpaque], std::array<double, 1>{item.transparent ? 0.0 : 1.0});
        put(frameUniforms_, f, fs[kRoughness], std::array<double, 1>{m.roughness});
        put(frameUniforms_, f, fs[kMetalness], std::array<double, 1>{m.metalness});
        put(frameUniforms_, f, fs[kEmissive],
            std::array<double, 3>{m.emissive[0] * m.emissiveIntensity, m.emissive[1] * m.emissiveIntensity,
                                  m.emissive[2] * m.emissiveIntensity});
        put(frameUniforms_, f, fs[kSpecular], std::array<double, 3>{m.specular[0], m.specular[1], m.specular[2]});
        put(frameUniforms_, f, fs[kShininess], std::array<double, 1>{m.shininess});
        put(frameUniforms_, f, fs[kIor], std::array<double, 1>{m.ior});
        put(frameUniforms_, f, fs[kSpecularIntensity], std::array<double, 1>{m.specularIntensity});
        put(frameUniforms_, f, fs[kSpecularColor], std::array<double, 3>{m.specularColor[0], m.specularColor[1], m.specularColor[2]});
        for (std::size_t i = 0; i < lights.direct.size() && i < program.lightSlots.size(); ++i) {
            const DirectLight& l = lights.direct[i];
            const auto& slot = program.lightSlots[i];
            put(frameUniforms_, f, slot[kLightColor], l.color);
            put(frameUniforms_, f, slot[kLightDirection], rotate(view, l.direction));
            put(frameUniforms_, f, slot[kLightAxis], rotate(view, l.direction));
            put(frameUniforms_, f, slot[kLightPosition], transformPoint(view, l.position));
            put(frameUniforms_, f, slot[kLightDistance], std::array<double, 1>{l.distance});
            put(frameUniforms_, f, slot[kLightDecay], std::array<double, 1>{l.decay});
            put(frameUniforms_, f, slot[kLightConeCos], std::array<double, 1>{l.coneCos});
            put(frameUniforms_, f, slot[kLightPenumbraCos], std::array<double, 1>{l.penumbraCos});
        }
        put(frameUniforms_, f, fs[kHemisphereSky], lights.hemisphereSky);
        put(frameUniforms_, f, fs[kHemisphereGround], lights.hemisphereGround);
        put(frameUniforms_, f, fs[kHemisphereDirection], lights.hemisphereUp);  // world space: it meets normalWorld
        put(frameUniforms_, f, fs[kAmbient], lights.ambient);
        plan.push_back({&item, &program, pipeline, static_cast<uint32_t>(v), static_cast<uint32_t>(f)});
    }

    // One buffer for the frame's uniforms, grown (and its bind groups rebuilt) when it is too small,
    // written once: a queue write, so it lands before this frame's commands and after the last's.
    if (frameUniforms_.size() > uniformCapacity_) {
        if (uniformCapacity_ != 0) gpu_.destroy(uniformBuffer_);
        uniformCapacity_ = std::max<uint64_t>(frameUniforms_.size() * 2, 64 * 1024);
        uniformBuffer_ = gpu_.createBuffer(uniformCapacity_, WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
        for (auto& [key, program] : programs_) {
            for (int g = 0; g < 2; ++g) {
                if (program->groups[g]) wgpuBindGroupRelease(program->groups[g]);
                program->groups[g] = bindGroup(program->layouts[g], g == 0 ? program->vertex : program->fragment,
                                               uniformBuffer_, lutView_, lutSampler_);
            }
        }
    }
    if (!frameUniforms_.empty()) gpu_.writeBuffer(uniformBuffer_, 0, frameUniforms_.data(), frameUniforms_.size());

    // Encode: state changes only where they change; per draw, two dynamic offsets and the draw.
    WGPURenderPipeline bound = nullptr;
    const BufferStore* boundVertex[8] = {};  // by vertex buffer slot (attribute location)
    const BufferStore* boundIndex = nullptr;
    lastFrame_ = FrameStats{};
    for (const Planned& p : plan) {
        const DrawItem& item = *p.item;
        if (p.pipeline != bound) {
            wgpuRenderPassEncoderSetPipeline(pass, bound = p.pipeline);
            std::fill(std::begin(boundVertex), std::end(boundVertex), nullptr);
            boundIndex = nullptr;
        }
        for (const shader::VertexAttribute& a : p.program->vertex.attributes) {
            // instanceMatrix0..3 are the columns of one buffer of mat4s, bound at 16-byte steps.
            const bool column = a.name.rfind("instanceMatrix", 0) == 0;
            BufferStore& store = a.name == "position"        ? *item.positions
                                 : a.name == "normal"        ? *item.normals
                                 : a.name == "instanceColor" ? *item.instanceColors
                                                             : *item.instanceMatrices;
            const uint64_t offset = column ? uint64_t(a.name.back() - '0') * 16 : 0;
            const Handle buffer = geometry_.sync(store, WGPUBufferUsage_Vertex);
            if (a.location < std::size(boundVertex) && boundVertex[a.location] == &store) continue;
            wgpuRenderPassEncoderSetVertexBuffer(pass, a.location, gpu_.buffer(buffer), offset, store.byteLength() - offset);
            if (a.location < std::size(boundVertex)) boundVertex[a.location] = &store;
        }
        wgpuRenderPassEncoderSetBindGroup(pass, 0, p.program->groups[0], 1, &p.vertexOffset);
        wgpuRenderPassEncoderSetBindGroup(pass, 1, p.program->groups[1], 1, &p.fragmentOffset);
        if (item.indices) {
            const Handle indices = geometry_.sync(*item.indices, WGPUBufferUsage_Index);
            const bool wide = item.indices->scalar() == Scalar::U32;
            if (boundIndex != item.indices) {
                wgpuRenderPassEncoderSetIndexBuffer(pass, gpu_.buffer(indices),
                                                    wide ? WGPUIndexFormat_Uint32 : WGPUIndexFormat_Uint16, 0,
                                                    (item.indices->byteLength() + 3) & ~uint64_t{3});
                boundIndex = item.indices;
            }
            const uint32_t count = static_cast<uint32_t>(item.indices->byteLength() / (wide ? 4 : 2));
            wgpuRenderPassEncoderDrawIndexed(pass, count, item.instanceCount, 0, 0, 0);
            lastFrame_.triangles += uint64_t{item.instanceCount} * (count / 3);  // three's Info.update
        } else {
            const uint32_t count = static_cast<uint32_t>(item.positions->byteLength() / 12);
            wgpuRenderPassEncoderDraw(pass, count, item.instanceCount, 0, 0);
            lastFrame_.triangles += uint64_t{item.instanceCount} * (count / 3);
        }
        ++lastFrame_.draws;
    }
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    outputPass(encoder, timed);
    if (timed) wgpuCommandEncoderResolveQuerySet(encoder, timestamps_, 0, 4, gpu_.buffer(timestampResolve_), 0);
    WGPUCommandBufferDescriptor commandDesc = {};
    gpu_.submit(wgpuCommandEncoderFinish(encoder, &commandDesc));
    wgpuCommandEncoderRelease(encoder);
    if (timed) {
        timing_->pending = true;
        std::weak_ptr<Timing> timing = timing_;
        gpu_.readBuffer(timestampResolve_, 0, 32, [timing](GpuStatus status, std::vector<uint8_t> bytes) {
            const std::shared_ptr<Timing> t = timing.lock();
            if (!t) return;  // the renderer is gone
            t->pending = false;
            uint64_t ns[4];
            if (status != GpuStatus::Ok || bytes.size() != sizeof ns) return;
            std::memcpy(ns, bytes.data(), sizeof ns);
            if (ns[3] <= ns[0]) return;  // a reset clock reads as no sample
            t->lastMs = double(ns[3] - ns[0]) / 1e6;
            ++t->samples;
        });
    }
    return id;
}

void Renderer::outputPass(WGPUCommandEncoder encoder, bool timed) {
    WGPURenderPipeline pipeline = pipelines_.get(
        outputVertex_, &outputFragment_, PipelineTarget{WGPUTextureFormat_RGBA8Unorm, WGPUTextureFormat_Undefined, WGPUCullMode_None});
    if (!pipeline) throw std::runtime_error("TN_NATIVE_PIPELINE_REFUSED: output program");
    std::vector<uint8_t> block(std::max<uint32_t>(outputFragment_.uniformBlockSize, 4));
    put(block, outputFragment_, "toneMappingExposure", std::array<double, 1>{output_.toneMappingExposure});
    if (outputFragment_.uniformBlockSize) gpu_.writeBuffer(outputUniforms_, 0, block.data(), outputFragment_.uniformBlockSize);
    if (!outputGroup_) {
        WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(pipeline, 0);
        outputGroup_ = bindGroup(layout, outputFragment_, outputUniforms_, sceneView_, outputSampler_);
        wgpuBindGroupLayoutRelease(layout);
    }
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
    WGPURenderPassTimestampWrites_Compat outputTimes = {};
    if (timed) {
        outputTimes.querySet = timestamps_;
        outputTimes.beginningOfPassWriteIndex = 2;
        outputTimes.endOfPassWriteIndex = 3;
        passDesc.timestampWrites = &outputTimes;
    }
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, outputGroup_, 0, nullptr);
    wgpuRenderPassEncoderSetVertexBuffer(pass, outputVertex_.attributes.at(0).location, gpu_.buffer(outputTriangle_), 0, 24);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    // three's renderer.info counts its output QuadMesh as one draw of one triangle; so does this.
    ++lastFrame_.draws;
    ++lastFrame_.triangles;
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
}

GpuStatus Renderer::readPixels(ReadbackCallback done) { return gpu_.readTexture(color_, std::move(done)); }

}  // namespace tn::engine
