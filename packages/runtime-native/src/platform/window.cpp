/**
 * Window Management (SDL3)
 *
 * Handles window creation, event loop, and provides native handles
 * for WebGPU surface creation.
 */

#include "mystral/platform/input.h"
#include "mystral/platform/ui_overlay.h"
#include "mystral/vfs/embedded_bundle.h"
#include <iostream>

#if defined(__linux__) && !defined(__ANDROID__)
#include <X11/Xlib.h>
#endif
#include <cstdlib>
#include <vector>
#include <SDL3/SDL.h>
#include "stb_image.h"

namespace mystral {
namespace platform {

// Forward declarations for input processing (implemented in input.cpp)
void processKeyboardEvent(const SDL_KeyboardEvent& event, bool isDown);
void processMouseMotion(const SDL_MouseMotionEvent& event);
void processMouseButton(const SDL_MouseButtonEvent& event, bool isDown);
void processMouseWheel(const SDL_MouseWheelEvent& event);
void processTouchEvent(const SDL_TouchFingerEvent& event);
void processGamepadConnected(SDL_JoystickID id);
void processGamepadDisconnected(SDL_JoystickID id);
void processResize(int width, int height);

/**
 * Window state
 */
struct Window {
    SDL_Window* sdlWindow = nullptr;
#if defined(__APPLE__)
    SDL_MetalView metalView = nullptr;
#endif
    int width = 800;
    int height = 600;
    bool fullscreen = false;
    bool shouldQuit = false;
};

static Window g_window;

static void applyEmbeddedWindowIcon() {
    const char* configured = std::getenv("THREENATIVE_WINDOW_ICON_BUNDLE");
    const std::string path = configured && configured[0] != '\0'
        ? configured
        : ".threenative/app-icon.png";
    std::vector<uint8_t> bytes;
    if (!vfs::readEmbeddedFile(path, bytes)) {
        // Informational degradation, not an error: an unbranded game is legitimate. It goes to
        // stdout because the playtest runner classifies every stderr line as a console error and
        // fails the run; a missing icon must not fail anyone's gate.
        std::cout << "[Window] Brand icon unavailable in embedded bundle; using compositor default" << std::endl;
        return;
    }
    int width = 0;
    int height = 0;
    int channels = 0;
    unsigned char* pixels = stbi_load_from_memory(bytes.data(), static_cast<int>(bytes.size()), &width, &height, &channels, 4);
    if (pixels == nullptr || width <= 0 || height <= 0) {
        std::cerr << "[Window] Brand icon could not be decoded; using compositor default" << std::endl;
        if (pixels != nullptr) stbi_image_free(pixels);
        return;
    }
    SDL_Surface* surface = SDL_CreateSurfaceFrom(width, height, SDL_PIXELFORMAT_RGBA32, pixels, width * 4);
    if (surface == nullptr || !SDL_SetWindowIcon(g_window.sdlWindow, surface)) {
        std::cerr << "[Window] SDL_SetWindowIcon failed: " << SDL_GetError() << std::endl;
    } else {
        std::cout << "[Window] Brand icon applied from " << path << std::endl;
    }
    if (surface != nullptr) SDL_DestroySurface(surface);
    stbi_image_free(pixels);
}


/**
 * Paint the window the game's own `bootSplash.backgroundColor` before the first frame exists.
 *
 * A freshly created X window has no background, so the server shows whatever was behind it — in
 * practice a flat grey — for every second between the window appearing and the GPU's first
 * present. On this game that gap is about four seconds, and it read as a "grey screen before
 * everything loads" that no loading screen could cover, because the UI overlay cannot paint that
 * early either.
 *
 * `bootSplash` was already resolved, validated and embedded in the config; only web, Android and
 * iOS ever read it, so the desktop window was the one target that ignored the colour the game had
 * already chosen. X11 only: Windows and macOS have their own launch-image paths and are NOT
 * covered here — do not claim them.
 */
static void applyEmbeddedBootSplash() {
#if defined(__linux__) && !defined(__ANDROID__)
    std::vector<uint8_t> bytes;
    if (!vfs::readEmbeddedFile(".threenative/config.json", bytes)) return;
    const std::string config(bytes.begin(), bytes.end());
    // Anchored, not flattened. `uiRenderer` is flattened because `renderer` already exists at the
    // top level and a flat scan would find the wrong one; `backgroundColor` has no such twin, and
    // the two packaging paths — `threenative build` and the release packager — do not both flatten,
    // so a flattened key was present in one artifact and absent in the other. Find `bootSplash`
    // first and read the colour after it: correct on both, and still no JSON parser.
    const auto section = config.find("\"bootSplash\"");
    if (section == std::string::npos) return;
    const auto at = config.find("\"backgroundColor\"", section);
    if (at == std::string::npos) return;
    const auto open = config.find('"', config.find(':', at));
    if (open == std::string::npos) return;
    const auto close = config.find('"', open + 1);
    if (close == std::string::npos) return;
    const std::string color = config.substr(open + 1, close - open - 1);
    // `#rrggbb`, which is the only form the packager's brand-colour validator accepts.
    if (color.size() != 7 || color[0] != '#') return;
    unsigned long rgb = 0;
    for (size_t i = 1; i < color.size(); ++i) {
        const char c = color[i];
        const int digit = c >= '0' && c <= '9' ? c - '0'
            : c >= 'a' && c <= 'f' ? c - 'a' + 10
            : c >= 'A' && c <= 'F' ? c - 'A' + 10
            : -1;
        if (digit < 0) return;
        rgb = (rgb << 4) | static_cast<unsigned long>(digit);
    }
    auto* display = static_cast<Display*>(SDL_GetPointerProperty(
        SDL_GetWindowProperties(g_window.sdlWindow), SDL_PROP_WINDOW_X11_DISPLAY_POINTER, nullptr));
    const auto window = static_cast<::Window>(SDL_GetNumberProperty(
        SDL_GetWindowProperties(g_window.sdlWindow), SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0));
    if (display == nullptr || window == 0) return;
    // Truecolor 24/32-bit visuals take a packed pixel directly, which is every visual SDL picks
    // for a Vulkan window here; a colormap allocation would be the general answer and is not
    // needed for one background.
    XSetWindowBackground(display, window, rgb);
    XClearWindow(display, window);
    XFlush(display);
    std::cout << "[Window] Boot splash background applied: " << color << std::endl;
#endif
}

/**
 * Initialize SDL and create window
 */
bool createWindow(
    const char* title,
    int width,
    int height,
    bool fullscreen,
    bool resizable,
    bool maximized
) {
    std::cout << "[Window] Creating window: " << title << " (" << width << "x" << height << ")" << std::endl;

#if defined(__linux__) && !defined(__ANDROID__)
    // The Linux WebGPU surface currently consumes SDL's X11 handles. Prefer that supported
    // backend even in a Wayland session; an explicit SDL_VIDEODRIVER remains an override.
    SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "x11");
#endif
    // Initialize SDL
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS | SDL_INIT_GAMEPAD)) {
        std::cerr << "[Window] SDL_Init failed: " << SDL_GetError() << std::endl;
        return false;
    }
    std::cout << "[Window] SDL initialized" << std::endl;

    // Create window with appropriate flags
    SDL_WindowFlags flags = 0;
    if (resizable) flags |= SDL_WINDOW_RESIZABLE;
    if (fullscreen) flags |= SDL_WINDOW_FULLSCREEN;
    if (maximized && !fullscreen) flags |= SDL_WINDOW_MAXIMIZED;

    // Check for headless/background mode via environment variable
    const char* headless = std::getenv("MYSTRAL_HEADLESS");
    bool isHeadless = headless && (headless[0] == '1' || headless[0] == 't' || headless[0] == 'T');
    if (isHeadless) {
        flags |= SDL_WINDOW_HIDDEN;
        std::cout << "[Window] Running in hidden mode (MYSTRAL_HEADLESS=1)" << std::endl;
    }

    // Platform-specific presentation flags. Win32 WebGPU uses the HWND directly, so
    // requiring SDL's Vulkan surface support would reject D3D12-only hosts.
