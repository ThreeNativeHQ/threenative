#include "mystral/webgpu/async_image_decode.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <deque>
#include <exception>
#include <iostream>
#include <limits>
#include <mutex>
#include <new>
#include <stdexcept>
#include <thread>

#include "stb_image.h"

#if defined(MYSTRAL_HAS_WEBP)
#include <webp/decode.h>
#endif

namespace mystral::webgpu {

namespace {

constexpr size_t kMaxWorkers = 4;
constexpr size_t kMaxQueuedDecodes = 512;
// Bound decoded pixel payloads too, not just the smaller encoded inputs. A stalled frame must
// not let the pool expand the entire texture set into RGBA before JS can consume any of it.
constexpr size_t kMaxCompletedDecodes = 2 * kMaxWorkers;
constexpr auto kDrainBudget = std::chrono::milliseconds(2);

bool looksLikeWebP(const uint8_t* bytes, size_t length) {
    return length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F' &&
           bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P';
}

}  // namespace

DecodedImage decodeImageBytes(const uint8_t* bytes, size_t length) {
    DecodedImage image;
    if (bytes == nullptr || length == 0) {
        image.error = "the image payload was empty";
        return image;
    }
    if (length > static_cast<size_t>(std::numeric_limits<int>::max())) {
        image.error = "the image payload is too large for the decoder";
        return image;
    }

    int width = 0;
    int height = 0;
    unsigned char* pixels = nullptr;
    bool decodedWebP = false;

    if (looksLikeWebP(bytes, length)) {
#if defined(MYSTRAL_HAS_WEBP)
        pixels = WebPDecodeRGBA(bytes, length, &width, &height);
        decodedWebP = true;
        if (pixels == nullptr) {
            image.error = "Failed to decode WebP image";
            return image;
        }
#else
        image.error = "WebP image detected but libwebp support not compiled in. Rebuild with MYSTRAL_HAS_WEBP.";
        return image;
#endif
    } else {
        int channels = 0;
        pixels = stbi_load_from_memory(bytes, static_cast<int>(length), &width, &height, &channels, 4);
        if (pixels == nullptr) {
            const char* reason = stbi_failure_reason();
            image.error = std::string("Failed to decode image: ") +
                          (reason ? reason : "decoder returned no diagnostic");
            return image;
        }
    }

    // The codec buffer must be released even if the RGBA vector allocation fails. An exception
    // escaping a worker terminates the process instead of rejecting createImageBitmap.
    const auto releasePixels = [decodedWebP](unsigned char* data) {
        if (decodedWebP) {
#if defined(MYSTRAL_HAS_WEBP)
            WebPFree(data);
#endif
        } else {
            stbi_image_free(data);
        }
    };
    const std::unique_ptr<unsigned char, decltype(releasePixels)> ownedPixels(pixels, releasePixels);
    if (width <= 0 || height <= 0) {
        image.error = "the image decoded to no pixels";
        return image;
    }
    const size_t w = static_cast<size_t>(width);
    const size_t h = static_cast<size_t>(height);
    // Check before multiplying or forming an out-of-range pointer, including on 32-bit hosts.
    if (w > image.rgba.max_size() / h / 4u) {
        image.error = "image too large";
        return image;
    }
    try {
        const size_t byteCount = w * h * 4u;
        image.rgba.assign(ownedPixels.get(), ownedPixels.get() + byteCount);
        image.width = width;
        image.height = height;
    } catch (const std::bad_alloc&) {
        image.error = "out of memory";
    } catch (const std::length_error&) {
        image.error = "image too large";
    }
    return image;
}

size_t imageDecodeWorkerCount() {
    const unsigned int cores = std::thread::hardware_concurrency();
    // A quarter of the machine, floor 1, ceiling 4: the load burst is the only traffic and the
    // frame thread has to keep its own cores.
    const size_t share = cores == 0 ? 1u : static_cast<size_t>(cores) / 4u;
    return std::clamp<size_t>(share, 1, kMaxWorkers);
}

struct AsyncImageDecoder::Impl {
    struct Job {
        std::vector<uint8_t> bytes;
        ImageDecodeCallback done;
    };
    struct Result {
        DecodedImage image;
        ImageDecodeCallback done;
    };

    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Job> jobs;
    std::deque<Result> results;
    std::vector<std::thread> workers;
    // Worker cancellation must not destroy captures that may own JS handles off-thread.
    // Fixed slots avoid allocating while shutdown is already under memory pressure.
    std::array<ImageDecodeCallback, kMaxWorkers> cancelled;
    bool stopping = false;

    void startWorkers() {
        const size_t wanted = imageDecodeWorkerCount();
        workers.reserve(wanted);
        for (size_t index = 0; index < wanted; ++index) {
            try {
                workers.emplace_back([this, index] { work(index); });
            } catch (const std::exception& error) {
                // No thread is a slow decode, not a broken decode: whatever is queueued still runs
                // on `drain()`'s thread, which is what a build without a pool does anyway.
                std::cerr << "[ImageDecode] Worker thread unavailable: " << error.what() << std::endl;
                break;
            }
        }
    }

