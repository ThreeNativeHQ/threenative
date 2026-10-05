#include "check.h"
#include "engine/shader/tonemap.h"
#include "engine/shader/wgsl.h"

#include <cstdio>

using namespace tn::engine::shader;

namespace {

// Every operator builds well-typed IR and emits WGSL; the GPU validates it in the shader suites.
void operators() {
    for (ToneMapping m : {ToneMapping::Linear, ToneMapping::Reinhard, ToneMapping::Cineon, ToneMapping::ACESFilmic,
                          ToneMapping::AgX, ToneMapping::Neutral}) {
        Program p(Stage::Fragment);
        const ExprId color = p.swizzle(p.varying("hdr", Type::vec(4)), "rgb");
        const ExprId mapped = toneMap(p, m, color, p.uniform("toneMappingExposure", Type::f32()));
        CHECK(p.expr(mapped).type == Type::vec(3));
        p.output("color", p.construct(Type::vec(4), {mapped, p.constant(1.0f)}));
        for (const Diagnostic& d : p.diagnostics()) std::fprintf(stderr, "%s %s %s:%u\n", d.node.c_str(), d.reason.c_str(), d.file.c_str(), d.line);
        CHECK(p.ok());
        CHECK(WgslEmitter::emit(p).ok());
    }
}

}  // namespace

TN_TEST_MAIN({"operators", operators})
