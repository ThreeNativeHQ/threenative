#pragma once

#include <cstdint>
#include <memory>
#include <set>
#include <string>
#include <unordered_map>

#include <v8.h>

#include "threenative/abi/tn_abi.h"

namespace tn::adapters::v8adapter {

class Tsl;

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

    /**
     * A safe point for callbacks (PRD-531): a wrapper whose object carries a JS callback is held
     * strongly while the object is attached (it has a parent), since the engine may still call it,
     * and weakly once detached. A detached object, its closure and the wrapper the closure captured
     * are then a plain JS cycle the collector reclaims, and the reclaimed wrapper releases the
     * object. The host calls this between frames.
     */
    void collect();
    /** An engine object passed into a call is held until the next safe point decides. */
    void holdIfCallback(tn_handle_t handle);

    /** The one wrapper for a handle, created on first sight. */
    v8::Local<v8::Value> wrap(tn_handle_t handle);
    /** The handle a wrapper holds; false for anything that is not an engine object. */
    bool unwrap(v8::Local<v8::Value> value, tn_handle_t& out) const;

    Tsl& tsl() const { return *tsl_; }

    tn_context_t* context() const { return context_; }
    v8::Isolate* isolate() const { return isolate_; }
    size_t liveWrappers() const { return wrappers_.size(); }

private:
    struct Wrapper;
    struct CallbackData;
    static uint64_t key(tn_handle_t h) { return (uint64_t{h.index} << 32) | h.generation; }
    void forget(uint64_t key);
    void track(Wrapper* wrapper, v8::Local<v8::Object> object);
    void strong(Wrapper* wrapper);
    void weak(Wrapper* wrapper);
    static tn_status_t invokeCallback(void* context, const tn_value_t* args, uint32_t count, char* error,
                                      uint32_t capacity);
    static void setCallback(const v8::FunctionCallbackInfo<v8::Value>& info);
    static void getCallback(const v8::FunctionCallbackInfo<v8::Value>& info);

    std::unique_ptr<Tsl> tsl_;
    v8::Isolate* isolate_;
    tn_context_t* context_;
    v8::Global<v8::ObjectTemplate> instanceTemplate_;
    std::unordered_map<uint16_t, v8::Global<v8::FunctionTemplate>> classes_;  // by catalog type id
    std::unordered_map<uint64_t, Wrapper*> wrappers_;
    std::set<Wrapper*> withCallbacks_;  // what collect() visits
    v8::Global<v8::Context> context_v8_;  // where callbacks run; set by install
    std::unordered_map<std::string, v8::Global<v8::Private>> callbackKeys_;  // by callback name
};

}  // namespace tn::adapters::v8adapter
