#include "mystral/webgpu/async_image_decode.h"

#include <algorithm>
#include <condition_variable>
#include <cstdlib>
#include <deque>
#include <exception>
#include <iostream>
#include <limits>
#include <mutex>
#include <thread>

#include "stb_image.h"

#if defined(MYSTRAL_HAS_WEBP)
#include <webp/decode.h>
#endif

namespace mystral::webgpu {

namespace {

constexpr size_t kMaxWorkers = 4;
constexpr size_t kMaxQueuedDecodes = 512;

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
            image.error = std::string("Failed to decode image: ") + stbi_failure_reason();
            return image;
        }
    }

    if (width <= 0 || height <= 0) {
        image.error = "the image decoded to no pixels";
    } else {
        const size_t byteCount = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
        image.rgba.assign(pixels, pixels + byteCount);
        image.width = width;
        image.height = height;
    }

    if (decodedWebP) {
#if defined(MYSTRAL_HAS_WEBP)
        WebPFree(pixels);
#endif
    } else {
        stbi_image_free(pixels);
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
    bool stopping = false;

    void startWorkers() {
        const size_t wanted = imageDecodeWorkerCount();
        workers.reserve(wanted);
        for (size_t index = 0; index < wanted; ++index) {
            try {
                workers.emplace_back([this] { work(); });
            } catch (const std::exception& error) {
                // No thread is a slow decode, not a broken decode: whatever is queueued still runs
                // on `drain()`'s thread, which is what a build without a pool does anyway.
                std::cerr << "[ImageDecode] Worker thread unavailable: " << error.what() << std::endl;
                break;
            }
        }
    }

    void work() {
        for (;;) {
            Job job;
            {
                std::unique_lock<std::mutex> lock(mutex);
                wake.wait(lock, [this] { return stopping || !jobs.empty(); });
                if (stopping && jobs.empty()) return;
                if (jobs.empty()) continue;
                job = std::move(jobs.front());
                jobs.pop_front();
            }
            DecodedImage image = decodeImageBytes(job.bytes.data(), job.bytes.size());
            std::lock_guard<std::mutex> lock(mutex);
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
    // Bounded: a runaway producer waits here rather than growing a queue without limit. The bound
    // is far above any real asset set, so it never blocks a load that fits in memory.
    if (impl_->jobs.size() >= kMaxQueuedDecodes) {
        lock.unlock();
        impl_->decodeInline(std::move(bytes), std::move(done));
        return;
    }
    impl_->jobs.push_back({std::move(bytes), std::move(done)});
    lock.unlock();
    impl_->wake.notify_one();
}

void AsyncImageDecoder::drain() {
    std::deque<Impl::Result> results;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        results.swap(impl_->results);
    }
    // Handed back in completion order, outside the lock: a callback builds JS objects and may take
    // as long as it likes without stalling the workers.
    for (auto& result : results) {
        if (result.done) result.done(std::move(result.image));
    }
}

void AsyncImageDecoder::shutdown() {
    std::vector<std::thread> workers;
    std::deque<Impl::Job> dropped;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        if (impl_->stopping) return;
        impl_->stopping = true;
        workers.swap(impl_->workers);
        dropped.swap(impl_->jobs);
    }
    impl_->wake.notify_all();
    for (auto& worker : workers) {
        if (worker.joinable() && worker.get_id() != std::this_thread::get_id()) worker.join();
    }
    // A decode that was still queued still settles, on this thread: a promise that never resolves
    // is worse than a promise that resolves late.
    for (auto& job : dropped) {
        if (job.done) job.done(decodeImageBytes(job.bytes.data(), job.bytes.size()));
    }
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
