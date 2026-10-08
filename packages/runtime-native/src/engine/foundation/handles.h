#pragma once

#include <cstdint>
#include <vector>

namespace tn::engine {

/** The ABI handle (PRD-500): a slot index plus the identity that proves the slot is still it. */
struct Handle {
    uint16_t type = 0;
    uint16_t context = 0;
    uint32_t index = 0;
    uint32_t generation = 0;
};

enum class HandleError : uint8_t {
    None,
    Invalid,  // no such slot, or a zero type: never allocated by this table
    Context,  // allocated by another context's table
    Stale,    // the slot was released; its generation moved on
    Type,     // live, but of another type than the caller asked for
};

/**
 * Generational slots (PRD-502). A released slot bumps its generation before it can be reused, so a
 * retained handle to the old object is rejected instead of aliasing the new one. Single-threaded by
 * contract: the engine resolves handles on its own thread, and the Wasm build has no other.
 */
class HandleTable {
public:
    explicit HandleTable(uint16_t context) : context_(context) {}

    /** `type` 0 is reserved for "no type" and is refused with an Invalid handle back. */
    Handle allocate(uint16_t type);
    /** `expectedType` 0 accepts any live type. */
    HandleError check(Handle handle, uint16_t expectedType = 0) const;
    HandleError release(Handle handle);

    uint16_t context() const { return context_; }
    uint32_t liveCount() const { return live_; }
    uint32_t capacity() const { return static_cast<uint32_t>(slots_.size()); }

private:
    struct Slot {
        uint32_t generation = 1;  // never 0, so a zeroed handle is never live
        uint16_t type = 0;
        bool live = false;
    };

    uint16_t context_;
    std::vector<Slot> slots_;
    std::vector<uint32_t> free_;
    uint32_t live_ = 0;
};

}  // namespace tn::engine