    void work(size_t workerIndex) {
        for (;;) {
            Job job;
            {
                std::unique_lock<std::mutex> lock(mutex);
                wake.wait(lock, [this] { return stopping || !jobs.empty(); });
                if (stopping) return;
                if (jobs.empty()) continue;
                job = std::move(jobs.front());
                jobs.pop_front();
            }
            DecodedImage image = decodeImageBytes(job.bytes.data(), job.bytes.size());
            std::unique_lock<std::mutex> lock(mutex);
            wake.wait(lock, [this] { return stopping || results.size() < kMaxCompletedDecodes; });
            if (stopping) {
                cancelled[workerIndex].swap(job.done);
                return;
            }
            results.push_back({std::move(image), std::move(job.done)});
        }
    }

    /** Decode inline, for a build with no pool or after shutdown. */
    void decodeInline(std::vector<uint8_t> bytes, ImageDecodeCallback done) {
        DecodedImage image = decodeImageBytes(bytes.data(), bytes.size());
        std::lock_guard<std::mutex> lock(mutex);
        results.push_back({std::move(image), std::move(done)});
    }
};

AsyncImageDecoder& AsyncImageDecoder::instance() {
    static AsyncImageDecoder decoder;
    return decoder;
}

AsyncImageDecoder::AsyncImageDecoder() : impl_(std::make_unique<Impl>()) {}

AsyncImageDecoder::~AsyncImageDecoder() { shutdown(); }

void AsyncImageDecoder::decode(std::vector<uint8_t> bytes, ImageDecodeCallback done) {
    if (!done) return;
    std::unique_lock<std::mutex> lock(impl_->mutex);
    if (impl_->stopping) {
        lock.unlock();
        impl_->decodeInline(std::move(bytes), std::move(done));
        return;
    }
    if (impl_->workers.empty()) impl_->startWorkers();
    if (impl_->workers.empty()) {
        // A worker could not be created — the machine refuses threads. Decode inline rather than
        // dropping the image; the caller's promise still settles.
        lock.unlock();
        impl_->decodeInline(std::move(bytes), std::move(done));
        return;
    }
    // Overload must not move expensive decoding back onto the frame thread. Reject the excess
    // request on the next drain, with no pixel payload and no synchronous JS re-entry.
    if (impl_->jobs.size() >= kMaxQueuedDecodes) {
        DecodedImage image;
        image.error = "image decode queue capacity exceeded";
        impl_->results.push_back({std::move(image), std::move(done)});
        return;
    }
    impl_->jobs.push_back({std::move(bytes), std::move(done)});
    lock.unlock();
    impl_->wake.notify_all();
}

/** A completion callback this slow is why the frame loop is not iterating. */
constexpr uint64_t kSlowCallbackNs = 100'000'000;

void AsyncImageDecoder::drain() {
    const auto deadline = std::chrono::steady_clock::now() + kDrainBudget;
    size_t remaining = 0;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        remaining = impl_->results.size();
    }
    // At least one completion makes progress; newly arriving results wait for a later poll.
    // A single callback cannot be preempted, but it must not pull the whole burst into its turn.
    while (remaining-- > 0) {
        Impl::Result result;
        {
            std::lock_guard<std::mutex> lock(impl_->mutex);
            if (impl_->results.empty()) break;
            result = std::move(impl_->results.front());
            impl_->results.pop_front();
        }
        // Workers wait on both job availability and result capacity, so wake all predicates.
        impl_->wake.notify_all();
        // One callback cannot be preempted, so a slow one is the whole reason the loop stopped
        // iterating: name it, with the image it was handed, or the next reader has to guess.
        const auto callbackBegin = std::chrono::steady_clock::now();
        const int callbackWidth = result.image.width;
        const int callbackHeight = result.image.height;
        if (result.done) result.done(std::move(result.image));
        const uint64_t callbackNs = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(
                std::chrono::steady_clock::now() - callbackBegin).count());
        if (callbackNs >= kSlowCallbackNs) {
            std::cout << "TN_SLOW_DECODE_CALLBACK:{\"ms\":" << static_cast<double>(callbackNs) / 1e6
                      << ",\"w\":" << callbackWidth << ",\"h\":" << callbackHeight
                      << ",\"waiting\":" << remaining << "}" << std::endl;
        }
        if (std::chrono::steady_clock::now() >= deadline) break;
    }
}

void AsyncImageDecoder::shutdown() {
    std::vector<std::thread> workers;
    std::deque<Impl::Job> dropped;
    std::deque<Impl::Result> completed;
    std::array<ImageDecodeCallback, kMaxWorkers> cancelled;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        if (impl_->stopping) return;
        impl_->stopping = true;
        workers.swap(impl_->workers);
        dropped.swap(impl_->jobs);
        completed.swap(impl_->results);
    }
    impl_->wake.notify_all();
    for (auto& worker : workers) {
        if (worker.joinable() && worker.get_id() != std::this_thread::get_id()) worker.join();
    }
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        cancelled.swap(impl_->cancelled);
    }
    // All callbacks, including interrupted workers' captures, are destroyed on the owner thread
    // outside the mutex. Destructors may themselves call back into decoder diagnostics.
    // Cancellation, not delivery: shutdown may run from the singleton's destructor, after the
    // JS engine has gone away. Destroy queued and completed callbacks without invoking them.
}

size_t AsyncImageDecoder::queued() const {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    return impl_->jobs.size();
}

size_t AsyncImageDecoder::completed() const {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    return impl_->results.size();
}

}  // namespace mystral::webgpu
