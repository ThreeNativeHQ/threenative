#include "check.h"
#include "threenative/abi/tn_abi.h"
#include "engine/abi/abi_internal.h"
#include "engine/abi/pooled_shared.h"
#include "engine/scene/object3d.h"
#include "engine/scene/nodes.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <stdexcept>

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
tn_value_t boolean(bool b) {
    tn_value_t v{};
    v.kind = TN_VALUE_BOOL;
    v.boolean = b ? 1 : 0;
    return v;
}
std::string text(const tn_value_t& v) { return std::string(v.text, v.count); }
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
    CHECK(tn_get(child, "position", &first, &d.value) == TN_OK);
    CHECK(tn_get(child, "position", &second, &d.value) == TN_OK);
    CHECK(first.kind == TN_VALUE_HANDLE && same(first.handle, second.handle));
    const tn_value_t forty = num(40);
    CHECK(tn_set(first.handle, "y", &forty, &d.value) == TN_OK);
    CHECK(tn_get(child, "position.y", &result, &d.value) == TN_OK);
    CHECK(result.number == 40);

    // The alias keeps the object alive, so releasing the object first does not dangle the alias.
    CHECK(tn_object_release(child, &d.value) == TN_OK);
    CHECK(tn_get(first.handle, "y", &result, &d.value) == TN_OK && result.number == 40);

    // PRD-514: Scene.background is a typed Color member; null clears it.
    tn_handle_t stage{};
    tn_handle_t background{};
    CHECK(tn_construct(ctx, "Scene", nullptr, 0, &stage, &d.value) == TN_OK);
    const tn_value_t bg[3] = {num(0.05), num(0.06), num(0.08)};
    CHECK(tn_construct(ctx, "Color", bg, 3, &background, &d.value) == TN_OK);
    const tn_value_t bgRef = ref(background);
    CHECK(tn_set(stage, "background", &bgRef, &d.value) == TN_OK);
    tn_value_t alias{};
    CHECK(tn_get(stage, "background", &alias, &d.value) == TN_OK && alias.kind == TN_VALUE_HANDLE);
    CHECK(tn_get(alias.handle, "g", &result, &d.value) == TN_OK && result.number == 0.06);
    const tn_value_t empty{};
    CHECK(tn_set(stage, "background", &empty, &d.value) == TN_OK);
    CHECK(tn_get(stage, "background", &result, &d.value) == TN_OK && result.kind == TN_VALUE_NULL);
    CHECK(tn_object_release(background, &d.value) == TN_OK);
    CHECK(tn_object_release(stage, &d.value) == TN_OK);

    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// PRD-508 phase 3: a catalogued class whose registry lacks a member refuses it by name, so an
