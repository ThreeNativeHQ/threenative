#pragma once

#include "bindings_state.h"

#include <cstddef>
#include <cstdint>

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

bool stageWriteInUploadStaging(
    BindingsState* state,
    WGPUBuffer buffer,
    uint64_t offset,
    const uint8_t* source,
    size_t writeSize,
    size_t alignedWriteSize);
bool replayPackedFrameOpStream(BindingsState* state, js::JSValueHandle frame);

#endif

}  // namespace mystral::webgpu
