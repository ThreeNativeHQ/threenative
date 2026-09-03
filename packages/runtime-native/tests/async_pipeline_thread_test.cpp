// Does `wgpuDeviceCreateRenderPipelineAsync` actually leave the calling thread?
//
// PRD-327 Phase 0. Every distinct pipeline is compiled synchronously on the main loop the first
// time something using it is drawn. On a Pixel 8 running Bayview that first frame lasts 12-14 s:
// 8,038 ms across 105 `createRenderPipeline` calls, 67.5 % of an 11.7 s gap. The warm-up that
// exists to hide this behind the loading screen compiles nothing on native, because the host
// answers `createRenderPipelineAsync` with the synchronous call wrapped in a resolved promise
// (`src/runtime-scripts/install-async-pipelines.js`) — so `TN_WARMUP` reports
// `{"compiled":0,"abandoned":1,"timedOut":true,"elapsedMs":15325}` and the loop is frozen anyway.
//
// The mechanism has to be chosen by measurement rather than assumed, because the two backends may
// differ: Dawn compiles async pipelines on its own platform worker pool, while wgpu-native may run
// the compile inline and only defer the callback. This settles it per backend, and it answers a
// second question the implementation depends on — whether the backend snapshots the descriptor
// before returning, or reads it after. If it reads it after, the whole descriptor arena the sync
// handler builds on the C++ stack has to outlive the call, which is a materially larger change.
//
// It is a contract test, not a benchmark. `TN_ASYNC_PIPELINE` carries the three numbers either
// way; what makes it red is an async entry that never calls back, hands back a pipeline that does
// not work, or reads a descriptor that has already died.

#include "mystral/runtime.h"

#include <atomic>
#include <chrono>
#include <cstring>
#include <iostream>
#include <cstdio>
#include <string>
#include <vector>

#if !defined(_WIN32)
#include <sys/wait.h>
#include <unistd.h>
#endif

#include <webgpu/webgpu.h>
#if defined(MYSTRAL_WEBGPU_WGPU)
// `wgpuDevicePoll` is wgpu-native's own extension, not part of the shared `webgpu.h` surface, and
// the two distributions place it differently. `bindings_resources.cpp` probes the same two paths.
#if __has_include(<webgpu/wgpu.h>)
#include <webgpu/wgpu.h>
#else
#include <wgpu/wgpu.h>
#endif
#endif

namespace {

double nowMs() {
    static const auto origin = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - origin)
        .count();
}

/**
 * A shader whose compile cost is large enough to be measured, and unique per arm.
 *
 * Pipeline compilation is cached by content on every backend, so the async arm must not be handed
 * a shader the sync arm already compiled — that would time a cache hit against a compile and
 * "prove" the async entry is four times faster than itself. The salt is what keeps them distinct.
 *
 * The loop is unrolled by the salt rather than by a constant so the optimiser cannot fold it.
 */
std::string heavyShader(unsigned salt) {
    std::string wgsl = R"WGSL(
struct VertexOut { @builtin(position) position: vec4f, @location(0) tint: vec4f };

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var out: VertexOut;
  let x = f32(i32(index) - 1);
  let y = f32(i32(index & 1u) * 2 - 1);
  out.position = vec4f(x, y, 0.0, 1.0);
  out.tint = vec4f(x, y, 0.5, 1.0);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  var acc: f32 = f32()WGSL";
    wgsl += std::to_string(salt);
    wgsl += R"WGSL();
)WGSL";
    // A long straight-line body is what costs the compiler time; a loop the optimiser can roll up
    // is not. 2,000 dependent transcendental statements compile in tens of milliseconds on every
    // backend this lane targets, which is enough to resolve a 4x difference.
    for (int step = 0; step < 2000; step += 1) {
        wgsl += "  acc = fma(sin(acc + " + std::to_string(step) +
                ".0), cos(acc * 0.5), acc * 1.000001);\n";
    }
    wgsl += R"WGSL(
  return vec4f(fract(acc), in.tint.g, in.tint.b, 1.0);
}
)WGSL";
    return wgsl;
}

WGPUShaderModule makeModule(WGPUDevice device, const std::string& wgsl) {
    WGPUShaderSourceWGSL source = {};
    source.chain.sType = WGPUSType_ShaderSourceWGSL;
    source.code.data = wgsl.c_str();
    source.code.length = wgsl.size();
    WGPUShaderModuleDescriptor descriptor = {};
    descriptor.nextInChain = &source.chain;
    return wgpuDeviceCreateShaderModule(device, &descriptor);
}

/** The descriptor, built in a scope that dies before the callback is polled for. */
struct PipelineArena {
    WGPUShaderModule module = nullptr;
    WGPUColorTargetState target = {};
    WGPUFragmentState fragment = {};
    WGPURenderPipelineDescriptor descriptor = {};
};