// uncatalogued method is a status a caller can read, never a crash.
void unsupported_member() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);

    tn_handle_t geometry{};
    CHECK(tn_construct(ctx, "BufferGeometry", nullptr, 0, &geometry, &d.value) == TN_OK);
    tn_value_t result{};
    CHECK(tn_invoke(geometry, "computeBoundingVolume", nullptr, 0, &result, &d.value) == TN_ERROR_UNSUPPORTED);
    CHECK(d.message().find("TN_NATIVE_UNSUPPORTED") != std::string::npos);
    CHECK(d.message().find("BufferGeometry.computeBoundingVolume()") != std::string::npos);
    CHECK(tn_get(geometry, "attributes.tangent.array", &result, &d.value) == TN_ERROR_UNSUPPORTED);
    CHECK(d.message().find("TN_NATIVE_UNSUPPORTED") != std::string::npos);
    CHECK(tn_object_release(geometry, &d.value) == TN_OK);
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// PRD-514: the material classes over the generic calls. A whole-color write reaches the Store, and
// the Color member is one alias Ref, as the fixture driver proves too.
void material() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);

    tn_handle_t basic{};
    CHECK(tn_construct(ctx, "MeshBasicMaterial", nullptr, 0, &basic, &d.value) == TN_OK);
    tn_value_t result{};
    CHECK(tn_get(basic, "type", &result, &d.value) == TN_OK);
    CHECK(result.kind == TN_VALUE_STRING && text(result) == "MeshBasicMaterial");
    CHECK(tn_get(basic, "transparent", &result, &d.value) == TN_OK && result.boolean == 0);
    CHECK(tn_get(basic, "opacity", &result, &d.value) == TN_OK && result.number == 1);

    // A parameters object is out of scope; the no-argument constructor is the only one.
    const tn_value_t one = num(1);
    tn_handle_t refused{};
    CHECK(tn_construct(ctx, "MeshBasicMaterial", &one, 1, &refused, &d.value) == TN_ERROR_UNSUPPORTED);
    CHECK(d.message().find("TN_NATIVE_UNSUPPORTED") != std::string::npos);

    // `material.color = ref` copies through the Store; the member reads back as one alias Ref.
    tn_handle_t paint{};
    const tn_value_t rgb[3] = {num(0.2), num(0.4), num(0.6)};
    CHECK(tn_construct(ctx, "Color", rgb, 3, &paint, &d.value) == TN_OK);
    const tn_value_t paintRef = ref(paint);
    CHECK(tn_set(basic, "color", &paintRef, &d.value) == TN_OK);
    CHECK(tn_get(basic, "color.g", &result, &d.value) == TN_OK && result.number == 0.4);

    tn_value_t first{};
    tn_value_t second{};
    CHECK(tn_get(basic, "color", &first, &d.value) == TN_OK);
    CHECK(tn_get(basic, "color", &second, &d.value) == TN_OK);
    CHECK(first.kind == TN_VALUE_HANDLE && same(first.handle, second.handle));
    const tn_value_t nine = num(0.9);
    CHECK(tn_set(first.handle, "r", &nine, &d.value) == TN_OK);
    CHECK(tn_get(basic, "color.r", &result, &d.value) == TN_OK && result.number == 0.9);

    const tn_value_t yes = boolean(true);
    CHECK(tn_set(basic, "needsUpdate", &yes, &d.value) == TN_OK);
    CHECK(tn_object_release(basic, &d.value) == TN_OK);
    CHECK(tn_object_release(paint, &d.value) == TN_OK);
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// PRD-514: a light takes a hex number through ColorManagement, inherits Object3D's bindings, and a
// DirectionalLight's target is an Object3D member alias.
void light() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);

    tn_handle_t directional{};
    const tn_value_t args[2] = {num(16777215), num(3)};
    CHECK(tn_construct(ctx, "DirectionalLight", args, 2, &directional, &d.value) == TN_OK);
    tn_value_t result{};
    CHECK(tn_get(directional, "type", &result, &d.value) == TN_OK && text(result) == "DirectionalLight");
    CHECK(tn_get(directional, "intensity", &result, &d.value) == TN_OK && result.number == 3);
    CHECK(tn_get(directional, "position.y", &result, &d.value) == TN_OK && result.number == 1);  // DEFAULT_UP
    CHECK(tn_get(directional, "target", &result, &d.value) == TN_OK && result.kind == TN_VALUE_HANDLE);
    const tn_handle_t originalTarget = result.handle;
    tn_handle_t target{};
    CHECK(tn_construct(ctx, "Group", nullptr, 0, &target, &d.value) == TN_OK);
    const tn_value_t targetRef = ref(target);
    CHECK(tn_set(directional, "target", &targetRef, &d.value) == TN_OK);
    CHECK(tn_object_release(target, &d.value) == TN_OK);
    CHECK(tn_get(directional, "target", &result, &d.value) == TN_OK && result.kind == TN_VALUE_HANDLE);
    const tn_value_t offset = num(2);
    CHECK(tn_set(result.handle, "position.x", &offset, &d.value) == TN_OK);
    CHECK(tn_get(originalTarget, "position.x", &result, &d.value) == TN_OK && result.number == 0);
    const tn_value_t invalidTarget = num(1);
    CHECK(tn_set(directional, "target", &invalidTarget, &d.value) != TN_OK);

    tn_handle_t hemisphere{};
    const tn_value_t hemiArgs[3] = {num(11189137), num(2236962), num(0.6)};
    CHECK(tn_construct(ctx, "HemisphereLight", hemiArgs, 3, &hemisphere, &d.value) == TN_OK);
    CHECK(tn_get(hemisphere, "type", &result, &d.value) == TN_OK && text(result) == "HemisphereLight");
    CHECK(tn_get(hemisphere, "intensity", &result, &d.value) == TN_OK && result.number == 0.6);
    CHECK(tn_get(hemisphere, "groundColor.g", &result, &d.value) == TN_OK && result.kind == TN_VALUE_NUMBER);

    tn_handle_t ambient{};
    CHECK(tn_construct(ctx, "AmbientLight", nullptr, 0, &ambient, &d.value) == TN_OK);
    CHECK(tn_get(ambient, "color.r", &result, &d.value) == TN_OK && result.number == 1);

    // A light is an Object3D: `add` and the inherited setters reach it through the same binding.
    const tn_value_t x = num(4);
    CHECK(tn_set(directional, "position.x", &x, &d.value) == TN_OK);
    CHECK(tn_get(directional, "position.x", &result, &d.value) == TN_OK && result.number == 4);

    CHECK(tn_object_release(ambient, &d.value) == TN_OK);
    CHECK(tn_object_release(hemisphere, &d.value) == TN_OK);
    CHECK(tn_object_release(directional, &d.value) == TN_OK);
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// Objects the engine still uses outlive the caller's handles, as three objects outlive a JS scope:
// a deleted attribute stays readable through a reference to it, a scene keeps the mesh it draws
// (and the mesh its geometry and material), and a replaced background stays readable. Run under
// ASan, a use-after-free in any of these fails the case.
void pooledLifetime() {
    // Exercise the actual binding factory, including enable_shared_from_this and late weak teardown.
    for (int cycle = 0; cycle < 3; ++cycle) {
        auto mesh = tn::binding::detail::makeShared<tn::engine::Mesh>();
        CHECK(mesh->shared_from_this().get() == mesh.get());
        std::weak_ptr<tn::engine::Mesh> weak = mesh;
        mesh.reset();
        CHECK(weak.expired());
        auto replacement = tn::binding::detail::makeShared<tn::engine::Mesh>();
        CHECK(replacement->shared_from_this().get() == replacement.get());
        weak.reset();
        CHECK(replacement->parent == nullptr);
    }
#if defined(__EMSCRIPTEN__) || !defined(__APPLE__)
    struct Upstream final : std::pmr::memory_resource {
        std::size_t bytes = 0;
        bool fail = false;
        void* do_allocate(std::size_t size, std::size_t alignment) override {
            if (fail)
                throw std::bad_alloc();
            void* pointer = std::pmr::new_delete_resource()->allocate(size, alignment);
            bytes += size;
            return pointer;
        }
        void do_deallocate(void* pointer, std::size_t size, std::size_t alignment) override {
            bytes -= size;
            std::pmr::new_delete_resource()->deallocate(pointer, size, alignment);
        }
        bool do_is_equal(const std::pmr::memory_resource& other) const noexcept override { return this == &other; }
    } upstream;
    struct alignas(64) Item {
        int value;
        explicit Item(int n) : value(n) {
            if (n < 0)
                throw std::runtime_error("constructor");
        }
    };
    tn::binding::detail::SharedObjectPool pool(&upstream);
    const auto initial = upstream.bytes;
    const std::pmr::polymorphic_allocator<Item> allocator(&pool);
    for (int cycle = 0; cycle < 3; ++cycle) {
        auto live = std::allocate_shared<Item>(allocator, 17);
        CHECK(reinterpret_cast<std::uintptr_t>(live.get()) % alignof(Item) == 0);
        std::weak_ptr<Item> weak = live;
        live.reset();
        CHECK(weak.expired() && upstream.bytes > initial);
        auto other = std::allocate_shared<Item>(allocator, 23);
        CHECK(other->value == 23);
        other.reset();
        CHECK(upstream.bytes > initial);
        weak.reset();
        CHECK(upstream.bytes <= initial);
        try {
            auto failed = std::allocate_shared<Item>(allocator, -1);
            CHECK(false);
        } catch (const std::runtime_error&) {
        }
        CHECK(upstream.bytes <= initial);
        upstream.fail = true;
        try {
            auto failed = std::allocate_shared<Item>(allocator, 1);
            CHECK(false);
        } catch (const std::bad_alloc&) {
        }
        upstream.fail = false;
        CHECK(upstream.bytes <= initial);
    }
#endif
}

