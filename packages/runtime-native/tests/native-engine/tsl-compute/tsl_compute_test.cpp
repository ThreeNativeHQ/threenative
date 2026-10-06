// The TSL compute programs of programs.js, authored with the native builder and run on the device,
// against compute_reference.json (recorded from the pinned three in headed Chromium's WebGPU):
//   instance_grid      PRD-513: one pass writes 10,000 instance positions.
//   particles_lifetime PRD-527: GPUParticles3D with a game emitter; after the same seed and 90 ticks
//                      every particle's life and generation are equal, so emission, lifetime and
//                      recycling counts are; positions within f32 rounding.
#include "check.h"
#include "engine/foundation/json.h"
#include "engine/renderer/compute.h"
#include "engine/world/particles/gpu_particles.h"
#include "mystral/webgpu/context.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <thread>
#include <vector>

using namespace tn::engine;
using namespace tn::engine::shader;
using namespace tn::engine::shader::tsl;

namespace {

constexpr uint32_t kGridCount = 10000;
constexpr uint32_t kParticleAmount = 256;
constexpr int kParticleTicks = 90;
constexpr uint32_t kParticleSeed = 1337;

std::vector<float> decode(const std::string& base64) {
    static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<uint8_t> bytes;
    uint32_t buffer = 0;
    int bits = 0;
    for (const char c : base64) {
        const auto at = alphabet.find(c);
        if (at == std::string::npos) continue;  // '=' padding
        buffer = (buffer << 6) | static_cast<uint32_t>(at);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push_back(static_cast<uint8_t>(buffer >> bits));
        }
    }
    std::vector<float> out(bytes.size() / 4);
    std::memcpy(out.data(), bytes.data(), out.size() * 4);
    return out;
}

std::vector<float> reference(const char* program, const char* buffer) {
    std::ifstream in(TN_COMPUTE_REFERENCE, std::ios::binary);
    const std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    json::Value root;
    json::Error error;
    CHECK(json::parse(text, root, error));
    const json::Value* programs = root.find("programs");
    const json::Value* entry = programs != nullptr ? programs->find(program) : nullptr;
    const json::Value* data = entry != nullptr ? entry->find(buffer) : nullptr;
    CHECK(data != nullptr);
    return data != nullptr ? decode(data->string()) : std::vector<float>{};
}

struct Device {
    mystral::webgpu::Context context;
    EventQueue events;
    std::unique_ptr<GpuResources> gpu;