#if defined(__APPLE__)
    flags |= SDL_WINDOW_METAL;
#elif !defined(_WIN32)
    flags |= SDL_WINDOW_VULKAN;
#endif

    g_window.sdlWindow = SDL_CreateWindow(title, width, height, flags);

    if (!g_window.sdlWindow) {
        std::cerr << "[Window] SDL_CreateWindow failed: " << SDL_GetError() << std::endl;
        return false;
    }

    // Get actual window size (may differ from requested, especially on mobile)
    int actualWidth, actualHeight;
    SDL_GetWindowSize(g_window.sdlWindow, &actualWidth, &actualHeight);

    // If requested 0 or actual differs, use actual size
    g_window.width = (actualWidth > 0) ? actualWidth : width;
    g_window.height = (actualHeight > 0) ? actualHeight : height;
    g_window.fullscreen = fullscreen;
    g_window.shouldQuit = false;

    applyEmbeddedWindowIcon();
    applyEmbeddedBootSplash();

    std::cout << "[Window] Actual window size: " << g_window.width << "x" << g_window.height << std::endl;

    // On macOS, create Metal view for WebGPU
#if defined(__APPLE__)
    g_window.metalView = SDL_Metal_CreateView(g_window.sdlWindow);
    if (!g_window.metalView) {
        std::cerr << "[Window] SDL_Metal_CreateView failed: " << SDL_GetError() << std::endl;
    } else {
        std::cout << "[Window] Metal view created" << std::endl;
    }
