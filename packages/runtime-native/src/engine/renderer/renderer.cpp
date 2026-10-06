#include "renderer.h"

#include <algorithm>
#include <cctype>
#include <unordered_map>
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

WGPUVertexFormat skinIndexFormat(const DrawItem& item) {
    if (!item.skinIndices) return WGPUVertexFormat_Uint16x4;
    switch (item.skinIndices->scalar()) {
        case Scalar::U8: return WGPUVertexFormat_Uint8x4;
        case Scalar::U32: return WGPUVertexFormat_Uint32x4;
        default: return WGPUVertexFormat_Uint16x4;
    }
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
    "hemisphereSky", "hemisphereGround", "hemisphereDirection", "ambient", "boneBase", "bindMatrix",
    "bindMatrixInverse", "morphBase", "morphInfluenceBase", "morphVertexCount", "morphBaseInfluence"};
constexpr const char* kLightFieldNames[] = {"Color",       "Direction",        "Position",     "Distance",
                                            "Decay",       "Axis",             "ConeCos",      "PenumbraCos",
                                            "ShadowMatrix", "ShadowBias",      "ShadowNormalBias", "ShadowRadius",
                                            "ShadowMapSize", "ShadowIntensity", "ShadowNear", "ShadowFar"};

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
    sampler.compare = WGPUCompareFunction_LessEqual;
    compareSampler_ = wgpuDeviceCreateSampler(device, &sampler);

    // One triangle covers the frame; the output pass samples the scene target texel for texel.
    const float triangle[6] = {-1, -1, 3, -1, -1, 3};
    outputTriangle_ = gpu_.createBuffer(sizeof triangle, WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst);
    for (const char* name : {"boneMatrices", "morphData", "morphInfluences"}) {
        FrameStorage& storage = storages_[name];
        storage.capacity = 64;
        storage.buffer = gpu_.createBuffer(storage.capacity, WGPUBufferUsage_Storage | WGPUBufferUsage_CopyDst);
    }
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
    wgpuSamplerRelease(compareSampler_);
    shadowMaps_.insert(shadowMaps_.end(), cubeShadowMaps_.begin(), cubeShadowMaps_.end());
    for (ShadowMap& map : shadowMaps_) {
        if (map.view) wgpuTextureViewRelease(map.view);
        for (WGPUTextureView face : map.faces)
            if (face) wgpuTextureViewRelease(face);
        if (map.texture) wgpuTextureRelease(map.texture);
    }
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
    const shader::OutputPrograms programs = shader::buildOutput(output.toneMapping, output.srgb, post_.get());
    outputVertex_ = shader::buildStage(programs.vertex, 0);
    outputFragment_ = shader::buildStage(programs.fragment, 0);
    if (!outputVertex_.wgsl.ok() || !outputFragment_.wgsl.ok()) throw std::runtime_error("TN_NATIVE_SHADER_INVALID: output program");
    releaseOutputGroup();  // its layout belongs to the previous program
}

void Renderer::setPostNode(std::shared_ptr<const shader::PostNode> post) {
    post_ = std::move(post);
    outputVertex_ = {};  // rebuild the output program with (or without) the post graph
    const OutputState output = output_;
    setOutput(output);
}

