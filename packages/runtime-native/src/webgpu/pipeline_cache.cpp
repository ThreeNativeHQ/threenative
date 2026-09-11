#include "pipeline_cache.h"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <limits>
#include <utility>
#ifndef _WIN32
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace mystral::webgpu {
namespace {

// SHA-256 over bytes, independent of host endianness. Used for corruption detection and identity,
// not authenticity: the containing directory must still be the host's app-private storage.
constexpr uint32_t kRound[] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
};
uint32_t rotate(uint32_t value, unsigned bits) { return (value >> bits) | (value << (32 - bits)); }
std::array<uint8_t, 32> digest(std::string_view bytes) {
    uint32_t hash[] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    const auto block = [&](const uint8_t* input) {
        uint32_t w[64]{};
        for (size_t i = 0; i < 16; ++i)
            for (size_t j = 0; j < 4; ++j) w[i] = (w[i] << 8) | input[i * 4 + j];
        for (size_t i = 16; i < 64; ++i) {
            const uint32_t a = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >> 3);
            const uint32_t b = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + a + w[i - 7] + b;
        }
        uint32_t a=hash[0], b=hash[1], c=hash[2], d=hash[3], e=hash[4], f=hash[5], g=hash[6], h=hash[7];
        for (size_t i = 0; i < 64; ++i) {
            const uint32_t s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const uint32_t choice = (e & f) ^ (~e & g);
            const uint32_t t1 = h + s1 + choice + kRound[i] + w[i];
            const uint32_t s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const uint32_t t2 = s0 + ((a & b) ^ (a & c) ^ (b & c));
            h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
        }
        hash[0]+=a; hash[1]+=b; hash[2]+=c; hash[3]+=d;
        hash[4]+=e; hash[5]+=f; hash[6]+=g; hash[7]+=h;
    };
    size_t offset = 0;
    while (bytes.size() - offset >= 64) {
        block(reinterpret_cast<const uint8_t*>(bytes.data() + offset)); offset += 64;
    }
    std::array<uint8_t, 128> tail{};
    const size_t remainder = bytes.size() - offset;
    if (remainder) std::memcpy(tail.data(), bytes.data() + offset, remainder);
    tail[remainder] = 0x80;
    const size_t padded = remainder < 56 ? 64 : 128;
    const uint64_t bits = static_cast<uint64_t>(bytes.size()) * 8;
    for (size_t i = 0; i < 8; ++i) tail[padded - 1 - i] = static_cast<uint8_t>(bits >> (i * 8));
    block(tail.data());
    if (padded == 128) block(tail.data() + 64);
    std::array<uint8_t, 32> result{};
    for (size_t i = 0; i < 8; ++i)
        for (size_t j = 0; j < 4; ++j) result[i * 4 + j] = static_cast<uint8_t>(hash[i] >> (24 - 8 * j));
    return result;
}
constexpr size_t kHeaderBytes = 80;
constexpr std::array<uint8_t, 8> kMagic{'T','N','P','C',0,0,0,1};
void encodeSize(uint8_t* into, uint64_t size) {
    for (size_t i = 0; i < 8; ++i) into[i] = static_cast<uint8_t>(size >> (8 * i));
}
uint64_t decodeSize(const uint8_t* from) {
    uint64_t size = 0;
    for (size_t i = 0; i < 8; ++i) size |= uint64_t(from[i]) << (8 * i);
    return size;
}
std::array<uint8_t, 32> identityDigest(const PipelineCacheIdentity& identity) {
    std::string encoded;
    for (const auto* field : {&identity.app, &identity.build, &identity.shaders, &identity.adapter,
                              &identity.driver, &identity.backend, &identity.abi}) {
        uint8_t length[8]; encodeSize(length, field->size());
        encoded.append(reinterpret_cast<const char*>(length), sizeof length);
        encoded += *field;
    }
    return digest(encoded);
}
std::string hex(const std::array<uint8_t, 32>& bytes) {
    constexpr char digits[] = "0123456789abcdef";
    std::string output; output.reserve(64);
    for (uint8_t byte : bytes) { output += digits[byte >> 4]; output += digits[byte & 15]; }
    return output;
}
#ifndef _WIN32
struct Descriptor {
    int fd;
    explicit Descriptor(int value) : fd(value) {}
    ~Descriptor() { if (fd >= 0) close(fd); }
    Descriptor(const Descriptor&) = delete;
    Descriptor& operator=(const Descriptor&) = delete;
};
bool readAll(int fd, uint8_t* bytes, size_t size) {
    size_t done = 0;
    while (done < size) {
        const ssize_t n = ::read(fd, bytes + done, size - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        done += static_cast<size_t>(n);
    }
    return true;
}
bool writeAll(int fd, const uint8_t* bytes, size_t size) {
    size_t done = 0;
    while (done < size) {
        const ssize_t n = ::write(fd, bytes + done, size - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        done += static_cast<size_t>(n);
    }
    return true;
}
#endif
} // namespace

std::string pipelineCacheDigest(std::string_view bytes) { return hex(digest(bytes)); }
bool PipelineCacheIdentity::complete() const {
    for (const auto* field : {&app, &build, &shaders, &adapter, &driver, &backend, &abi})
        if (field->empty() || field->size() > 4096) return false;
    return true;
}
std::string PipelineCacheIdentity::key() const { return hex(identityDigest(*this)); }
PipelineCacheStore::PipelineCacheStore(std::string directory, PipelineCacheIdentity identity)
    : identity_(std::move(identity)) {
    if (!directory.empty() && std::filesystem::path(directory).is_absolute()) {
        directory_ = (std::filesystem::path(directory) / "pipeline-cache-v1" / pipelineCacheDigest(identity_.app)).string();
        path_ = (std::filesystem::path(directory_) / "cache.bin").string();
    }
}

PipelineCacheRead PipelineCacheStore::read() const noexcept {
    try {
        if (path_.empty() || !identity_.complete()) return {"unavailable", "unqualified-identity", {}};
#ifdef _WIN32
        return {"unavailable", "unsupported-storage-platform", {}};
#else
        // Hold the private directory while opening the leaf. A symlinked app directory must not
        // redirect validation to another tree, and a FIFO must never block the startup thread.
        Descriptor directory(open(directory_.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
        if (directory.fd < 0) return {errno == ENOENT ? "missing" : "rejected", errno == ENOENT ? "not-found" : "directory-open-failed", {}};
        struct stat directoryInfo{};
        if (fstat(directory.fd, &directoryInfo) != 0 || directoryInfo.st_uid != geteuid() ||
            (directoryInfo.st_mode & 0022) != 0) return {"rejected", "non-private-directory", {}};
        Descriptor file(openat(directory.fd, "cache.bin", O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK));
        if (file.fd < 0) return {errno == ENOENT ? "missing" : "rejected", errno == ENOENT ? "not-found" : "open-failed", {}};
        struct stat info{};
        if (fstat(file.fd, &info) != 0 || !S_ISREG(info.st_mode)) return {"rejected", "not-regular", {}};
        if (info.st_uid != geteuid() || info.st_nlink != 1 || (info.st_mode & 0022) != 0)
            return {"rejected", "non-private-file", {}};
        if (info.st_size < static_cast<off_t>(kHeaderBytes)) return {"rejected", "truncated", {}};
        if (info.st_size > static_cast<off_t>(kHeaderBytes + kPipelineCacheMaxBytes)) return {"rejected", "oversized", {}};
        std::array<uint8_t, kHeaderBytes> header{};
        if (!readAll(file.fd, header.data(), header.size())) return {"rejected", "read-failed", {}};
        if (!std::equal(kMagic.begin(), kMagic.end(), header.begin())) return {"rejected", "version-mismatch", {}};
        const uint64_t size = decodeSize(header.data() + 8);
        if (size > kPipelineCacheMaxBytes) return {"rejected", "oversized", {}};
        if (size == 0 || size != static_cast<uint64_t>(info.st_size) - kHeaderBytes) return {"rejected", "length-mismatch", {}};
        const auto identity = identityDigest(identity_);
        if (!std::equal(identity.begin(), identity.end(), header.begin() + 16)) return {"rejected", "identity-mismatch", {}};
        std::vector<uint8_t> bytes(static_cast<size_t>(size));
        if (!readAll(file.fd, bytes.data(), bytes.size())) return {"rejected", "read-failed", {}};
        // Also catch a file extended after fstat. Atomic writers never mutate a published inode.
        uint8_t extra;
        if (::read(file.fd, &extra, 1) != 0) return {"rejected", "length-mismatch", {}};
        const auto payloadDigest = digest({reinterpret_cast<const char*>(bytes.data()), bytes.size()});
        if (!std::equal(payloadDigest.begin(), payloadDigest.end(), header.begin() + 48)) return {"rejected", "digest-mismatch", {}};
        return {"validated", "envelope-valid", std::move(bytes)};
#endif
    } catch (...) { return {"unavailable", "read-exception", {}}; }
}

PipelineCacheWrite PipelineCacheStore::write(const uint8_t* bytes, size_t size) const noexcept {
    const auto start = std::chrono::steady_clock::now();
    const auto result = [&](const char* outcome, const char* reason) {
        return PipelineCacheWrite{outcome, reason, std::strcmp(outcome, "stored") == 0 ? size : 0,
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count()};
    };
    try {
        if (size > kPipelineCacheMaxBytes) return result("rejected", "oversized");
        if (bytes == nullptr || size == 0) return result("rejected", "empty-payload");
        if (path_.empty() || !identity_.complete()) return result("unavailable", "unqualified-identity");
#ifdef _WIN32
        return result("unavailable", "unsupported-storage-platform");
#else
        std::error_code error;
        const bool created = std::filesystem::create_directories(directory_, error);
        if (error) return result("unavailable", "directory-failed");
        if (created && chmod(directory_.c_str(), 0700) != 0) return result("unavailable", "permissions-failed");
        Descriptor directory(open(directory_.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
        if (directory.fd < 0) return result("unavailable", "directory-open-failed");
        struct stat directoryInfo{};
        if (fstat(directory.fd, &directoryInfo) != 0 || directoryInfo.st_uid != geteuid() || (directoryInfo.st_mode & 0022))
            return result("unavailable", "directory-not-private");
        Descriptor lock(openat(directory.fd, "cache.lock", O_WRONLY | O_CREAT | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK, 0600));
        struct stat lockInfo{};
        if (lock.fd < 0 || fstat(lock.fd, &lockInfo) != 0 || !S_ISREG(lockInfo.st_mode) || lockInfo.st_nlink != 1)
            return result("unavailable", "lock-open-failed");
        if (flock(lock.fd, LOCK_EX | LOCK_NB) != 0) return result("unavailable", "writer-busy");
        // One fixed temporary name under the cross-process lock bounds crash leftovers, too.
        if (unlinkat(directory.fd, "cache.tmp", 0) != 0 && errno != ENOENT) return result("unavailable", "temporary-cleanup-failed");
        Descriptor temporary(openat(directory.fd, "cache.tmp", O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600));
        if (temporary.fd < 0) return result("unavailable", "temporary-open-failed");
        std::array<uint8_t, kHeaderBytes> header{};
        std::copy(kMagic.begin(), kMagic.end(), header.begin());
        encodeSize(header.data() + 8, size);
        const auto identity = identityDigest(identity_);
        const auto payloadDigest = digest({reinterpret_cast<const char*>(bytes), size});
        std::copy(identity.begin(), identity.end(), header.begin() + 16);
        std::copy(payloadDigest.begin(), payloadDigest.end(), header.begin() + 48);
        if (!writeAll(temporary.fd, header.data(), header.size()) || !writeAll(temporary.fd, bytes, size) || fsync(temporary.fd) != 0) {
            unlinkat(directory.fd, "cache.tmp", 0);
            return result("unavailable", "write-failed");
        }
        if (renameat(directory.fd, "cache.tmp", directory.fd, "cache.bin") != 0) {
            unlinkat(directory.fd, "cache.tmp", 0);
            return result("unavailable", "replace-failed");
        }
        if (fsync(directory.fd) != 0) return result("unavailable", "directory-sync-failed");
        return result("stored", "atomic-replacement");
#endif
    } catch (...) { return result("unavailable", "write-exception"); }
}
} // namespace mystral::webgpu
