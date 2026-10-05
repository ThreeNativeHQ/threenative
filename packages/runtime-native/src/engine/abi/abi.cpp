// The N03 C ABI (PRD-500 phase 2): version handshake, contexts and generational object handles.
// Nothing here throws across the boundary and nothing here holds an STL type in a signature; every
// failure is a status code plus an owned diagnostic the caller releases.

#include "threenative/abi/tn_abi.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "engine/abi/bindings.h"
#include "engine/foundation/handles.h"

#include <exception>
#include <string>

extern "C" uint16_t tn_type_id(const char* name);

// A context is also the binding Store of the generic calls: Ref values name handles, objects live
// in the slot their handle indexes.
struct tn_context : tn::binding::Store {
    explicit tn_context(uint16_t id) : objects(id) {}
    tn::engine::HandleTable objects;
    std::vector<tn::binding::Object> values;  // by handle index
    // (address, class) -> the one handle naming it: member aliases and shared objects. The class is
    // part of the key because a first member shares its owner's address (Box3::min).
    std::map<std::pair<const void*, std::string>, tn_handle_t> identities_;
    std::unordered_map<const void*, tn_handle_t> primary_;  // an object's own handle, by address
    std::unordered_map<const void*, std::shared_ptr<void>> owners_;  // an object pointer -> its record
    std::string scratchText;                  // a returned string, valid until the next call
    std::vector<double> scratchNumbers;       // a returned array, valid until the next call

    static std::string refText(tn_handle_t h) {
        return "h" + std::to_string(h.type) + ":" + std::to_string(h.index) + ":" + std::to_string(h.generation);
    }
    bool decode(const std::string& text, tn_handle_t& out) const {
        unsigned type = 0, index = 0, generation = 0;
        if (std::sscanf(text.c_str(), "h%u:%u:%u", &type, &index, &generation) != 3) return false;
        out = tn_handle_t{static_cast<uint16_t>(type), objects.context(), index, generation};
        return true;
    }
    tn::binding::Object* object(tn_handle_t h) {
        const tn::engine::Handle handle{h.type, h.context, h.index, h.generation};
        if (objects.check(handle) != tn::engine::HandleError::None || h.index >= values.size()) return nullptr;
        tn::binding::Object& o = values[h.index];
        return o.ptr ? &o : nullptr;
    }
    tn::binding::Object* find(const tn::binding::Value& arg) override {
        tn_handle_t h{};
        return arg.kind == tn::binding::Value::Kind::Ref && decode(arg.text, h) ? object(h) : nullptr;
    }
    tn::binding::Value adopt(std::string cls, std::shared_ptr<void> ptr) override {
        tn_handle_t h{};
        if (!hold(std::move(cls), std::move(ptr), h)) throw tn::binding::Unsupported{"the catalog publishes no such class"};
        return tn::binding::Value{tn::binding::Value::Kind::Ref, 0, refText(h)};
    }
    tn::binding::Value adoptAlias(std::string cls, void* member, void* owner) override {
        const auto held = owners_.find(owner);
        if (held == owners_.end()) throw tn::binding::Unsupported{"this object is not one the caller owns"};
        // One handle per member address, so `object.position` is the same handle on every call. The
        // aliasing shared_ptr keeps the owner alive, so releasing the owner's handle first is safe.
        return identity(std::move(cls), std::shared_ptr<void>(held->second, member), false);
    }
    tn::binding::Value share(std::string cls, std::shared_ptr<void> shared) override {
        if (!shared) return tn::binding::Value{};
        // An object the caller already holds answers its own handle (`mesh.geometry` is the
        // BoxGeometry it was built from), whatever class name the asking binding knows it by.
        if (const auto known = primary_.find(shared.get()); known != primary_.end() && object(known->second) != nullptr) {
            return tn::binding::Value{tn::binding::Value::Kind::Ref, 0, refText(known->second)};
        }
        return identity(std::move(cls), std::move(shared), true);
    }
    // The cached handle while its object lives; a released handle is replaced, never reused.
    tn::binding::Value identity(std::string cls, std::shared_ptr<void> ptr, bool primary) {
        const auto key = std::make_pair(static_cast<const void*>(ptr.get()), cls);
        const auto cached = identities_.find(key);
        if (cached != identities_.end() && object(cached->second) != nullptr) {
            return tn::binding::Value{tn::binding::Value::Kind::Ref, 0, refText(cached->second)};
        }
        tn_handle_t h{};
        if (!hold(std::move(cls), std::move(ptr), h, primary)) throw tn::binding::Unsupported{"the catalog publishes no such class"};
        identities_[key] = h;
        return tn::binding::Value{tn::binding::Value::Kind::Ref, 0, refText(h)};
    }
    std::vector<double> numbers(const tn::binding::Value& arg) override {
        return arg.kind == tn::binding::Value::Kind::Numbers ? arg.numbers : std::vector<double>{};
    }
    // `primary`: the handle names the object itself, not a member alias at the same address.
    bool hold(std::string cls, std::shared_ptr<void> ptr, tn_handle_t& out, bool primary = true) {
        const uint16_t type = tn_type_id(cls.c_str());
        if (type == 0) return false;
        const tn::engine::Handle h = objects.allocate(type);
        if (values.size() <= h.index) values.resize(h.index + 1);
        owners_[ptr.get()] = ptr;
        values[h.index] = tn::binding::Object{std::move(cls), std::move(ptr)};
        out = tn_handle_t{h.type, h.context, h.index, h.generation};
        if (primary) primary_[values[h.index].ptr.get()] = out;
        return true;
    }
};

