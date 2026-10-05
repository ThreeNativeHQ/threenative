#include "check.h"
#include "threenative/abi/tn_abi.h"

#include <cstring>
#include <string>

namespace {

struct Diag {
    tn_diagnostic_t value{nullptr, 0};
    ~Diag() { tn_diagnostic_release(&value); }
    std::string message() const { return value.message ? value.message : ""; }
};

void version() {
    const tn_version_info_t own = tn_engine_version();
    {
        Diag d;
        tn_version_info_t engine{};
        CHECK(tn_version_handshake(&own, &engine, &d.value) == TN_OK);
        CHECK(std::memcmp(&engine, &own, sizeof own) == 0);
        CHECK(d.value.message == nullptr);
    }
    struct Case {
        void (*mutate)(tn_version_info_t&);
        uint32_t code;
        const char* name;
    };
    const Case cases[] = {
        {[](tn_version_info_t& v) { v.engine_abi += 1; }, TN_DIAG_ENGINE_ABI_MISMATCH, "TN_DIAG_ENGINE_ABI_MISMATCH"},
        {[](tn_version_info_t& v) { v.compatibility_contract += 1; }, TN_DIAG_CONTRACT_MISMATCH, "TN_DIAG_CONTRACT_MISMATCH"},
        {[](tn_version_info_t& v) { v.scene += 1; }, TN_DIAG_SCENE_MISMATCH, "TN_DIAG_SCENE_MISMATCH"},
        {[](tn_version_info_t& v) { v.shader_package += 1; }, TN_DIAG_SHADER_PACKAGE_MISMATCH, "TN_DIAG_SHADER_PACKAGE_MISMATCH"},
        {[](tn_version_info_t& v) { v.capability_digest ^= 1; }, TN_DIAG_CAPABILITY_MISMATCH, "TN_DIAG_CAPABILITY_MISMATCH"},
        {[](tn_version_info_t& v) { v.capability_count += 1; }, TN_DIAG_CAPABILITY_MISMATCH, "TN_DIAG_CAPABILITY_MISMATCH"},
        // Two fields differ: the first in the documented order is the one named.
        {[](tn_version_info_t& v) { v.scene += 1; v.engine_abi += 1; }, TN_DIAG_ENGINE_ABI_MISMATCH, "TN_DIAG_ENGINE_ABI_MISMATCH"},
    };
    for (const Case& c : cases) {
        tn_version_info_t module = own;
        c.mutate(module);
        Diag d;
        CHECK(tn_version_handshake(&module, nullptr, &d.value) == TN_ERROR_VERSION_MISMATCH);
        CHECK(d.value.code == c.code);
        CHECK(d.message().rfind(c.name, 0) == 0);
        // Rejected before start: no context exists for a mismatched module.
        tn_context_t* context = reinterpret_cast<tn_context_t*>(1);
        Diag d2;
        CHECK(tn_context_create(&context, &module, &d2.value) == TN_ERROR_VERSION_MISMATCH);
        CHECK(context == nullptr);
        CHECK(d2.value.code == c.code);
    }
}

void handles() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* a = nullptr;
    tn_context_t* b = nullptr;
    Diag d;
    CHECK(tn_context_create(&a, &own, &d.value) == TN_OK);
    CHECK(tn_context_create(&b, &own, &d.value) == TN_OK);
    CHECK(tn_type_id("Mesh") != 0);
    CHECK(tn_type_id("Mesh") != tn_type_id("Scene"));
    CHECK(tn_type_id("NotAThreeClass") == 0);
    CHECK(tn_type_id(nullptr) == 0);

    tn_handle_t mesh{};
    CHECK(tn_object_create(a, tn_type_id("Mesh"), &mesh, &d.value) == TN_OK);
    tn_handle_t forged = mesh;
    forged.type = tn_type_id("Scene");
    CHECK(tn_object_release(forged, &d.value) == TN_ERROR_WRONG_TYPE);
    tn_handle_t foreign = mesh;
    foreign.context = 999;
    CHECK(tn_object_release(foreign, &d.value) == TN_ERROR_INVALID_HANDLE);
    tn_handle_t outOfRange = mesh;
    outOfRange.index = 1u << 30;
    CHECK(tn_object_release(outOfRange, &d.value) == TN_ERROR_INVALID_HANDLE);
    CHECK(tn_object_release(mesh, &d.value) == TN_OK);
    CHECK(tn_object_release(mesh, &d.value) == TN_ERROR_STALE_HANDLE);   // stale generation
    tn_handle_t again{};
    CHECK(tn_object_create(a, tn_type_id("Mesh"), &again, &d.value) == TN_OK);
    CHECK(again.index == mesh.index && again.generation != mesh.generation);
    CHECK(tn_object_release(mesh, &d.value) == TN_ERROR_STALE_HANDLE);   // the old handle never reaches the new object
    CHECK(tn_object_create(a, 0, &again, &d.value) == TN_ERROR_WRONG_TYPE);
    CHECK(tn_object_create(a, 0xffff, &again, &d.value) == TN_ERROR_WRONG_TYPE);

    tn_handle_t inB{};
    CHECK(tn_object_create(b, tn_type_id("Scene"), &inB, &d.value) == TN_OK);
    CHECK(tn_context_destroy(b, &d.value) == TN_OK);
    CHECK(tn_object_release(inB, &d.value) == TN_ERROR_INVALID_HANDLE);   // its context is gone
    CHECK(tn_context_destroy(b, &d.value) == TN_ERROR_INVALID_STATE);     // destroyed twice: refused, not touched
    CHECK(tn_object_create(b, tn_type_id("Mesh"), &inB, &d.value) == TN_ERROR_INVALID_STATE);
    CHECK(tn_context_destroy(a, &d.value) == TN_OK);
    tn_diagnostic_t zero{nullptr, 0};
    tn_diagnostic_release(&zero);
    tn_diagnostic_release(nullptr);
}

}  // namespace

TN_TEST_MAIN({"version", version}, {"handles", handles})
