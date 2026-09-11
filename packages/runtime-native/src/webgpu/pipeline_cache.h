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
