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

/**
 * Replays everything the recorder holds up to its last clean cut, mid-frame.
 *
 * `queue.submit` is recorded, not executed, so between the game's submit and the frame boundary
 * the GPU has not seen that work. `buffer.mapAsync` is the one call that lets JavaScript observe
 * the queue in that window — WebGPU completes a map only after the work already submitted — so it
 * flushes first. Returns false when the replay failed, with the engine exception already set.
 */
bool flushRecordedFrameOps(BindingsState* state);

#endif

}  // namespace mystral::webgpu
