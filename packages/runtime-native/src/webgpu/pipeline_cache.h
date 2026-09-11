#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mystral::webgpu {

// Disposable compiler data, never game assets. One cache file per app, not per identity generation.
inline constexpr size_t kPipelineCacheMaxBytes = 32u * 1024u * 1024u;
std::string pipelineCacheDigest(std::string_view bytes);

// The native process clock may start well before performance.now(). Observe readiness after a
// real present, then wait for a later present so a pre-ready loading frame cannot count as play.
class PipelineCachePlayableBoundary {
public:
    bool observe(bool ready, uint64_t present) {
        if (reported_ || present == 0) return false;
        if (!ready) { observedPresent_ = 0; return false; }
        if (observedPresent_ == 0) { observedPresent_ = present; return false; }
        if (present <= observedPresent_) return false;
        reported_ = true;
        return true;
    }
    bool reported() const { return reported_; }
private:
    uint64_t observedPresent_ = 0;
    bool reported_ = false;
};

struct PipelineCacheIdentity {
    std::string app, build, shaders, adapter, driver, backend, abi;
    bool complete() const;
    std::string key() const;
};

struct PipelineCacheRead {
    // validated is ONLY an envelope result. Only the device owner can report backend acceptance.
    std::string outcome, reason;
    std::vector<uint8_t> bytes;
};
struct PipelineCacheWrite {
    std::string outcome, reason;
    size_t bytes = 0;
    double elapsedMs = 0;
    double snapshotMs = 0;
};

class PipelineCacheStore {
public:
    PipelineCacheStore(std::string directory, PipelineCacheIdentity identity);
    PipelineCacheRead read() const noexcept;
    PipelineCacheWrite write(const uint8_t* bytes, size_t size) const noexcept;
    const std::string& path() const { return path_; }
    const PipelineCacheIdentity& identity() const { return identity_; }
private:
    std::string directory_, path_;
    PipelineCacheIdentity identity_;
};

} // namespace mystral::webgpu
