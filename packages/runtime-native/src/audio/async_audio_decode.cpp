#include "mystral/audio/async_audio_decode.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <iostream>
#include <mutex>
#include <thread>

#include "mystral/audio/audio_context.h"

namespace mystral {
namespace audio {

namespace {

// A game loads its clips in one burst; the cap is a bound on how much encoded audio one stalled
// frame can hand over, not a throughput limit. Past it the excess settles as an error on the next
// drain rather than moving decoding back onto the frame thread.
constexpr size_t kMaxQueuedDecodes = 512;
// Decoded clips are float PCM and much larger than their encoded bytes, so the completed side is
// bounded too: a frame that never drains must not let the worker expand the whole clip set.
constexpr size_t kMaxCompletedDecodes = 64;
constexpr auto kDrainBudget = std::chrono::milliseconds(2);

}  // namespace

struct AsyncAudioDecoder::Impl {
    struct Job {
        std::vector<uint8_t> bytes;
        float sampleRate = 0.0f;
        AudioDecodeCallback done;
    };
    struct Result {
        DecodedAudio audio;
        AudioDecodeCallback done;
    };

    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Job> jobs;
    std::deque<Result> results;
    std::thread worker;
    bool stopping = false;

    void startWorker() {
        try {
            worker = std::thread([this] { work(); });
        } catch (const std::exception& error) {
            // No thread is a slow decode, not a broken decode: whatever is queued still runs on
            // `drain()`'s thread, which is what a build without a worker does anyway.
            std::cerr << "[AudioDecode] Worker thread unavailable: " << error.what() << std::endl;
        }
    }

    void work() {
        for (;;) {
            Job job;
            {
                std::unique_lock<std::mutex> lock(mutex);
                wake.wait(lock, [this] { return stopping || !jobs.empty(); });
                if (stopping) return;
                job = std::move(jobs.front());
                jobs.pop_front();
            }
            DecodedAudio decoded;
            auto buffer = decodeAudioFile(job.bytes.data(), job.bytes.size(), job.sampleRate);
            if (buffer == nullptr) decoded.error = "decodeAudioData could not decode the supplied audio";
            else decoded.buffer = std::move(buffer);
            std::unique_lock<std::mutex> lock(mutex);
            wake.wait(lock, [this] { return stopping || results.size() < kMaxCompletedDecodes; });
            if (stopping) return;
            results.push_back({std::move(decoded), std::move(job.done)});
        }
    }

    /** Decode inline, for a build with no worker or after shutdown. */
    void decodeInline(std::vector<uint8_t> bytes, float sampleRate, AudioDecodeCallback done) {
        DecodedAudio decoded;
        auto buffer = decodeAudioFile(bytes.data(), bytes.size(), sampleRate);
        if (buffer == nullptr) decoded.error = "decodeAudioData could not decode the supplied audio";
        else decoded.buffer = std::move(buffer);
        std::lock_guard<std::mutex> lock(mutex);
        results.push_back({std::move(decoded), std::move(done)});
    }
};

AsyncAudioDecoder& AsyncAudioDecoder::instance() {
    static AsyncAudioDecoder decoder;
    return decoder;
}

AsyncAudioDecoder::AsyncAudioDecoder() : impl_(std::make_unique<Impl>()) {}

AsyncAudioDecoder::~AsyncAudioDecoder() { shutdown(); }

void AsyncAudioDecoder::decode(std::vector<uint8_t> bytes, float sampleRate, AudioDecodeCallback done) {
    if (!done) return;
    std::unique_lock<std::mutex> lock(impl_->mutex);
    if (impl_->stopping) {
        lock.unlock();
        impl_->decodeInline(std::move(bytes), sampleRate, std::move(done));
        return;
    }
    if (!impl_->worker.joinable()) impl_->startWorker();
    if (!impl_->worker.joinable()) {
        lock.unlock();
        impl_->decodeInline(std::move(bytes), sampleRate, std::move(done));
        return;
    }
    if (impl_->jobs.size() >= kMaxQueuedDecodes) {
        DecodedAudio decoded;
        decoded.error = "audio decode queue capacity exceeded";
        impl_->results.push_back({std::move(decoded), std::move(done)});
        impl_->wake.notify_all();
        return;
    }
    impl_->jobs.push_back({std::move(bytes), sampleRate, std::move(done)});
    lock.unlock();
    impl_->wake.notify_all();
}

void AsyncAudioDecoder::drain() {
    const auto deadline = std::chrono::steady_clock::now() + kDrainBudget;
    for (;;) {
        Impl::Result result;
        {
            std::lock_guard<std::mutex> lock(impl_->mutex);
            if (impl_->results.empty()) return;
            result = std::move(impl_->results.front());
            impl_->results.pop_front();
        }
        impl_->wake.notify_all();
        if (result.done) result.done(std::move(result.audio));
        // Always deliver one, then stop at the budget so a long queue cannot own the frame; the
        // rest are delivered on later frames, which is the point of draining instead of decoding.
        if (std::chrono::steady_clock::now() >= deadline) return;
    }
}

void AsyncAudioDecoder::shutdown() {
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        if (impl_->stopping) {
            if (impl_->worker.joinable()) impl_->worker.join();
            return;
        }
        impl_->stopping = true;
    }
    impl_->wake.notify_all();
    if (impl_->worker.joinable()) impl_->worker.join();
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->jobs.clear();
    impl_->results.clear();
}

size_t AsyncAudioDecoder::queued() const {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    return impl_->jobs.size();
}

size_t AsyncAudioDecoder::completed() const {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    return impl_->results.size();
}

}  // namespace audio
}  // namespace mystral