#endif

    std::cout << "[Window] Window created successfully" << std::endl;
    return true;
}

/**
 * Destroy window and cleanup SDL
 */
void destroyWindow() {
    std::cout << "[Window] Destroying window..." << std::endl;

#if defined(__APPLE__)
    if (g_window.metalView) {
        SDL_Metal_DestroyView(g_window.metalView);
        g_window.metalView = nullptr;
    }
#endif

    if (g_window.sdlWindow) {
        SDL_DestroyWindow(g_window.sdlWindow);
        g_window.sdlWindow = nullptr;
    }

    // Note: We skip SDL_Quit() because it hangs on macOS trying to close
    // the audio subsystem (CoreAudio callback interaction issue).
    // Instead, quit individual subsystems except audio.
    // The OS will clean up resources on process exit.
    SDL_QuitSubSystem(SDL_INIT_VIDEO);
    std::cout << "[Window] SDL video shutdown complete" << std::endl;
}

/** SDL's button index as the DOM's `buttons` bit. Returns 0 for a button the DOM does not name. */
int domButtonBit(Uint8 sdlButton) {
    switch (sdlButton) {
        case SDL_BUTTON_LEFT: return 1;
        case SDL_BUTTON_RIGHT: return 2;
        case SDL_BUTTON_MIDDLE: return 4;
        default: return 0;
    }
}

/** The DOM `buttons` bitmask across a gesture, which is not SDL's: DOM is 1=left, 2=right, 4=middle. */
int g_domButtons = 0;

/** A normalized viewport point from SDL's window-relative one, or false when it cannot be one. */
bool uiViewportPoint(float x, float y, float& nx, float& ny) {
    int width = 0;
    int height = 0;
    if (g_window.sdlWindow == nullptr) return false;
    SDL_GetWindowSize(g_window.sdlWindow, &width, &height);
    if (width <= 0 || height <= 0) return false;
    nx = x / static_cast<float>(width);
    ny = y / static_cast<float>(height);
    return nx >= 0.0f && ny >= 0.0f && nx <= 1.0f && ny <= 1.0f;
}

/**
 * Offer one real OS pointer event to the page.
 *
 * A thin wrapper: which side owns the gesture and where it last was is decided in
 * `platform::uiOverlayRoutePointer`, so a real press and a synthetic playtest press cannot be
 * routed by different rules. All this adds is the SDL-to-DOM button mask, which is not the same
 * numbering (SDL is left/middle/right, the DOM is 1/2/4).
 */
bool routePointerToUi(const SDL_Event& event) {
    float x = 0.0f;
    float y = 0.0f;
    if (event.type == SDL_EVENT_MOUSE_MOTION) {
        x = event.motion.x;
        y = event.motion.y;
    } else {
        x = event.button.x;
        y = event.button.y;
    }
    float nx = 0.0f;
    float ny = 0.0f;
    if (!uiViewportPoint(x, y, nx, ny)) return false;
    const char* type = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN ? "pointerdown"
        : event.type == SDL_EVENT_MOUSE_BUTTON_UP               ? "pointerup"
                                                                : "pointermove";
    return uiOverlayRoutePointer(type, nx, ny, g_domButtons, 1);
}

/**
 * Tell the offscreen UI how many pixels the game window has now.
 *
 * The web view has no window to follow, so this is the only thing that re-lays it out: the page's
 * viewport is what its CSS sees, and the composite draws the frame it produces across the whole
 * swapchain. Skip it and the HUD is a stretched copy of the layout it was attached at.
 *
 * Pixels, not logical points: the page is sized in device pixels, which is what the swapchain is
 * measured in too, so the two agree at any scale factor.
 */
void uiOverlayResizeToWindow() {
    if (g_window.sdlWindow == nullptr) return;
    int width = 0;
    int height = 0;
    SDL_GetWindowSizeInPixels(g_window.sdlWindow, &width, &height);
    if (width <= 0 || height <= 0) return;
    uiOverlaySetSize(width, height);
}