namespace {

struct TypeEntry {
    std::string_view name;
    uint16_t id;
};

constexpr TypeEntry kTypes[] = {
#define TN_CATALOG_TYPE(name, id) {name, id},
#include "catalog_types.inc"
#undef TN_CATALOG_TYPE
};
constexpr uint16_t kTypeCount = sizeof(kTypes) / sizeof(kTypes[0]);

// Context ids are the handle's `context` field: slot i holds context id i + 1; 0 is never valid.
// ponytail: single-threaded registry, as the engine thread owns the ABI; lock it when a second
// thread is allowed to call in.
std::vector<std::unique_ptr<tn_context>>& registry() {
    static std::vector<std::unique_ptr<tn_context>> contexts;
    return contexts;
}

tn_status_t report(tn_diagnostic_t* diagnostic, tn_status_t status, uint32_t code, const char* message) {
    if (diagnostic) {
        tn_diagnostic_release(diagnostic);  // a reused diagnostic never leaks its previous message
        diagnostic->code = code;
        const size_t length = std::strlen(message);
        diagnostic->message = static_cast<char*>(std::malloc(length + 1));
        if (diagnostic->message) std::memcpy(diagnostic->message, message, length + 1);
    }
    return status;
}

tn_status_t ok(tn_diagnostic_t* diagnostic) {
    tn_diagnostic_release(diagnostic);
    return TN_OK;
}

tn_context* contextFor(uint16_t id) {
    auto& contexts = registry();
    return id == 0 || id > contexts.size() ? nullptr : contexts[id - 1].get();
}

}  // namespace