void lifetime() {
    pooledLifetime();
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);
    auto str = [](const char* s) {
        tn_value_t v{};
        v.kind = TN_VALUE_STRING;
        v.text = s;
        v.count = std::strlen(s);
        return v;
    };
    auto ref = [](tn_handle_t h) {
        tn_value_t v{};
        v.kind = TN_VALUE_HANDLE;
        v.handle = h;
        return v;
    };
    tn_value_t out{};

    // 1. An attribute reference survives deleteAttribute.
    tn_handle_t box{};
    CHECK(tn_construct(ctx, "BoxGeometry", nullptr, 0, &box, &d.value) == TN_OK);
    CHECK(tn_get(box, "attributes.position", &out, &d.value) == TN_OK && out.kind == TN_VALUE_HANDLE);
    const tn_handle_t position = out.handle;
    const tn_value_t name = str("position");
    CHECK(tn_invoke(box, "deleteAttribute", &name, 1, &out, &d.value) == TN_OK);
    const tn_value_t zero = num(0);
    CHECK(tn_invoke(position, "getX", &zero, 1, &out, &d.value) == TN_OK && out.kind == TN_VALUE_NUMBER && out.number == 0.5);

    // 2. A scene keeps its mesh, and the mesh its geometry and material, after every other handle goes.
    tn_handle_t scene{}, geometry{}, material{}, mesh{};
    CHECK(tn_construct(ctx, "Scene", nullptr, 0, &scene, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "SphereGeometry", nullptr, 0, &geometry, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "MeshBasicMaterial", nullptr, 0, &material, &d.value) == TN_OK);
    const tn_value_t parts[2] = {ref(geometry), ref(material)};
    CHECK(tn_construct(ctx, "Mesh", parts, 2, &mesh, &d.value) == TN_OK);
    CHECK(tn_get(mesh, "geometry", &out, &d.value) == TN_OK && out.handle.index == geometry.index &&
          out.handle.generation == geometry.generation);  // the geometry it was built from, not a new handle
    const tn_value_t meshName = str("kept");
    CHECK(tn_set(mesh, "name", &meshName, &d.value) == TN_OK);
    const tn_value_t meshRef = ref(mesh);
    CHECK(tn_invoke(scene, "add", &meshRef, 1, &out, &d.value) == TN_OK);
    CHECK(tn_object_release(mesh, &d.value) == TN_OK);
    CHECK(tn_object_release(geometry, &d.value) == TN_OK);
    CHECK(tn_object_release(material, &d.value) == TN_OK);
    CHECK(tn_invoke(scene, "getObjectByName", &meshName, 1, &out, &d.value) == TN_OK && out.kind == TN_VALUE_HANDLE);
    const tn_handle_t found = out.handle;
    CHECK(tn_get(found, "geometry", &out, &d.value) == TN_OK && out.kind == TN_VALUE_HANDLE);
    const tn_handle_t keptGeometry = out.handle;
    CHECK(tn_get(keptGeometry, "attributes.position", &out, &d.value) == TN_OK && out.kind == TN_VALUE_HANDLE);
    CHECK(tn_get(out.handle, "count", &out, &d.value) == TN_OK && out.kind == TN_VALUE_NUMBER && out.number > 0);
    CHECK(tn_get(found, "material", &out, &d.value) == TN_OK && out.kind == TN_VALUE_HANDLE);
    CHECK(tn_get(out.handle, "type", &out, &d.value) == TN_OK && std::string(out.text, out.count) == "MeshBasicMaterial");

    // 3. A replaced background stays readable through the old reference, and is the caller's Color.
    const tn_value_t red[3] = {num(1), num(0), num(0)};
    tn_handle_t c1{}, c2{};
    CHECK(tn_construct(ctx, "Color", red, 3, &c1, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "Color", nullptr, 0, &c2, &d.value) == TN_OK);
    const tn_value_t c1Ref = ref(c1), c2Ref = ref(c2);
    CHECK(tn_set(scene, "background", &c1Ref, &d.value) == TN_OK);
    CHECK(tn_get(scene, "background", &out, &d.value) == TN_OK && out.handle.index == c1.index);  // the same Color
    CHECK(tn_object_release(c1, &d.value) == TN_OK);
    CHECK(tn_get(scene, "background", &out, &d.value) == TN_OK && out.kind == TN_VALUE_HANDLE);
    const tn_handle_t oldBackground = out.handle;
    CHECK(tn_set(scene, "background", &c2Ref, &d.value) == TN_OK);
    CHECK(tn_get(oldBackground, "r", &out, &d.value) == TN_OK && out.number == 1);

    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