/**
 * The DOM's names for the keys the platform's own naming does not already match.
 *
 * SDL names a key the way a keyboard does ("Left", "Escape", "Return"); the DOM names the same
 * keys "ArrowLeft", "Escape", "Enter". Only the differences are listed — a table of every key
 * would be a second keyboard layout to keep in step, and anything absent falls through to SDL's
 * own name, which is already the DOM's for letters, digits and punctuation.
 */
const char* domKeyName(SDL_Keycode key) {
    switch (key) {
        case SDLK_LEFT: return "ArrowLeft";
        case SDLK_RIGHT: return "ArrowRight";
        case SDLK_UP: return "ArrowUp";
        case SDLK_DOWN: return "ArrowDown";
        case SDLK_RETURN: return "Enter";
        case SDLK_KP_ENTER: return "Enter";
        case SDLK_ESCAPE: return "Escape";
        case SDLK_BACKSPACE: return "Backspace";
        case SDLK_DELETE: return "Delete";
        case SDLK_TAB: return "Tab";
        case SDLK_HOME: return "Home";
        case SDLK_END: return "End";
        case SDLK_PAGEUP: return "PageUp";
        case SDLK_PAGEDOWN: return "PageDown";
        case SDLK_SPACE: return " ";
        default: return nullptr;
    }
}

/**
 * Offer one key to the page, but only while the page owns the keyboard.
 *
 * Everything else is the game's, which is what makes a HUD usable at all: `W` is throttle and
 * `KeyQ` is the command overlay, and a rectangle under the pointer cannot decide that. The page
 * says whether it holds the keyboard — a focused input, textarea, select or open list — and that
 * answer is the whole rule.
 *
 * `text` is the character the key would insert, and is empty for anything that types nothing; the
 * page inserts it itself, because a synthesised `keydown` never inserts one.
 */
bool routeKeyToUi(const SDL_KeyboardEvent& event, bool isDown) {
    if (!uiOverlayKeyboardCaptured()) return false;
    const char* named = domKeyName(event.key);
    const char* key = named != nullptr ? named : SDL_GetKeyName(event.key);
    const char* code = SDL_GetScancodeName(event.scancode);
    char text[8] = {};
    if (isDown && !event.repeat && event.key >= 0x20 && event.key < 0x7F) {
        text[0] = static_cast<char>(event.key);
    }
    const SDL_Keymod modifiers = SDL_GetModState();
    uiOverlayInjectKey(isDown ? "keydown" : "keyup", key, code != nullptr ? code : "", text,
                       (modifiers & SDL_KMOD_CTRL) != 0, (modifiers & SDL_KMOD_ALT) != 0,
                       (modifiers & SDL_KMOD_SHIFT) != 0, (modifiers & SDL_KMOD_GUI) != 0);
    return true;
}

/**
 * Poll SDL events
 * @return false if quit event received
 */
