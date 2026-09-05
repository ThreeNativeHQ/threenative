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

    // The product selector keeps its existing BGRA preference. When the product path already
    // selected a linear surface, the bridge is already off; the diagnostic must refuse to turn
    // that into a BGRA-versus-RGBA colour-channel comparison.
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
    if (diagnostic.errorCode == nullptr ||
        std::string(diagnostic.errorCode) != "TN_LINEAR_SURFACE_NO_CHANGE" ||
        diagnostic.selectedFormat != product.selectedFormat) {
        return fail("switch-on manufactured a treatment without a bridge transition");
    }

    // With only an sRGB surface, the product arm really does use the bridge, but there is no
    // supported linear treatment. This must be reported as unavailable rather than silently
    // configuring an unsupported format.
    const WGPUTextureFormat srgbOnly[] = {WGPUTextureFormat_BGRA8UnormSrgb};
    const auto control = selectSurfaceFormat(srgbOnly, 1, false);
    if (control.errorCode != nullptr ||
        control.productDefaultFormat != WGPUTextureFormat_BGRA8UnormSrgb ||
        control.selectedFormat != WGPUTextureFormat_BGRA8UnormSrgb) {
        return fail("sRGB control did not retain the bridge format");
    }
    const auto refused = selectSurfaceFormat(srgbOnly, 1, true);
    if (refused.errorCode == nullptr ||
        std::string(refused.errorCode) != "TN_LINEAR_SURFACE_UNSUPPORTED") {
        return fail("unsupported linear twin did not fail with its named error");
    }

    std::cout << "surface-format-selection: PASS" << std::endl;
    return 0;
}
