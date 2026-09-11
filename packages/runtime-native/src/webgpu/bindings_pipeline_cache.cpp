// PRD-368: device-owned compiler data, qualified before ingestion and persisted off the main loop.
#include "bindings_pipelines.h"
#include "mystral/cold_start.h"
#include "../storage/local_storage.h"
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <shared_mutex>
#include <utility>

#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
#if __has_include(<webgpu/wgpu.h>)
#include <webgpu/wgpu.h>
#else
#include <wgpu/wgpu.h>
#endif
#endif

namespace mystral::webgpu {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
namespace {
#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
std::string own(WGPUStringView value) {
    return value.data == nullptr ? std::string{} : std::string(value.data,
        value.length == WGPU_STRLEN ? std::char_traits<char>::length(value.data) : value.length);
}
struct RetainedCache {
    WGPUDevice device;
    WGPUPipelineCache handle;
    RetainedCache(WGPUDevice d, WGPUPipelineCache c) : device(d), handle(c) {
        wgpuDeviceAddRef(device);
        wgpuPipelineCacheAddRef(handle);
    }
    ~RetainedCache() { wgpuPipelineCacheRelease(handle); wgpuDeviceRelease(device); }
};
struct CacheData {
    WGPUPipelineCacheData value{};
    ~CacheData() { wgpuPipelineCacheDataFreeMembers(value); }
};

PipelineCacheWrite snapshot(PipelineCacheState& cache, const RetainedCache& retained) {
    const auto begin = std::chrono::steady_clock::now();
    CacheData data;
    {
        std::unique_lock<std::shared_mutex> lock(cache.snapshotMutex);
        data.value = wgpuPipelineCacheGetData(retained.handle);
    }
    const double snapshotMs = std::chrono::duration<double, std::milli>(
        std::chrono::steady_clock::now() - begin).count();
    PipelineCacheWrite result{"unavailable", "backend-returned-no-data", 0, 0};
    if (data.value.data != nullptr && data.value.size != 0)
        result = cache.store->write(static_cast<const uint8_t*>(data.value.data), data.value.size);
    result.snapshotMs = snapshotMs;
    return result;
}
void settlePersistence(BindingsState* state) {
    auto& cache = state->pipelineCache;
    try { cache.lastWrite = cache.persistence.get(); }
    catch (...) { cache.lastWrite = {"unavailable", "snapshot-failed", 0, 0}; }
    if (cache.lastWrite.bytes > 0) cache.serializedBytes = cache.lastWrite.bytes;
    reportPipelineCacheState(state, "store");
}

void qualifyAndLoad(BindingsState* state, bool load = true) {
    auto& cache = state->pipelineCache;
    const auto begin = std::chrono::steady_clock::now();
    const std::string root = storage::LocalStorage::getStorageDirectory();
    // Android's internal files directory is application-specific even when two APKs use the
    // same asset entry name. A desktop embedded executable supplies its canonical identity.
    if (!cache.identity.app.empty()) cache.identity.app = root + "/" + cache.identity.app;
#if defined(TN_PIPELINE_CACHE_BUILD_ID) && defined(TN_PIPELINE_CACHE_ABI_ID)
    cache.identity.build = TN_PIPELINE_CACHE_BUILD_ID;
    cache.identity.abi = TN_PIPELINE_CACHE_ABI_ID;
#endif
    if (state->adapter != nullptr) {
        WGPUAdapterInfo info{};
        wgpuAdapterGetInfo(state->adapter, &info);
        cache.identity.backend = pipelineBackendName(info.backendType);
        cache.identity.adapter = std::to_string(info.vendorID) + ":" + std::to_string(info.deviceID) + ":" + own(info.device);
        // In pinned wgpu-native 25, vendor is AdapterInfo.driver and description is driver_info.
        // An absent driver revision is unqualified, not a fabricated "unknown" compatibility key.
        const auto revision = own(info.description);
        if (!revision.empty()) cache.identity.driver = own(info.vendor) + "/" + revision;
        wgpuAdapterInfoFreeMembers(info);
    }
    if (cache.identity.backend != "vulkan" || !cache.identity.complete() || root.empty()) {
        cache.reason = "unqualified-persistence-identity";
        return;
    }
    if (!load) return; // disabled controls report identity without opening or writing cache files
    cache.store = std::make_shared<PipelineCacheStore>(root, cache.identity);
    auto loaded = cache.store->read();
    cache.loadOutcome = loaded.outcome;
    cache.reason = loaded.reason;
    if (loaded.outcome == "validated") {
        WGPUPipelineCacheDescriptor descriptor{};
        descriptor.data = loaded.bytes.data();
        descriptor.size = loaded.bytes.size();
        // The maintained C API sets fallback=false. A null result is reported as a rejection;
        // the empty device cache remains live, so corruption can never prevent ordinary compile.
        auto imported = wgpuDeviceCreatePipelineCache(state->device, &descriptor);
        if (imported != nullptr) {
            wgpuPipelineCacheRelease(static_cast<WGPUPipelineCache>(cache.handle));
            cache.handle = const_cast<void*>(static_cast<const void*>(imported));
            cache.loadOutcome = "accepted";
            cache.reason.clear();
            cache.loadedBytes = loaded.bytes.size();
            cache.serializedBytes = cache.loadedBytes;
        } else {
            cache.loadOutcome = "rejected";
            cache.reason = "backend-rejected";
        }
    }
    cache.loadMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begin).count();
}
#endif
} // namespace

