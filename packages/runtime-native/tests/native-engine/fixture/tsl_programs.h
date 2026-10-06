#pragma once
// The native twins of three-native/tests/compatibility/render/tsl-programs.js: the TSL program a
// render fixture's `tsl` op names, authored with the native TSL builder, applied to the bound
// material (and any GPU work it needs) just before the frame is drawn.

#include "engine/abi/binding.h"
#include "probes.h"
#include "engine/renderer/compute.h"
#include "engine/renderer/renderer.h"
#include "engine/renderer/post/traa.h"
#include "engine/scene/material.h"
#include "engine/scene/camera.h"
#include "engine/scene/lights.h"
#include "engine/shader/tsl/tsl.h"
#include "engine/world/particles/gpu_particles.h"
#include "engine/world/fluids/fluid_particles.h"
#include "engine/scene/nodes.h"

#include <functional>
#include <cstdlib>
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

inline std::string particleSprites(binding::Object& object, engine::Renderer& renderer, WGPUDevice device,
                                   std::vector<std::shared_ptr<void>>& resources, bool fluid) {
    using namespace engine::shader;
    using namespace engine::shader::tsl;
    if (object.cls != "Sprite") return "particle fixture needs a Sprite";
    auto& sprite = *static_cast<engine::Sprite*>(object.ptr.get());
    if (!sprite.material || !sprite.material->spriteMaterial) return "particle fixture needs the game sprite material";
    constexpr uint32_t amount = 12;
    constexpr int ticks = 10;
    const auto initialPosition = [] {
        const Node row = instanceIndex().div(uint_(4));
        const Node col = instanceIndex().sub(row.mul(uint_(4)));
        const Node mod3 = instanceIndex().sub(instanceIndex().div(uint_(3)).mul(uint_(3)));
        return vec3({float_(col).sub(1.5).mul(1.1), float_(row).sub(1).mul(0.85), float_(mod3).sub(1).mul(0.2)});
    };
    engine::GpuResources& gpu = renderer.gpu();
    WGPUCommandEncoderDescriptor desc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device, &desc);
    engine::Handle positions;
    uint64_t bytes = amount * 16;
    if (!fluid) {
        auto particles = std::make_shared<engine::world::GpuParticles3D>(device, gpu,
            engine::world::GpuParticles3D::Options{amount,
                [&](Storage p, Storage v) {
                    p.element(instanceIndex()).assign(initialPosition());
                    v.element(instanceIndex()).assign(vec3({0.1, 0.25, -0.08}));
                },
                [](Storage p, Storage v) {
                    const Node velocity = v.element(instanceIndex());
                    p.element(instanceIndex()).assign(Node(p.element(instanceIndex())).add(velocity.mul(1.0 / 60)));
                    v.element(instanceIndex()).assign(velocity.add(vec3({0, -1.2 / 60, 0})));
                }, {}});
        if (!particles->error().empty() || !particles->attach(encoder)) {
            wgpuCommandEncoderRelease(encoder);
            return "particles-sprite: " + particles->error();
        }
        for (int tick = 0; tick < ticks; ++tick) if (!particles->process(encoder)) {
            wgpuCommandEncoderRelease(encoder); return "particles-sprite: " + particles->error();
        }
        positions = particles->positions();
        resources.push_back(std::move(particles)); // lives through draw/readback, before renderer teardown
    } else {
        engine::world::FluidParticles3D::Options options;
        options.capacity = amount; options.min = {-1, -1, -1}; options.max = {1, 1, 1}; options.voxelSize = 0.25;
        auto particles = std::make_shared<engine::world::FluidParticles3D>(device, gpu, options);
        if (!particles->error().empty()) { wgpuCommandEncoderRelease(encoder); return particles->error(); }
        for (uint32_t i = 0; i < amount; ++i) {
            if (!particles->emit({(int(i % 3) - 1) * 0.1, (int(i / 3 % 2) - 0.5) * 0.1, (int(i / 6) - 0.5) * 0.1},
                {0.1 + (i % 3) * 0.07, 0.25, -0.08 + (i / 6) * 0.1})) {
                wgpuCommandEncoderRelease(encoder); return "fluid-particles emission refused";
            }
        }
        for (int tick = 0; tick < ticks; ++tick) if (!particles->process()) {
            wgpuCommandEncoderRelease(encoder); return particles->error();
        }
        positions = particles->positions();
        resources.push_back(std::move(particles));
    }
    WGPUCommandBufferDescriptor commands = {};
    gpu.submit(wgpuCommandEncoderFinish(encoder, &commands));
    wgpuCommandEncoderRelease(encoder);
    renderer.setStorage("positions", positions, bytes);
    sprite.count = amount;
    sprite.material->positionNode = std::make_shared<PositionNode>(PositionNode{
        fluid ? "fluid-particles" : "particles-sprite", [fluid](Program& vertex, ExprId) {
            Build build(vertex);
            return Node(storage("positions", Type::vec(fluid ? 4 : 3)).element(instanceIndex())).xyz().id;
        }});
    namespace g = engine::shader::graph;
    sprite.material->nodes.colorNode = g::vec4({g::uv(), g::float_(0.35), g::float_(1)});
    sprite.material->nodes.opacityNode = g::float_(0.8);
    sprite.material->needsUpdate();
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
                                   WGPUDevice device, const std::function<std::string(uint32_t, uint32_t)>& renderAt,
                                   std::vector<std::shared_ptr<void>>& resources, engine::Camera* camera = nullptr) {
    if (program == "traa-history" || program == "history-cut") {
        if (object.cls != "Scene" || !camera) return "TN_FIXTURE_TRAA_INVALID: scene/camera";
        auto* scene = static_cast<engine::Scene*>(object.ptr.get());
        auto* mesh = dynamic_cast<engine::Mesh*>(scene->getObjectByName("temporalPattern"));
        if (!mesh || !mesh->material) return "TN_FIXTURE_TRAA_INVALID: temporalPattern/material";
        namespace g = engine::shader::graph;
        const auto pattern = [&](float phase) {
            const auto value = g::mul(g::sin(g::add(g::mul(g::swizzle(g::uv(), "x"), g::float_(900)),
                g::uniform("temporalPhase", engine::shader::Type::f32(), {phase}))),
                g::sin(g::mul(g::swizzle(g::uv(), "y"), g::float_(700))));
            mesh->material->nodes.colorNode = g::vec4({g::vec3({g::add(g::mul(value, g::float_(0.45)), g::float_(0.5))}), g::float_(1)});
            mesh->material->needsUpdate();
        };
        pattern(0);
        renderer.setTraa(engine::TraaOptions{});
        if (const char* directory = std::getenv("TN_TRAA_DUMP");
            program == "traa-history" && directory && *directory)
            renderer.traaDebugPass()->enableDebugDump();
        const auto draw = [&]() { camera->updateMatrixWorld(true); return renderAt(renderer.width(), renderer.height()); };
        for (int i = 0; i < 20; ++i) {
            mesh->position.x = i * 0.002;
            if (const auto error = draw(); !error.empty()) return error;
        }
        camera->position.z = 5.01; camera->updateMatrixWorld(true);
        pattern(float(3.141592653589793));
        renderer.cutHistory();
        const int steps = program == "history-cut" ? 0 : 3;
        for (int i = 0; i < steps; ++i) {
            mesh->position.x = (20 + i) * 0.002;
            if (const auto error = draw(); !error.empty()) return error;
        }
        mesh->position.x = (20 + steps) * 0.002;
        return "";
    }
    if (program == "probes" || program == "probes-baked" || program == "probes-relight") {
        if (object.cls != "Scene") return "TN_FIXTURE_PROBES_SCENE";
        const auto error = tsl_detail::probeFixture(program, *static_cast<engine::Scene*>(object.ptr.get()), renderer, renderAt);
        return error.empty() || error.starts_with("TN_FIXTURE_PROBES_")
                   ? error : "TN_FIXTURE_PROBES_FAILURE: " + error;
    }
    if (program == "particles-sprite" || program == "fluid-particles")
        return tsl_detail::particleSprites(object, renderer, device, resources, program == "fluid-particles");
    if (program == "vsm-basic" || program == "vsm-cut") {
        if (object.cls != "DirectionalLight" || !camera) return "TN_FIXTURE_VSM_INVALID: light/camera";
        engine::shadows::AtlasOptions options;
        options.clipExtents = {8, 24}; options.mapSize = 256; options.pageTexels = 64;
        options.lightDistance = 20; options.depthRange = 40; options.refreshStep = {0};
        renderer.setVirtualShadow(0, options);
        for (int i = 0; i < 2; ++i) {
            camera->updateMatrixWorld(true);
            if (const std::string error = renderAt(renderer.width(), renderer.height()); !error.empty()) return error;
        }
        if (program == "vsm-cut") {
            // Same eye/page keys, changed indices only: neither bounds nor position signatures
            // invalidate this cached shadow. Only the cut removes the box's broad ghost shadow.
            auto* light = static_cast<engine::DirectionalLight*>(object.ptr.get());
            auto* caster = light->parent ? dynamic_cast<engine::Mesh*>(light->parent->getObjectByName("cutCaster")) : nullptr;
            if (!caster || !caster->geometry || !caster->geometry->index) return "TN_FIXTURE_VSM_INVALID: cutCaster/index";
            caster->geometry->setIndexFromArray(std::vector<uint32_t>(caster->geometry->index->count(), 0));
            camera->lookAt(engine::Vector3(0, 0.4, 0)); camera->updateMatrixWorld(true);
            renderer.cutVirtualShadows();
        }
        return "";
    }
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
    if (program == "vsm-deformation") {
        material->nodes.positionNode = g::add(g::positionLocal(),
            g::vec3({g::float_(0), g::float_(0), g::mul(g::sin(g::mul(g::swizzle(g::positionLocal(), "x"), g::float_(2))), g::float_(0.4))}));
    } else if (program == "nodemat-color-uv") {
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
