/**
 * Windows Surface Creation (D3D12/Vulkan)
 */

#include <iostream>

#if defined(_WIN32)

namespace mystral {
namespace platform {

void* createWin32Surface(void* instance, void* hwnd, void* hinstance) {
    std::cout << "[Surface] Creating Win32 surface..." << std::endl;
    // TODO: Implement D3D12 or Vulkan surface creation
    return nullptr;
}

}  // namespace platform
}  // namespace mystral

#endif  // _WIN32
