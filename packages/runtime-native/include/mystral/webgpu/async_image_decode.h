#pragma once

/**
 * Image decoding off the frame thread.
 *
 * `createImageBitmap` used to decode inline, on the thread that called it: a game that loads a
 * texture set decoded every PNG, JPEG and WebP serially on the frame thread, and a native run of a
 * real game measured ~38 % of its whole asset load inside `stbi_load_from_memory` and `VP8Decode`
 * with the frame loop stopped the entire time. Chrome answers the same call off-thread and in
 * parallel, which is most of why the same content loads several times faster there.
 *
 * This module owns the decoder and a small bounded pool: `decode()` returns immediately, the bytes
 * are decoded on a worker, and the callback runs on the thread that calls `drain()`. That split is
 * the whole contract — a callback must never run on a worker, because the only thing a decode
 * result is for is building a V8 object.
 */

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace mystral::webgpu {

/** One decoded image, RGBA8, or the reason it could not be decoded. Never both. */
struct DecodedImage {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> rgba;
    std::string error;
};

/**
 * Decode PNG/JPEG (stb_image) or WebP (libwebp) bytes. Pure, allocation-only, callable from any
 * thread. Fails closed with `error` set rather than returning a blank image.
 */
DecodedImage decodeImageBytes(const uint8_t* bytes, size_t length);

/** Runs on the draining thread once the worker has finished. */
using ImageDecodeCallback = std::function<void(DecodedImage)>;

/**
 * Decodes images on a bounded pool and hands the results back on the draining thread.
 *
 * The pool is started on the first decode and stopped by `shutdown()`; a decode with no pool
 * available (no threads at all, or after shutdown) still completes, on the calling thread, so the
 * caller never has to know which happened.
 */
class AsyncImageDecoder {
public:
    static AsyncImageDecoder& instance();

    /** Queue one decode, or defer a queue-capacity error. Callbacks run only from `drain()`. */
    void decode(std::vector<uint8_t> bytes, ImageDecodeCallback done);

    /**
     * Deliver completions within a soft 2 ms budget, always allowing one to make progress.
     * A callback is not preemptible. Must be called from the thread that owns the JS engine.
     */
    void drain();

    /**
     * Stop workers and discard queued/completed callbacks without invoking JS. Idempotent.
     * Call from the owning thread, never a decoder worker.
     */
    void shutdown();

    /** Queued decodes that no worker has picked up yet. Diagnostics and tests. */
    size_t queued() const;
    /** Decoded results waiting for a `drain()`. Diagnostics and tests. */
    size_t completed() const;

private:
    AsyncImageDecoder();
    ~AsyncImageDecoder();
    AsyncImageDecoder(const AsyncImageDecoder&) = delete;
    AsyncImageDecoder& operator=(const AsyncImageDecoder&) = delete;

    struct Impl;
    std::unique_ptr<Impl> impl_;
};

/**
 * How many worker threads decode at once.
 *
 * Enough to overlap a texture set, few enough to leave the frame thread's cores alone: the load
 * burst is the only traffic, and a decode pool that claims every core makes the frames it was
 * added to protect slower.
 */
size_t imageDecodeWorkerCount();

}  // namespace mystral::webgpu
