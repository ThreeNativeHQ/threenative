// The native-engine desktop player loop (PRD-529 phase 2, PRD-531 phase 3): an SDL window on the
// display the playtest runner provides, the engine's fixed-step clock, the render database into the
// renderer, the presentation of that frame, and the mailbox the runner talks to. It names no game:
// the C++ demo and a V8 game bundle both arrive as a `player::Game`.
#include "engine/player/run.h"

#include <SDL3/SDL.h>
#if defined(__ANDROID__)
#include <android/native_window.h>
#include <android/log.h>
#endif

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "engine/inspect/endpoint.h"
#include "engine/player/mailbox.h"
#include "engine/renderer/presentation.h"
#include "engine/renderer/render_database.h"
#include "engine/world/loop/fixed_step.h"
#include "mystral/platform/ui_overlay.h"
#include "mystral/webgpu/context.h"
#include "mystral/webgpu/presentation.h"

using namespace tn::engine;

namespace tn::engine::player {

namespace {

constexpr uint32_t kWidth = 1280;
constexpr uint32_t kHeight = 720;
constexpr double kTickStep = 1.0 / 60;
#if defined(__ANDROID__)
// The legacy Android host uses Immediate/Mailbox at 60 Hz and the software/display pacing cap.
constexpr bool kSurfaceVsync = false;
#else
constexpr bool kSurfaceVsync = true;
#endif

void startupStage(const char* stage) {
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_INFO, "TN_Player", "TN_PLAYER_STAGE: %s", stage);
#else
    (void)stage;
#endif
}

struct Window {
    SDL_Window* handle = nullptr;
#if defined(__APPLE__)
    SDL_MetalView metalView = nullptr;
#endif
#if defined(__ANDROID__)
    mystral::webgpu::Context* context = nullptr;
    std::unique_ptr<Presenter>* presenter = nullptr;
    bool resumeSurface = false;
#endif
    uint32_t width = kWidth;
    uint32_t height = kHeight;
};

/** The legacy host's platform presentation flags, without web-view or UI branches. */
bool openWindow(Window& window) {
#if defined(__ANDROID__)
    SDL_SetHint(SDL_HINT_ANDROID_BLOCK_ON_PAUSE, "1");
#endif
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) {
        std::printf("[Playtest] SDL_Init failed: %s\n", SDL_GetError());
        return false;
    }
#if defined(__linux__) && !defined(__ANDROID__)
    // Dawn's Xlib surface needs the X11 backend, as src/platform/window.cpp forces on Linux.
    SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "x11");
#endif
    SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE;
#if defined(__APPLE__)
    flags |= SDL_WINDOW_METAL;
#elif !defined(_WIN32)
    flags |= SDL_WINDOW_VULKAN;
#endif
    window.handle = SDL_CreateWindow("ThreeNative native engine", static_cast<int>(kWidth),
                                     static_cast<int>(kHeight), flags);
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

/** SDL exposes the native handles needed by the host's existing Dawn surface API. */
bool surfaceForWindow(mystral::webgpu::Context& context, Window& window) {
#if defined(__ANDROID__)
    void* native = SDL_GetPointerProperty(SDL_GetWindowProperties(window.handle),
                                         SDL_PROP_WINDOW_ANDROID_WINDOW_POINTER, nullptr);
    return native && context.createSurface(native, mystral::webgpu::Context::PLATFORM_ANDROID);
#elif defined(__APPLE__)
    window.metalView = SDL_Metal_CreateView(window.handle);
    void* layer = window.metalView ? SDL_Metal_GetLayer(window.metalView) : nullptr;
    return layer && context.createSurface(layer, mystral::webgpu::Context::PLATFORM_METAL);
#elif defined(_WIN32)
    void* hwnd = SDL_GetPointerProperty(SDL_GetWindowProperties(window.handle),
                                       SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr);
    return hwnd && context.createSurface(hwnd, mystral::webgpu::Context::PLATFORM_WINDOWS);
#else
    SDL_PropertiesID properties = SDL_GetWindowProperties(window.handle);
    void* display = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_X11_DISPLAY_POINTER, nullptr);
    const auto id = SDL_GetNumberProperty(properties, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0);
    if (!display || id == 0) {
        std::printf("[Playtest] The window carries no X11 handle, so there is no surface to present into.\n");
        return false;
    }
    return context.createSurfaceWithDisplay(display, reinterpret_cast<void*>(static_cast<std::uintptr_t>(id)),
                                           mystral::webgpu::Context::PLATFORM_XLIB);