extern "C" {

tn_version_info_t tn_engine_version(void) {
    return tn_version_info_t{TN_CAPABILITY_DIGEST,       TN_ENGINE_ABI_VERSION, TN_COMPATIBILITY_CONTRACT_VERSION,
                             TN_SCENE_VERSION,          TN_SHADER_PACKAGE_VERSION, TN_CAPABILITY_COUNT, 0};
}

tn_status_t tn_version_handshake(const tn_version_info_t* module, tn_version_info_t* engine,
                                 tn_diagnostic_t* diagnostic) {
    const tn_version_info_t own = tn_engine_version();
    if (engine) *engine = own;
    if (!module) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: no module version info");
    if (module->engine_abi != own.engine_abi) {
        return report(diagnostic, TN_ERROR_VERSION_MISMATCH, TN_DIAG_ENGINE_ABI_MISMATCH,
                      "TN_DIAG_ENGINE_ABI_MISMATCH: the module was built against another engine ABI");
    }
    if (module->compatibility_contract != own.compatibility_contract) {
        return report(diagnostic, TN_ERROR_VERSION_MISMATCH, TN_DIAG_CONTRACT_MISMATCH,
                      "TN_DIAG_CONTRACT_MISMATCH: the module expects another compatibility contract");
    }
    if (module->scene != own.scene) {
        return report(diagnostic, TN_ERROR_VERSION_MISMATCH, TN_DIAG_SCENE_MISMATCH,
                      "TN_DIAG_SCENE_MISMATCH: the module's serialized scene version differs");
    }
    if (module->shader_package != own.shader_package) {
        return report(diagnostic, TN_ERROR_VERSION_MISMATCH, TN_DIAG_SHADER_PACKAGE_MISMATCH,
                      "TN_DIAG_SHADER_PACKAGE_MISMATCH: the module's shader packages are another version");
    }
    if (module->capability_count != own.capability_count || module->capability_digest != own.capability_digest) {
        return report(diagnostic, TN_ERROR_VERSION_MISMATCH, TN_DIAG_CAPABILITY_MISMATCH,
                      "TN_DIAG_CAPABILITY_MISMATCH: the module was built against another capability set");
    }
    return ok(diagnostic);
}

tn_status_t tn_context_create(tn_context_t** out_context, const tn_version_info_t* module,
                              tn_diagnostic_t* diagnostic) {
    if (!out_context) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: no out_context");
    *out_context = nullptr;
    const tn_status_t handshake = tn_version_handshake(module, nullptr, diagnostic);
    if (handshake != TN_OK) return handshake;
    auto& contexts = registry();
    size_t slot = 0;
    while (slot < contexts.size() && contexts[slot]) ++slot;
    if (slot >= 0xffff) return report(diagnostic, TN_ERROR_OUT_OF_MEMORY, 0, "TN_ABI_CONTEXTS: no free context id");
    // Plain new under a catch, not nothrow new: clang 23's libFuzzer runtime pairs nothrow new with
    // free and reports a false alloc-dealloc mismatch (reproduced with no engine code, 2026-10-04).
    std::unique_ptr<tn_context> context;
    try {
        context = std::make_unique<tn_context>(static_cast<uint16_t>(slot + 1));
        if (slot == contexts.size()) contexts.emplace_back();
    } catch (const std::bad_alloc&) {
        return report(diagnostic, TN_ERROR_OUT_OF_MEMORY, 0, "TN_ABI_OOM: context");
    }
    *out_context = context.get();
    contexts[slot] = std::move(context);
    return ok(diagnostic);
}

tn_status_t tn_context_destroy(tn_context_t* context, tn_diagnostic_t* diagnostic) {
    auto& contexts = registry();
    if (!context) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: no context");
    // Found by address, never dereferenced first: a destroyed or foreign pointer is refused.
    for (auto& slot : contexts) {
        if (slot.get() != context) continue;
        slot.reset();
        return ok(diagnostic);
    }
    return report(diagnostic, TN_ERROR_INVALID_STATE, 0, "TN_ABI_CONTEXT: not a live context");
}

uint16_t tn_type_id(const char* name) {
    if (!name) return 0;
    const std::string_view wanted(name);
    for (const TypeEntry& entry : kTypes) {
        if (entry.name == wanted) return entry.id;
    }
    return 0;
}

tn_status_t tn_object_create(tn_context_t* context, uint16_t type, tn_handle_t* out_object,
                             tn_diagnostic_t* diagnostic) {
    if (!context || !out_object) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: context or out_object");
    *out_object = tn_handle_t{0, 0, 0, 0};
    bool live = false;
    for (const auto& slot : registry()) live = live || slot.get() == context;
    if (!live) return report(diagnostic, TN_ERROR_INVALID_STATE, 0, "TN_ABI_CONTEXT: not a live context");
    if (type == 0 || type > kTypeCount) {
        return report(diagnostic, TN_ERROR_WRONG_TYPE, 0, "TN_ABI_TYPE: the catalog publishes no such type");
    }
    const tn::engine::Handle handle = context->objects.allocate(type);
    *out_object = tn_handle_t{handle.type, handle.context, handle.index, handle.generation};
    return ok(diagnostic);
}

tn_status_t tn_object_release(tn_handle_t object, tn_diagnostic_t* diagnostic) {
    tn_context* context = contextFor(object.context);
    if (!context) return report(diagnostic, TN_ERROR_INVALID_HANDLE, 0, "TN_HANDLE_CONTEXT: no live context owns this handle");
    const tn::engine::Handle handle{object.type, object.context, object.index, object.generation};
    switch (context->objects.release(handle)) {
        case tn::engine::HandleError::None:
            if (object.index < context->values.size()) {
                tn::binding::Object& slot = context->values[object.index];
                // An alias of one of its members still holds the object, so the record outlives the
                // handle that named it; the aliasing shared_ptr is what keeps it alive.
                if (slot.ptr) context->owners_.erase(slot.ptr.get());
                slot = tn::binding::Object{};
            }
            return ok(diagnostic);
        case tn::engine::HandleError::Stale:
            return report(diagnostic, TN_ERROR_STALE_HANDLE, 0, "TN_HANDLE_STALE: the slot was reclaimed");
        case tn::engine::HandleError::Type:
            return report(diagnostic, TN_ERROR_WRONG_TYPE, 0, "TN_HANDLE_TYPE: the handle names another type");
        case tn::engine::HandleError::Context:
        case tn::engine::HandleError::Invalid: break;
    }
    return report(diagnostic, TN_ERROR_INVALID_HANDLE, 0, "TN_HANDLE_INVALID: no such object");
}

}  // extern "C"

