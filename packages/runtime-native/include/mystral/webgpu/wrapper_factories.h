#pragma once

#include <cstdint>

#include "mystral/js/engine.h"

namespace mystral::webgpu {

struct BindingsState;

js::JSValueHandle createTextureWrapper(
    BindingsState* state,
    void* texture,
    uint64_t textureId,
    uint32_t width,
    uint32_t height,
    const char* format,
    bool rollbackRegistryEntry);

js::JSValueHandle createPipelineWrapper(
    BindingsState* state,
    void* pipeline,
    uint64_t pipelineId,
    bool renderPipeline);

}  // namespace mystral::webgpu
