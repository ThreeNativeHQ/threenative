#pragma once

#include <cstdint>
#include <unordered_map>

#include <v8.h>

#include "threenative/abi/tn_abi.h"

namespace tn::adapters::v8adapter {

/**
 * The V8 game-runtime adapter (PRD-531): JS sees the engine's classes as ordinary constructors
 * (`new Vector3(1, 2, 3)`), built at install time from the engine's binding registry, and every
 * call goes through the C ABI. A JS wrapper holds its handle in an internal field — handles never
 * cross as JS numbers — and one wrapper exists per live handle, so `m.makeTranslation(...) === m`.
 * A collected wrapper releases its handle.
 */
class Adapter {
public:
    Adapter(v8::Isolate* isolate, tn_context_t* context);
    ~Adapter();
    Adapter(const Adapter&) = delete;
    Adapter& operator=(const Adapter&) = delete;

    /** Defines one constructor per registered class on `target` (a namespace object or global). */
    void install(v8::Local<v8::Context> context, v8::Local<v8::Object> target);

    /** The one wrapper for a handle, created on first sight. */
    v8::Local<v8::Value> wrap(tn_handle_t handle);
    /** The handle a wrapper holds; false for anything that is not an engine object. */
    bool unwrap(v8::Local<v8::Value> value, tn_handle_t& out) const;

    tn_context_t* context() const { return context_; }
    v8::Isolate* isolate() const { return isolate_; }
    size_t liveWrappers() const { return wrappers_.size(); }

private:
    struct Wrapper;
    static uint64_t key(tn_handle_t h) { return (uint64_t{h.index} << 32) | h.generation; }
    void forget(uint64_t key);

    v8::Isolate* isolate_;
    tn_context_t* context_;
    v8::Global<v8::ObjectTemplate> instanceTemplate_;
    std::unordered_map<uint16_t, v8::Global<v8::FunctionTemplate>> classes_;  // by catalog type id
    std::unordered_map<uint64_t, Wrapper*> wrappers_;
};

}  // namespace tn::adapters::v8adapter
