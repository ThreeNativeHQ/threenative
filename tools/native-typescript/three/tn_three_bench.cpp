// The benchmark session of the native-AOT driver (PRD-533): a Perry-compiled game builds its scene
// through the facade, then drives this renderer one frame at a time, with the same meters as
// tn-native-engine-host (adapters/v8/host_main.cpp) so native-cpp, native-v8 and native-aot read alike.
// Per measured frame: the game's update (begin to render), the submit (RenderDatabase::render) and
// the frame (both plus the wait for the GPU), the C ABI crossings and the draws and triangles.
#include "engine/abi/abi_internal.h"
#include "engine/renderer/render_database.h"
#include "mystral/webgpu/context.h"
#include "threenative/abi/tn_abi.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

extern "C" tn_handle_t tnx_handle(int slot);

namespace {
using Clock = std::chrono::steady_clock;
using namespace tn::engine;

double ms(Clock::time_point a, Clock::time_point b) { return std::chrono::duration<double, std::milli>(b - a).count(); }

// workload.ts's percentile: the sorted sample at rank ceil(f * n) - 1.
double percentile(std::vector<double> samples, double fraction) {
    if (samples.empty()) return 0;
    std::sort(samples.begin(), samples.end());
    const double rank = std::ceil(fraction * double(samples.size())) - 1;
    return samples[size_t(std::clamp(rank, 0.0, double(samples.size() - 1)))];
}

std::string series(const std::vector<double>& s) {
    char buffer[128];
    std::snprintf(buffer, sizeof buffer, "{\"p50\": %.4f, \"p95\": %.4f}", percentile(s, 0.5), percentile(s, 0.95));
    return buffer;
}

struct Session {
    mystral::webgpu::Context gpu;
    EventQueue events;
    std::unique_ptr<Renderer> renderer;
    RenderDatabase database;
    std::shared_ptr<void> sceneHold, cameraHold;  // the session co-owns what it renders
    Scene* scene = nullptr;
    Camera* camera = nullptr;
    uint32_t width = 0, height = 0, meshes = 0;
    std::vector<double> update, submit, frame, crossings, gpuTimes;
    uint64_t gpuSeen = 0;
    Renderer::FrameStats stats;
    Clock::time_point begun;
    uint64_t crossedAt = 0;
    uint32_t frameIndex = 0, warmup = 0;
};
Session* session = nullptr;

double setting(const char* name, double fallback) {
    const char* value = std::getenv(name);
    return value && *value ? std::atof(value) : fallback;
}
}  // namespace

extern "C" double tnx_bench_config(const char* name) {
    const std::string key = name;
    if (key == "objects") return setting("TN_BENCH_OBJECTS", 4096);
    if (key == "frames") return setting("TN_BENCH_FRAMES", 600);
    if (key == "warmup") return setting("TN_BENCH_WARMUP", 120);
    if (key == "width") return setting("TN_BENCH_WIDTH", 1280);
    if (key == "height") return setting("TN_BENCH_HEIGHT", 720);
    return -1;
}

