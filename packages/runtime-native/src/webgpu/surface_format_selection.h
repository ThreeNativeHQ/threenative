#pragma once

#include <cstdint>

#include <webgpu/webgpu.h>

namespace mystral::webgpu {

struct SurfaceFormatSelection {
    WGPUTextureFormat productDefaultFormat;
    WGPUTextureFormat selectedFormat;
    const char* errorCode;
};

SurfaceFormatSelection selectSurfaceFormat(
    const WGPUTextureFormat* formats,
    uint32_t formatCount,
    bool linearDiagnosticRequested);

}  // namespace mystral::webgpu
