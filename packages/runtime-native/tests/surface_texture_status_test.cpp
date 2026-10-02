#include <webgpu/webgpu.h>
#include "mystral/webgpu_compat.h"

#include <iostream>

// The same production helper used by all surface acquisition paths. No device or display
// is needed: a suboptimal image is usable, while timeout/lost/outdated remain failures.
int main() {
    if (!wgpuSurfaceTextureStatusIsSuccess(WGPUSurfaceGetCurrentTextureStatus_Success_Compat)) {
        std::cerr << "optimal surface acquisition was rejected\n";
        return 1;
    }
#if defined(MYSTRAL_WEBGPU_DAWN) || defined(MYSTRAL_WEBGPU_WGPU_MODERN)
    if (!wgpuSurfaceTextureStatusIsSuccess(WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal)) {
        std::cerr << "suboptimal surface acquisition was rejected\n";
        return 1;
    }
    if (wgpuSurfaceTextureStatusIsSuccess(WGPUSurfaceGetCurrentTextureStatus_Error)) return 2;
#endif
#if defined(MYSTRAL_WEBGPU_WGPU_MODERN)
    // Pinned Dawn folds these failures into Error; only wgpu declares distinct statuses.
    if (wgpuSurfaceTextureStatusIsSuccess(WGPUSurfaceGetCurrentTextureStatus_OutOfMemory)) return 2;
    if (wgpuSurfaceTextureStatusIsSuccess(WGPUSurfaceGetCurrentTextureStatus_DeviceLost)) return 2;
#endif
    for (const auto status : {WGPUSurfaceGetCurrentTextureStatus_Timeout,
                              WGPUSurfaceGetCurrentTextureStatus_Outdated,
                              WGPUSurfaceGetCurrentTextureStatus_Lost,
                              WGPUSurfaceGetCurrentTextureStatus_Force32}) {
        if (wgpuSurfaceTextureStatusIsSuccess(status)) {
            std::cerr << "failed surface acquisition was accepted\n";
            return 2;
        }
    }
    std::cout << "native surface acquisition status contract passed\n";
    return 0;
}