void Renderer::setSize(uint32_t width, uint32_t height) {
    width = std::max(width, 1u);
    height = std::max(height, 1u);
    if (width == width_ && height == height_) return;
    releaseTargets();
    width_ = width;
    height_ = height;
    color_ = gpu_.createTexture(width, height, WGPUTextureFormat_RGBA8Unorm,
                                // TextureBinding too: a windowed player samples this finished frame to
                                // put it on the screen (Renderer::blitTo).
                                WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc |
                                    WGPUTextureUsage_TextureBinding);
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
        } else if (b.kind == shader::BindingKind::Storage && externalStorage_.count(b.name.substr(2))) {
            const auto& [buffer, bytes] = externalStorage_.at(b.name.substr(2)); // a positionNode's buffer
            e.buffer = gpu_.buffer(buffer);
            e.size = bytes;
        } else if (b.kind == shader::BindingKind::Storage && storages_.count(b.name.substr(2))) {
            const FrameStorage& storage = storages_.at(b.name.substr(2)); // "s_<name>"
            e.buffer = gpu_.buffer(storage.buffer);
            e.size = storage.capacity;
        } else if (b.depth) {
            // `t_shadow{i}` / `t_shadowCube{i}` and their samplers: direct light i's shadow map (2D, or a
            // point light's cube) and the comparison sampler.
            const std::string prefix = b.cube ? "shadowCube" : "shadow";
            const std::size_t index = std::stoul(b.name.substr(b.name.find(prefix) + prefix.size()));
            if (b.kind == shader::BindingKind::Texture) e.textureView = (b.cube ? cubeShadowMaps_ : shadowMaps_).at(index).view;
            else e.sampler = compareSampler_;
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
            } else if (b.kind == shader::BindingKind::Storage) {
                e.buffer.type = WGPUBufferBindingType_ReadOnlyStorage;
                e.buffer.minBindingSize = b.minSize;
            } else if (b.kind == shader::BindingKind::Texture) {
                e.texture.sampleType = b.depth ? WGPUTextureSampleType_Depth : WGPUTextureSampleType_Float;
                e.texture.viewDimension = b.cube ? WGPUTextureViewDimension_Cube : WGPUTextureViewDimension_2D;
            } else if (b.kind == shader::BindingKind::Sampler) {
                e.sampler.type = b.depth ? WGPUSamplerBindingType_Comparison : WGPUSamplerBindingType_Filtering;
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

Renderer::Program& Renderer::program(MaterialKind kind, const shader::VertexVariant& vv, const std::string& lights) {
    const std::string key = std::to_string(static_cast<int>(kind)) + "|" + vv.key() + "|" + lights;
    if (const auto found = programs_.find(key); found != programs_.end()) return *found->second;
    const shader::LightLayout layout{lights};
    shader::StandardPrograms source;
    switch (kind) {
    case MaterialKind::Standard: source = shader::buildStandard(shader::StandardMaterial{}, vv, layout); break;
    case MaterialKind::Basic: source = shader::buildBasic(vv); break;
    case MaterialKind::Lambert: source = shader::buildLambert(vv, layout); break;
    case MaterialKind::Phong: source = shader::buildPhong(vv, layout); break;
    case MaterialKind::Physical: source = shader::buildPhysical(shader::StandardMaterial{}, vv, layout); break;
    }
    shader::StageModule vertex = shader::buildStage(source.vertex, 0);
    shader::StageModule fragment = shader::buildStage(source.fragment, 1);
    if (!vertex.wgsl.ok() || !fragment.wgsl.ok())
        throw std::runtime_error("TN_NATIVE_SHADER_INVALID: material program " + key);
    return add(key, std::move(vertex), std::move(fragment));
}

Renderer::Program& Renderer::depthProgram(const shader::VertexVariant& variant) {
    shader::VertexVariant kind = variant;
    kind.instanceColor = false; // a depth pass reads no colour
    const std::string key = "depth|" + kind.key();
    if (const auto found = programs_.find(key); found != programs_.end()) return *found->second;
    // three's shadow pass draws with the default positionNode, the same transform as a basic material.
    shader::StageModule vertex = shader::buildStage(shader::buildBasic(kind).vertex, 0);
    if (!vertex.wgsl.ok()) throw std::runtime_error("TN_NATIVE_SHADER_INVALID: shadow depth program");
    shader::StageModule fragment;
    fragment.stage = shader::Stage::Fragment;
    return add(key, std::move(vertex), std::move(fragment));
}

Renderer::Program& Renderer::add(const std::string& key, shader::StageModule vertex, shader::StageModule fragment) {
    auto built = std::make_unique<Program>();
    built->vertex = std::move(vertex);
    built->fragment = std::move(fragment);
    buildLayouts(*built);
    if (uniformCapacity_ != 0) {
        for (int g = 0; g < 2; ++g)
            built->groups[g] = bindGroup(built->layouts[g], g == 0 ? built->vertex : built->fragment, uniformBuffer_,
                                         lutView_, lutSampler_);
    }
    return *programs_.emplace(key, std::move(built)).first->second;
}

void Renderer::rebuildGroups() {
    for (auto& [key, program] : programs_) {
        for (int g = 0; g < 2; ++g) {
            if (program->groups[g]) wgpuBindGroupRelease(program->groups[g]);
            program->groups[g] = bindGroup(program->layouts[g], g == 0 ? program->vertex : program->fragment,
                                           uniformBuffer_, lutView_, lutSampler_);
        }
    }
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
    // Upper case: the light casts a shadow, which a receiving mesh's program reads; a mesh that does
    // not receive shadows takes the lower-case layout, as three keys a program on receiveShadow.
    std::string lightKinds, unshadowedKinds;
    bool shadowMapsChanged = false;
    for (std::size_t i = 0; i < lights.direct.size(); ++i) {
        const DirectLight& l = lights.direct[i];
        const char kind = l.kind == DirectLight::Kind::Directional ? 'd' : l.kind == DirectLight::Kind::Point ? 'p' : 's';
        unshadowedKinds += kind;
        lightKinds += l.shadow ? static_cast<char>(kind - 'a' + 'A') : kind;
        if (!l.shadow) continue;
        std::vector<ShadowMap>& maps = l.shadow->cube ? cubeShadowMaps_ : shadowMaps_;
        if (maps.size() <= i) maps.resize(i + 1);
        ShadowMap& map = maps[i];
        if (map.width == l.shadow->width && map.height == l.shadow->height) continue;
        if (map.view) wgpuTextureViewRelease(map.view);
        for (WGPUTextureView& face : map.faces) {
            if (face) wgpuTextureViewRelease(face);
            face = nullptr;
        }
        if (map.texture) wgpuTextureRelease(map.texture);
        WGPUTextureDescriptor desc = {};
        desc.dimension = WGPUTextureDimension_2D;
        desc.size = {l.shadow->width, l.shadow->height, l.shadow->cube ? 6u : 1u};
        desc.format = WGPUTextureFormat_Depth24Plus;
        desc.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_TextureBinding;
        desc.mipLevelCount = 1;
        desc.sampleCount = 1;
        map.texture = wgpuDeviceCreateTexture(device_, &desc);
        map.cube = l.shadow->cube;
        if (map.cube) {
            WGPUTextureViewDescriptor view = {};
            view.format = WGPUTextureFormat_Depth24Plus;
            view.mipLevelCount = 1;
            view.dimension = WGPUTextureViewDimension_Cube;
            view.arrayLayerCount = 6;
            map.view = wgpuTextureCreateView(map.texture, &view);
            view.dimension = WGPUTextureViewDimension_2D;
            view.arrayLayerCount = 1;
            for (uint32_t face = 0; face < 6; ++face) {
                view.baseArrayLayer = face;
                map.faces[face] = wgpuTextureCreateView(map.texture, &view);
            }
        } else {
            map.view = view2d(map.texture, WGPUTextureFormat_Depth24Plus);
        }
        map.width = l.shadow->width;
        map.height = l.shadow->height;
        shadowMapsChanged = true;
    }

    // Each skinned draw's palette, appended once to the frame's bone buffer; its draws (main and shadow)
    // read it from `boneBase`. three's skeleton.update() ran in the render database.
    // Each morphed draw's targets and influences likewise (three's morph texture, as vec4 per vertex
    // and target, the normal after the position), and its base influence: 1 for relative targets,
    // else 1 minus the influences' sum, summed in double as JS reduces them.
    for (auto& [name, storage] : storages_) storage.data.clear();
    std::vector<float>& bones = storages_["boneMatrices"].data;
    std::vector<float>& morphData = storages_["morphData"].data;
    std::vector<float>& morphInfluences = storages_["morphInfluences"].data;
    struct Deform {
        double boneBase = 0, morphBase = 0, morphInfluenceBase = 0, morphVertexCount = 0, morphBaseInfluence = 1;
    };
    std::unordered_map<const DrawItem*, Deform> deforms;
    for (const auto& [depthKey, drawn] : opaque) {
        if (!drawn->boneMatrices && !drawn->morphGeometry) continue;
        Deform& d = deforms[drawn];
        if (drawn->boneMatrices) {
            d.boneBase = double(bones.size() / 16);
            bones.insert(bones.end(), drawn->boneMatrices->begin(), drawn->boneMatrices->end());
        }
        if (const BufferGeometry* g = drawn->morphGeometry) {
            const bool normals = !g->morphNormals.empty();
            const std::size_t vertices = g->morphPositions.front()->count();
            d.morphBase = double(morphData.size() / 4);
            d.morphVertexCount = double(vertices);
            for (std::size_t i = 0; i < g->morphPositions.size(); ++i) {
                for (std::size_t j = 0; j < vertices; ++j) {
                    const BufferAttribute& p = *g->morphPositions[i];
                    morphData.insert(morphData.end(), {float(p.getComponent(j, 0)), float(p.getComponent(j, 1)),
                                                       float(p.getComponent(j, 2)), 0.0f});
                    if (normals) {
                        const BufferAttribute& n = *g->morphNormals.at(i);
                        morphData.insert(morphData.end(), {float(n.getComponent(j, 0)), float(n.getComponent(j, 1)),
                                                           float(n.getComponent(j, 2)), 0.0f});
                    }
                }
            }
            d.morphInfluenceBase = double(morphInfluences.size());
            double sum = 0;
            for (const double influence : *drawn->morphInfluences) {
                morphInfluences.push_back(float(influence));
                sum += influence;
            }
            // One influence per target the program reads; a shorter array reads as zeros.
            for (std::size_t i = drawn->morphInfluences->size(); i < g->morphPositions.size(); ++i)
                morphInfluences.push_back(0.0f);
            d.morphBaseInfluence = g->morphTargetsRelative ? 1 : 1 - sum;
        }
    }
    auto putSkin = [&](uint64_t v, const shader::UniformField* const* vs, const DrawItem& item) {
        const auto found = deforms.find(&item);
        if (found == deforms.end()) return;
        const Deform& d = found->second;
        if (item.boneMatrices) {
            put(frameUniforms_, v, vs[kBoneBase], std::array<double, 1>{d.boneBase});
            put(frameUniforms_, v, vs[kBindMatrix], item.bindMatrix);
            put(frameUniforms_, v, vs[kBindMatrixInverse], item.bindMatrixInverse);
        }
        put(frameUniforms_, v, vs[kMorphBase], std::array<double, 1>{d.morphBase});
        put(frameUniforms_, v, vs[kMorphInfluenceBase], std::array<double, 1>{d.morphInfluenceBase});
        put(frameUniforms_, v, vs[kMorphVertexCount], std::array<double, 1>{d.morphVertexCount});
        put(frameUniforms_, v, vs[kMorphBaseInfluence], std::array<double, 1>{d.morphBaseInfluence});
    };
    auto variantOf = [](const DrawItem& item) {
        shader::VertexVariant v;
        v.instanced = item.instanceMatrices != nullptr;
        v.instanceColor = item.instanceColors != nullptr;
        v.skinned = item.boneMatrices != nullptr;
        if (item.morphGeometry) {
            v.morphTargets = static_cast<uint8_t>(item.morphGeometry->morphPositions.size());
            v.morphNormals = !item.morphGeometry->morphNormals.empty();
        }
        v.positionNode = item.positionNode;
        return v;
    };

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
        Program& program = this->program(item.kind, variantOf(item),
                                         item.kind == MaterialKind::Basic ? ""
                                         : item.receiveShadow            ? lightKinds
                                                                         : unshadowedKinds);
        if (item.instanceCount == 0) continue;  // three draws nothing for count 0
        const bool lit = item.kind != MaterialKind::Basic;
        if (!item.positions || (lit && !item.normals) || !item.material) continue;
        // material.side: FrontSide culls back faces, BackSide front faces, DoubleSide none.
        const WGPUCullMode cull = item.side == 2 ? WGPUCullMode_None : item.side == 1 ? WGPUCullMode_Front : WGPUCullMode_Back;
        PipelineTarget target{WGPUTextureFormat_RGBA16Float, WGPUTextureFormat_Depth32Float, cull, item.transparent,
                              item.depthWrite};
        target.layout = program.pipelineLayout;
        target.skinIndex = skinIndexFormat(item);
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
        putSkin(v, vs, item);
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
            if (l.shadow) {
                put(frameUniforms_, f, slot[kLightShadowMatrix], l.shadow->matrix);
                put(frameUniforms_, f, slot[kLightShadowBias], std::array<double, 1>{l.shadow->bias});
                put(frameUniforms_, f, slot[kLightShadowNormalBias], std::array<double, 1>{l.shadow->normalBias});
                put(frameUniforms_, f, slot[kLightShadowRadius], std::array<double, 1>{l.shadow->radius});
                put(frameUniforms_, f, slot[kLightShadowMapSize],
                    std::array<double, 2>{double(l.shadow->width), double(l.shadow->height)});
                put(frameUniforms_, f, slot[kLightShadowIntensity], std::array<double, 1>{l.shadow->intensity});
                put(frameUniforms_, f, slot[kLightShadowNear], std::array<double, 1>{l.shadow->near});
                put(frameUniforms_, f, slot[kLightShadowFar], std::array<double, 1>{l.shadow->far});
            }
        }
        put(frameUniforms_, f, fs[kHemisphereSky], lights.hemisphereSky);
        put(frameUniforms_, f, fs[kHemisphereGround], lights.hemisphereGround);
        put(frameUniforms_, f, fs[kHemisphereDirection], lights.hemisphereUp);  // world space: it meets normalWorld
        put(frameUniforms_, f, fs[kAmbient], lights.ambient);
        plan.push_back({&item, &program, pipeline, static_cast<uint32_t>(v), static_cast<uint32_t>(f)});
    }

    // Each shadow-casting light's depth pass: every caster through the shadow camera, back faces for
    // front-sided materials (three's _shadowSide), depth only. Order is free: depth keeps the nearest.
    struct ShadowPass {
        WGPUTextureView target;
        std::vector<Planned> draws;
    };
    std::vector<ShadowPass> shadowPasses;
    for (std::size_t i = 0; i < lights.direct.size(); ++i) {
        if (!lights.direct[i].shadow) continue;
        const DirectLight::Shadow& shadow = *lights.direct[i].shadow;
        for (int face = 0; face < (shadow.cube ? 6 : 1); ++face) {
        const Matrix& view = shadow.cube ? shadow.faceViews[face] : shadow.view;
        ShadowPass& pass = shadowPasses.emplace_back();
        pass.target = shadow.cube ? cubeShadowMaps_[i].faces[face] : shadowMaps_[i].view;
        for (const auto& [depthKey, drawn] : opaque) {
            const DrawItem& item = *drawn;
            if (!item.castShadow || item.instanceCount == 0 || !item.positions) continue;
            Program& program = depthProgram(variantOf(item));
            // three's _shadowSide: a front-sided caster draws its back faces, a back-sided one its
            // front faces, a double-sided one both.
            const WGPUCullMode cull =
                item.side == 2 ? WGPUCullMode_None : item.side == 1 ? WGPUCullMode_Back : WGPUCullMode_Front;
            PipelineTarget target{WGPUTextureFormat_Undefined, WGPUTextureFormat_Depth24Plus, cull};
            target.layout = program.pipelineLayout;
            target.skinIndex = skinIndexFormat(item);
            WGPURenderPipeline pipeline = pipelines_.get(program.vertex, nullptr, target);
            if (!pipeline) throw std::runtime_error("TN_NATIVE_PIPELINE_REFUSED: shadow depth program");
            const uint64_t v = frameUniforms_.size();
            frameUniforms_.resize(v + aligned(program.vertex.uniformBlockSize), 0);
            put(frameUniforms_, v, program.vertexSlots[kModelMatrix], item.matrixWorld);
            put(frameUniforms_, v, program.vertexSlots[kViewMatrix], view);
            put(frameUniforms_, v, program.vertexSlots[kProjectionMatrix], shadow.projection);
            putSkin(v, program.vertexSlots, item);
            pass.draws.push_back({&item, &program, pipeline, static_cast<uint32_t>(v), 0});
        }
        }
    }

    // One buffer for the frame's uniforms, grown (and its bind groups rebuilt) when it is too small,
    // written once: a queue write, so it lands before this frame's commands and after the last's.
    if (frameUniforms_.size() > uniformCapacity_) {
        if (uniformCapacity_ != 0) gpu_.destroy(uniformBuffer_);
        uniformCapacity_ = std::max<uint64_t>(frameUniforms_.size() * 2, 64 * 1024);
        uniformBuffer_ = gpu_.createBuffer(uniformCapacity_, WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
        rebuildGroups();
    } else if (shadowMapsChanged) {
        rebuildGroups();
    }
    if (!frameUniforms_.empty()) gpu_.writeBuffer(uniformBuffer_, 0, frameUniforms_.data(), frameUniforms_.size());
    for (auto& [name, storage] : storages_) {
        if (storage.data.size() * 4 > storage.capacity) {
            gpu_.destroy(storage.buffer);
            storage.capacity = std::max<uint64_t>(storage.data.size() * 4 * 2, 64 * 1024);
            storage.buffer = gpu_.createBuffer(storage.capacity, WGPUBufferUsage_Storage | WGPUBufferUsage_CopyDst);
            rebuildGroups();
        }
        if (!storage.data.empty()) gpu_.writeBuffer(storage.buffer, 0, storage.data.data(), storage.data.size() * 4);
    }

    // Encode: state changes only where they change; per draw, its dynamic offsets and the draw. The
    // shadow passes first, so the main pass samples this frame's maps.
    WGPURenderPipeline bound = nullptr;
    const BufferStore* boundVertex[8] = {};  // by vertex buffer slot (attribute location)
    const BufferStore* boundIndex = nullptr;
    lastFrame_ = FrameStats{};
    auto encode = [&](WGPURenderPassEncoder pass, const Planned& p, bool counted) {
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
                                 : a.name == "skinIndex"     ? *item.skinIndices
                                 : a.name == "skinWeight"    ? *item.skinWeights
                                                             : *item.instanceMatrices;
            const uint64_t offset = column ? uint64_t(a.name.back() - '0') * 16 : 0;
            const Handle buffer = geometry_.sync(store, WGPUBufferUsage_Vertex);
            if (a.location < std::size(boundVertex) && boundVertex[a.location] == &store) continue;
            wgpuRenderPassEncoderSetVertexBuffer(pass, a.location, gpu_.buffer(buffer), offset, store.byteLength() - offset);
            if (a.location < std::size(boundVertex)) boundVertex[a.location] = &store;
        }
        wgpuRenderPassEncoderSetBindGroup(pass, 0, p.program->groups[0], 1, &p.vertexOffset);
        // The depth program's fragment group is empty: no uniform block, no dynamic offset.
        const bool fragmentBlock = p.program->fragment.uniformBlockSize != 0;
        wgpuRenderPassEncoderSetBindGroup(pass, 1, p.program->groups[1], fragmentBlock ? 1 : 0, &p.fragmentOffset);
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
            if (counted) lastFrame_.triangles += uint64_t{item.instanceCount} * (count / 3);  // three's Info.update
        } else {
            const uint32_t count = static_cast<uint32_t>(item.positions->byteLength() / 12);
            wgpuRenderPassEncoderDraw(pass, count, item.instanceCount, 0, 0);
            if (counted) lastFrame_.triangles += uint64_t{item.instanceCount} * (count / 3);
        }
        if (counted) ++lastFrame_.draws;
    };
    for (const ShadowPass& shadowPlan : shadowPasses) {
        WGPURenderPassDepthStencilAttachment shadowDepth = {};
        shadowDepth.view = shadowPlan.target;
        shadowDepth.depthLoadOp = WGPULoadOp_Clear;
        shadowDepth.depthStoreOp = WGPUStoreOp_Store;
        shadowDepth.depthClearValue = 1.0f;
        WGPURenderPassDescriptor shadowDesc = {};
        shadowDesc.depthStencilAttachment = &shadowDepth;
        WGPURenderPassEncoder shadowPass = wgpuCommandEncoderBeginRenderPass(encoder, &shadowDesc);
        bound = nullptr;
        boundIndex = nullptr;
        for (const Planned& p : shadowPlan.draws) encode(shadowPass, p, false); // three's info counts the main pass
        wgpuRenderPassEncoderEnd(shadowPass);
        wgpuRenderPassEncoderRelease(shadowPass);
    }
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    bound = nullptr;
    boundIndex = nullptr;
    for (const Planned& p : plan) encode(pass, p, true);
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

