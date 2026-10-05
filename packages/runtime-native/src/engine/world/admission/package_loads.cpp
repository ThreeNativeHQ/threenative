#include "engine/world/admission/package_loads.h"

#include <algorithm>
#include <fstream>
#include <iterator>
#include <utility>

namespace tn::engine::world {

namespace {

// The package codes by recovery: bytes that are wrong or need a missing decoder are skipped; a
// package cooked for another format version means the whole world was built for another engine.
Recovery recoveryOf(const std::string& code) { return code == "TN_PACKAGE_VERSION" ? Recovery::Fatal : Recovery::Skip; }

} // namespace

PackageLoads::PackageLoads(CompletionQueue& completions, GpuResources& gpu, uint32_t availableDecoders)
    : poster_(completions.poster()), gpu_(gpu), decoders_(availableDecoders) {}

PackageLoads::~PackageLoads() {
    for (std::thread& worker : workers_)
        worker.join();
    for (const auto& request : requests_)
        for (const LoadedEntry& entry : request->uploaded)
            gpu_.destroy(entry.resource);
}

uint64_t PackageLoads::load(std::string path, Done done) {
    const uint64_t id = ++nextId_;
    auto request = std::make_unique<Request>();
    request->id = id;
    request->path = path;
    request->done = std::move(done);
    requests_.push_back(std::move(request));
    workers_.emplace_back([this, id, path = std::move(path), poster = poster_]() mutable {
        // Worker thread: read and verify. Only the completion touches the request, on the game thread.
        auto bytes = std::make_shared<std::vector<uint8_t>>();
        std::optional<LoadError> error;
        assets::Package package;
        std::ifstream in(path, std::ios::binary);
        if (!in) {
            error = LoadError{"TN_WORLD_IO_UNAVAILABLE", "io", path, Recovery::Retry, "the file could not be opened"};
        } else {
            bytes->assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
            assets::PackageError failure;
            if (!assets::parsePackage(*bytes, package, failure) || !assets::verifyPackage(package, decoders_, failure))
                error = LoadError{failure.code, "assets", path, recoveryOf(failure.code), failure.detail};
        }
        poster.post([this, life = std::weak_ptr<int>(alive_), id, bytes, package = std::move(package),
                     error = std::move(error)]() mutable {
            if (life.expired())
                return; // these loads are gone; the world may still drain
            Request* request = find(id);
            if (!request)
                return; // cancelled while it was read
            if (error)
                return finish(id, LoadResult{{}, std::move(error)});
            request->bytes = std::move(bytes);
            request->package = std::move(package);
            request->verified = true;
        });
    });
    return id;
}

PackageLoads::Request* PackageLoads::find(uint64_t id) {
    for (const auto& request : requests_)
        if (request->id == id)
            return request.get();
    return nullptr;
}

std::vector<LoadedEntry> PackageLoads::uploaded(uint64_t id) const {
    for (const auto& request : requests_)
        if (request->id == id)
            return request->uploaded;
    return {};
}

void PackageLoads::cancel(uint64_t id) {
    const auto it = std::find_if(requests_.begin(), requests_.end(), [&](const auto& r) { return r->id == id; });
    if (it == requests_.end())
        return;
    // The handles die now; GpuResources keeps each GPU object until the submissions that may read it finish.
    for (const LoadedEntry& entry : (*it)->uploaded)
        gpu_.destroy(entry.resource);
    requests_.erase(it);
}

void PackageLoads::finish(uint64_t id, LoadResult result) {
    const auto it = std::find_if(requests_.begin(), requests_.end(), [&](const auto& r) { return r->id == id; });
    if (it == requests_.end())
        return;
    std::unique_ptr<Request> request = std::move(*it);
    requests_.erase(it);
    if (result.error)
        for (const LoadedEntry& entry : request->uploaded)
            gpu_.destroy(entry.resource); // a half load is no load
    request->done(std::move(result));
}

uint64_t PackageLoads::admit(uint64_t byteAllowance) {
    uint64_t spent = 0;
    for (std::size_t i = 0; i < requests_.size() && spent < byteAllowance;) {
        Request& request = *requests_[i];
        if (!request.verified) {
            ++i;
            continue;
        }
        bool failed = false, complete = false;
        while (spent < byteAllowance && request.next < request.package.entries.size()) {
            const assets::PackageEntry& entry = request.package.entries[request.next];
            assets::PackageError failure;
            if (!loadEntry(request.package, entry, gpu_, request.uploaded, failure)) {
                failed = true;
                finish(request.id,
                       LoadResult{{},
                                  LoadError{"TN_WORLD_UPLOAD_REFUSED", "gpu", request.path + "#" + entry.name,
                                            Recovery::Skip, failure.detail}});
                break;
            }
            spent += entry.size;
            ++request.next;
        }
        if (failed)
            continue; // finish removed it; the same index is now the next request
        complete = request.next == request.package.entries.size();
        if (complete) {
            LoadResult result{std::move(request.uploaded), std::nullopt};
            request.uploaded.clear();
            finish(request.id, std::move(result));
            continue;
        }
        ++i;
    }
    return spent;
}

} // namespace tn::engine::world
