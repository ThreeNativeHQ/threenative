// In-process frame dump host, reusing the render driver's headless device and readback path.
#include "engine/abi/abi_internal.h"
#include "engine/renderer/render_database.h"
#include "mystral/webgpu/context.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>
#include <unistd.h>
extern "C" tn_handle_t tnx_handle(int slot);
extern "C" int stbi_write_png(const char*, int, int, int, const void*, int);
extern "C" const char* tnx_render(int64_t sceneSlot, int64_t cameraSlot) {
    using namespace tn::engine;
    try {
        auto* sceneObject = tn::abi::objectOf(tnx_handle(int(sceneSlot)));
        auto* cameraObject = tn::abi::objectOf(tnx_handle(int(cameraSlot)));
        const char* file = std::getenv("TN_TSL_FRAME");
        if (!file || !*file || !sceneObject || sceneObject->cls != "Scene" ||
            !cameraObject || cameraObject->cls != "OrthographicCamera") return "TN_TSL_RENDER_ARGUMENT";
        // Context logging must not contaminate the corpus stdout contract.
        std::fflush(stdout);
        const int saved = dup(STDOUT_FILENO);
        if (saved < 0 || dup2(STDERR_FILENO, STDOUT_FILENO) < 0) return "TN_TSL_RENDER_STDOUT";
        mystral::webgpu::Context context;
        const bool initialized = context.initializeHeadless();
        std::fflush(stdout);
        dup2(saved, STDOUT_FILENO);
        close(saved);
        if (!initialized) return "TN_TSL_RENDER_NO_DEVICE";
        EventQueue events;
        Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
        renderer.setSize(320, 240);
        renderer.setOutput(OutputState{});
        RenderDatabase database;
        database.render(renderer, *static_cast<Scene*>(sceneObject->ptr.get()),
                        *static_cast<OrthographicCamera*>(cameraObject->ptr.get()), {0, 0, 0, 0});
        if (!database.diagnostics().empty()) return "TN_TSL_RENDER_DIAGNOSTIC";
        bool done = false;
        std::vector<uint8_t> pixels;
        renderer.readPixels([&](GpuStatus status, std::vector<uint8_t> data) {
            if (status == GpuStatus::Ok) pixels = std::move(data);
            done = true;
        });
        for (int i = 0; i < 5000 && !done; ++i) {
            renderer.poll(); events.drain();
            if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        if (pixels.size() != 320 * 240 * 4) return "TN_TSL_RENDER_READBACK";
        if (!stbi_write_png(file, 320, 240, 4, pixels.data(), 320 * 4)) return "TN_TSL_RENDER_PNG";
        return "";
    } catch (...) { return "TN_TSL_RENDER_EXCEPTION"; }
}
