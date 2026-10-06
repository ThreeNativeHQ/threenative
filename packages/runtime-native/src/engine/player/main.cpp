// The native-engine desktop player (PRD-529 phase 2): an SDL window on the display the playtest
// runner provides, the engine's fixed-step clock, the render database into the renderer, the
// presentation of that frame, and the mailbox the runner talks to. No JS engine is linked: the game
// is inspect-demo, in C++.
#include <SDL3/SDL.h>

#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "engine/foundation/json.h"
#include "engine/inspect/endpoint.h"
#include "engine/player/demo.h"
#include "engine/player/mailbox.h"
#include "engine/renderer/presentation.h"
#include "engine/renderer/render_database.h"
#include "engine/world/loop/fixed_step.h"
#include "mystral/webgpu/context.h"

using namespace tn::engine;

namespace {

constexpr uint32_t kWidth = 1280;
constexpr uint32_t kHeight = 720;
constexpr double kTickStep = 1.0 / 60;

struct Window {
    SDL_Window* handle = nullptr;
    uint32_t width = kWidth;
    uint32_t height = kHeight;
};

/** The legacy host's window, minus its web-view and UI branches: an SDL window and its X11 handles. */
bool openWindow(Window& window) {
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) {
        std::printf("[Playtest] SDL_Init failed: %s\n", SDL_GetError());
        return false;
    }
    // Dawn's Xlib surface needs the X11 backend, as src/platform/window.cpp forces on Linux.
    SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "x11");
    window.handle = SDL_CreateWindow("ThreeNative native engine", static_cast<int>(kWidth),
                                     static_cast<int>(kHeight), SDL_WINDOW_RESIZABLE | SDL_WINDOW_VULKAN);
    if (!window.handle) {
        std::printf("[Playtest] SDL_CreateWindow failed: %s\n", SDL_GetError());
        return false;
    }
    int width = 0, height = 0;
    SDL_GetWindowSize(window.handle, &width, &height);
    if (width <= 0 || height <= 0)
        return false;
    window.width = static_cast<uint32_t>(width);
    window.height = static_cast<uint32_t>(height);
    return true;
}

/** The Dawn surface for this window, as src/runtime.cpp builds it on Linux. */
bool surfaceForWindow(mystral::webgpu::Context& context, Window& window) {
    SDL_PropertiesID properties = SDL_GetWindowProperties(window.handle);
    void* display = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_X11_DISPLAY_POINTER, nullptr);
    const auto id = SDL_GetNumberProperty(properties, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0);
    if (!display || id == 0) {
        std::printf("[Playtest] The window carries no X11 handle, so there is no surface to present into.\n");
        return false;
    }
    return context.createSurfaceWithDisplay(display, reinterpret_cast<void*>(static_cast<std::uintptr_t>(id)),
                                           mystral::webgpu::Context::PLATFORM_XLIB);
}

