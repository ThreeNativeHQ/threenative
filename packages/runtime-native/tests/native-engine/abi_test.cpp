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

tn_value_t num(double n) {
    tn_value_t v{};
    v.kind = TN_VALUE_NUMBER;
    v.number = n;
    return v;
}
tn_value_t ref(tn_handle_t h) {
    tn_value_t v{};
    v.kind = TN_VALUE_HANDLE;
    v.handle = h;
    return v;
}
bool same(tn_handle_t a, tn_handle_t b) { return a.type == b.type && a.index == b.index && a.generation == b.generation; }

// The generic calls drive the same registry the differential fixtures prove.
void generic() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);

    const tn_value_t xyz[3] = {num(1), num(2), num(3)};
    tn_handle_t v{};
    CHECK(tn_construct(ctx, "Vector3", xyz, 3, &v, &d.value) == TN_OK);
    CHECK(v.type == tn_type_id("Vector3"));

    tn_handle_t m{};
    CHECK(tn_construct(ctx, "Matrix4", nullptr, 0, &m, &d.value) == TN_OK);
    tn_value_t result{};
    const tn_value_t offset[3] = {num(10), num(0), num(-5)};
    CHECK(tn_invoke(m, "makeTranslation", offset, 3, &result, &d.value) == TN_OK);
    CHECK(result.kind == TN_VALUE_HANDLE && same(result.handle, m));         // chaining returns self

    const tn_value_t byMatrix[1] = {ref(m)};
    CHECK(tn_invoke(v, "applyMatrix4", byMatrix, 1, &result, &d.value) == TN_OK);
    CHECK(tn_get(v, "x", &result, &d.value) == TN_OK);
    CHECK(result.kind == TN_VALUE_NUMBER && result.number == 11);
    CHECK(tn_get(v, "z", &result, &d.value) == TN_OK && result.number == -2);

    const tn_value_t seven = num(7);
    CHECK(tn_set(v, "y", &seven, &d.value) == TN_OK);
    CHECK(tn_get(v, "y", &result, &d.value) == TN_OK && result.number == 7);

    CHECK(tn_get(m, "elements", &result, &d.value) == TN_OK);
    CHECK(result.kind == TN_VALUE_NUMBERS && result.count == 16 && result.numbers[12] == 10);

    CHECK(tn_invoke(v, "clone", nullptr, 0, &result, &d.value) == TN_OK);  // a new object, a new handle
    CHECK(result.kind == TN_VALUE_HANDLE && !same(result.handle, v));
    tn_value_t copyX{};
    CHECK(tn_get(result.handle, "x", &copyX, &d.value) == TN_OK && copyX.number == 11);

    // Refusals are statuses with named reasons, never a crash or an exception across the ABI.
    CHECK(tn_invoke(v, "teleport", nullptr, 0, &result, &d.value) == TN_ERROR_UNSUPPORTED);
    CHECK(d.message().find("Vector3.teleport()") != std::string::npos);
    CHECK(tn_invoke(v, "applyMatrix4", nullptr, 0, &result, &d.value) == TN_ERROR_INVALID_ARGUMENT);
    const tn_value_t wrong[1] = {ref(v)};
    CHECK(tn_invoke(v, "applyMatrix4", wrong, 1, &result, &d.value) == TN_ERROR_UNSUPPORTED);  // a Vector3, not a Matrix4
    CHECK(tn_construct(ctx, "Spaceship", nullptr, 0, &v, &d.value) == TN_ERROR_UNSUPPORTED);

    tn_handle_t gone{};
    CHECK(tn_construct(ctx, "Vector3", nullptr, 0, &gone, &d.value) == TN_OK);
    CHECK(tn_object_release(gone, &d.value) == TN_OK);
    CHECK(tn_get(gone, "x", &result, &d.value) == TN_ERROR_INVALID_HANDLE);
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// PRD-508: the scene graph over the same generic calls, and the member alias a caller reads back as
// one object rather than a copy per read.
void scene() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);

    tn_handle_t parent{};
    tn_handle_t child{};
    CHECK(tn_construct(ctx, "Object3D", nullptr, 0, &parent, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "Object3D", nullptr, 0, &child, &d.value) == TN_OK);

    const tn_value_t offset[3] = {num(1), num(2), num(3)};
    CHECK(tn_set(parent, "position.x", &offset[0], &d.value) == TN_OK);
    CHECK(tn_set(parent, "position.y", &offset[1], &d.value) == TN_OK);
    CHECK(tn_set(parent, "position.z", &offset[2], &d.value) == TN_OK);
    const tn_value_t two = num(2);
    CHECK(tn_set(child, "position.y", &two, &d.value) == TN_OK);

    tn_value_t result{};
    CHECK(tn_invoke(parent, "add", nullptr, 0, &result, &d.value) == TN_ERROR_INVALID_ARGUMENT);
    const tn_value_t childRef = ref(child);
    CHECK(tn_invoke(parent, "add", &childRef, 1, &result, &d.value) == TN_OK);
    CHECK(result.kind == TN_VALUE_HANDLE && same(result.handle, parent));

    const tn_value_t force = num(1);
    CHECK(tn_invoke(parent, "updateMatrixWorld", &force, 1, &result, &d.value) == TN_OK);
    CHECK(tn_get(child, "matrixWorld.elements", &result, &d.value) == TN_OK);
    CHECK(result.kind == TN_VALUE_NUMBERS && result.count == 16);
    CHECK(result.numbers[12] == 1 && result.numbers[13] == 4 && result.numbers[14] == 3);

    // `mesh.position` is the member, not a copy: the same handle every time, and a write through it
    // is the object's own write.
    tn_value_t first{};
    tn_value_t second{};
    CHECK(tn_invoke(child, "position", nullptr, 0, &first, &d.value) == TN_OK);
    CHECK(tn_invoke(child, "position", nullptr, 0, &second, &d.value) == TN_OK);
    CHECK(first.kind == TN_VALUE_HANDLE && same(first.handle, second.handle));
    const tn_value_t forty = num(40);
    CHECK(tn_set(first.handle, "y", &forty, &d.value) == TN_OK);
    CHECK(tn_get(child, "position.y", &result, &d.value) == TN_OK);
    CHECK(result.number == 40);

    // The alias keeps the object alive, so releasing the object first does not dangle the alias.
    CHECK(tn_object_release(child, &d.value) == TN_OK);
    CHECK(tn_get(first.handle, "y", &result, &d.value) == TN_OK && result.number == 40);

    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

}  // namespace

TN_TEST_MAIN({"version", version}, {"handles", handles}, {"generic", generic}, {"scene", scene})
