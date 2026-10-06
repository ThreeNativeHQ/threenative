#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <array>
#include "engine/shader/graph/graph.h"
#include "engine/shader/graph/post_effects.h"

namespace tn::engine::shader {

class Program;

/** NodeMaterial slots; null nodes use the non-node material path. */
struct MaterialNodes {
    graph::Node colorNode, positionNode, normalNode, emissiveNode, roughnessNode, metalnessNode, opacityNode;
    auto graphs() const { return std::array{colorNode, positionNode, normalNode, emissiveNode,
                                         roughnessNode, metalnessNode, opacityNode}; }
    std::string key() const {
        std::string out;
        for (const auto& node : graphs()) { const auto k = graph::key(node); out += std::to_string(k.size()) + ":" + k; }
        return out;
    }
};

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

/**
 * A post pass (three's RenderPipeline.outputNode over `pass(scene, camera)`): a TSL graph over the
 * scene's linear colour, applied before the output transform (tone mapping, colour space), as
 * RenderPipeline's outputColorTransform does. `build` receives the fragment program, the scene
 * texture (declared as texture "scene") and the screen uv (vec2), and returns the linear vec4.
 */
struct PostNode {
    std::string key;
    std::function<uint32_t(Program& fragment, uint32_t sceneTexture, uint32_t screenUv)> build;
    std::vector<graph::PostPass> passes;
    std::map<std::string, std::vector<float>> uniforms;
};

}  // namespace tn::engine::shader
