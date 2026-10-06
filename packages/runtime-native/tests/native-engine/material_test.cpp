#include "check.h"
#include "engine/shader/standard.h"
#include "engine/shader/wgsl.h"

#include <bit>
#include <cstdio>
#include <string>

using namespace tn::engine::shader;

namespace {

void unsupported() {
    // Defaults are the pinned MeshStandardMaterial constructor's.
    const StandardMaterial defaults;
    CHECK(defaults.color[0] == 1 && defaults.roughness == 1 && defaults.metalness == 0 && defaults.opacity == 1);
    CHECK(unsupportedFeatures(defaults).empty());

    struct Case {
        const char* feature;
        float StandardMaterial::*field;
    };
    const Case cases[] = {{"clearcoat", &StandardMaterial::clearcoat},       {"sheen", &StandardMaterial::sheen},
                          {"transmission", &StandardMaterial::transmission}, {"iridescence", &StandardMaterial::iridescence},
                          {"anisotropy", &StandardMaterial::anisotropy},     {"dispersion", &StandardMaterial::dispersion}};
    for (const Case& c : cases) {
        StandardMaterial m;
        m.*c.field = 0.5f;
        const StandardPrograms programs = buildStandard(m);
        CHECK(programs.diagnostics.size() == 1);
        CHECK(!programs.diagnostics.empty() &&
              programs.diagnostics[0] == std::string("TN_MATERIAL_UNSUPPORTED ") + c.feature);
    }
    // Never a silent fallback: a refused material produces no shader at all.
    StandardMaterial clearcoat;
    clearcoat.clearcoat = 1;
    CHECK(buildStandard(clearcoat).fragment.exprCount() == 0);
}

void nodes() {
    namespace g = tn::engine::shader::graph;
    VertexVariant variant;
    variant.map = true;
    variant.nodes.colorNode = g::vec4({g::uv(), g::uniform("nodeTint", Type::f32(), {0.35f}), g::float_(0.8)});
    const auto basic = buildBasic(variant);
    const auto fragment = WgslEmitter::emit(basic.fragment, 1);
    const auto vertex = WgslEmitter::emit(basic.vertex, 0);
    CHECK(fragment.ok() && vertex.ok());
    // NodeMaterial.setupDiffuseColor picks colorNode instead of materialColor (color * map).
    CHECK(fragment.code.find("t_map") == std::string::npos);
    CHECK(fragment.code.find("f_nodeTint") != std::string::npos);
    CHECK(fragment.code.find("f_diffuse).xyz") == std::string::npos);
    CHECK(fragment.code.find("f_diffuse).w") != std::string::npos); // material opacity still multiplies node alpha
    CHECK(vertex.code.find("o_uv = a_uv") != std::string::npos);
    VertexVariant mapped;
    mapped.map = true;
    CHECK(WgslEmitter::emit(buildBasic(mapped).fragment, 1).code.find("t_map") != std::string::npos);
    const auto same = variant.nodes.colorNode;
    const auto copy = g::vec4({g::uv(), g::uniform("nodeTint", Type::f32(), {0.9f}), g::float_(0.8)});
    CHECK(g::key(same) == g::key(copy)); // uniform data does not change the shader
    CHECK(g::uniforms(same).at("nodeTint")[0] == 0.35f);
    CHECK(g::key(g::add(g::float_(1), g::float_(2))) != g::key(g::sub(g::float_(1), g::float_(2))));
    const std::string colorKey = variant.key();
    variant.nodes.opacityNode = g::float_(0.4);
    CHECK(variant.key() != colorKey);
    const auto opacity = WgslEmitter::emit(buildBasic(variant).fragment, 1);
    CHECK(opacity.ok());
    // opacityNode replaces the scalar material opacity, without replacing colorNode's alpha.
    CHECK(opacity.code.find("f_diffuse).w") == std::string::npos);
    variant.nodes.normalNode = g::normalize(g::add(g::varying("normalViewGeometry", Type::vec(3)),
                                                g::vec3({g::float_(0.3), g::float_(0), g::float_(0)})));
    variant.nodes.roughnessNode = g::swizzle(g::uv(), "x");
    variant.nodes.metalnessNode = g::swizzle(g::varying("positionWorld", Type::vec(3)), "y");
    variant.nodes.emissiveNode = g::vec3({g::sin(g::swizzle(g::uv(), "x")), g::float_(0), g::float_(0)});
    variant.nodes.positionNode = g::add(g::positionLocal(), g::vec3({g::float_(0), g::float_(0), g::float_(0.2)}));
    const auto standard = buildStandard(StandardMaterial{}, variant);
    CHECK(standard.diagnostics.empty());
    const auto sv = WgslEmitter::emit(standard.vertex, 0), sf = WgslEmitter::emit(standard.fragment, 1);
    CHECK(sv.ok() && sf.ok());
    CHECK(sv.code.find("o_positionWorld") != std::string::npos);
    CHECK(sf.code.find("dpdx") != std::string::npos); // geometry roughness remains
    CHECK(sf.code.find("sin(") != std::string::npos);
    CHECK(sf.code.find("f_emissive") == std::string::npos); // emissiveNode replaces emissive * intensity
    CHECK(sf.code.find("f_roughness") == std::string::npos);
    CHECK(sf.code.find("f_metalness") == std::string::npos);
    // Varyings match by name despite roughness, metalness and normal using different graph orders.
    for (const auto& [name, type] : standard.fragment.varyings()) {
        const auto at = sf.code.find("i_" + name + ":");
        const auto location = sf.code.rfind("@location(", at);
        const auto end = sf.code.find(')', location);
        CHECK(sv.code.find(sf.code.substr(location, end - location + 1) + " o_" + name + ":") != std::string::npos);
    }
    CHECK(sv.code.find("out.position =") != std::string::npos);
    VertexVariant invalid;
    invalid.nodes.colorNode = g::Block{}.node();
    CHECK(!buildBasic(invalid).fragment.ok());
    invalid.nodes = {};
    invalid.nodes.positionNode = g::Block{}.node();
    CHECK(!buildBasic(invalid).vertex.ok());
    variant.nodes.positionNode = g::vec4({g::positionLocal(), g::float_(1)});
    CHECK(buildBasic(variant).vertex.ok()); // setupPosition subBuild requests vec3

}

void builds() {
    nodes();
    // Both GGX and copy passes must address all extra tiles, including negative mips.
    for (uint32_t lodMax : {4u, 8u}) {
        for (int lod = 1; lod <= int(lodMax) + 2; ++lod) {
            CHECK(pmremMip(lodMax, lod - 1) == float(int(lodMax) - lod + 1));
            CHECK(pmremMip(lodMax, lod) == float(int(lodMax) - lod));
        }
        // Last copy (mip -2): filterInt = 6, so it reads the sixth extra tile at x = 288.
        CHECK((4.0f - pmremMip(lodMax, int(lodMax) + 2)) * 48.0f == 288.0f);
    }
    const StandardPrograms programs = buildStandard(StandardMaterial{});
    for (const std::string& d : programs.diagnostics) std::fprintf(stderr, "%s\n", d.c_str());
    CHECK(programs.diagnostics.empty());
    CHECK(WgslEmitter::emit(programs.vertex, 0).ok());
    CHECK(WgslEmitter::emit(programs.fragment, 1).ok());
    // The environment variant must emit explicit cubeUV taps and keep derivatives before branches.
    VertexVariant environment;
    environment.environment = true;
    CHECK(environment.key() != VertexVariant{}.key());
    for (bool physical : {false, true}) {
        const auto lit = physical ? buildPhysical(StandardMaterial{}, environment, LightLayout{"d"})
                                  : buildStandard(StandardMaterial{}, environment, LightLayout{"d"});
        CHECK(lit.diagnostics.empty());
        const auto fragment = WgslEmitter::emit(lit.fragment, 1);
        CHECK(fragment.ok());
        CHECK(fragment.code.find("textureSampleLevel(t_env") != std::string::npos);
        CHECK(fragment.code.find("f_envMapIntensity") != std::string::npos);
        CHECK(fragment.code.rfind("dpdx") < fragment.code.find("if ("));
        // EnvironmentNode's pow4 is ((r*r)*r)*r, not (r*r)*(r*r): f32 rounding is observable.
        bool reflectionMix = false;
        bool mipDenominators = false;
        for (ExprId id = 1; id <= lit.fragment.exprCount(); ++id) {
            const Expr& mix = lit.fragment.expr(id);
            // three's unsuffixed WGSL breakpoint subtraction folds in abstract-float precision.
            if (mix.op == Op::Div) {
                const Expr& numerator = lit.fragment.expr(mix.args[0]);
                if (numerator.op == Op::Mul) {
                    const Expr& delta = lit.fragment.expr(numerator.args[0]);
                    if (delta.op == Op::Sub && lit.fragment.expr(delta.args[0]).op == Op::Constant &&
                        lit.fragment.expr(delta.args[1]).op == Op::LoadVar) {
                        const float high = std::bit_cast<float>(uint32_t(lit.fragment.expr(delta.args[0]).immediate));
                        const float expected = high == 1.0f ? 0.2f : high == 0.8f ? 0.4f : 0.095f;
                        const Expr& denominator = lit.fragment.expr(mix.args[1]);
                        CHECK(denominator.op == Op::Constant && denominator.immediate == std::bit_cast<uint32_t>(expected));
                        mipDenominators = true;
                    }
                }
            }
            if (mix.op != Op::Call || mix.argc != 3) continue;
            const Expr& reflection = lit.fragment.expr(mix.args[0]);
            if (reflection.op != Op::Call || reflection.argc != 2) continue;
            const Expr& incident = lit.fragment.expr(reflection.args[0]);
            if (incident.op != Op::Neg) continue;
            const Expr& fourth = lit.fragment.expr(mix.args[2]);
            CHECK(fourth.op == Op::Mul);
            const Expr& third = lit.fragment.expr(fourth.args[0]);
            CHECK(third.op == Op::Mul && third.args[1] == fourth.args[1]);
            const Expr& second = lit.fragment.expr(third.args[0]);
            CHECK(second.op == Op::Mul && second.args[0] == fourth.args[1] && second.args[1] == fourth.args[1]);
            reflectionMix = true;
        }
        CHECK(reflectionMix);
        CHECK(mipDenominators);
    }
}

}  // namespace

TN_TEST_MAIN({"unsupported", unsupported}, {"builds", builds})