    Device() {
        CHECK(context.initializeHeadless());
        gpu = std::make_unique<GpuResources>(context.getInstance(), context.getDevice(), context.getQueue(), events, 1);
    }
    WGPUCommandEncoder encoder() {
        WGPUCommandEncoderDescriptor desc = {};
        return wgpuDeviceCreateCommandEncoder(context.getDevice(), &desc);
    }
    void submit(WGPUCommandEncoder encoder) {
        WGPUCommandBufferDescriptor desc = {};
        gpu->submit(wgpuCommandEncoderFinish(encoder, &desc));
        wgpuCommandEncoderRelease(encoder);
    }
    std::vector<float> read(Handle buffer, uint64_t floats) {
        std::vector<float> out;
        bool done = false;
        gpu->readBuffer(buffer, 0, floats * 4, [&](GpuStatus s, std::vector<uint8_t> bytes) {
            CHECK(s == GpuStatus::Ok);
            out.resize(bytes.size() / 4);
            std::memcpy(out.data(), bytes.data(), out.size() * 4);
            done = true;
        });
        for (int i = 0; i < 4000 && !done; ++i) {
            gpu->poll();
            events.drain();
            if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        CHECK(done);
        return out;
    }
    Handle storage(uint64_t floats) {
        const uint64_t bytes = floats * 4;
        const Handle h = gpu->createBuffer(bytes, WGPUBufferUsage_Storage | WGPUBufferUsage_CopySrc | WGPUBufferUsage_CopyDst);
        const std::vector<uint8_t> zeros(bytes, 0);
        gpu->writeBuffer(h, 0, zeros.data(), bytes);
        return h;
    }
};

/** Equal, or both within f32 rounding of each other; counts how many were not bit-equal. */
size_t compare(const std::vector<float>& got, const std::vector<float>& want, float tolerance, size_t& inexact) {
    size_t differ = got.size() == want.size() ? 0 : 1;
    for (size_t i = 0; i < std::min(got.size(), want.size()); ++i) {
        if (got[i] == want[i]) continue;
        if (std::fabs(got[i] - want[i]) <= tolerance * std::max(1.0f, std::fabs(want[i]))) ++inexact;
        else ++differ;
    }
    return differ;
}

Node lcg(Node state) { return state.mul(uint_(1664525)).add(uint_(1013904223)); }
Node modulo(Node value, uint32_t n) { return value.sub(value.div(uint_(n)).mul(uint_(n))); }

void instanceGrid() {
    Device device;
    Program program(Stage::Compute);
    {
        Build build(program);
        const Storage positions = storage("positions", Type::vec(4));
        const Node time = uniform("time", Type::f32());
        Fn([&] {
            If(instanceIndex().lessThan(uint_(kGridCount)), [&] {
                const Node row = instanceIndex().div(uint_(100));
                const Node column = float_(instanceIndex().sub(row.mul(uint_(100))));
                positions.element(instanceIndex())
                    .assign(vec4({column.mul(0.5), sin(column.mul(0.25).add(time)), float_(row).mul(0.5), 1}));
            });
        });
    }
    for (const Diagnostic& d : program.diagnostics()) std::fprintf(stderr, "%s %s: %s\n", d.code.c_str(), d.node.c_str(), d.reason.c_str());
    ComputePass pass(device.context.getDevice(), *device.gpu, program);
    CHECK(program.ok() && pass.error().empty());
    const Handle positions = device.storage(uint64_t{kGridCount} * 4);
    WGPUCommandEncoder encoder = device.encoder();
    const Handle storage[] = {positions};
    CHECK(pass.dispatch(encoder, storage, kGridCount, {{"time", 0.75}}));
    device.submit(encoder);
    size_t inexact = 0;
    const size_t differ = compare(device.read(positions, uint64_t{kGridCount} * 4), reference("instance-grid", "positions"), 1e-6f, inexact);
    std::printf("instance grid: %u positions, %zu components differ, %zu within f32 rounding\n", kGridCount, differ, inexact);
    CHECK(differ == 0);
}

void particlesLifetime() {
    Device device;
    const Handle state = device.storage(uint64_t{kParticleAmount} * 2);
    const auto seed = [](Node generation) {
        return lcg(lcg(instanceIndex().add(uint_(kParticleSeed)).add(generation.mul(uint_(7919)))));
    };
    const auto spawn = [&](Storage positions, Storage velocities, Storage life, Node generation) {
        const Node s = seed(generation);
        life.element(instanceIndex()).assign(vec2({float_(modulo(s, 60).add(uint_(1))), float_(generation)}));
        positions.element(instanceIndex()).assign(vec3({0, 0, 0}));
        const Node x = float_(modulo(s.div(uint_(64)), 200)).sub(100).mul(0.01);
        const Node z = float_(modulo(s.div(uint_(16384)), 200)).sub(100).mul(0.01);
        velocities.element(instanceIndex()).assign(vec3({x, 2, z}));
    };
    world::GpuParticles3D particles(
        device.context.getDevice(), *device.gpu,
        {kParticleAmount,
         [&](Storage positions, Storage velocities) {
             spawn(positions, velocities, storage("state", Type::vec(2)), uint_(0));
         },
         [&](Storage positions, Storage velocities) {
             const Storage life = storage("state", Type::vec(2));
             const Node current = life.element(instanceIndex());
             const Node remaining = current.x().sub(1);
             const Node generation = current.y();
             const Node velocity = velocities.element(instanceIndex());
             positions.element(instanceIndex())
                 .assign(Node(positions.element(instanceIndex())).add(velocity.mul(1.0 / 60)));
             velocities.element(instanceIndex()).assign(velocity.sub(vec3({0, 9.8 / 60, 0})));
             life.element(instanceIndex()).assign(vec2({remaining, generation}));
             If(remaining.lessThan(0.5), [&] { spawn(positions, velocities, life, uint_(generation.add(1))); });
         },
         {state}});
    if (!particles.error().empty()) std::fprintf(stderr, "%s\n", particles.error().c_str());
    CHECK(particles.error().empty());
    WGPUCommandEncoder encoder = device.encoder();
    CHECK(particles.attach(encoder));
    for (int tick = 0; tick < kParticleTicks; ++tick) CHECK(particles.process(encoder));
    device.submit(encoder);

    const std::vector<float> gotState = device.read(state, uint64_t{kParticleAmount} * 2);
    const std::vector<float> wantState = reference("particles", "state");
    size_t inexact = 0;
    const size_t stateDiffer = compare(gotState, wantState, 0, inexact);
    double recycled = 0, wantRecycled = 0;
    for (size_t i = 1; i < gotState.size(); i += 2) recycled += gotState[i];
    for (size_t i = 1; i < wantState.size(); i += 2) wantRecycled += wantState[i];
    size_t positionsInexact = 0;
    const size_t positionsDiffer =
        compare(device.read(particles.positions(), uint64_t{kParticleAmount} * 4), reference("particles", "positions"), 1e-5f, positionsInexact);
    std::printf("particles: %u emitted at start, %.0f recycled (reference %.0f) over %d ticks; %zu state values differ, "
                "%zu position components differ, %zu within f32 rounding\n",
                kParticleAmount, recycled, wantRecycled, kParticleTicks, stateDiffer, positionsDiffer, positionsInexact);
    CHECK(stateDiffer == 0 && positionsDiffer == 0 && recycled == wantRecycled && recycled > 0);
    CHECK(particles.processDispatches() == static_cast<uint32_t>(kParticleTicks));

    // Not emitting, then released: no dispatch either way, as TS's `process` returns early.
    particles.emitting = false;
    WGPUCommandEncoder idle = device.encoder();
    CHECK(particles.process(idle));
    particles.emitting = true;
    particles.release();
    CHECK(particles.process(idle) && particles.processDispatches() == static_cast<uint32_t>(kParticleTicks));
    CHECK(!particles.attach(idle));
    device.submit(idle);
    device.gpu->destroy(state);
}

}  // namespace

TN_TEST_MAIN({"instance_grid", instanceGrid}, {"particles_lifetime", particlesLifetime})
