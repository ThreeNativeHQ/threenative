/**
 * Linux Surface Creation (Vulkan - X11/Wayland)
 */

#include <iostream>

#if defined(__linux__)

namespace mystral {
namespace platform {

void* createX11Surface(void* instance, void* display, void* window) {
    std::cout << "[Surface] Creating X11 surface..." << std::endl;
    // TODO: Implement X11 Vulkan surface
    return nullptr;
}

void* createWaylandSurface(void* instance, void* display, void* surface) {
    std::cout << "[Surface] Creating Wayland surface..." << std::endl;
    // TODO: Implement Wayland Vulkan surface
    return nullptr;
}

}  // namespace platform
}  // namespace mystral

#endif  // __linux__
