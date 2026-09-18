#include "mystral/webgpu/async_image_decode.h"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using namespace std::chrono_literals;
using mystral::webgpu::AsyncImageDecoder;
using mystral::webgpu::DecodedImage;

namespace {
std::atomic<bool> releaseCodec{false};
std::atomic<size_t> enteredCodec{0};

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

template <typename Predicate>
void until(Predicate ready) {
    const auto deadline = std::chrono::steady_clock::now() + 5s;
    while (!ready()) {
        require(std::chrono::steady_clock::now() < deadline, "contract timed out");
        std::this_thread::sleep_for(1ms);
    }
}

void yieldingDrain() {
    auto& decoder = AsyncImageDecoder::instance();
    const auto caller = std::this_thread::get_id();
    int callbacks = 0;
    std::vector<int> seen(8, 0);
    for (int index = 0; index < 8; ++index) {
        decoder.decode({static_cast<uint8_t>(index)}, [&, index](DecodedImage image) {
            require(std::this_thread::get_id() == caller, "callback ran on a worker");
            require(image.error.empty() && image.rgba[0] == index, "wrong decoded payload");
            ++seen[index];
            ++callbacks;
            // One continuation can consume its whole budget. Remaining callbacks must wait for
            // a later poll rather than extending this turn by the entire texture burst.
            std::this_thread::sleep_for(5ms);
        });
    }
    until([&] { return decoder.completed() == 8; });
    require(callbacks == 0, "decode invoked a callback before drain");
    decoder.drain();
    require(callbacks > 0 && callbacks < 8, "one drain monopolized the entire completion burst");
    require(decoder.completed() == static_cast<size_t>(8 - callbacks), "drain lost deferred results");
    until([&] {
        decoder.drain();
        return callbacks == 8;
    });
    for (const int count : seen) require(count == 1, "callback was lost or delivered twice");
    decoder.shutdown();
}

void boundedCompletions() {
    auto& decoder = AsyncImageDecoder::instance();
    int callbacks = 0;
    for (int index = 0; index < 64; ++index) {
        decoder.decode({1}, [&](DecodedImage image) {
            require(image.error.empty(), "ordinary burst was rejected");
            ++callbacks;
        });
    }
    until([&] { return decoder.completed() >= 8; });
    // Give a fast producer more turns while the consumer is deliberately not polling.
    std::this_thread::sleep_for(30ms);
    require(decoder.completed() <= 8, "workers retained the whole decoded texture burst");
    require(decoder.queued() > 0, "backpressure did not reach the workers");
    require(callbacks == 0, "a worker delivered JS callbacks");
    until([&] {
        decoder.drain();
        return callbacks == 64;
    });
    require(decoder.queued() == 0 && decoder.completed() == 0, "backpressure lost work");
    decoder.shutdown();
}

void shutdownDoesNotCallJs() {
    auto& decoder = AsyncImageDecoder::instance();
    const size_t workers = mystral::webgpu::imageDecodeWorkerCount();
    int callbacks = 0;
    for (size_t index = 0; index < workers; ++index) {
        decoder.decode({254}, [&](DecodedImage) { ++callbacks; });
    }
    until([&] { return enteredCodec.load() == workers; });
    for (int index = 0; index < 16; ++index) {
        decoder.decode({1}, [&](DecodedImage) { ++callbacks; });
    }
    std::thread release([] {
        std::this_thread::sleep_for(20ms);
        releaseCodec = true;
    });
    decoder.shutdown();
    release.join();
    require(callbacks == 0, "shutdown invoked callbacks whose JS owner may already be destroyed");
    require(decoder.queued() == 0 && decoder.completed() == 0, "shutdown retained stale callbacks");
    decoder.drain();
    decoder.shutdown();
    require(callbacks == 0, "a post-shutdown drain invoked stale callbacks");
}

void shutdownWakesBackpressuredWorkers() {
    auto& decoder = AsyncImageDecoder::instance();
    int callbacks = 0;
    for (int index = 0; index < 64; ++index) {
        decoder.decode({1}, [&](DecodedImage) { ++callbacks; });
    }
    until([&] { return decoder.completed() >= 8; });
    std::this_thread::sleep_for(30ms);
    decoder.shutdown();
    require(callbacks == 0, "shutdown delivered a backpressured callback");
    require(decoder.queued() == 0 && decoder.completed() == 0,
            "shutdown did not discard backpressured work");
    decoder.drain();
    require(callbacks == 0, "cancelled completions survived shutdown");
}

void saturatedQueueDoesNotDecodeInline() {
    auto& decoder = AsyncImageDecoder::instance();
    const size_t workers = mystral::webgpu::imageDecodeWorkerCount();
    size_t callbacks = 0;
    size_t rejected = 0;
    auto done = [&](DecodedImage image) {
        ++callbacks;
        if (!image.error.empty()) {
            require(image.error.find("queue") != std::string::npos, "unexpected overload error");
            ++rejected;
        }
    };
    for (size_t index = 0; index < workers; ++index) decoder.decode({254}, done);
    until([&] { return enteredCodec.load() == workers; });
    for (int index = 0; index < 520; ++index) decoder.decode({1}, done);
    const bool stayedOffThread = enteredCodec.load() == workers;
    const bool stayedDeferred = callbacks == 0;
    releaseCodec = true;
    until([&] {
        decoder.drain();
        return callbacks == workers + 520;
    });
    decoder.shutdown();
    require(stayedOffThread, "a full queue decoded images inline on the frame thread");
    require(stayedDeferred, "overload reentered JS synchronously");
    require(rejected == 8, "overload did not reject exactly the excess queued decodes");
}

void destroyedOwnerCannotBeReentered() {
    auto& decoder = AsyncImageDecoder::instance();
    struct Owner { int marker; };
    alignas(Owner) unsigned char storage[sizeof(Owner)];
    auto oldAlive = std::make_shared<std::atomic<bool>>(true);
    auto* oldOwner = new (storage) Owner{7};
    int staleCalls = 0;
    decoder.decode({254}, [oldOwner, oldAlive, &staleCalls](DecodedImage) {
        if (!oldAlive->load(std::memory_order_acquire)) return;
        staleCalls += oldOwner->marker;
    });
    until([&] { return enteredCodec.load() >= 1; });

    // Model BindingsState teardown, then recreate an owner at the same address before the old
    // worker completes. A raw owner capture would now hit the replacement object on drain.
    oldAlive->store(false, std::memory_order_release);
    oldOwner->~Owner();
    auto freshAlive = std::make_shared<std::atomic<bool>>(true);
    auto* freshOwner = new (storage) Owner{11};
    releaseCodec = true;
    until([&] { return decoder.completed() >= 1; });
    decoder.drain();
    require(staleCalls == 0, "a queued completion reentered a destroyed/recreated owner");

    int freshCalls = 0;
    decoder.decode({1}, [freshOwner, freshAlive, &freshCalls](DecodedImage image) {
        if (!freshAlive->load(std::memory_order_acquire)) return;
        require(image.error.empty(), "replacement owner decode failed");
        freshCalls += freshOwner->marker;
    });
    until([&] {
        decoder.drain();
        return freshCalls == 11;
    });
    freshAlive->store(false, std::memory_order_release);
    freshOwner->~Owner();
    decoder.shutdown();
}
}  // namespace