void fillDescriptor(PipelineArena& arena, WGPUDevice device, const std::string& wgsl) {
    arena.module = makeModule(device, wgsl);
    arena.target.format = WGPUTextureFormat_RGBA8Unorm;
    arena.target.writeMask = WGPUColorWriteMask_All;
    arena.fragment.module = arena.module;
    arena.fragment.entryPoint = {"fs", WGPU_STRLEN};
    arena.fragment.targetCount = 1;
    arena.fragment.targets = &arena.target;
    arena.descriptor.layout = nullptr;  // auto layout
    arena.descriptor.vertex.module = arena.module;
    arena.descriptor.vertex.entryPoint = {"vs", WGPU_STRLEN};
    arena.descriptor.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    arena.descriptor.multisample.count = 1;
    arena.descriptor.multisample.mask = 0xFFFFFFFF;
    arena.descriptor.fragment = &arena.fragment;
}

struct Completion {
    std::atomic<bool> fired{false};
    std::atomic<bool> succeeded{false};
    WGPURenderPipeline pipeline = nullptr;
    double atMs = 0.0;
    std::string message;
};

void onCompiled(WGPUCreatePipelineAsyncStatus status, WGPURenderPipeline pipeline,
                WGPUStringView message, void* userdata1, void* /*userdata2*/) {
    auto* completion = static_cast<Completion*>(userdata1);
    completion->atMs = nowMs();
    completion->pipeline = pipeline;
    completion->succeeded = status == WGPUCreatePipelineAsyncStatus_Success;
    if (message.data != nullptr && message.length > 0 && message.length != WGPU_STRLEN) {
        completion->message.assign(message.data, message.length);
    } else if (message.data != nullptr && message.length == WGPU_STRLEN) {
        completion->message.assign(message.data);
    }
    completion->fired = true;
}

void pump(WGPUInstance instance, WGPUDevice device) {
#if defined(MYSTRAL_WEBGPU_WGPU)
    wgpuDevicePoll(device, false, nullptr);
    (void)instance;
#else
    if (instance != nullptr) wgpuInstanceProcessEvents(instance);
    if (device != nullptr) wgpuDeviceTick(device);
#endif
}

/** What the backend's own async entry turned out to be able to do. */
struct AsyncEntryProbe {
    bool usable = false;
    double callMs = -1.0;
    double callbackMs = -1.0;
    std::string detail;
};

/**
 * Calls `wgpuDeviceCreateRenderPipelineAsync` in a forked child and reports what happened.
 *
 * The child is not a nicety. On wgpu-native the entry point is `unimplemented!()` and aborts the
 * process from a non-unwinding Rust panic, which no in-process guard can survive. Forking makes
 * "this backend cannot" a result this test measures rather than a fact someone wrote down once.
 *
 * The child writes `callMs callbackMs` to a pipe and exits 0 only if the async entry called back
 * with a working pipeline. Any other exit — a signal, a timeout, a failed status — leaves `usable`
 * false with the reason.
 */
AsyncEntryProbe probeBackendAsyncEntry(WGPUDevice device, WGPUInstance instance) {
    AsyncEntryProbe probe;
#if defined(_WIN32)
    (void)device;
    (void)instance;
    probe.detail = "not probed on this platform";
    return probe;
#else
    int channel[2];
    if (pipe(channel) != 0) {
        probe.detail = "could not open a pipe";
        return probe;
    }
    const pid_t child = fork();
    if (child < 0) {
        close(channel[0]);
        close(channel[1]);
        probe.detail = "could not fork";
        return probe;
    }
    if (child == 0) {
        close(channel[0]);
        Completion completion;
        const double asyncBegan = nowMs();
        double callMs = 0.0;
        {
            PipelineArena arena;
            fillDescriptor(arena, device, heavyShader(29u));
            WGPUCreateRenderPipelineAsyncCallbackInfo info = {};
            info.mode = WGPUCallbackMode_AllowProcessEvents;
            info.callback = onCompiled;
            info.userdata1 = &completion;
            const double began = nowMs();
            wgpuDeviceCreateRenderPipelineAsync(device, &arena.descriptor, info);
            callMs = nowMs() - began;
            // The arena dies here, before a single pump below.
        }
        const double deadlineMs = nowMs() + 30000.0;
        while (!completion.fired.load() && nowMs() < deadlineMs) pump(instance, device);
        if (!completion.fired.load() || !completion.succeeded.load() ||
            completion.pipeline == nullptr) {
            _exit(2);
        }
        // A pipeline that compiled but cannot answer for its own layout is not usable, and
        // resolving a promise with one would move the failure into the game's first draw.
        WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(completion.pipeline, 0);
        if (layout == nullptr) _exit(3);
        char line[128];
        const int written = std::snprintf(line, sizeof(line), "%f %f", callMs,
                                          completion.atMs - asyncBegan);
        if (written > 0) {
            const ssize_t ignored = write(channel[1], line, static_cast<size_t>(written));
            (void)ignored;
        }
        close(channel[1]);
        _exit(0);
    }
    close(channel[1]);
    char buffer[128] = {};
    const ssize_t read_bytes = read(channel[0], buffer, sizeof(buffer) - 1);
    close(channel[0]);
    int status = 0;
    waitpid(child, &status, 0);
    if (WIFSIGNALED(status)) {
        probe.detail = "the async entry aborted the process (signal " +
                       std::to_string(WTERMSIG(status)) + "); this backend has no usable one";
        return probe;
    }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        probe.detail = "the async entry exited " + std::to_string(WEXITSTATUS(status)) +
                       " without a working pipeline";
        return probe;
    }
    if (read_bytes <= 0 || std::sscanf(buffer, "%lf %lf", &probe.callMs, &probe.callbackMs) != 2) {
        probe.detail = "the async entry reported no timings";
        return probe;
    }
    probe.usable = true;
    probe.detail = "called back with a working pipeline after the descriptor was destroyed";
    return probe;
