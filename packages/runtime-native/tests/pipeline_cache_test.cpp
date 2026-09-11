// PRD-368 filesystem contract. No GPU or mocked filesystem is involved.
#include "../src/webgpu/pipeline_cache.h"
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <thread>
#include <vector>
#ifndef _WIN32
#include <fcntl.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
using namespace mystral::webgpu;
namespace fs = std::filesystem;
static int checks = 0;
static void require(bool value, const char* message) {
    ++checks;
    if (!value) { std::cerr << "FAIL " << message << '\n'; std::exit(1); }
}
static PipelineCacheIdentity identity() {
    return {"test-app", "native-build", "bundled-shaders", "adapter-1", "driver-1", "vulkan", "wgpu25-cache1"};
}
int main() {
    require(pipelineCacheDigest("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "SHA-256 empty vector");
    require(pipelineCacheDigest("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 abc vector");
    require(pipelineCacheDigest(std::string(1000000, 'a')) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "SHA-256 multi-block vector");
#ifndef _WIN32
    char temporary[] = "/tmp/tn-pipeline-cache-XXXXXX";
    char* made = mkdtemp(temporary);
    require(made != nullptr, "temporary app-private directory");
    const fs::path root(made);
    PipelineCacheStore store(root.string(), identity());
    const std::vector<uint8_t> payload{0, 1, 2, 255, 4, 5};
    require(store.read().outcome == "missing", "missing cache compiles normally");
    require(store.write(payload.data(), payload.size()).outcome == "stored", "write bounded payload");
    auto read = store.read();
    require(read.outcome == "validated" && read.bytes == payload, "round trip exact opaque backend bytes");
    // The reader below runs in a distinct process, with no in-memory state from the writer.
    pid_t child = fork();
    require(child >= 0, "fork independent reader");
    if (child == 0) {
        PipelineCacheStore restarted(root.string(), identity());
        auto result = restarted.read();
        _exit(result.outcome == "validated" && result.bytes == payload ? 0 : 1);
    }
    int status = 0;
    waitpid(child, &status, 0);
    require(WIFEXITED(status) && WEXITSTATUS(status) == 0, "new process loads persisted bytes");
    for (int field = 0; field < 7; ++field) {
        auto changed = identity();
        std::string* fields[] = {&changed.app, &changed.build, &changed.shaders, &changed.adapter, &changed.driver, &changed.backend, &changed.abi};
        *fields[field] += "-changed";
        // App gets a separate directory; every other dimension invalidates the envelope.
        PipelineCacheStore foreign(root.string(), changed);
        require(foreign.read().outcome == (field == 0 ? "missing" : "rejected"), "all identity dimensions qualify the cache");
    }
    auto incomplete = identity(); incomplete.driver.clear();
    PipelineCacheStore unqualified(root.string(), incomplete);
    require(unqualified.read().outcome == "unavailable", "unknown driver cannot qualify persisted compiler bytes");
    require(unqualified.write(payload.data(), payload.size()).outcome != "stored", "unknown identity cannot be stored");
    // A payload bit flip must be rejected before the unsafe backend API sees anything.
    { std::fstream file(store.path(), std::ios::in | std::ios::out | std::ios::binary); file.seekp(-1, std::ios::end); file.put(7); }
    read = store.read();
    require(read.outcome == "rejected" && read.bytes.empty() && read.reason == "digest-mismatch", "corrupt payload is not ingested");
    require(store.write(payload.data(), payload.size()).outcome == "stored", "rebuild after corrupt cache");
    { std::ofstream file(store.path(), std::ios::binary | std::ios::app); file.put(0); }
    require(store.read().reason == "length-mismatch", "trailing data rejected");
    { std::ofstream file(store.path(), std::ios::binary | std::ios::trunc); file << "TNPC"; }
    require(store.read().outcome == "rejected", "truncated envelope rejected");
    { std::ofstream file(store.path(), std::ios::binary | std::ios::trunc); file.seekp(kPipelineCacheMaxBytes + 128); file.put(0); }
    require(store.read().reason == "oversized", "oversized input rejected before allocation");
    require(store.write(payload.data(), kPipelineCacheMaxBytes + 1).reason == "oversized", "oversized write rejected before reading caller memory");
    require(store.write(nullptr, 1).outcome != "stored", "null data refused");
    require(store.write(payload.data(), payload.size()).outcome == "stored", "restore valid old cache");
    // Kill a REAL write with RLIMIT_FSIZE before rename, not a simulated writer or callback.
    child = fork();
    require(child >= 0, "fork interrupted writer");
    if (child == 0) {
        signal(SIGXFSZ, SIG_DFL);
        rlimit limit{1024, 1024};
        if (setrlimit(RLIMIT_FSIZE, &limit) != 0) _exit(2);
        const std::vector<uint8_t> large(1024 * 1024, 42);
        store.write(large.data(), large.size());
        _exit(3);
    }
    waitpid(child, &status, 0);
    require(WIFSIGNALED(status) && WTERMSIG(status) == SIGXFSZ, "writer actually died during filesystem write");
    require(store.read().bytes == payload, "interrupted replacement preserves previous valid cache");
    require(store.write(payload.data(), payload.size()).outcome == "stored", "next write cleans interrupted temporary file");
    // Multiple real processes contend on one app's writer lock. Busy is safe, mixed bytes are not.
    std::vector<pid_t> children;
    for (int index = 0; index < 8; ++index) {
        child = fork();
        require(child >= 0, "fork concurrent writer");
        if (child == 0) {
            const std::vector<uint8_t> bytes(8192, static_cast<uint8_t>(index));
            const auto result = store.write(bytes.data(), bytes.size());
            _exit(result.outcome == "stored" || result.reason == "writer-busy" ? 0 : 1);
        }
        children.push_back(child);
    }
    for (auto pid : children) { waitpid(pid, &status, 0); require(WIFEXITED(status) && WEXITSTATUS(status) == 0, "concurrent writer stored or yielded"); }
    read = store.read();
    require(read.outcome == "validated" && read.bytes.size() == 8192, "concurrent replacement remains a complete envelope");
    for (auto byte : read.bytes) require(byte == read.bytes[0], "concurrent writes never interleave payloads");
    size_t files = 0; for (const auto& entry : fs::directory_iterator(fs::path(store.path()).parent_path())) { (void)entry; ++files; }
    require(files <= 2, "one cache and one lock bound per-app file count");
    // Refuse symlink/FIFO ingestion without following or blocking on them.
    fs::remove(store.path());
    fs::create_symlink(root / "unrelated", store.path());
    require(store.read().outcome == "rejected", "symlink cache rejected");
    fs::remove(store.path());
    require(mkfifo(store.path().c_str(), 0600) == 0, "make non-regular cache");
    require(store.read().outcome == "rejected", "FIFO rejected without blocking");
    fs::remove(store.path());
    require(store.write(payload.data(), payload.size()).outcome == "stored", "restore before permission control");
    const auto privateDir = fs::path(store.path()).parent_path();
    const auto movedDir = privateDir.string() + ".real";
    fs::rename(privateDir, movedDir);
    fs::create_directory_symlink(movedDir, privateDir);
    require(store.read().outcome == "rejected", "symlinked private cache directory rejected");
    fs::remove(privateDir);
    fs::rename(movedDir, privateDir);
    chmod(root.c_str(), 0755);
    const auto appDir = fs::path(store.path()).parent_path();
    chmod(appDir.c_str(), 0555);
    child = fork();
    require(child >= 0, "fork read-only storage control");
    if (child == 0) {
        if (geteuid() == 0 && setuid(65534) != 0) _exit(2);
        _exit(store.write(payload.data(), payload.size()).outcome != "stored" ? 0 : 1);
    }
    waitpid(child, &status, 0);
    require(WIFEXITED(status) && WEXITSTATUS(status) == 0, "unwritable storage never reports a store");
    chmod(appDir.c_str(), 0700);
    require(store.read().bytes == payload, "permission failure preserves valid cache");
    fs::remove_all(root);
#else
    std::cout << "filesystem persistence unavailable on Windows; backend remains unsupported\n";
#endif
    std::cout << "pipeline cache filesystem contract passed: " << checks << " checks\n";
}
