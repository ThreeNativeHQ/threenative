#include "check.h"
#include "engine/shader/standard.h"
#include "engine/shader/wgsl.h"

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
    const StandardPrograms programs = buildStandard(StandardMaterial{});
    for (const std::string& d : programs.diagnostics) std::fprintf(stderr, "%s\n", d.c_str());
    CHECK(programs.diagnostics.empty());
    CHECK(WgslEmitter::emit(programs.vertex, 0).ok());
    CHECK(WgslEmitter::emit(programs.fragment, 1).ok());
}

}  // namespace

TN_TEST_MAIN({"unsupported", unsupported}, {"builds", builds})
