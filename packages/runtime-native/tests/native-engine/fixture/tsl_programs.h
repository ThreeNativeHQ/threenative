#pragma once
// The native twins of three-native/tests/compatibility/render/tsl-programs.js: the TSL program a
// render fixture's `tsl` op names, authored with the native TSL builder, applied to the bound
// material (and any GPU work it needs) just before the frame is drawn.

#include "engine/abi/binding.h"
#include "engine/renderer/compute.h"
#include "engine/renderer/renderer.h"
#include "engine/scene/material.h"
#include "engine/shader/tsl/tsl.h"

#include <memory>
#include <string>
#include <vector>

namespace tn::fixture {

namespace tsl_detail {

inline constexpr uint32_t kGridCount = 10000;

inline engine::Material* materialOf(binding::Object& object) {
    const std::string& cls = object.cls;
    if (cls.size() < 8 || cls.compare(cls.size() - 8, 8, "Material") != 0) return nullptr;
    return static_cast<engine::Material*>(object.ptr.get());
}

/** PRD-513: a compute pass writes the grid; the positionNode places instance i at entry i. */
inline std::string storageInstances(engine::Material& material, engine::Renderer& renderer, WGPUDevice device) {
    using namespace engine::shader;
    using namespace engine::shader::tsl;
    Program kernel(Stage::Compute);
    {
        Build build(kernel);
        const Storage positions = storage("positions", Type::vec(4));
        const Node time = uniform("time", Type::f32());
        If(instanceIndex().lessThan(uint_(kGridCount)), [&] {
            const Node row = instanceIndex().div(uint_(100));
            const Node column = float_(instanceIndex().sub(row.mul(uint_(100))));
            positions.element(instanceIndex())
                .assign(vec4({column.mul(0.5), sin(column.mul(0.25).add(time)), float_(row).mul(0.5), 1}));
        });
    }
    engine::GpuResources& gpu = renderer.gpu();
    engine::ComputePass pass(device, gpu, kernel);
    if (!kernel.ok() || !pass.error().empty()) return "storage-instances: " + pass.error();
    const uint64_t bytes = uint64_t{kGridCount} * 16;
    const engine::Handle buffer =
        gpu.createBuffer(bytes, WGPUBufferUsage_Storage | WGPUBufferUsage_CopySrc | WGPUBufferUsage_CopyDst);
    WGPUCommandEncoderDescriptor encoderDesc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device, &encoderDesc);
    const engine::Handle bound[] = {buffer};
    if (!pass.dispatch(encoder, bound, kGridCount, {{"time", 0.75}})) return "storage-instances: " + pass.error();
    WGPUCommandBufferDescriptor commandDesc = {};
    gpu.submit(wgpuCommandEncoderFinish(encoder, &commandDesc));
    wgpuCommandEncoderRelease(encoder);
    renderer.setStorage("positions", buffer, bytes);
    material.positionNode = std::make_shared<PositionNode>(PositionNode{
        "storage-instances", [](Program& vertex, ExprId position) {
            Build build(vertex);
            const Storage positions = storage("positions", Type::vec(4));
            return Node(position).add(Node(positions.element(instanceIndex())).xyz()).id;
        }});
    return "";
}

/** PRD-512: a plane bent by a sine wave along its own z. */
inline std::string wavePlane(engine::Material& material) {
    using namespace engine::shader;
    using namespace engine::shader::tsl;
    material.positionNode = std::make_shared<PositionNode>(PositionNode{
        "wave-plane", [](Program& vertex, ExprId position) {
            Build build(vertex);
            const Node local(position);
            return local.add(vec3({0, 0, sin(local.x().mul(2)).mul(0.4)})).id;
        }});
    return "";
}

}  // namespace tsl_detail

/** Applies the named program; empty on success, else why not (an unknown name included). */
inline std::string applyTslProgram(const std::string& program, binding::Object& object, engine::Renderer& renderer,
                                   WGPUDevice device) {
    engine::Material* material = tsl_detail::materialOf(object);
    if (material == nullptr) return "tsl " + program + ": " + object.cls + " is not a material";
    if (program == "storage-instances") return tsl_detail::storageInstances(*material, renderer, device);
    if (program == "wave-plane") return tsl_detail::wavePlane(*material);
    return "TN_FIXTURE_TSL_UNKNOWN: " + program;
}

}  // namespace tn::fixture
