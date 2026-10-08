// PRD-532: the engine's C ABI as a Wasm module for the browser-JS back end
// (packages/three-native/src/browser-backend.ts). The module is the ABI and nothing else: no
// entry point, no WebGPU. Its exports are listed in cmake/NativeEngineCore.cmake.
#include "engine/abi/abi_internal.h"
#include "engine/scene/nodes.h"
#include "threenative/abi/tn_abi.h"

#include <cstdio>
#include <string>

// Test hook for the smoke run (tests/browser-backend-smoke.ts): fires a mesh's onBeforeRender as
// RenderDatabase does before a draw, with its parent as the scene; 0 when it ran, 1 when the callee
// threw (the message is printed), 2 when there was nothing to call. The module has no renderer.
extern "C" int tnw_fire_before_render(const tn_handle_t* mesh) {
    tn::binding::Object* object = tn::abi::objectOf(*mesh);
    if (object == nullptr) return 2;
    auto* node = static_cast<tn::engine::Mesh*>(object->ptr.get());
    if (!node->onBeforeRender) return 2;
    std::string error;
    if ((*node->onBeforeRender)({node->parent, nullptr, node->geometry, node->material}, error)) return 0;
    std::printf("TN_CALLBACK_FAILED onBeforeRender: %s\n", error.c_str());
    return 1;
}
