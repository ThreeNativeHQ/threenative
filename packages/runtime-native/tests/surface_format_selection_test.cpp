#include "webgpu/surface_format_selection.h"

#include <iostream>
#include <string>

namespace {

int fail(const char* message) {
    std::cerr << "surface-format-selection: FAIL: " << message << std::endl;
    return 1;
}

}  // namespace

int main() {
    using mystral::webgpu::selectSurfaceFormat;

    // The product selector keeps its existing BGRA preference. The diagnostic selector must
    // inspect the whole capability list and choose the supported linear twin of RGBA8UnormSrgb,
    // proving that the enabled arm changes the negotiated format rather than repeating the
    // product default.
    const WGPUTextureFormat capabilities[] = {
        WGPUTextureFormat_BGRA8Unorm,
        WGPUTextureFormat_RGBA8UnormSrgb,
        WGPUTextureFormat_RGBA8Unorm,
    };
    const auto product = selectSurfaceFormat(capabilities, 3, false);
    if (product.errorCode != nullptr ||
        product.selectedFormat != WGPUTextureFormat_BGRA8Unorm) {
        return fail("switch-off product default changed");
    }

    const auto diagnostic = selectSurfaceFormat(capabilities, 3, true);
    if (diagnostic.errorCode != nullptr ||
        diagnostic.selectedFormat != WGPUTextureFormat_RGBA8Unorm ||
        diagnostic.selectedFormat == product.selectedFormat) {
        return fail("switch-on did not select a changed supported linear twin");
    }

    const WGPUTextureFormat unsupported[] = {WGPUTextureFormat_BGRA8UnormSrgb};
    const auto refused = selectSurfaceFormat(unsupported, 1, true);
    if (refused.errorCode == nullptr ||
        std::string(refused.errorCode) != "TN_LINEAR_SURFACE_UNSUPPORTED") {
        return fail("unsupported linear twin did not fail with its named error");
    }

    std::cout << "surface-format-selection: PASS" << std::endl;
    return 0;
}