// The output triangle again, this time sampling the finished RGBA8 frame into a window surface. The
// program's own variant is chosen by the target format, so a BGRA swapchain gets a BGRA pipeline.
bool Renderer::blitTo(WGPUQueue queue, WGPUTextureView target, WGPUTextureFormat format) {
    if (!target || !colorView_)
        return false;
    // The finished frame is already tone mapped and encoded: the blit copies it, never re-encodes it.
    if (blitVertex_.wgsl.code.empty()) {
        const shader::OutputPrograms copy = shader::buildOutput(std::nullopt, false);
        blitVertex_ = shader::buildStage(copy.vertex, 0);
        blitFragment_ = shader::buildStage(copy.fragment, 0);
    }
    WGPURenderPipeline pipeline = pipelines_.get(
        blitVertex_, &blitFragment_, PipelineTarget{format, WGPUTextureFormat_Undefined, WGPUCullMode_None});
    if (!pipeline)
        return false;
    WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(pipeline, 0);
    WGPUBindGroup group = bindGroup(layout, blitFragment_, outputUniforms_, colorView_, outputSampler_);
    wgpuBindGroupLayoutRelease(layout);
    if (!group)
        return false;

    WGPUCommandEncoderDescriptor encoderDesc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, &encoderDesc);
    WGPURenderPassColorAttachment color = {};
    color.view = target;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = {0, 0, 0, 1};
#if defined(MYSTRAL_WEBGPU_DAWN)
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif
    WGPURenderPassDescriptor passDesc = {};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &color;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, group, 0, nullptr);
    wgpuRenderPassEncoderSetVertexBuffer(pass, blitVertex_.attributes.at(0).location,
                                         gpu_.buffer(outputTriangle_), 0, 24);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    WGPUCommandBufferDescriptor commandDesc = {};
    gpu_.submit(wgpuCommandEncoderFinish(encoder, &commandDesc));
    wgpuCommandEncoderRelease(encoder);
    wgpuBindGroupRelease(group);
    return true;
}

}  // namespace tn::engine
