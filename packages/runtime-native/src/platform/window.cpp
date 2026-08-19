/**
 * Window Management (SDL3)
 *
 * Handles window creation, event loop, and provides native handles
 * for WebGPU surface creation.
 */

#include "mystral/platform/input.h"
#include "mystral/vfs/embedded_bundle.h"
#include <iostream>
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
        std::cerr << "[Window] Brand icon unavailable in embedded bundle; using compositor default" << std::endl;
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
 * Initialize SDL and create window
 */
bool createWindow(const char* title, int width, int height, bool fullscreen, bool resizable) {
    std::cout << "[Window] Creating window: " << title << " (" << width << "x" << height << ")" << std::endl;

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

/**
 * Poll SDL events
 * @return false if quit event received
 */
bool pollEvents() {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
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
