#include "mystral/webgpu/render_pass_wrapper_pool.h"

#include <cstdint>
#include <iostream>
#include <memory>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

using NativeHandle = uintptr_t;

struct ObjectHandle {
    uint64_t id = 0;
};

struct Wrapper {
    ObjectHandle object{};
    std::shared_ptr<NativeHandle> pass;
    std::shared_ptr<NativeHandle> encoder;
};

void initializeFresh(Wrapper& wrapper, uint64_t objectId) {
    wrapper.object = {objectId};
    wrapper.pass = std::make_shared<NativeHandle>(0);
    wrapper.encoder = std::make_shared<NativeHandle>(0);
}

bool isFresh(const ObjectHandle& object) {
    return object.id == 0;
}

bool check(const char* message, bool condition) {
    if (condition) return true;
    std::cerr << "render-pass wrapper lifetime failed: " << message << '\n';
    return false;
}

}  // namespace

int main() {
    std::vector<std::unique_ptr<Wrapper>> pool;
    std::unordered_map<NativeHandle, NativeHandle> livePasses;
    std::vector<std::pair<uint64_t, NativeHandle>> privateDataWrites;
    std::vector<uint64_t> freedObjects;

    auto bind = [&](Wrapper& wrapper, NativeHandle pass, NativeHandle encoder) {
        mystral::webgpu::rebindRenderPassWrapper(
            wrapper, pass, encoder,
            [&](const ObjectHandle& object, NativeHandle value) {
                privateDataWrites.emplace_back(object.id, value);
            });
    };
    auto discard = [&](Wrapper& wrapper, bool fresh) {
        mystral::webgpu::discardFreshRenderPassWrapper(
            wrapper, fresh,
            [&](const ObjectHandle& object) { freedObjects.push_back(object.id); });
    };

    Wrapper* first = mystral::webgpu::acquireRenderPassWrapper(pool, livePasses, isFresh);
    initializeFresh(*first, 1);
    bind(*first, 11, 101);
    livePasses.emplace(101, 11);

    // A concurrent native pass must grow the pool instead of changing the first wrapper's slots.
    Wrapper* concurrent = mystral::webgpu::acquireRenderPassWrapper(pool, livePasses, isFresh);
    if (!check("concurrent passes receive distinct wrappers", concurrent != first && pool.size() == 2)) return 1;
    initializeFresh(*concurrent, 2);
    bind(*concurrent, 22, 202);
    livePasses.emplace(202, 22);
    if (!check("first live slot remains bound", *first->pass == 11 && *first->encoder == 101)) return 1;

    // Ending both passes makes the first wrapper eligible. Rebinding must keep its object and
    // overwrite the native private value rather than leaving the old pass observable.
    livePasses.erase(101);
    livePasses.erase(202);
    Wrapper* reused = mystral::webgpu::acquireRenderPassWrapper(pool, livePasses, isFresh);
    if (!check("ended pass wrapper is reused", reused == first && pool.size() == 2)) return 1;
    bind(*reused, 33, 303);
    if (!check("reused wrapper keeps object and rebinding slots", reused->object.id == 1 &&
        *reused->pass == 33 && *reused->encoder == 303)) return 1;
    if (!check("private data is overwritten on reuse", privateDataWrites ==
        std::vector<std::pair<uint64_t, NativeHandle>>{{1, 11}, {2, 22}, {1, 33}})) return 1;

    // A fresh installation rollback disposes the newly created object and returns it to a fresh
    // pool slot; a rollback reached while reusing an existing wrapper must preserve that object.
    Wrapper freshRollback;
    initializeFresh(freshRollback, 3);
    discard(freshRollback, true);
    if (!check("fresh rollback frees and resets object", freedObjects == std::vector<uint64_t>{3} &&
        isFresh(freshRollback.object))) return 1;
    discard(*reused, false);
    if (!check("reused rollback preserves object", freedObjects == std::vector<uint64_t>{3} &&
        reused->object.id == 1)) return 1;

    std::cout << "render-pass-wrapper-lifetime: concurrent=distinct reuse=overwrites "
              << "rollback=fresh-only\n";
    return 0;
}