namespace {

const tn::binding::Registry& classRegistry() {
    static const tn::binding::Registry classes = [] {
        tn::binding::Registry r;
        tn::binding::registerAll(r);
        return r;
    }();
    return classes;
}

bool toBinding(tn_context* context, const tn_value_t* in, uint32_t count, tn::binding::Args& out) {
    using Kind = tn::binding::Value::Kind;
    for (uint32_t i = 0; i < count; ++i) {
        const tn_value_t& v = in[i];
        switch (v.kind) {
            case TN_VALUE_NULL: out.push_back({}); break;
            case TN_VALUE_NUMBER: out.push_back(tn::binding::Value::of(v.number)); break;
            case TN_VALUE_BOOL: out.push_back(tn::binding::Value::of(v.boolean != 0)); break;
            case TN_VALUE_STRING:
                out.push_back(tn::binding::Value{Kind::String, 0, std::string(v.text ? v.text : "", v.text ? v.count : 0)});
                break;
            case TN_VALUE_HANDLE:
                // A handle from another context is not resolvable here; it arrives as an unknown ref.
                out.push_back(tn::binding::Value{Kind::Ref, 0,
                                                 v.handle.context == context->objects.context() ? tn_context::refText(v.handle) : "x"});
                break;
            case TN_VALUE_NUMBERS:
                if (!v.numbers && v.count) return false;
                out.push_back(tn::binding::Value::list(std::vector<double>(v.numbers, v.numbers + v.count)));
                break;
            default: return false;
        }
    }
    return true;
}

void fromBinding(tn_context* context, tn_handle_t self, const tn::binding::Value& in, tn_value_t* out) {
    using Kind = tn::binding::Value::Kind;
    *out = tn_value_t{};
    switch (in.kind) {
        case Kind::Null: break;
        case Kind::Number: out->kind = TN_VALUE_NUMBER; out->number = in.number; break;
        case Kind::Bool: out->kind = TN_VALUE_BOOL; out->boolean = in.flag ? 1 : 0; break;
        case Kind::String:
            context->scratchText = in.text;
            out->kind = TN_VALUE_STRING;
            out->text = context->scratchText.c_str();
            out->count = context->scratchText.size();
            break;
        case Kind::Numbers:
            context->scratchNumbers = in.numbers;
            out->kind = TN_VALUE_NUMBERS;
            out->numbers = context->scratchNumbers.data();
            out->count = context->scratchNumbers.size();
            break;
        case Kind::Ref:
            out->kind = TN_VALUE_HANDLE;
            if (in.text == "\x01self") out->handle = self;
            else context->decode(in.text, out->handle);
            break;
    }
}

// Every binding throw stops here: Unsupported becomes TN_ERROR_UNSUPPORTED with its reason,
// anything else (a missing argument) TN_ERROR_INVALID_ARGUMENT. Nothing unwinds into C.
template <typename Call>
tn_status_t guarded(tn_diagnostic_t* diagnostic, Call call) {
    try {
        return call();
    } catch (const tn::binding::Unsupported& u) {
        return report(diagnostic, TN_ERROR_UNSUPPORTED, 0, ("TN_NATIVE_UNSUPPORTED " + u.reason).c_str());
    } catch (const std::exception& e) {
        return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, (std::string("TN_ABI_ARGUMENT ") + e.what()).c_str());
    }
}

tn_status_t selfObject(tn_handle_t self, tn_context*& context, tn::binding::Object*& object, tn_diagnostic_t* diagnostic) {
    context = contextFor(self.context);
    object = context ? context->object(self) : nullptr;
    if (!object) return report(diagnostic, TN_ERROR_INVALID_HANDLE, 0, "TN_HANDLE_INVALID: no live object");
    return TN_OK;
}

}  // namespace