bool pollEvents() {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        // The UI is offered every pointer event before the game sees it, and either takes it or
        // declines. `uiOverlayAttached()` is false for a `renderer: "native"` game and on every
        // platform without an offscreen UI, which is what keeps those targets on the exact path
        // they had.
        if (uiOverlayAttached()) {
            if (event.type == SDL_EVENT_MOUSE_BUTTON_DOWN || event.type == SDL_EVENT_MOUSE_BUTTON_UP) {
                const int bit = domButtonBit(event.button.button);
                if (event.type == SDL_EVENT_MOUSE_BUTTON_DOWN)
                    g_domButtons |= bit;
                else
                    g_domButtons &= ~bit;
            }
            switch (event.type) {
                case SDL_EVENT_MOUSE_MOTION:
                case SDL_EVENT_MOUSE_BUTTON_DOWN:
                case SDL_EVENT_MOUSE_BUTTON_UP:
                    if (routePointerToUi(event)) continue;
                    break;
                case SDL_EVENT_KEY_DOWN:
                    if (routeKeyToUi(event.key, true)) continue;
                    break;
                case SDL_EVENT_KEY_UP:
                    if (routeKeyToUi(event.key, false)) continue;
                    break;
                default:
                    break;
            }
        }
        switch (event.type) {
            case SDL_EVENT_QUIT:
                std::cout << "[Window] Quit event received" << std::endl;
                g_window.shouldQuit = true;
                return false;

            case SDL_EVENT_WINDOW_RESIZED:
                g_window.width = event.window.data1;
                g_window.height = event.window.data2;
                std::cout << "[Window] Resized to " << g_window.width << "x" << g_window.height << std::endl;
                processResize(g_window.width, g_window.height);
                // The offscreen UI has no window of its own to follow, so nothing tells it the game
                // changed size unless this does. Without it the web view keeps the layout it was
                // attached at and the composite scales that onto the new swapchain, which a player
                // sees as a stretched HUD rather than a re-laid-out one.
                uiOverlayResizeToWindow();
                break;

            case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
                // A different scale factor is a different number of pixels for the same logical size,
                // and the page's viewport is measured in pixels.
                uiOverlayResizeToWindow();
                break;

            case SDL_EVENT_KEY_DOWN:
                processKeyboardEvent(event.key, true);
                break;

            case SDL_EVENT_KEY_UP:
                processKeyboardEvent(event.key, false);
                break;

            case SDL_EVENT_MOUSE_MOTION:
                processMouseMotion(event.motion);
                break;

            case SDL_EVENT_MOUSE_BUTTON_DOWN:
                processMouseButton(event.button, true);
                break;

            case SDL_EVENT_MOUSE_BUTTON_UP:
                processMouseButton(event.button, false);
                break;

            case SDL_EVENT_MOUSE_WHEEL:
                processMouseWheel(event.wheel);
                break;

            case SDL_EVENT_FINGER_DOWN:
            case SDL_EVENT_FINGER_MOTION:
            case SDL_EVENT_FINGER_UP:
            case SDL_EVENT_FINGER_CANCELED:
                processTouchEvent(event.tfinger);
                break;

            case SDL_EVENT_GAMEPAD_ADDED:
                processGamepadConnected(event.gdevice.which);
                break;

            case SDL_EVENT_GAMEPAD_REMOVED:
                processGamepadDisconnected(event.gdevice.which);
                break;
        }
    }

    return !g_window.shouldQuit;
}

/**
 * Check if window should quit
 */
bool shouldQuit() {
    return g_window.shouldQuit;
}

/**
 * Get native window handle for WebGPU surface creation
 */
SDL_Window* getSDLWindow() {
    return g_window.sdlWindow;
}

float displayPixelDensity() {
    // SDL answers this on every target this runtime ships to, Android included, so there is one
    // implementation rather than one per platform. A headless run has no display to have a
    // density of, and SDL returns 0 rather than failing, so both cases fall back to 1.0 — the
    // ratio a caller gets when nothing is known, never a guess at what it might be.
    if (g_window.sdlWindow == nullptr) return 1.0f;
    const float density = SDL_GetWindowPixelDensity(g_window.sdlWindow);
    return density > 0.0f ? density : 1.0f;
}

/**
 * Get Metal view (macOS/iOS only)
 */
void* getMetalView() {
#if defined(__APPLE__)
    return g_window.metalView;
#else
    return nullptr;
#endif
}

/**
 * Get Metal layer from view (macOS/iOS only)
 */
void* getMetalLayer() {
#if defined(__APPLE__)
    if (g_window.metalView) {
        return SDL_Metal_GetLayer(g_window.metalView);
    }
#endif
    return nullptr;
}

/**
 * Get window dimensions
 */
void getWindowSize(int* width, int* height) {
    *width = g_window.width;
    *height = g_window.height;
}

/**
 * Set fullscreen mode
 */
void setFullscreen(bool fullscreen) {
    if (g_window.sdlWindow) {
        SDL_SetWindowFullscreen(g_window.sdlWindow, fullscreen);
        g_window.fullscreen = fullscreen;
    }
}

/**
 * Record a size the platform already applied, without asking SDL to resize again.
 */
void syncWindowSize(int width, int height) {
    if (width <= 0 || height <= 0) return;
    g_window.width = width;
    g_window.height = height;
}

void setWindowSize(int width, int height) {
    // The cached size is what scales SDL's normalized touch coordinates back into canvas
    // pixels, so it has to track the canvas even when there is no SDL window to resize.
    // Android reaches this before the SDL window exists, and skipping the cache left every
    // finger scaled by the portrait display width inside a landscape surface.
    syncWindowSize(width, height);
    if (g_window.sdlWindow) {
        SDL_SetWindowSize(g_window.sdlWindow, width, height);
    }
}

/**
 * Set window title
 */
void setWindowTitle(const char* title) {
    if (g_window.sdlWindow) {
        SDL_SetWindowTitle(g_window.sdlWindow, title);
    }
}

}  // namespace platform
}  // namespace mystral