/** Quits on a close request; the runner ends a run with SIGTERM, not with a window message. */
bool pumpEvents(Window& window) {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        if (event.type == SDL_EVENT_QUIT || event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED)
            return false;
        if (event.type != SDL_EVENT_WINDOW_RESIZED && event.type != SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED)
            continue;
        int width = 0, height = 0;
        SDL_GetWindowSize(window.handle, &width, &height);
        if (width > 0 && height > 0) {
            window.width = static_cast<uint32_t>(width);
            window.height = static_cast<uint32_t>(height);
        }
    }
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    // The one argument the player takes is the game name; inspect-demo is the only built-in game.
    const std::string game = argc > 1 && argv[1][0] != '\0' ? argv[1] : "inspect-demo";
    if (game != "inspect-demo") {
        std::printf("TN_PLAYER_UNKNOWN_GAME: %s; this player builds inspect-demo.\n", game.c_str());
        return 1;
    }

    Window window;
    const bool windowed = openWindow(window);
    std::unique_ptr<mystral::webgpu::Context> context;
    std::unique_ptr<Presenter> presenter;
    auto candidate = std::make_unique<mystral::webgpu::Context>();
    if (windowed && candidate->initialize() && surfaceForWindow(*candidate, window) &&
        candidate->configureSurface(window.width, window.height, true)) {
        context = std::move(candidate);
        presenter = std::make_unique<Presenter>(*context);
    } else {
        // The window is the product path. Without a display or a surface the game still runs, so a
        // scenario can inspect and advance it; only the presented frame is missing.
        std::printf("[Playtest] No presentable surface; running headless.\n");
        context = std::make_unique<mystral::webgpu::Context>();
        if (!context->initializeHeadless())
            return 2;
    }

    EventQueue events;
    Renderer renderer(context->getInstance(), context->getDevice(), context->getQueue(), events);
    const uint32_t width = presenter ? presenter->width() : kWidth;
    const uint32_t height = presenter ? presenter->height() : kHeight;
    renderer.setSize(width, height);
    renderer.setOutput(OutputState{shader::ToneMapping::ACESFilmic, 1, true});

    player::InspectDemo demo(game);
    world::FixedStepClock clock(kTickStep, 5);
    clock.start(0);
    double nowMs = 0;
    inspect::Host host;
    host.scene = &demo.scene();
    host.tick = [&clock] { return clock.tick(); };
    host.step = [&clock, &demo, &nowMs] {
        // One fixed update per driven tick, so the reported clock is the engine's own.
        nowMs += 1000.0 * kTickStep;
        clock.advance(nowMs);
        demo.update(kTickStep);
    };
    // What the scenario schema can read: the profile describe reports, the state snapshot a
    // scenario compares across labelled steps, and the input latch the per-tick callback fills.
    host.resource = [&demo, &clock](const std::string& id) -> json::Value {
        if (id == "profile")
            return json::Value::makeObject({{"engine", json::Value::makeString("native")},
                                            {"gameRuntime", json::Value::makeString("cpp")}});
        if (id == "state") {
            const Vector3 at = demo.scene().getObjectByName("player")->position;
            return json::Value::makeObject(
                {{"playerX", json::Value::makeNumber(at.x)},
                 {"playerY", json::Value::makeNumber(at.y)},
                 {"playerZ", json::Value::makeNumber(at.z)},
                 {"tick", json::Value::makeNumber(double(clock.tick()))}});
        }
        if (id == "input") {
            const player::InspectDemo::InputLatch& latch = demo.inputLatch();
            return json::Value::makeObject({{"key", json::Value::makeString(latch.key)},
                                            {"latched", json::Value::makeBool(latch.latched)},
                                            {"injectedTick", json::Value::makeNumber(double(latch.injectedTick))},
                                            {"seenTick", json::Value::makeNumber(double(latch.seenTick))}});
        }
        return json::Value::makeNull();
    };
    inspect::Endpoint endpoint(host);
    demo.attachEndpoint(endpoint);

    player::Mailbox mailbox(player::Mailbox::rootFromEnvironment());
    const bool runner = mailbox.announceReady();
    std::printf("[Playtest] threenative-native-engine ready: game %s, %ux%u, mailbox %s\n", demo.name().c_str(),
                renderer.width(), renderer.height(), runner ? "on" : "off");

    RenderDatabase database;
    bool readbackInFlight = false;
    while (pumpEvents(window)) {
        // One request frame in, one response frame out: advance, sample, describe and the input
        // methods are all answered here, so the runner's call lands inside the tick it asked for.
        mailbox.poll(endpoint);

        if (presenter && (presenter->width() != window.width || presenter->height() != window.height)) {
            presenter->resize(window.width, window.height);
            renderer.setSize(presenter->width(), presenter->height());
        }
        database.render(renderer, demo.scene(), demo.camera(), {0.05, 0.06, 0.09, 1});
        for (const std::string& diagnostic : database.diagnostics())
            std::printf("[Playtest] %s\n", diagnostic.c_str());
        if (presenter) {
            Presenter::Frame target;
            if (presenter->begin(target)) {
                // The window carries the very frame the render database just built.
                renderer.blitTo(context->getQueue(), target.color,
                                static_cast<WGPUTextureFormat>(context->getPreferredFormat()));
                presenter->present();
            }
        }

        // A screenshot answer is a real frame of this loop, so it is read back from the renderer the
        // moment the mailbox asks for one. The readback lands a few frames later.
        if (mailbox.screenshotRequested() && !readbackInFlight) {
            readbackInFlight = renderer.readPixels([&](GpuStatus status, std::vector<uint8_t> pixels) {
                readbackInFlight = false;
                if (status == GpuStatus::Ok) {
                    mailbox.answerScreenshot(pixels, renderer.width(), renderer.height());
                }
            }) == GpuStatus::Ok;
        }
        // Bounded by iteration count, never by a wait: a readback completes on a later drain of
        // the event queue (GpuResources::readTexture), and the swapchain's present paces the loop.
        for (int i = 0; i < 100000 && (readbackInFlight || events.pending()); ++i) {
            renderer.poll();
            events.drain();
            if (!readbackInFlight && events.pending() == 0)
                break;
        }
    }

    if (window.handle)
        SDL_DestroyWindow(window.handle);
    SDL_QuitSubSystem(SDL_INIT_VIDEO);
    return 0;
}