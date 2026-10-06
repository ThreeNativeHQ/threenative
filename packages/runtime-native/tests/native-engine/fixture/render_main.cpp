// tn-native-engine-render-driver: the fixture driver with a GPU. It answers `render` lines by
// drawing the fixture's scene through the native renderer's render database — the path a game's
// `renderer.render(scene, camera)` takes — and writing the frame as a PNG for run-native to compare
// with the browser's golden frame.
#include "tsl_programs.h"
#include "driver.h"
#include "engine/abi/bindings.h"
#include "engine/renderer/render_database.h"
#include "mystral/webgpu/context.h"

#include <chrono>
#include <iostream>
#include <memory>
#include <sstream>
#include <thread>

#include <unistd.h>

extern "C" int stbi_write_png(const char* filename, int w, int h, int comp, const void* data, int stride);

using namespace tn::engine;

namespace {

std::optional<shader::ToneMapping> toneMapping(const std::string& name) {
    using T = shader::ToneMapping;
    if (name == "linear") return T::Linear;
    if (name == "reinhard") return T::Reinhard;
    if (name == "cineon") return T::Cineon;
    if (name == "aces") return T::ACESFilmic;
    if (name == "agx") return T::AgX;
    if (name == "neutral") return T::Neutral;
    return std::nullopt;  // none
}

struct Gpu {
    mystral::webgpu::Context context;
    EventQueue events;
    std::unique_ptr<Renderer> renderer;
    RenderDatabase database;
    std::vector<std::shared_ptr<void>> fixtureResources;
};

std::string draw(Gpu& gpu, tn::binding::Object& sceneObject, tn::binding::Object& cameraObject, const tn::fixture::RenderRequest& r) {
    if (sceneObject.cls != "Scene") return "render scene is a " + sceneObject.cls;
    Camera* camera = nullptr;
    if (cameraObject.cls == "PerspectiveCamera") camera = static_cast<PerspectiveCamera*>(cameraObject.ptr.get());
    if (cameraObject.cls == "OrthographicCamera") camera = static_cast<OrthographicCamera*>(cameraObject.ptr.get());
    if (!camera) return "render camera is a " + cameraObject.cls;
    if (!gpu.renderer) {
        if (!gpu.context.initializeHeadless()) return "no GPU device";
        gpu.renderer = std::make_unique<Renderer>(gpu.context.getInstance(), gpu.context.getDevice(), gpu.context.getQueue(), gpu.events);
    }
    Renderer& renderer = *gpu.renderer;
    renderer.setSize(r.width, r.height);
    renderer.setOutput(OutputState{toneMapping(r.toneMapping), r.exposure, r.srgb});
    auto& scene = *static_cast<Scene*>(sceneObject.ptr.get());
    // three's background colour is the clear colour; without one the renderer clears to black.
    std::array<double, 4> clear{0, 0, 0, 1};
    if (scene.background) clear = {scene.background->r, scene.background->g, scene.background->b, 1};
    gpu.database.shadowMapEnabled = r.shadowMap;
    const auto renderAt = [&](uint32_t width, uint32_t height) -> std::string {
        renderer.setSize(width, height);
        gpu.database.render(renderer, scene, *camera, clear);
        renderer.setSize(r.width, r.height);
        return gpu.database.diagnostics().empty() ? "" : gpu.database.diagnostics().front();
    };
    for (auto [program, object] : r.tsl)
        if (const std::string failed =
                tn::fixture::applyTslProgram(program, object, renderer, gpu.context.getDevice(), renderAt, gpu.fixtureResources, camera);
            !failed.empty())
            return failed;
    gpu.database.render(renderer, scene, *camera, clear);
    if (!gpu.database.diagnostics().empty()) return gpu.database.diagnostics().front();
    std::vector<uint8_t> pixels;
    bool done = false;
    renderer.readPixels([&](GpuStatus s, std::vector<uint8_t> px) {
        if (s == GpuStatus::Ok) pixels = std::move(px);
        done = true;
    });
    for (int i = 0; i < 5000 && !done; ++i) {
        renderer.poll();
        gpu.events.drain();
        if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    if (pixels.size() != size_t{r.width} * r.height * 4) return "frame readback failed";
    if (!stbi_write_png(r.png.c_str(), int(r.width), int(r.height), 4, pixels.data(), int(r.width * 4))) return "png write failed: " + r.png;
    return "";
}

}  // namespace

int main() {
    // The GPU context logs to stdout, and stdout is the protocol: keep a handle on the real stdout
    // for the replies and point fd 1 at stderr for everything else.
    const int protocol = dup(STDOUT_FILENO);
    dup2(STDERR_FILENO, STDOUT_FILENO);
    tn::fixture::Driver driver;
    tn::binding::registerAll(driver.classes);
    Gpu gpu;
    driver.render = [&gpu](tn::binding::Object& scene, tn::binding::Object& camera, const tn::fixture::RenderRequest& r) {
        return draw(gpu, scene, camera, r);
    };
    std::ostringstream replies;
    const int status = driver.run(std::cin, replies);
    const std::string text = replies.str();
    for (size_t written = 0; written < text.size();) {
        const ssize_t n = write(protocol, text.data() + written, text.size() - written);
        if (n <= 0) return 1;
        written += size_t(n);
    }
    close(protocol);
    return status;
}
