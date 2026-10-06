#pragma once
// The native twins of three-native/tests/compatibility/render/tsl-programs.js: the TSL program a
// render fixture's `tsl` op names, authored with the native TSL builder, applied to the bound
// material (and any GPU work it needs) just before the frame is drawn.

#include "engine/abi/binding.h"
#include "engine/renderer/compute.h"
#include "engine/renderer/renderer.h"
#include "engine/scene/material.h"
#include "engine/shader/tsl/tsl.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace tn::fixture {

namespace tsl_detail {

inline constexpr uint32_t kGridCount = 10000;

inline engine::Material* materialOf(binding::Object& object) {
    if (!binding::isMaterialClass(object.cls)) return nullptr;
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

/**
 * PRD-513: a post pass over the scene texture: a 2-texel chromatic split (texel centres, so the
 * sampler's filter cannot matter) and a radial vignette, before tone mapping.
 */
inline void postChromatic(engine::Renderer& renderer) {
    using namespace engine::shader;
    using namespace engine::shader::tsl;
    renderer.setPostNode(std::make_shared<PostNode>(PostNode{
        "post-chromatic", [](Program& fragment, uint32_t scene, ExprId screenUv) {
            Build build(fragment);
            const Node uv(screenUv);
            const Node offset = vec2({2.0 / 320.0, 0});
            const Node r = sample(scene, uv.add(offset)).x();
            const Node g = sample(scene, uv).y();
            const Node b = sample(scene, uv.sub(offset)).z();
            const Node vignette = float_(1).sub(length(uv.sub(0.5)).mul(0.6));
            return vec4({vec3({r, g, b}).mul(vignette), 1}).id;
        }}));
}

}  // namespace tsl_detail

/**
 * Applies the named program; empty on success, else why not (an unknown name included).
 * `renderAt(width, height)` draws the fixture's scene once at that size, for a program that
 * renders before the captured frame (a resize).
 */
inline std::string applyTslProgram(const std::string& program, binding::Object& object, engine::Renderer& renderer,
                                   WGPUDevice device, const std::function<std::string(uint32_t, uint32_t)>& renderAt) {
    if (program == "post-chromatic") {
        tsl_detail::postChromatic(renderer);
        return "";
    }
    if (program == "post-chromatic-resized") {
        // Drawn once at another size first, so the captured frame is the one after a resize.
        tsl_detail::postChromatic(renderer);
        return renderAt(200, 150);
    }
    engine::Material* material = tsl_detail::materialOf(object);
    if (material == nullptr) return "tsl " + program + ": " + object.cls + " is not a material";
    // PRD-531 slice 3: the upstream fixture programs above, built as native lazy graphs.
    namespace g = engine::shader::graph;
    using engine::shader::Type;
    const auto x = g::swizzle(g::uv(), "x"), y = g::swizzle(g::uv(), "y");
    if (program == "nodemat-color-uv") {
        material->nodes.colorNode = g::vec4({g::uv(), g::uniform("nodeTint", Type::f32(), {0.35f}), g::float_(1)});
    } else if (program == "nodemat-standard-nodes") {
        material->nodes.roughnessNode = g::add(g::mul(x, g::float_(0.7)), g::float_(0.2));
        material->nodes.metalnessNode = g::mul(y, g::float_(0.8));
        material->nodes.emissiveNode = g::vec3({g::add(g::mul(g::sin(g::mul(x, g::float_(8))), g::float_(0.15)),
                                                    g::float_(0.15)), g::float_(0), g::float_(0)});
    } else if (program == "nodemat-normal-opacity") {
        material->nodes.normalNode = g::normalize(g::add(g::varying("normalViewGeometry", Type::vec(3)),
            g::vec3({g::mul(g::sin(g::mul(x, g::float_(10))), g::float_(0.35)), g::float_(0), g::float_(0)})));
        material->nodes.opacityNode = g::add(g::mul(y, g::float_(0.6)), g::float_(0.2));
    } else {
        if (program == "storage-instances") return tsl_detail::storageInstances(*material, renderer, device);
        if (program == "wave-plane") return tsl_detail::wavePlane(*material);
        return "TN_FIXTURE_TSL_UNKNOWN: " + program;
    }
    material->needsUpdate();
    return "";
}

}  // namespace tn::fixture