unsigned char* stbi_load_from_memory(const unsigned char* bytes, int, int* width, int* height,
                                    int* channels, int) {
    ++enteredCodec;
    if (bytes[0] == 254) {
        while (!releaseCodec.load()) std::this_thread::sleep_for(1ms);
    }
    *width = *height = 1;
    *channels = 4;
    auto* pixels = static_cast<unsigned char*>(std::malloc(4));
    if (!pixels) return nullptr;
    pixels[0] = bytes[0];
    pixels[1] = pixels[2] = 0;
    pixels[3] = 255;
    return pixels;
}
void stbi_image_free(void* pixels) { std::free(pixels); }
const char* stbi_failure_reason() { return "test codec allocation failed"; }

int main(int argc, char** argv) {
    try {
        require(argc == 2, "a contract mode is required");
        const std::string mode(argv[1]);
        if (mode == "yield") yieldingDrain();
        else if (mode == "backpressure") boundedCompletions();
        else if (mode == "shutdown") shutdownDoesNotCallJs();
        else if (mode == "shutdown-full") shutdownWakesBackpressuredWorkers();
        else if (mode == "saturation") saturatedQueueDoesNotDecodeInline();
        else if (mode == "owner-lifetime") destroyedOwnerCannotBeReentered();
        else throw std::runtime_error("unknown contract mode");
        std::cout << "async image decode " << mode << " passed\n";
        return 0;
    } catch (const std::exception& error) {
        releaseCodec = true;
        std::cerr << error.what() << '\n';
        return 1;
    }
}
