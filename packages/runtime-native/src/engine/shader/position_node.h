#pragma once

#include <cstdint>
#include <functional>
#include <string>

namespace tn::engine::shader {

class Program;

/**
 * A material's `positionNode` (three's NodeMaterial.positionNode): a TSL graph, authored with the
 * native builder (engine/shader/tsl/tsl.h), that replaces the vertex's local position after
 * morphing, skinning and instancing, as setupPosition assigns it last. `build` receives the vertex
 * program and that position (vec3) and returns the new one (vec3). Storage buffers it declares are
 * bound by name from Renderer::setStorage. `key` names the graph: two nodes with one key must build
 * the same program, which is how programs are cached.
 */
struct PositionNode {
    std::string key;
    std::function<uint32_t(Program& vertex, uint32_t positionLocal)> build;
};

}  // namespace tn::engine::shader
