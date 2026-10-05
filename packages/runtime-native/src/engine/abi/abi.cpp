// The N03 C ABI (PRD-500 phase 2): version handshake, contexts and generational object handles.
// Nothing here throws across the boundary and nothing here holds an STL type in a signature; every
// failure is a status code plus an owned diagnostic the caller releases.

#include "threenative/abi/tn_abi.h"

#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string_view>
#include <vector>

#include "engine/foundation/handles.h"

struct tn_context {
    explicit tn_context(uint16_t id) : objects(id) {}
    tn::engine::HandleTable objects;
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
        case tn::engine::HandleError::None: return ok(diagnostic);
        case tn::engine::HandleError::Stale:
            return report(diagnostic, TN_ERROR_STALE_HANDLE, 0, "TN_HANDLE_STALE: the slot was reclaimed");
        case tn::engine::HandleError::Type:
            return report(diagnostic, TN_ERROR_WRONG_TYPE, 0, "TN_HANDLE_TYPE: the handle names another type");
        case tn::engine::HandleError::Context:
        case tn::engine::HandleError::Invalid: break;
    }
    return report(diagnostic, TN_ERROR_INVALID_HANDLE, 0, "TN_HANDLE_INVALID: no such object");
}

void tn_diagnostic_release(tn_diagnostic_t* diagnostic) {
    if (!diagnostic) return;
    std::free(diagnostic->message);
    diagnostic->message = nullptr;
    diagnostic->code = 0;
}

}  // extern "C"
