// PRD-510 phase 2: the TSL corpus authored with the native builder, graph for graph the same as
// tsl-corpus/reference.ts. Prints each graph's typed IR dump; differential.mjs --suite tsl-ir
// compares it with the upstream node tree normalised into the same syntax. A graph whose program
// carries a diagnostic prints it instead, which never equals the reference.
#include "engine/shader/tsl/tsl.h"

#include <cstdio>
#include <functional>
#include <string>

using namespace tn::engine::shader;
using namespace tn::engine::shader::tsl;

namespace {

void graph(const char* name, const char* output, const std::function<Node()>& body) {
    Program p(std::string(output) == "color" ? Stage::Fragment : Stage::Vertex);
    {
        Build build(p);
        tsl::output(output, body());
    }
    std::printf("# %s\n", name);
    if (!p.ok()) {
        for (const Diagnostic& d : p.diagnostics())
            std::printf("DIAGNOSTIC %s %s: %s\n", d.code.c_str(), d.node.c_str(), d.reason.c_str());
        return;
    }
    std::printf("%s", p.dump(true).c_str());
}

/** A compute graph: the body of an `Fn`, dispatched one invocation per instance. */
void compute(const char* name, const std::function<void(Storage)>& body) {
    Program p(Stage::Compute);
    {
        Build build(p);
        const Storage positions = storage("positions", Type::vec(4));
        Fn([&] { body(positions); });
    }
    std::printf("# %s\n", name);
    for (const Diagnostic& d : p.diagnostics())
        std::printf("DIAGNOSTIC %s %s: %s\n", d.code.c_str(), d.node.c_str(), d.reason.c_str());
    if (p.ok()) std::printf("%s", p.dump(true).c_str());
}

Node u() { return uniform("u", Type::f32()); }
Node tint() { return uniform("tint", Type::vec(3)); }
Node time() { return uniform("time", Type::f32()); }

}  // namespace

int main() {
    graph("scale-by-uniform", "position", [] { return vec4({positionLocal().mul(u()), 1}); });
    graph("swizzle-and-join", "color", [] { return vec4({positionLocal().swizzle("zyx"), positionLocal().x()}); });
    graph("sin-of-sum", "color", [] { return vec4({vec3({sin(float_(2).add(u()))}), 1}); });
    graph("attribute-weight", "position",
          [] { return vec4({positionLocal().mul(attribute("weight", Type::f32())), 1}); });
    graph("vector-math", "color",
          [] { return vec4({normalize(cross(positionLocal(), tint())), dot(positionLocal(), tint())}); });
    graph("length-distance", "color",
          [] { return vec4({length(positionLocal()), distance(positionLocal(), tint()), 0, 1}); });
    graph("mix-clamp-smoothstep", "color",
          [] { return vec4({mix(tint(), positionLocal(), clamp(u(), 0, 1)), smoothstep(0, 1, u())}); });
    graph("unary-math", "color", [] { return vec4({abs(u()), floor(u()), fract(u()), sqrt(u())}); });
    graph("binary-math", "color",
          [] { return vec4({pow(u(), 2), min(u(), time()), max(u(), time()), step(u(), time())}); });
    graph("exp-cos", "color", [] { return vec4({exp2(u()), cos(time()), 0, 1}); });
    graph("compare-select", "color",
          [] { return vec4({vec3({select(u().lessThan(time()), u(), time())}), 1}); });
    graph("greater-select", "color",
          [] { return vec4({vec3({select(u().greaterThan(0.25), float_(1), float_(0))}), 1}); });
    graph("negate-sub-div", "color", [] { return vec4({u().negate(), u().sub(time()), u().div(2), 1}); });
    graph("uv-texture", "color", [] { return texture("albedo", uv()); });
    graph("texture-scaled-uv", "color", [] { return texture("albedo", uv().mul(2)).mul(u()); });
    graph("int-convert", "color", [] { return vec4({float_(int_(3)), float_(uint_(4)), 0, 1}); });
    graph("vector-constants", "color", [] { return vec4({vec3({1, 2, 3}).add(tint()), 1}); });
    graph("constant-splat", "color", [] { return vec4({vec3({0.5}).mul(tint()), 1}); });
    graph("vec2-swizzle", "color", [] { return vec4({vec2({u(), time()}).swizzle("yx"), 0, 1}); });
    graph("instance-offset", "position",
          [] { return vec4({positionLocal().add(vec3({float_(instanceIndex()), 0, 0})), 1}); });
    graph("time-wave", "position",
          [] { return vec4({positionLocal().add(vec3({0, sin(time().add(positionLocal().x())), 0})), 1}); });
    graph("camera-position", "color", [] { return vec4({uniform("cameraPosition", Type::vec(3)), 1}); });
    graph("camera-projection", "position", [] {
        return uniform("cameraProjectionMatrix", Type::mat(4, 4)).mul(vec4({attribute("position", Type::vec(3)), 1}));
    });
    graph("camera-world-matrix", "color",
          [] { return uniform("cameraWorldMatrix", Type::mat(4, 4)).mul(vec4({1, 0, 0, 0})); });
    graph("position-geometry", "position", [] { return vec4({attribute("position", Type::vec(3)).xy(), 0, 1}); });
    graph("normal-world", "color", [] {
        const Node normalView = normalize(program().varying("normalView", Type::vec(3)));
        return vec4({normalize(vec4({normalView, 0}).mul(uniform("viewMatrix", Type::mat(4, 4))).xyz()), 1});
    });
    graph("varying-fragment", "color", [] { return vec4({program().varying("scaled", Type::vec(3)), 1}); });
    graph("varying-vertex", "position", [] { return vec4({attribute("position", Type::vec(3)).mul(u()), 1}); });

    compute("fn-if-store", [](Storage positions) {
        const Var acc = toVar(float_(0));
        If(instanceIndex().lessThan(uint_(16)), [&] {
            acc.assign(acc.add(1));
            positions.element(instanceIndex()).assign(vec4({acc, 0, 0, 1}));
        });
    });
    compute("loop-accumulate", [](Storage positions) {
        const Var acc = toVar(float_(0));
        Loop(4, [&](Node i) { acc.assign(acc.add(float_(i))); });
        positions.element(instanceIndex()).assign(vec4({acc, 0, 0, 1}));
    });
    compute("if-else", [](Storage positions) {
        IfElse(instanceIndex().lessThan(uint_(8)),
               [&] { positions.element(instanceIndex()).assign(vec4({1, 0, 0, 1})); },
               [&] { positions.element(instanceIndex()).assign(vec4({0, 1, 0, 1})); });
    });
    compute("storage-read-modify", [](Storage positions) {
        positions.element(instanceIndex()).assign(Node(positions.element(instanceIndex())).mul(2));
    });
    return 0;
}