extern "C" const char* tnx_bench(const char* operation, double a, double b, double c, double d) {
    static std::string answer;
    try {
        const std::string op = operation;
        if (op == "open") {
            auto* sceneObject = tn::abi::objectOf(tnx_handle(int(a)));
            auto* cameraObject = tn::abi::objectOf(tnx_handle(int(b)));
            if (!sceneObject || sceneObject->cls != "Scene" || !cameraObject || cameraObject->cls != "PerspectiveCamera")
                return "TN_BENCH_OPEN_ARGUMENT: a Scene and a PerspectiveCamera";
            if (session) return "TN_BENCH_OPEN_TWICE";
            session = new Session();
            session->width = uint32_t(std::lround(c));
            session->height = uint32_t(std::lround(d));
            if (!session->gpu.initializeHeadless()) return "TN_BENCH_NO_GPU";
            session->renderer = std::make_unique<Renderer>(session->gpu.getInstance(), session->gpu.getDevice(),
                                                           session->gpu.getQueue(), session->events);
            session->renderer->setSize(session->width, session->height);
            session->renderer->setGpuTimer(true);  // the report carries gpuMs, as the host arms do
            session->sceneHold = sceneObject->ptr;
            session->cameraHold = cameraObject->ptr;
            session->scene = static_cast<Scene*>(sceneObject->ptr.get());
            session->camera = static_cast<PerspectiveCamera*>(cameraObject->ptr.get());
            session->scene->traverse(
                [](Object3D& object, void* context) {
                    if (object.type() == "Mesh") ++*static_cast<uint32_t*>(context);
                },
                &session->meshes);
            return "";
        }
        if (!session) return "TN_BENCH_NOT_OPEN";
        if (op == "begin") {
            session->frameIndex = uint32_t(a);
            session->warmup = uint32_t(b);
            session->crossedAt = tn::abi::crossings();
            session->begun = Clock::now();
            return "";
        }
        if (op == "render") {
            Session& s = *session;
            const auto t1 = Clock::now();
            s.database.render(*s.renderer, *s.scene, *s.camera);
            const auto t2 = Clock::now();
            // One frame in flight, as a presented frame would be: wait for the GPU before the next.
            while (s.renderer->gpu().completedSerial() < s.renderer->gpu().submittedSerial()) {
                s.renderer->poll();
                s.events.drain();
            }
            const auto t3 = Clock::now();
            if (!s.database.diagnostics().empty()) {
                answer = "TN_BENCH_RENDER: " + s.database.diagnostics().front();
                return answer.c_str();
            }
            if (s.frameIndex < s.warmup) return "";
            s.update.push_back(ms(s.begun, t1));
            s.submit.push_back(ms(t1, t2));
            s.frame.push_back(ms(s.begun, t3));
            s.crossings.push_back(double(tn::abi::crossings() - s.crossedAt));
            if (s.renderer->gpuSamples() != s.gpuSeen) {
                s.gpuSeen = s.renderer->gpuSamples();
                s.gpuTimes.push_back(s.renderer->lastGpuMs());
            }
            s.stats = s.renderer->lastFrame();
            return "";
        }
        if (op == "finish") {
            Session& s = *session;
            const char* path = std::getenv("TN_BENCH_REPORT");
            if (!path || !*path) return "TN_BENCH_REPORT_UNSET";
            std::vector<double> hot(s.update.size());
            for (size_t k = 0; k < hot.size(); ++k) hot[k] = s.update[k] + s.submit[k];
            std::ostringstream json;
            json << "{\n  \"arm\": \"native-aot\",\n  \"workload\": \"L4\",\n"
                 << "  \"objects\": " << uint32_t(setting("TN_BENCH_OBJECTS", 4096)) << ",\n"
                 << "  \"presentedObjects\": " << (s.meshes ? s.meshes - 1 : 0) << ",\n"  // N cubes under one ground plane
                 << "  \"sceneTriangles\": " << s.stats.triangles << ",\n"
                 << "  \"frames\": " << s.update.size() << ",\n  \"warmup\": " << s.warmup << ",\n"
                 << "  \"size\": [" << s.width << ", " << s.height << "],\n"
                 << "  \"updateMs\": " << series(s.update) << ",\n  \"submitMs\": " << series(s.submit) << ",\n"
                 << "  \"hotPathMs\": " << series(hot) << ",\n  \"frameMs\": " << series(s.frame) << ",\n"
                 << "  \"crossingsPerFrame\": " << series(s.crossings) << ",\n"
                 << "  \"draws\": " << s.stats.draws << ",\n  \"triangles\": " << s.stats.triangles << ",\n"
                 << "  \"gpuMs\": " << (s.gpuTimes.empty() ? std::string("null") : series(s.gpuTimes))
                 << ",\n  \"gpuSamples\": " << s.gpuTimes.size() << ",\n  \"presented\": false\n}\n";
            std::ofstream(path) << json.str();
            return "";
        }
        return "TN_BENCH_OP: unknown operation";
    } catch (const std::exception& error) {
        answer = std::string("TN_BENCH_EXCEPTION: ") + error.what();
        return answer.c_str();
    }
}
