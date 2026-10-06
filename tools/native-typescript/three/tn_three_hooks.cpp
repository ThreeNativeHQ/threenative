// The engine half of three-aot.ts (PRD-506): runs an object's onBeforeRender through the engine's
// own RenderCallback, as RenderDatabase does before a draw, with its parent as the scene.
#include "engine/abi/abi_internal.h"
#include "engine/scene/nodes.h"
#include "threenative/abi/tn_abi.h"

#include <cstring>
#include <string>

extern "C" tn_handle_t tnx_handle(int slot);

extern "C" const char* tnx_fire_before_render(int slot) {
    static std::string answer;
    tn::binding::Object* object = tn::abi::objectOf(tnx_handle(slot));
    if (object == nullptr) return "no object";
    auto* mesh = static_cast<tn::engine::Mesh*>(object->ptr.get());
    if (!mesh->onBeforeRender) return "no callback";
    std::string error;
    answer = (*mesh->onBeforeRender)({mesh->parent, nullptr, mesh->geometry, mesh->material}, error)
                 ? "ok"
                 : "TN_CALLBACK_FAILED onBeforeRender: " + error;
    return answer.c_str();
}

#ifndef TN_TSL_RENDER
extern "C" const char* tnx_render(int64_t, int64_t) {
    return "TN_TSL_RENDER_UNBUILT: compile with --render";
}
#endif