struct Calls {
    int invoked = 0;
    int released = 0;
    bool fail = false;
    uint32_t count = 0;
    tn_value_t args[6] = {};
};

tn_status_t recordCall(void* context, const tn_value_t* args, uint32_t count, char* error, uint32_t capacity) {
    auto* calls = static_cast<Calls*>(context);
    ++calls->invoked;
    calls->count = count;
    for (uint32_t i = 0; i < count && i < 6; ++i) calls->args[i] = args[i];
    if (!calls->fail) return TN_OK;
    std::snprintf(error, capacity, "boom");
    return TN_ERROR_INVALID_STATE;
}

void releaseCall(void* context) { ++static_cast<Calls*>(context)->released; }

template <typename T>
T* engineObject(tn_handle_t h) {
    return static_cast<T*>(tn::abi::objectOf(h)->ptr.get());
}

// PRD-531/506: a callback set through the ABI runs with three's arguments as handles, reports a
// throw as a status, and its context is released exactly once: replaced, cleared or destroyed.
void callbacks() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);
    tn_handle_t scene{}, camera{}, geometry{}, material{}, mesh{}, other{};
    CHECK(tn_construct(ctx, "Scene", nullptr, 0, &scene, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "PerspectiveCamera", nullptr, 0, &camera, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "BoxGeometry", nullptr, 0, &geometry, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "MeshBasicMaterial", nullptr, 0, &material, &d.value) == TN_OK);
    const tn_value_t parts[2] = {ref(geometry), ref(material)};
    CHECK(tn_construct(ctx, "Mesh", parts, 2, &mesh, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "Mesh", parts, 2, &other, &d.value) == TN_OK);

    Calls first, second, third;
    CHECK(tn_set_callback(mesh, "onBeforeRender", recordCall, &first, releaseCall, &d.value) == TN_OK);
    auto* object = engineObject<tn::engine::Object3D>(mesh);
    const tn::engine::RenderCallbackArgs args{
        engineObject<tn::engine::Object3D>(scene), engineObject<tn::engine::Object3D>(camera),
        std::static_pointer_cast<const tn::engine::BufferGeometry>(tn::abi::objectOf(geometry)->ptr),
        std::static_pointer_cast<const tn::engine::Material>(tn::abi::objectOf(material)->ptr)};
    std::string error;
    CHECK(object->onBeforeRender && (*object->onBeforeRender)(args, error));
    CHECK(first.invoked == 1 && first.count == 6);
    CHECK(first.args[0].kind == TN_VALUE_NULL && first.args[5].kind == TN_VALUE_NULL);  // renderer, group
    CHECK(first.args[1].kind == TN_VALUE_HANDLE && same(first.args[1].handle, scene));
    CHECK(first.args[2].kind == TN_VALUE_HANDLE && same(first.args[2].handle, camera));
    CHECK(first.args[3].kind == TN_VALUE_HANDLE && same(first.args[3].handle, geometry));
    CHECK(first.args[4].kind == TN_VALUE_HANDLE && same(first.args[4].handle, material));
    first.fail = true;
    CHECK(!(*object->onBeforeRender)(args, error) && error == "boom");

    CHECK(tn_set_callback(mesh, "onBeforeRender", recordCall, &second, releaseCall, &d.value) == TN_OK);
    CHECK(first.released == 1 && second.released == 0);  // replaced: released once
    CHECK(tn_set_callback(mesh, "onBeforeRender", nullptr, nullptr, nullptr, &d.value) == TN_OK);
    CHECK(second.released == 1 && !object->onBeforeRender);  // cleared

    CHECK(tn_set_callback(other, "onBeforeRender", recordCall, &third, releaseCall, &d.value) == TN_OK);
    CHECK(tn_object_release(other, &d.value) == TN_OK);
    CHECK(third.released == 1);  // its object destroyed

    Calls unused;
    CHECK(tn_set_callback(mesh, "onAfterShadow", recordCall, &unused, releaseCall, &d.value) == TN_ERROR_UNSUPPORTED);
    tn_handle_t vector{};
    CHECK(tn_construct(ctx, "Vector3", nullptr, 0, &vector, &d.value) == TN_OK);
    CHECK(tn_set_callback(vector, "onBeforeRender", recordCall, &unused, releaseCall, &d.value) == TN_ERROR_UNSUPPORTED);
    CHECK(unused.released == 0);  // a refused pair was never taken
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// PRD-540: three's one-argument Color is Color.set(): a hex in sRGB, a CSS string, or a Color to
// copy. Three numbers stay linear components.
void color_set() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);
    tn_value_t result{};
    const auto channel = [&](tn_handle_t color, const char* name) {
        CHECK(tn_get(color, name, &result, &d.value) == TN_OK && result.kind == TN_VALUE_NUMBER);
        return result.number;
    };

    tn_handle_t red{};
    const tn_value_t hex = num(0xff0000);
    CHECK(tn_construct(ctx, "Color", &hex, 1, &red, &d.value) == TN_OK);
    CHECK(channel(red, "r") == 1 && channel(red, "g") == 0 && channel(red, "b") == 0);

    tn_handle_t green{};
    tn_value_t css{};
    css.kind = TN_VALUE_STRING;
    css.text = "#00ff00";
    css.count = 7;
    CHECK(tn_construct(ctx, "Color", &css, 1, &green, &d.value) == TN_OK);
    CHECK(channel(green, "r") == 0 && channel(green, "g") == 1 && channel(green, "b") == 0);

    tn_handle_t copy{};
    const tn_value_t source = ref(red);
    CHECK(tn_construct(ctx, "Color", &source, 1, &copy, &d.value) == TN_OK);
    CHECK(!same(copy, red) && channel(copy, "r") == 1 && channel(copy, "g") == 0);

    tn_handle_t linear{};
    const tn_value_t rgb[3] = {num(0.25), num(0.5), num(0.75)};
    CHECK(tn_construct(ctx, "Color", rgb, 3, &linear, &d.value) == TN_OK);
    CHECK(channel(linear, "r") == 0.25 && channel(linear, "g") == 0.5 && channel(linear, "b") == 0.75);
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

