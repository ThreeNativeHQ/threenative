#include "engine/shader/graph/serialized.h"
#include "engine/shader/graph/post_effects.h"
#include "engine/renderer/graph/render_graph.h"
#include "engine/shader/output.h"
#include "engine/shader/package.h"
#include "engine/shader/tsl/tsl.h"
#include "engine/foundation/json.h"

#include <fstream>
#include <iostream>
#include <iterator>

using namespace tn::engine::shader;

int main(int argc, char** argv) {
    if (argc != 4) { std::cerr << "expected template, exported graph, output prefix\n"; return 2; }
    std::ifstream input(argv[2]);
    if (!input) { std::cerr << argv[1] << ": cannot read exported graph\n"; return 2; }
    const std::string source{std::istreambuf_iterator<char>(input), {}};
    ShaderPackage package;
    package.name = argv[1];
    const auto node = graph::importSerialized(source, package.errors);
    if (!node || !package.ok()) {
        for (const auto& error : package.errors) std::cerr << package.name << ": " << error << '\n';
        return 1;
    }
    const PostNode post{graph::key(node), [&](Program& p, uint32_t, ExprId uv) {
        tsl::Build build(p);
        return graph::lower(node, p, {{"uv", uv}});
    }};
    const auto programs = buildOutput(std::nullopt, false, &post);
    for (const Program* p : {&programs.vertex, &programs.fragment})
        for (const auto& d : p->diagnostics()) package.errors.push_back(d.code + ": " + d.node + ": " + d.reason);
    package.variants.push_back(Variant{0, {buildStage(programs.vertex), buildStage(programs.fragment)}});
    std::vector<ShaderPackage> packages;
    tn::engine::graph::RenderGraph renderGraph;
    using Desc = tn::engine::graph::TextureDesc;
    std::map<std::string, tn::engine::graph::ResourceId> resources;
    for (const std::string name : {"scene", "depth", "normal"}) resources[name] = renderGraph.external(name, Desc{320,240,1,1});
    const auto passes = graph::postPasses(node);
    for (const auto& pass : passes) {
        for (const auto& image : pass.images) resources[image.name] = renderGraph.external(image.name, Desc{image.width,image.height,1,1});
        resources[pass.output] = renderGraph.transient(pass.output, Desc{320,240,1,1});
    }
    for (const auto& pass : passes) {
        std::vector<tn::engine::graph::Read> reads;
        for (const auto& [binding, name] : pass.reads) {
            if (!resources.count(name)) { std::cerr << package.name << ": TN_POST_INPUT_MISSING: " << name << '\n'; return 1; }
            reads.push_back({resources.at(name)});
        }
        renderGraph.pass(pass.output, tn::engine::graph::PassKind::Render, reads, {resources.at(pass.output)});
        packages.push_back(pass.package);
    }
    const auto plan = renderGraph.compile();
    if (!plan.ok()) { for (const auto& d : plan.errors) std::cerr << d.code << ": " << d.detail << '\n'; return 1; }
    packages.push_back(package);
    std::string error;
    for (const auto& compiled : packages) if (!acceptPackage(compiled, error)) { std::cerr << package.name << ": " << error << '\n'; return 1; }
    std::vector<tn::engine::json::Value> modules;
    size_t index = 0;
    for (const auto& compiled : packages) for (const auto& module : compiled.variants[0].stages) {
        const std::string file = std::string(argv[3]) + "-" + std::to_string(index++) + ".wgsl";
        std::ofstream output(file);
        output << module.wgsl.code;
        if (!output) { std::cerr << package.name << ": failed to write " << file << '\n'; return 2; }
        modules.push_back(tn::engine::json::Value::makeString(file));
    }
    std::ofstream manifest(std::string(argv[3]) + ".modules.json");
    manifest << tn::engine::json::stringify(tn::engine::json::Value::makeArray(std::move(modules)));
    return manifest ? 0 : 2;
}