// Android's zygote cannot inherit the caller's shell environment. The equivalent negative
// control is an app-private file created through `run-as`; it only disables an optimization.
// No user data is cleared and the APK, device identity, shaders, and rendering stay identical.
#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
static bool pipelineCacheDisabledForHost() {
    const char* setting = std::getenv("TN_PIPELINE_CACHE");
    if (setting != nullptr && std::string(setting) == "0") return true;
    std::error_code error;
    const std::filesystem::path root(storage::LocalStorage::getStorageDirectory());
    return root.is_absolute() && std::filesystem::is_regular_file(root / "pipeline-cache.disabled", error);
}

#endif

void initPipelineCache(BindingsState* state) {
    if (state == nullptr) return;
    auto& cache = state->pipelineCache;
#if !defined(MYSTRAL_WGPU_PIPELINE_CACHE)
    cache.mode = "unsupported";
    cache.reason = "this build's WebGPU backend declares no pipeline cache API";
#else
    cache.featureGranted = state->device != nullptr && wgpuDeviceHasFeature(state->device,
        static_cast<WGPUFeatureName>(WGPUNativeFeature_PipelineCache)) != 0;
    if (!cache.featureGranted) {
        cache.mode = "unavailable";
        cache.reason = "the device was not granted the pipeline-cache feature";
    } else if (pipelineCacheDisabledForHost()) {
        cache.mode = "disabled";
        cache.loadOutcome = "disabled";
        cache.reason = "operator-disabled";
        try { qualifyAndLoad(state, false); }
        catch (...) { cache.reason = "disabled-unqualified-identity"; }
    } else {
        WGPUPipelineCacheDescriptor descriptor{};
        auto handle = wgpuDeviceCreatePipelineCache(state->device, &descriptor);
        if (handle == nullptr) {
            cache.mode = "unavailable";
            cache.reason = "the backend refused an empty pipeline cache";
        } else {
            cache.handle = const_cast<void*>(static_cast<const void*>(handle));
            cache.mode = "attached";
            cache.emptyBytes = pipelineCacheSerializedBytes(state);
            try { qualifyAndLoad(state); }
            catch (...) {
                cache.loadOutcome = "unavailable";
                cache.reason = "storage-qualification-failed";
                cache.store.reset();
            }
        }
    }
#endif
    reportPipelineCacheState(state, "device");
}

WGPURenderPipeline createCachedRenderPipeline(BindingsState* state, WGPUDevice device,
                                              const WGPURenderPipelineDescriptor* descriptor) {
    std::shared_lock<std::shared_mutex> lock(state->pipelineCache.snapshotMutex);
    return wgpuDeviceCreateRenderPipeline(device, descriptor);
}
WGPUComputePipeline createCachedComputePipeline(BindingsState* state, WGPUDevice device,
                                                const WGPUComputePipelineDescriptor* descriptor) {
    std::shared_lock<std::shared_mutex> lock(state->pipelineCache.snapshotMutex);
    return wgpuDeviceCreateComputePipeline(device, descriptor);
}

size_t pipelineCacheSerializedBytes(BindingsState* state) {
#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
    if (state == nullptr || state->pipelineCache.handle == nullptr) return 0;
    std::unique_lock<std::shared_mutex> lock(state->pipelineCache.snapshotMutex);
    CacheData data;
    data.value = wgpuPipelineCacheGetData(static_cast<WGPUPipelineCache>(state->pipelineCache.handle));
    state->pipelineCache.serializedBytes = data.value.size;
    return data.value.size;
#else
    (void)state;
    return 0;
#endif
}