extern "C" {

tn_status_t tn_construct(tn_context_t* context, const char* class_name, const tn_value_t* args, uint32_t arg_count,
                         tn_handle_t* out_object, tn_diagnostic_t* diagnostic) {
    if (!context || !class_name || !out_object || (arg_count && !args)) {
        return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: context, class, args or out_object");
    }
    *out_object = tn_handle_t{};
    const auto cls = classRegistry().find(class_name);
    if (cls == classRegistry().end() || !cls->second.ctor) {
        return report(diagnostic, TN_ERROR_UNSUPPORTED, 0, (std::string("TN_NATIVE_UNSUPPORTED class ") + class_name).c_str());
    }
    return guarded(diagnostic, [&]() -> tn_status_t {
        tn::binding::Args in;
        if (!toBinding(context, args, arg_count, in)) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_VALUE: bad value kind");
        if (!context->hold(class_name, cls->second.ctor(in, *context), *out_object)) {
            return report(diagnostic, TN_ERROR_UNSUPPORTED, 0, (std::string("TN_NATIVE_UNSUPPORTED catalog class ") + class_name).c_str());
        }
        return ok(diagnostic);
    });
}

tn_status_t tn_invoke(tn_handle_t self, const char* method, const tn_value_t* args, uint32_t arg_count, tn_value_t* result,
                      tn_diagnostic_t* diagnostic) {
    tn_context* context = nullptr;
    tn::binding::Object* object = nullptr;
    if (!method || !result || (arg_count && !args)) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: method, args or result");
    if (const tn_status_t s = selfObject(self, context, object, diagnostic); s != TN_OK) return s;
    const auto& methods = classRegistry().at(object->cls).methods;
    const auto m = methods.find(method);
    if (m == methods.end()) {
        return report(diagnostic, TN_ERROR_UNSUPPORTED, 0, ("TN_NATIVE_UNSUPPORTED " + object->cls + "." + method + "()").c_str());
    }
    return guarded(diagnostic, [&]() -> tn_status_t {
        tn::binding::Args in;
        if (!toBinding(context, args, arg_count, in)) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_VALUE: bad value kind");
        void* target = object->ptr.get();
        fromBinding(context, self, m->second(target, in, *context), result);
        return ok(diagnostic);
    });
}

tn_status_t tn_get(tn_handle_t self, const char* path, tn_value_t* result, tn_diagnostic_t* diagnostic) {
    tn_context* context = nullptr;
    tn::binding::Object* object = nullptr;
    if (!path || !result) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: path or result");
    if (const tn_status_t s = selfObject(self, context, object, diagnostic); s != TN_OK) return s;
    const tn::binding::ClassBinding& binding = classRegistry().at(object->cls);
    const auto g = binding.getters.find(path);
    const auto m = binding.members.find(path);
    if (g == binding.getters.end() && m == binding.members.end())
        return report(diagnostic, TN_ERROR_UNSUPPORTED, 0, ("TN_NATIVE_UNSUPPORTED " + object->cls + "." + path).c_str());
    return guarded(diagnostic, [&]() -> tn_status_t {
        void* ptr = object->ptr.get();
        fromBinding(context, self, g != binding.getters.end() ? g->second(ptr) : m->second(ptr, {}, *context), result);
        return ok(diagnostic);
    });
}

tn_status_t tn_set(tn_handle_t self, const char* path, const tn_value_t* value, tn_diagnostic_t* diagnostic) {
    tn_context* context = nullptr;
    tn::binding::Object* object = nullptr;
    if (!path || !value) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_NULL: path or value");
    if (const tn_status_t s = selfObject(self, context, object, diagnostic); s != TN_OK) return s;
    const auto& setters = classRegistry().at(object->cls).setters;
    const auto st = setters.find(path);
    if (st == setters.end()) return report(diagnostic, TN_ERROR_UNSUPPORTED, 0, ("TN_NATIVE_UNSUPPORTED " + object->cls + "." + path + " is not settable").c_str());
    return guarded(diagnostic, [&]() -> tn_status_t {
        tn::binding::Args in;
        if (!toBinding(context, value, 1, in)) return report(diagnostic, TN_ERROR_INVALID_ARGUMENT, 0, "TN_ABI_VALUE: bad value kind");
        st->second(object->ptr.get(), in[0], *context);
        return ok(diagnostic);
    });
}

void tn_diagnostic_release(tn_diagnostic_t* diagnostic) {
    if (!diagnostic) return;
    std::free(diagnostic->message);
    diagnostic->message = nullptr;
    diagnostic->code = 0;
}

}  // extern "C"