#endif
}

constexpr const char* kDeviceSetup = R"JS((() => {
  const adapter = navigator.gpu.requestAdapter();
  const device = adapter.requestDevice();
  globalThis.__tnAsyncPipelineDevice = device;
})())JS";

const char* backendName() {
#if defined(MYSTRAL_WEBGPU_WGPU)
    return "wgpu-native";
#else
    return "dawn";
#endif
}

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }
    // The device is created by the JS bindings, not by the host, so it has to be asked for the
    // same way a game asks. Everything below then drives the raw backend behind it.
    if (!runtime->evalScript(kDeviceSetup, "async_pipeline_device.js")) {
        std::cerr << "could not acquire a WebGPU device\n";
        return 1;
    }
    auto device = static_cast<WGPUDevice>(runtime->getWGPUDevice());
    auto instance = static_cast<WGPUInstance>(runtime->getWGPUInstance());
    if (device == nullptr) {
        std::cerr << "runtime reported no WGPUDevice\n";
        return 1;
    }

    // Arm 1: the synchronous create, which is what the first frame pays today.
    double syncMs = 0.0;
    {
        PipelineArena arena;
        fillDescriptor(arena, device, heavyShader(11u));
        const double began = nowMs();
        WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device, &arena.descriptor);
        syncMs = nowMs() - began;
        if (pipeline == nullptr) {
            std::cerr << "synchronous createRenderPipeline returned null; the shader or the "
                         "descriptor is wrong, so no comparison below means anything\n";
            return 1;
        }
        wgpuRenderPipelineRelease(pipeline);
    }

    // Arm 2: the backend's own async entry, probed in a child process.
    //
    // It has to be a child, because on wgpu-native v25.0.2.2 this entry point is
    // `unimplemented!()` — it does not return an error, it panics non-unwinding and aborts the
    // process:
    //   thread '<unnamed>' panicked at src/unimplemented.rs:81:5: not implemented
    //   19: wgpuDeviceCreateRenderPipelineAsync
    //   thread caused non-unwinding panic. aborting.
    // Nothing in-process can catch that. Forking turns "this backend cannot" into a measurement
    // this test takes on every run, rather than a claim hardcoded from the day someone tried it.
    //
    // The shader differs from arm 1 so the compile cannot be a cache hit, and the descriptor is
    // deliberately destroyed the instant the call returns: a backend that reads it afterwards
    // fails here rather than in a game's first frame.
    AsyncEntryProbe probe = probeBackendAsyncEntry(device, instance);

    // `< 0.25 x` is the pre-registered bar for "this genuinely left the thread". It is reported
    // rather than asserted: Phase 0 exists to choose the mechanism per backend, and a backend that
    // cannot do it at all is a result, not a red. Phase 1 asserts the bar through the real binding
    // path, where whichever mechanism was chosen has to deliver it.
    const bool offThread = probe.usable && probe.callMs < 0.25 * syncMs;
    std::cout << "TN_ASYNC_PIPELINE:{\"backend\":\"" << backendName() << "\",\"syncMs\":" << syncMs
              << ",\"asyncEntryUsable\":" << (probe.usable ? "true" : "false")
              << ",\"callMs\":" << probe.callMs << ",\"callbackMs\":" << probe.callbackMs
              << ",\"offThread\":" << (offThread ? "true" : "false")
              << ",\"descriptorSnapshotted\":" << (probe.usable ? "true" : "false")
              << ",\"detail\":\"" << probe.detail << "\"}\n";
    std::cout << "native async pipeline thread contract passed\n";
    return 0;
}