void pollPipelineCachePersistence(BindingsState* state) {
    if (state == nullptr) return;
    auto& cache = state->pipelineCache;
    // This boundary is also required in disabled controls: never derive process-to-playable
    // from the later-created JavaScript performance clock. The caller has actually presented.
    if (!cache.playableBoundary.reported() && state->engine != nullptr &&
        state->profiling.firstPresentReported) {
        auto ready = state->engine->getGlobalProperty("__TN_STARTUP_READY__");
        const bool isReady = state->engine->isBoolean(ready) && state->engine->toBoolean(ready);
        if (cache.playableBoundary.observe(isReady, state->profiling.presentCount))
            coldStartMark("first_playable");
    }
#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
    if (cache.stopping || !cache.store || !cache.handle) return;
    if (cache.persistence.valid()) {
        if (cache.persistence.wait_for(std::chrono::seconds(0)) != std::future_status::ready) return;
        settlePersistence(state);
    }
    // No backend serialization or file I/O on first present. Require settled work and a later
    // present with unchanged attachment count. A subsequent compile generation re-arms saving.
    if (!state->profiling.firstPresentReported || state->profiling.presentCount < 2 ||
        state->asyncPipelines.started != state->asyncPipelines.settled) return;
    const uint64_t count = cache.renderAttached.load() + cache.computeAttached.load();
    if (cache.observedAttachments != count) { cache.observedAttachments = count; return; }
    if (count == 0 || cache.attemptedAttachments == count) return;
    cache.attemptedAttachments = count;
    try {
        const auto retained = std::make_shared<RetainedCache>(state->device,
            static_cast<WGPUPipelineCache>(cache.handle));
        cache.persistence = std::async(std::launch::async, [&cache, retained] {
            return snapshot(cache, *retained);
        });
    } catch (...) {
        cache.lastWrite = {"unavailable", "snapshot-worker-unavailable", 0, 0};
        reportPipelineCacheState(state, "store");
    }
#else
    (void)state;
#endif
}

void releasePipelineCache(BindingsState* state) {
#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
    if (state == nullptr) return;
    auto& cache = state->pipelineCache;
    cache.stopping = true;
    // shutdownAsyncPipelineCompiles joins both compiler workers before entering here. Joining
    // this future is the other half of device lifetime: no task can retain a reference to state.
    if (cache.persistence.valid()) settlePersistence(state);
    if (cache.handle == nullptr) return;
    pipelineCacheSerializedBytes(state);
    reportPipelineCacheState(state, "shutdown");
    auto handle = static_cast<WGPUPipelineCache>(cache.handle);
    cache.handle = nullptr;
    wgpuPipelineCacheRelease(handle);
#else
    (void)state;
#endif
}

void reportPipelineCacheState(BindingsState* state, const char* phase) {
    if (state == nullptr) return;
    const auto& cache = state->pipelineCache;
    std::lock_guard<std::mutex> outputLock(pipelineOutputMutex());
    // Only already-observed values. Reporting a completed store on a present must not secretly
    // serialize a second snapshot on the main thread.
    std::cout << "TN_PIPELINE_CACHE:{\"version\":1,\"phase\":" << pipelineJsonString(phase)
              << ",\"mode\":" << pipelineJsonString(cache.mode)
              << ",\"featureGranted\":" << (cache.featureGranted ? "true" : "false")
              << ",\"renderAttached\":" << cache.renderAttached.load()
              << ",\"computeAttached\":" << cache.computeAttached.load()
              << ",\"emptyBytes\":" << cache.emptyBytes
              << ",\"serializedBytes\":" << cache.serializedBytes
              << ",\"load\":" << pipelineJsonString(cache.loadOutcome)
              << ",\"loadedBytes\":" << cache.loadedBytes << ",\"loadMs\":" << cache.loadMs
              << ",\"store\":" << pipelineJsonString(cache.lastWrite.outcome)
              << ",\"storedBytes\":" << cache.lastWrite.bytes
              << ",\"storeMs\":" << cache.lastWrite.elapsedMs
              << ",\"snapshotMs\":" << cache.lastWrite.snapshotMs;
    if (cache.identity.complete()) std::cout << ",\"identity\":" << pipelineJsonString(cache.identity.key());
    if (!cache.reason.empty()) std::cout << ",\"reason\":" << pipelineJsonString(cache.reason);
    if (!cache.lastWrite.reason.empty()) std::cout << ",\"storeReason\":" << pipelineJsonString(cache.lastWrite.reason);
    std::cout << "}" << std::endl;
}
#endif
} // namespace mystral::webgpu
