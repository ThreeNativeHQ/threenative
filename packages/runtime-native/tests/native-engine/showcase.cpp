// tn-native-engine-showcase: a progress screenshot of the native path as it stands. Shaders are
// authored as IR, emitted as WGSL packages, drawn through native GPU resources with no JS engine,
// read back and written as PNG. It grows with the renderer (N09); it is evidence, not a test.

#include "engine/renderer/gpu_resources.h"
#include "engine/shader/package.h"
#include "mystral/webgpu/context.h"

#include <webgpu/webgpu.h>
#include "mystral/webgpu_compat.h"

#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

extern "C" int stbi_write_png(const char* filename, int w, int h, int comp, const void* data, int stride);

using namespace tn::engine;
using namespace tn::engine::shader;
using Mat4 = std::array<float, 16>;  // column-major, as WGSL reads it

namespace {

constexpr uint32_t kWidth = 960;
constexpr uint32_t kHeight = 540;

Mat4 multiply(const Mat4& a, const Mat4& b) {
    Mat4 r{};
    for (int c = 0; c < 4; ++c)
        for (int row = 0; row < 4; ++row)
            for (int k = 0; k < 4; ++k) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
    return r;
}

Mat4 perspective(float fovY, float aspect, float near, float far) {
    const float f = 1.0f / std::tan(fovY / 2);
    Mat4 m{};
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1;
    m[14] = near * far / (near - far);
    return m;
}

Mat4 lookAt(std::array<float, 3> eye, std::array<float, 3> target) {
    auto sub = [](auto a, auto b) { return std::array<float, 3>{a[0] - b[0], a[1] - b[1], a[2] - b[2]}; };
    auto norm = [](std::array<float, 3> v) {
        const float l = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return std::array<float, 3>{v[0] / l, v[1] / l, v[2] / l};
    };
    auto cross = [](auto a, auto b) {
        return std::array<float, 3>{a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
    };
    auto dot = [](auto a, auto b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
    const auto z = norm(sub(eye, target));
    const std::array<float, 3> up{0, 1, 0};
    const auto x = norm(cross(up, z));
    const auto y = cross(z, x);
    return {x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1};
}

Mat4 transform(float x, float y, float z, float sx, float sy, float sz) {
    return {sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1};
}

struct Sphere {
    std::vector<float> positions, normals;
    std::vector<uint32_t> indices;
};

Sphere sphere(int segments, int rings) {
    Sphere s;
    for (int r = 0; r <= rings; ++r) {
        const float v = float(r) / rings * 3.14159265f;
        for (int g = 0; g <= segments; ++g) {
            const float u = float(g) / segments * 6.2831853f;
            const float n[3] = {std::sin(v) * std::cos(u), std::cos(v), std::sin(v) * std::sin(u)};
            s.positions.insert(s.positions.end(), n, n + 3);
            s.normals.insert(s.normals.end(), n, n + 3);
        }
    }
    for (int r = 0; r < rings; ++r)
        for (int g = 0; g < segments; ++g) {
            const uint32_t a = r * (segments + 1) + g, b = a + segments + 1;
            s.indices.insert(s.indices.end(), {a, b, a + 1, a + 1, b, b + 1});
        }
    return s;
}

Program vertexProgram() {
    Program v(Stage::Vertex);
    const ExprId model = v.uniform("model", Type::mat(4, 4));
    const ExprId world = v.mul(model, v.construct(Type::vec(4), {v.attribute("position", Type::vec(3)), v.constant(1.0f)}));
    v.output("position", v.mul(v.uniform("viewProjection", Type::mat(4, 4)), world));
    v.output("normal", v.swizzle(v.mul(model, v.construct(Type::vec(4), {v.attribute("normal", Type::vec(3)), v.constant(0.0f)})), "xyz"));
    v.output("world", v.swizzle(world, "xyz"));
    return v;
}

Program fragmentProgram() {
    Program f(Stage::Fragment);
    const ExprId n = f.call("normalize", {f.varying("normal", Type::vec(3))});
    const ExprId world = f.varying("world", Type::vec(3));
    const ExprId base = f.swizzle(f.uniform("color", Type::vec(4)), "rgb");
    const ExprId light = f.call("normalize", {f.uniform("lightDirection", Type::vec(3))});
    const ExprId view = f.call("normalize", {f.sub(f.uniform("cameraPosition", Type::vec(3)), world)});
    const ExprId lambert = f.call("max", {f.call("dot", {n, light}), f.constant(0.0f)});
    const ExprId half = f.call("normalize", {f.add(light, view)});
    const ExprId spec = f.call("pow", {f.call("max", {f.call("dot", {n, half}), f.constant(0.0f)}), f.constant(64.0f)});
    const ExprId sky = f.construct(Type::vec(3), {f.constant(0.55f), f.constant(0.65f), f.constant(0.85f)});
    const ExprId ground = f.construct(Type::vec(3), {f.constant(0.18f), f.constant(0.14f), f.constant(0.12f)});
    const ExprId hemi = f.call("mix", {ground, sky, f.add(f.mul(f.swizzle(n, "y"), f.constant(0.5f)), f.constant(0.5f))});
    const ExprId lit = f.add(f.add(f.mul(f.mul(base, hemi), f.constant(0.45f)), f.mul(base, f.mul(lambert, f.constant(1.1f)))),
                             f.construct(Type::vec(3), {f.mul(spec, f.constant(0.6f))}));
    // Linear to sRGB by a 2.2 power, since the target is RGBA8Unorm.
    const ExprId encoded = f.call("pow", {f.call("clamp", {lit, f.constant(0.0f), f.constant(1.0f)}),
                                          f.construct(Type::vec(3), {f.constant(1.0f / 2.2f)})});
    f.output("color", f.construct(Type::vec(4), {encoded, f.constant(1.0f)}));
    return f;
}

template <typename Done>
bool pump(GpuResources& gpu, EventQueue& events, Done done) {
    for (int i = 0; i < 5000 && !done(); ++i) {
        gpu.poll();
        events.drain();
        if (!done()) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return done();
}

WGPUShaderModule shaderModule(WGPUDevice device, const std::string& code) {
    WGPUShaderModuleWGSLDescriptor_Compat wgsl = {};
    WGPUShaderModuleDescriptor desc = {};
    setupShaderModuleWGSL(&desc, &wgsl, code.c_str());
    return wgpuDeviceCreateShaderModule(device, &desc);
}

}  // namespace

int main(int argc, char** argv) {
    const char* outPath = argc > 1 ? argv[1] : "showcase.png";
    mystral::webgpu::Context context;
    if (!context.initializeHeadless()) return std::fprintf(stderr, "no GPU device\n"), 1;
    WGPUDevice device = context.getDevice();
    EventQueue events;
    GpuResources gpu(context.getInstance(), device, context.getQueue(), events, 1);

    const StageModule vs = buildStage(vertexProgram(), 0);
    const StageModule fs = buildStage(fragmentProgram(), 1);
    if (!vs.wgsl.ok() || !fs.wgsl.ok()) return std::fprintf(stderr, "shader package invalid\n"), 1;

    const Sphere ball = sphere(64, 32);
    Sphere plane;
    plane.positions = {-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1};
    plane.normals = {0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0};
    plane.indices = {0, 1, 2, 2, 1, 3};
    // One buffer set holds both meshes: the plane's vertices and indices follow the sphere's.
    Sphere mesh = ball;
    const uint32_t planeBase = static_cast<uint32_t>(ball.positions.size() / 3);
    const uint32_t planeFirst = static_cast<uint32_t>(ball.indices.size());
    mesh.positions.insert(mesh.positions.end(), plane.positions.begin(), plane.positions.end());
    mesh.normals.insert(mesh.normals.end(), plane.normals.begin(), plane.normals.end());
    for (uint32_t i : plane.indices) mesh.indices.push_back(planeBase + i);
    const Handle positions = gpu.createBuffer(mesh.positions.size() * 4, WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst);
    const Handle normals = gpu.createBuffer(mesh.normals.size() * 4, WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst);
    const Handle indices = gpu.createBuffer(mesh.indices.size() * 4, WGPUBufferUsage_Index | WGPUBufferUsage_CopyDst);
    gpu.writeBuffer(positions, 0, mesh.positions.data(), mesh.positions.size() * 4);
    gpu.writeBuffer(normals, 0, mesh.normals.data(), mesh.normals.size() * 4);
    gpu.writeBuffer(indices, 0, mesh.indices.data(), mesh.indices.size() * 4);
    const Handle color = gpu.createTexture(kWidth, kHeight, WGPUTextureFormat_RGBA8Unorm,
                                           WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc);
    WGPUTextureDescriptor depthDesc = {};
    depthDesc.dimension = WGPUTextureDimension_2D;
    depthDesc.size = {kWidth, kHeight, 1};
    depthDesc.format = WGPUTextureFormat_Depth32Float;
    depthDesc.usage = WGPUTextureUsage_RenderAttachment;
    depthDesc.mipLevelCount = 1;
    depthDesc.sampleCount = 1;
    WGPUTexture depth = wgpuDeviceCreateTexture(device, &depthDesc);

    WGPUVertexAttribute attributes[2] = {};
    WGPUVertexBufferLayout buffers[2] = {};
    for (int i = 0; i < 2; ++i) {
        attributes[i].format = WGPUVertexFormat_Float32x3;
        attributes[i].shaderLocation = vs.attributes[i].location;
        buffers[i].arrayStride = 12;
        buffers[i].stepMode = WGPUVertexStepMode_Vertex;
        buffers[i].attributeCount = 1;
        buffers[i].attributes = &attributes[i];
    }
    WGPUShaderModule vsModule = shaderModule(device, vs.wgsl.code);
    WGPUShaderModule fsModule = shaderModule(device, fs.wgsl.code);
    WGPURenderPipelineDescriptor desc = {};
    desc.vertex.module = vsModule;
    WGPU_SET_ENTRY_POINT(desc.vertex, "main");
    desc.vertex.bufferCount = 2;
    desc.vertex.buffers = buffers;
    desc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    desc.primitive.cullMode = WGPUCullMode_Back;
    desc.primitive.frontFace = WGPUFrontFace_CW;
    desc.multisample.count = 1;
    desc.multisample.mask = 0xffffffffu;
    WGPUDepthStencilState depthState = {};
    depthState.format = WGPUTextureFormat_Depth32Float;
    depthState.depthWriteEnabled = WGPU_OPTIONAL_BOOL_TRUE;
    depthState.depthCompare = WGPUCompareFunction_Less;
    desc.depthStencil = &depthState;
    WGPUColorTargetState target = {};
    target.format = WGPUTextureFormat_RGBA8Unorm;
    target.writeMask = WGPUColorWriteMask_All;
    WGPUFragmentState fragment = {};
    fragment.module = fsModule;
    WGPU_SET_ENTRY_POINT(fragment, "main");
    fragment.targetCount = 1;
    fragment.targets = &target;
    desc.fragment = &fragment;
    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device, &desc);
    if (!pipeline) return std::fprintf(stderr, "pipeline refused\n"), 1;

    const std::array<float, 3> eye{0.0f, 2.2f, 7.5f};
    const Mat4 viewProjection = multiply(perspective(0.75f, float(kWidth) / kHeight, 0.1f, 100.0f), lookAt(eye, {0, 0.1f, 0}));
    struct Draw {
        Mat4 model;
        std::array<float, 4> rgba;
    };
    const Draw draws[] = {
        {transform(0, -1.0f, 0, 9, 1, 9), {0.30f, 0.32f, 0.36f, 1}},
        {transform(-2.3f, 0, 0, 1, 1, 1), {0.85f, 0.18f, 0.16f, 1}},
        {transform(0, 0, -0.4f, 1, 1, 1), {0.95f, 0.72f, 0.25f, 1}},
        {transform(2.3f, 0, 0, 1, 1, 1), {0.12f, 0.62f, 0.66f, 1}},
    };
    WGPUBindGroupLayout vsLayout = wgpuRenderPipelineGetBindGroupLayout(pipeline, 0);
    WGPUBindGroupLayout fsLayout = wgpuRenderPipelineGetBindGroupLayout(pipeline, 1);
    std::vector<WGPUBindGroup> groups;
    for (const Draw& d : draws) {
        std::vector<uint8_t> vblock(vs.uniformBlockSize), fblock(fs.uniformBlockSize);
        auto put = [](std::vector<uint8_t>& block, const StageModule& stage, const char* name, const float* data, size_t n) {
            for (const UniformField& f : stage.uniforms)
                if (f.name == name) std::memcpy(&block[f.offset], data, n * 4);
        };
        put(vblock, vs, "model", d.model.data(), 16);
        put(vblock, vs, "viewProjection", viewProjection.data(), 16);
        const float light[3] = {-0.45f, 0.85f, 0.4f};
        put(fblock, fs, "color", d.rgba.data(), 4);
        put(fblock, fs, "lightDirection", light, 3);
        put(fblock, fs, "cameraPosition", eye.data(), 3);
        for (auto [block, layout] : {std::pair{&vblock, vsLayout}, std::pair{&fblock, fsLayout}}) {
            const Handle buffer = gpu.createBuffer(block->size(), WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst);
            gpu.writeBuffer(buffer, 0, block->data(), block->size());
            WGPUBindGroupEntry entry = {};
            entry.binding = 0;
            entry.buffer = gpu.buffer(buffer);
            entry.size = block->size();
            WGPUBindGroupDescriptor groupDesc = {};
            groupDesc.layout = layout;
            groupDesc.entryCount = 1;
            groupDesc.entries = &entry;
            groups.push_back(wgpuDeviceCreateBindGroup(device, &groupDesc));
        }
    }

    WGPUTextureViewDescriptor viewDesc = {};
    viewDesc.dimension = WGPUTextureViewDimension_2D;
    viewDesc.mipLevelCount = 1;
    viewDesc.arrayLayerCount = 1;
    viewDesc.format = WGPUTextureFormat_RGBA8Unorm;
    WGPUTextureView colorView = wgpuTextureCreateView(gpu.texture(color), &viewDesc);
    viewDesc.format = WGPUTextureFormat_Depth32Float;
    WGPUTextureView depthView = wgpuTextureCreateView(depth, &viewDesc);
    WGPUCommandEncoderDescriptor encoderDesc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device, &encoderDesc);
    WGPURenderPassColorAttachment colorAttachment = {};
    colorAttachment.view = colorView;
    colorAttachment.loadOp = WGPULoadOp_Clear;
    colorAttachment.storeOp = WGPUStoreOp_Store;
    colorAttachment.clearValue = {0.07, 0.08, 0.11, 1.0};
#if defined(MYSTRAL_WEBGPU_DAWN)
    colorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif
    WGPURenderPassDepthStencilAttachment depthAttachment = {};
    depthAttachment.view = depthView;
    depthAttachment.depthLoadOp = WGPULoadOp_Clear;
    depthAttachment.depthStoreOp = WGPUStoreOp_Store;
    depthAttachment.depthClearValue = 1.0f;
    WGPURenderPassDescriptor passDesc = {};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &colorAttachment;
    passDesc.depthStencilAttachment = &depthAttachment;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, gpu.buffer(positions), 0, mesh.positions.size() * 4);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 1, gpu.buffer(normals), 0, mesh.normals.size() * 4);
    wgpuRenderPassEncoderSetIndexBuffer(pass, gpu.buffer(indices), WGPUIndexFormat_Uint32, 0, mesh.indices.size() * 4);
    for (size_t i = 0; i < std::size(draws); ++i) {
        wgpuRenderPassEncoderSetBindGroup(pass, 0, groups[i * 2], 0, nullptr);
        wgpuRenderPassEncoderSetBindGroup(pass, 1, groups[i * 2 + 1], 0, nullptr);
        if (i == 0) wgpuRenderPassEncoderDrawIndexed(pass, plane.indices.size(), 1, planeFirst, 0, 0);
        else wgpuRenderPassEncoderDrawIndexed(pass, ball.indices.size(), 1, 0, 0, 0);
    }
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    WGPUCommandBufferDescriptor commandDesc = {};
    gpu.submit(wgpuCommandEncoderFinish(encoder, &commandDesc));
    wgpuCommandEncoderRelease(encoder);

    std::vector<uint8_t> pixels;
    bool done = false;
    gpu.readTexture(color, [&](GpuStatus s, std::vector<uint8_t> out) {
        if (s == GpuStatus::Ok) pixels = std::move(out);
        done = true;
    });
    if (!pump(gpu, events, [&] { return done; }) || pixels.empty()) return std::fprintf(stderr, "readback failed\n"), 1;
    if (!stbi_write_png(outPath, kWidth, kHeight, 4, pixels.data(), kWidth * 4)) return std::fprintf(stderr, "png write failed\n"), 1;
    std::printf("SHOWCASE_OK %s %ux%u, %zu draws, %zu triangles each\n", outPath, kWidth, kHeight, std::size(draws),
                ball.indices.size() / 3);
    return 0;
}
