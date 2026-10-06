#pragma once
#include "engine/shader/graph/graph.h"
#include "engine/shader/package.h"
#include "engine/foundation/json.h"
#include <map>

namespace tn::engine::shader::graph {
struct PostImage {
    std::string name;
    uint32_t width = 0, height = 0;
    std::vector<uint8_t> bytes;
    bool nearest = false, repeat = false;
};
struct PostEffect {
    std::string kind, output;
    std::vector<Node> inputs;
    std::map<std::string, std::vector<float>> parameters;
    std::vector<PostImage> images;
    float resolutionScale = 1;
    bool normal = false, temporal = false;
};
struct PostPass {
    std::string output;
    ShaderPackage package;
    // Shader binding name -> render graph resource name. All inputs require a producer.
    std::map<std::string, std::string> reads;
    std::map<std::string, std::vector<float>> uniforms;
    std::vector<PostImage> images;
    float resolutionScale = 1;
    uint32_t width = 0, height = 0; // RTT fixed dimensions; zero uses viewport
    bool floorSize = false, autoUpdate = true;
    // GTAONode uses RedFormat + UnsignedByteType (R8Unorm), not an HDR colour target.
    bool redFormat = false;
    float clear = 0;
    bool temporal = false;
};
Node importPostEffect(const json::Value& record, const std::vector<Node>& args, std::vector<std::string>& errors);
/** Ordered native passes, including materialization of the authored SMAA colour input. */
std::vector<PostPass> postPasses(Node root);
} // namespace tn::engine::shader::graph