// PRD-540: `children` answers the attached objects in order, as three's array does.
void children() {
    const tn_version_info_t own = tn_engine_version();
    tn_context_t* ctx = nullptr;
    Diag d;
    CHECK(tn_context_create(&ctx, &own, &d.value) == TN_OK);
    tn_handle_t scene{}, first{}, second{};
    CHECK(tn_construct(ctx, "Scene", nullptr, 0, &scene, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "Group", nullptr, 0, &first, &d.value) == TN_OK);
    CHECK(tn_construct(ctx, "Mesh", nullptr, 0, &second, &d.value) == TN_OK);
    tn_value_t result{};
    CHECK(tn_get(scene, "children", &result, &d.value) == TN_OK && result.kind == TN_VALUE_ARRAY && result.count == 0);
    // three's add(...objects) and remove(...objects): every argument, in order, in one call.
    const tn_value_t both[2] = {ref(first), ref(second)};
    CHECK(tn_invoke(scene, "add", both, 2, &result, &d.value) == TN_OK);
    CHECK(tn_get(scene, "children", &result, &d.value) == TN_OK && result.kind == TN_VALUE_ARRAY && result.count == 2);
    CHECK(result.values[0].kind == TN_VALUE_HANDLE && same(result.values[0].handle, first));
    CHECK(result.values[1].kind == TN_VALUE_HANDLE && same(result.values[1].handle, second));
    CHECK(tn_invoke(scene, "remove", both, 2, &result, &d.value) == TN_OK);
    CHECK(tn_get(scene, "children", &result, &d.value) == TN_OK && result.count == 0);
    CHECK(tn_context_destroy(ctx, &d.value) == TN_OK);
}

}  // namespace

TN_TEST_MAIN({"version", version}, {"handles", handles}, {"generic", generic}, {"scene", scene},
             {"unsupported_member", unsupported_member}, {"material", material}, {"light", light}, {"lifetime", lifetime},
             {"callbacks", callbacks}, {"color_set", color_set}, {"children", children})
