#include "geometry_cache.h"

#include <algorithm>
#include <cstring>
#include <vector>

namespace tn::engine {

// GPU buffer writes are whole 4-byte words. A range is widened to words; a final partial word
// (an odd-count uint16 index buffer) goes up through a zero-padded copy, never dropped.
void GeometryCache::upload(Handle buffer, const BufferStore& store, uint64_t offset, uint64_t size) {
    const uint64_t begin = offset & ~uint64_t{3};
    const uint64_t end = std::min<uint64_t>(offset + size, store.byteLength());
    if (end <= begin) return;
    const uint64_t whole = (end - begin) & ~uint64_t{3};
    if (whole) gpu_.writeBuffer(buffer, begin, store.data() + begin, whole);
    if (const uint64_t tail = (end - begin) - whole) {
        uint8_t word[4] = {};
        std::memcpy(word, store.data() + begin + whole, tail);
        gpu_.writeBuffer(buffer, begin + whole, word, 4);
    }
    stats_.bytesUploaded += end - begin;
}

Handle GeometryCache::sync(BufferStore& store, uint32_t usage) {
    const uint64_t byteLength = (store.byteLength() + 3) & ~uint64_t{3};
    auto [it, isNew] = entries_.try_emplace(&store);
    Entry& e = it->second;
    // A resize reallocates: the old copy is retired and the whole store goes up again.
    if (!isNew && (e.byteLength != byteLength || e.epoch != store.epoch())) {
        gpu_.destroy(e.buffer);
        isNew = true;
    }
    if (isNew) {
        e.buffer = gpu_.createBuffer(byteLength == 0 ? 4 : byteLength, usage | WGPUBufferUsage_CopyDst);
        e.byteLength = byteLength;
        e.epoch = store.epoch();
        upload(e.buffer, store, 0, store.byteLength());
        ++stats_.fullUploads;
    } else if (store.version() != e.version) {
        const auto ranges = store.updateRanges();
        if (ranges.empty()) {
            upload(e.buffer, store, 0, store.byteLength());
            ++stats_.fullUploads;
        } else {
            const uint32_t elementSize = scalarSize(store.scalar());
            for (const UpdateRange& r : ranges) {
                upload(e.buffer, store, r.start * elementSize, r.count * elementSize);
                ++stats_.rangeUploads;
            }
        }
    } else {
        return e.buffer;  // the steady state: nothing moves
    }
    store.clearUpdateRanges();
    e.version = store.version();
    return e.buffer;
}

void GeometryCache::forget(const BufferStore& store) {
    const auto it = entries_.find(&store);
    if (it == entries_.end()) return;
    gpu_.destroy(it->second.buffer);
    entries_.erase(it);
}

}  // namespace tn::engine
