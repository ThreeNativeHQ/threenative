#pragma once

/**
 * Audio decoding off the frame thread.
 *
 * `decodeAudioData` used to decode inline, on the thread that called it: a native run of a real game
 * measured **146 clips decoded inside a single frame, ~542 ms of them**, with the frame loop stopped
 * the entire time — a loading screen that froze for half a second and a launch whose `audio` step
 * cost 1.2 s. The same split that `AsyncImageDecoder` gives images is the fix here: `decode()`
 * returns immediately, the bytes are decoded on a worker, and the callback runs on the thread that
 * calls `drain()`. That split is the whole contract — a callback must never run on a worker, because
 * the only thing a decode result is for is building a V8 object.
 */

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace mystral {
namespace audio {

class AudioBuffer;

/** One decoded clip, or the reason it could not be decoded. Never both. */
struct DecodedAudio {
    std::shared_ptr<AudioBuffer> buffer;
    std::string error;
};

/** Runs on the draining thread once the worker has finished. */
using AudioDecodeCallback = std::function<void(DecodedAudio)>;

/**
 * Decodes audio on one worker and hands the results back on the draining thread.
 *
 * The worker is started on the first decode and stopped by `shutdown()`; a decode with no worker
 * available (the machine refuses threads, or after shutdown) still completes, on the calling thread,
 * so the caller never has to know which happened. One worker is enough: audio decode is a few
 * milliseconds per clip and the callers are per-load bursts, so a pool would only take cores from
 * the frame it exists to protect.
 */
class AsyncAudioDecoder {
public:
    static AsyncAudioDecoder& instance();

    /** Queue one decode, or defer a capacity error. Callbacks run only from `drain()`. */
    void decode(std::vector<uint8_t> bytes, float sampleRate, AudioDecodeCallback done);

    /**
     * Deliver completions within a soft 2 ms budget, always allowing one to make progress.
     * A callback is not preemptible. Must be called from the thread that owns the JS engine.
     */
    void drain();

    /**
     * Stop the worker and discard queued/completed callbacks without invoking JS. Idempotent.
     * Call from the owning thread, never the decode worker.
     */
    void shutdown();

    /** Queued decodes the worker has not picked up yet. Diagnostics and tests. */
    size_t queued() const;
    /** Decoded results waiting for a `drain()`. Diagnostics and tests. */
    size_t completed() const;

private:
    AsyncAudioDecoder();
    ~AsyncAudioDecoder();
    AsyncAudioDecoder(const AsyncAudioDecoder&) = delete;
    AsyncAudioDecoder& operator=(const AsyncAudioDecoder&) = delete;

    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace audio
}  // namespace mystral