#endif
}

#if defined(__ANDROID__)
// SDL's Android pump queues this event on the game thread before blocking on pause. A polled
// handler runs too late: the Java SurfaceView may already have destroyed its ANativeWindow.
bool SDLCALL lifecycleWatch(void* data, SDL_Event* event) {
    auto& window = *static_cast<Window*>(data);
    if (event->type == SDL_EVENT_WILL_ENTER_BACKGROUND) {
        window.presenter->reset();
        window.context->releaseSurface();
        window.resumeSurface = true;
        startupStage("surface-released"); // acknowledgement before SDL parks the game thread
    }
    return true;
}
#endif

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

int run(const Game& game) {
    if (!game.view && (game.scene == nullptr || game.camera == nullptr)) {
        std::printf("TN_PLAYER_NO_SCENE: %s carries no scene or camera.\n", game.name.c_str());
        return 1;
    }

    Window window;
    startupStage("sdl-window-begin");
    const bool windowed = openWindow(window);
    startupStage(windowed ? "sdl-window-ready" : "sdl-window-failed");
    if (!game.uiRoot.empty()) {
        // The same overlay the legacy host attaches, over this window; a game that asked for a UI
        // and cannot show it stops by name rather than playing behind an empty rectangle.
        mystral::platform::setUiOverlayWindow(windowed ? window.handle : nullptr);
        const bool attached = game.cssUi ? mystral::platform::attachDesktopCssUi(game.uiRoot)
                                         : mystral::platform::attachDesktopUiOverlay(game.uiRoot);
        if (!attached) {
            std::printf("TN_UI_LOAD_FAILED: the %s UI in %s could not attach\n", game.cssUi ? "native-css" : "web",
                        game.uiRoot.c_str());
            return 1;
        }
    }
    std::unique_ptr<mystral::webgpu::Context> context;
    std::unique_ptr<Presenter> presenter;
    auto candidate = std::make_unique<mystral::webgpu::Context>();
    startupStage("webgpu-surface-begin");
    if (windowed && candidate->initialize() && surfaceForWindow(*candidate, window) &&
        candidate->configureSurface(window.width, window.height, kSurfaceVsync)) {
        context = std::move(candidate);
        presenter = std::make_unique<Presenter>(*context);
    } else {
        // The window is the product path. Without a display or a surface the game still runs, so a
        // scenario can inspect and advance it; only the presented frame is missing.
#if defined(__ANDROID__)
        std::printf("TN_PLAYER_ANDROID_SURFACE_FAILED\n");
        return 2; // a device run must never silently become headless
#endif
        std::printf("[Playtest] No presentable surface; running headless.\n");
        context = std::make_unique<mystral::webgpu::Context>();
        if (!context->initializeHeadless())
            return 2;
    }
    startupStage("webgpu-surface-ready");

#if defined(__ANDROID__)
    mystral::webgpu::notePresentationFramesStopped();
    mystral::webgpu::setPresentationCapHz(60);
    window.context = context.get();
    window.presenter = &presenter;
    if (!SDL_AddEventWatch(lifecycleWatch, &window)) {
        std::fprintf(stderr, "TN_PLAYER_ANDROID_EVENT_WATCH_FAILED: %s\n", SDL_GetError());
        return 2;
    }
    struct WatchGuard {
        Window& window;
        ~WatchGuard() { SDL_RemoveEventWatch(lifecycleWatch, &window); }
    } watchGuard{window};
#endif
    EventQueue events;
    startupStage("renderer-begin");
    Renderer renderer(context->getInstance(), context->getDevice(), context->getQueue(), events);
    const uint32_t width = presenter ? presenter->width() : kWidth;
    const uint32_t height = presenter ? presenter->height() : kHeight;
    renderer.setSize(width, height);
    renderer.setOutput(OutputState{shader::ToneMapping::ACESFilmic, 1, true});
    startupStage("renderer-ready");
    struct Shutdown {
        const Game& game;
        ~Shutdown() { if (game.shutdown) game.shutdown(); }
    } shutdown{game}; // also releases game resources if an update or admission throws
    startupStage("game-initialize-begin");
    if (game.initialize)
        game.initialize(renderer);
    startupStage("game-initialize-ready");

    world::FixedStepClock clock(kTickStep, 5);
    clock.start(0);
    double nowMs = 0;
    inspect::Host host;
    std::function<void()> renderFrame;
    host.scene = game.scene;
    host.gameRuntime = game.gameRuntime;
    host.observe = game.observe;
    host.tick = [&clock] { return clock.tick(); };
    host.step = [&clock, &game, &nowMs, &renderFrame] {
        // One fixed update per driven tick, so the reported clock is the engine's own.
        nowMs += 1000.0 * kTickStep;
        clock.advance(nowMs);
        if (game.update)
            game.update(kTickStep);
        if (game.renderEachTick && renderFrame)
            renderFrame();
    };
    // What the scenario schema can read: the profile describe reports, a state snapshot a scenario
    // compares across labelled steps, and whatever else the game registers.
    host.resource = [&game, &clock, &renderer, &context](const std::string& id) -> json::Value {
        if (id == "surface")
            return json::Value::makeObject({
                {"deviceCreations", json::Value::makeNumber(context->deviceCreations())},
                {"surfaceCreations", json::Value::makeNumber(context->surfaceCreations())}});
        if (id == "profile")
            return json::Value::makeObject({{"engine", json::Value::makeString("native")},
                                            {"gameRuntime", json::Value::makeString(game.gameRuntime)}});
        if (id == "render") {
            const auto pass = [](const Renderer::FrameStats::SkinnedPass& stats) {
                return json::Value::makeObject({{"skinnedBatches", json::Value::makeNumber(stats.batches)},
                                                {"skinnedDraws", json::Value::makeNumber(stats.draws)},
                                                {"skinnedExactDraws", json::Value::makeNumber(stats.exactDraws)},
                                                {"skinnedInstances", json::Value::makeNumber(stats.instances)}});
            };
            const auto& stats = renderer.lastFrame();
            return json::Value::makeObject({{"main", pass(stats.mainSkinned)}, {"shadow", pass(stats.shadowSkinned)}});
        }
        return game.resource ? game.resource(id, clock.tick()) : json::Value::makeNull();
    };
    inspect::Endpoint endpoint(host);
    if (game.attach)
        game.attach(endpoint);
    Object3D* scene = game.scene;
    Camera* camera = game.camera;
    const auto refreshView = [&] {
        if (!game.view) return true;
        std::string error;
        if (game.view(scene, camera, error) < 0)
            return std::printf("TN_PLAYER_VIEW: %s\n", error.c_str()), false;
        endpoint.setScene(scene);
        return true;
    };

    player::Mailbox mailbox(player::Mailbox::rootFromEnvironment());
    const bool runner = mailbox.announceReady();
    startupStage(runner ? "mailbox-ready" : "mailbox-off");
    std::printf("[Playtest] threenative-native-engine ready: game %s, runtime %s, %ux%u, mailbox %s\n",
                game.name.c_str(), game.gameRuntime.c_str(), renderer.width(), renderer.height(),
                runner ? "on" : "off");

    const auto freeRunStart = std::chrono::steady_clock::now();
    RenderDatabase database;
    database.shadowMapEnabled = game.shadowMapEnabled;
    bool readbackInFlight = false;
    bool firstFrame = true;
    renderFrame = [&] {
        if (firstFrame) startupStage("first-render-begin");
        if (game.afterRender)  // after the previous frame; between frames, never inside one
            game.afterRender();

        if (presenter && (presenter->width() != window.width || presenter->height() != window.height)) {
            presenter->resize(window.width, window.height);
            renderer.setSize(presenter->width(), presenter->height());
        }
        // Nothing is drawn until the game publishes its view, as a page's canvas stays blank while it loads.
        if (scene == nullptr || camera == nullptr) {
            if (game.frameWithoutView) game.frameWithoutView();
            renderer.poll();
            events.drain();
            return;
        }
        if (game.beforeRender) game.beforeRender(renderer, database);
        database.render(renderer, *scene, *camera, game.clear ? game.clear() : std::array<double, 4>{0.05, 0.06, 0.09, 1});
        for (const std::string& diagnostic : database.diagnostics())
            std::printf("[Playtest] %s\n", diagnostic.c_str());
        for (const std::string& diagnostic : renderer.diagnostics())
            std::printf("[Playtest] %s\n", diagnostic.c_str());
        if (presenter) {
            Presenter::Frame target;
            if (firstFrame) startupStage("first-acquire-begin");
            if (presenter->begin(target)) {
                // The window carries the very frame the render database just built.
                renderer.blitTo(context->getQueue(), target.color,
                                static_cast<WGPUTextureFormat>(context->getPreferredFormat()));
                presenter->present();
#if defined(__ANDROID__)
                mystral::webgpu::paceToPresentationCap();
#endif
                if (firstFrame) startupStage("first-present-ready");
                firstFrame = false;
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
        // Retirement callbacks also need a poll when no readback/event was queued at frame start.
        renderer.poll();
        events.drain();
        if (game.frameComplete)
            game.frameComplete(renderer, database.diagnostics());
    };
    while (pumpEvents(window)) {
#if defined(__ANDROID__)
        if (window.resumeSurface) {
            auto* native = static_cast<ANativeWindow*>(SDL_GetPointerProperty(
                SDL_GetWindowProperties(window.handle), SDL_PROP_WINDOW_ANDROID_WINDOW_POINTER, nullptr));
            if (!native || ANativeWindow_getWidth(native) <= 0 || ANativeWindow_getHeight(native) <= 0 ||
                !context->rebuildSurface(native, mystral::webgpu::Context::PLATFORM_ANDROID) ||
                !context->configureSurface(ANativeWindow_getWidth(native), ANativeWindow_getHeight(native), kSurfaceVsync)) {
                std::printf("TN_PLAYER_ANDROID_SURFACE_RECREATE_FAILED\n");
                return 2;
            }
            window.width = context->getSurfaceWidth();
            window.height = context->getSurfaceHeight();
            presenter = std::make_unique<Presenter>(*context);
            renderer.setSize(window.width, window.height);
            window.resumeSurface = false;
        }
#endif
        if (game.uiFrame) game.uiFrame();
        // An advance may render several streaming frames; each tick gets its own admission cap.
        mailbox.poll(endpoint);
        // Without a runner nothing drives host.step, and the game would re-render one frozen tick:
        // the clock follows real time instead, as the web loop follows requestAnimationFrame.
        if (!runner) {
            nowMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - freeRunStart).count();
            for (uint32_t steps = clock.advance(nowMs); steps > 0 && game.update; --steps)
                game.update(kTickStep);
        }
        if (!refreshView())
            return 1;
        renderFrame();
    }
#if defined(__APPLE__)
    if (window.metalView)
        SDL_Metal_DestroyView(window.metalView);
#endif
#if defined(__ANDROID__)
    SDL_RemoveEventWatch(lifecycleWatch, &window);
    presenter.reset();
    context->releaseSurface();
#endif
    if (!game.uiRoot.empty()) {
        mystral::platform::detachDesktopUiOverlay();
        mystral::platform::setUiOverlayWindow(nullptr);
    }
    if (window.handle)
        SDL_DestroyWindow(window.handle);
    SDL_QuitSubSystem(SDL_INIT_VIDEO);
    return 0;
}

}  // namespace tn::engine::player
