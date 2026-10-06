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

void builds() {
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
