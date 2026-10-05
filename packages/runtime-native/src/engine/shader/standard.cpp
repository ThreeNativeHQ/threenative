// The standard material, ported from three@0.185.1's TSL node chain line by line where order of
// operations is observable: src/nodes/functions/BSDF/{F_Schlick,V_GGX_SmithCorrelated,D_GGX,
// BRDF_GGX,BRDF_GGX_Multiscatter,BRDF_Lambert,DFGLUT}.js, functions/material/getRoughness.js,
// functions/PhysicalLightingModel.js (direct, indirect diffuse), lighting/HemisphereLightNode.js.

#include "standard.h"

#include <numbers>

namespace tn::engine::shader {

namespace {

constexpr float kPi = std::numbers::pi_v<float>;
constexpr float kEpsilon = 1e-6f;  // MathNode EPSILON

struct Tsl {
    Program& p;
    ExprId f(float v) { return p.constant(v); }
    ExprId pow2(ExprId x) { return p.mul(x, x); }
    ExprId oneMinus(ExprId x) { return p.sub(f(1), x); }
    ExprId saturate(ExprId x) { return p.call("clamp", {x, f(0), f(1)}); }
    ExprId dot(ExprId a, ExprId b) { return p.call("dot", {a, b}); }
};

// F_Schlick( f0, f90, dotVH )
ExprId fSchlick(Tsl& t, ExprId f0, ExprId f90, ExprId dotVH) {
    Program& p = t.p;
    const ExprId fresnel = p.call("exp2", {p.mul(p.sub(p.mul(dotVH, t.f(-5.55473f)), t.f(6.98316f)), dotVH)});
    return p.add(p.mul(f0, t.oneMinus(fresnel)), p.mul(f90, fresnel));
}

// V_GGX_SmithCorrelated( alpha, dotNL, dotNV )
ExprId vGgxSmithCorrelated(Tsl& t, ExprId alpha, ExprId dotNL, ExprId dotNV) {
    Program& p = t.p;
    const ExprId a2 = t.pow2(alpha);
    const ExprId gv = p.mul(dotNL, p.call("sqrt", {p.add(a2, p.mul(t.oneMinus(a2), t.pow2(dotNV)))}));
    const ExprId gl = p.mul(dotNV, p.call("sqrt", {p.add(a2, p.mul(t.oneMinus(a2), t.pow2(dotNL)))}));
    return p.div(t.f(0.5f), p.call("max", {p.add(gv, gl), t.f(kEpsilon)}));
}

// D_GGX( alpha, dotNH )
ExprId dGgx(Tsl& t, ExprId alpha, ExprId dotNH) {
    Program& p = t.p;
    const ExprId a2 = t.pow2(alpha);
    const ExprId denom = t.oneMinus(p.mul(t.pow2(dotNH), t.oneMinus(a2)));  // avoid alpha = 0 with dotNH = 1
    return p.mul(p.div(a2, t.pow2(denom)), t.f(1 / kPi));
}

struct Surface {
    ExprId normal;   // normalView
    ExprId view;     // positionViewDirection
    ExprId roughness;
    ExprId f0;       // specularColorBlended
    ExprId f90;
    uint32_t dfg;
};

// BRDF_GGX( lightDirection, f0, f90, roughness )
ExprId brdfGgx(Tsl& t, const Surface& s, ExprId light) {
    Program& p = t.p;
    const ExprId alpha = t.pow2(s.roughness);  // UE4's roughness
    const ExprId half = p.call("normalize", {p.add(light, s.view)});
    const ExprId dotNL = t.saturate(t.dot(s.normal, light));
    const ExprId dotNV = t.saturate(t.dot(s.normal, s.view));
    const ExprId dotNH = t.saturate(t.dot(s.normal, half));
    const ExprId dotVH = t.saturate(t.dot(s.view, half));
    const ExprId F = fSchlick(t, s.f0, s.f90, dotVH);
    return p.mul(p.mul(F, vGgxSmithCorrelated(t, alpha, dotNL, dotNV)), dGgx(t, alpha, dotNH));
}

// DFGLUT( roughness, dotNV ).rg
ExprId dfgLut(Tsl& t, const Surface& s, ExprId dotNV) {
    Program& p = t.p;
    return p.swizzle(p.sample(s.dfg, p.construct(Type::vec(2), {s.roughness, dotNV})), "xy");
}

// BRDF_GGX_Multiscatter
ExprId brdfGgxMultiscatter(Tsl& t, const Surface& s, ExprId light) {
    Program& p = t.p;
    const ExprId singleScatter = brdfGgx(t, s, light);
    const ExprId dotNL = t.saturate(t.dot(s.normal, light));
    const ExprId dotNV = t.saturate(t.dot(s.normal, s.view));
    const ExprId dfgV = dfgLut(t, s, dotNV);
    const ExprId dfgL = dfgLut(t, s, dotNL);
    const ExprId FssEssV = p.add(p.mul(s.f0, p.swizzle(dfgV, "x")), p.mul(s.f90, p.swizzle(dfgV, "y")));
    const ExprId FssEssL = p.add(p.mul(s.f0, p.swizzle(dfgL, "x")), p.mul(s.f90, p.swizzle(dfgL, "y")));
    const ExprId EssV = p.add(p.swizzle(dfgV, "x"), p.swizzle(dfgV, "y"));
    const ExprId EssL = p.add(p.swizzle(dfgL, "x"), p.swizzle(dfgL, "y"));
    const ExprId EmsV = p.sub(t.f(1), EssV);
    const ExprId EmsL = p.sub(t.f(1), EssL);
    const ExprId Favg = p.add(s.f0, p.mul(t.oneMinus(s.f0), t.f(0.047619f)));  // 1/21
    const ExprId Fms = p.div(p.mul(p.mul(FssEssV, FssEssL), Favg),
                             p.add(p.sub(t.f(1), p.mul(p.mul(p.mul(EmsV, EmsL), Favg), Favg)), t.f(kEpsilon)));
    const ExprId compensationFactor = p.mul(EmsV, EmsL);
    return p.add(singleScatter, p.mul(Fms, compensationFactor));
}

// sRGBTransferOETF from three's ColorSpaceFunctions.
ExprId srgbTransferOetf(Tsl& t, ExprId linear) {
    Program& p = t.p;
    const ExprId a = p.sub(p.mul(p.call("pow", {linear, p.construct(Type::vec(3), {t.f(1 / 2.4f)})}), t.f(1.055f)), t.f(0.055f));
    const ExprId b = p.mul(linear, t.f(12.92f));
    const ExprId le = p.call("step", {linear, p.construct(Type::vec(3), {t.f(0.0031308f)})});  // 1 where linear <= cutoff
    return p.call("mix", {a, b, le});
}

}  // namespace

std::vector<std::string> unsupportedFeatures(const StandardMaterial& m) {
    std::vector<std::string> out;
    auto check = [&](float value, const char* feature) {
        if (value != 0) out.push_back(std::string("TN_MATERIAL_UNSUPPORTED ") + feature);
    };
    check(m.clearcoat, "clearcoat");
    check(m.sheen, "sheen");
    check(m.transmission, "transmission");
    check(m.iridescence, "iridescence");
    check(m.anisotropy, "anisotropy");
    check(m.dispersion, "dispersion");
    return out;
}

StandardPrograms buildStandard(const StandardMaterial& material) {
    StandardPrograms out;
    out.diagnostics = unsupportedFeatures(material);
    if (!out.diagnostics.empty()) return out;

    Program& v = out.vertex;
    const ExprId model = v.uniform("modelMatrix", Type::mat(4, 4));
    const ExprId view = v.uniform("viewMatrix", Type::mat(4, 4));
    const ExprId normalMatrix = v.uniform("normalMatrix", Type::mat(3, 3));
    const ExprId position = v.construct(Type::vec(4), {v.attribute("position", Type::vec(3)), v.constant(1.0f)});
    const ExprId normal = v.attribute("normal", Type::vec(3));
    const ExprId positionView = v.mul(view, v.mul(model, position));
    v.output("position", v.mul(v.uniform("projectionMatrix", Type::mat(4, 4)), positionView));
    v.output("normalView", v.mul(normalMatrix, normal));
    v.output("positionView", v.swizzle(positionView, "xyz"));
    v.output("normalWorld", v.swizzle(v.mul(model, v.construct(Type::vec(4), {normal, v.constant(0.0f)})), "xyz"));

    Program& f = out.fragment;
    Tsl t{f};
    const ExprId normalViewGeometry = f.varying("normalView", Type::vec(3));
    const ExprId n = f.call("normalize", {normalViewGeometry});
    const ExprId positionViewDirection = f.call("normalize", {f.neg(f.varying("positionView", Type::vec(3)))});
    const ExprId normalWorld = f.call("normalize", {f.varying("normalWorld", Type::vec(3))});
    const ExprId diffuse = f.uniform("diffuse", Type::vec(4));
    const ExprId diffuseColor = f.swizzle(diffuse, "xyz");
    const ExprId metalness = f.uniform("metalness", Type::f32());

    // getRoughness: max(roughness, 0.0525) + getGeometryRoughness, capped at 1.
    const ExprId dxy = f.call("max", {f.call("abs", {f.call("dFdx", {normalViewGeometry})}),
                                      f.call("abs", {f.call("dFdy", {normalViewGeometry})})});
    const ExprId geometryRoughness =
        f.call("max", {f.call("max", {f.swizzle(dxy, "x"), f.swizzle(dxy, "y")}), f.swizzle(dxy, "z")});
    const ExprId roughness = f.call("min", {f.add(f.call("max", {f.uniform("roughness", Type::f32()), t.f(0.0525f)}),
                                                  geometryRoughness), t.f(1)});

    // MeshStandardNodeMaterial.setupSpecular / setupVariants
    const ExprId specularColorBlended =
        f.call("mix", {f.construct(Type::vec(3), {t.f(0.04f)}), diffuseColor, metalness});
    const ExprId diffuseContribution = f.mul(diffuseColor, t.oneMinus(metalness));
    const Surface surface{n, positionViewDirection, roughness, specularColorBlended, t.f(1), f.texture2d("dfg")};

    // PhysicalLightingModel.direct for the directional light.
    const ExprId lightDirection = f.call("normalize", {f.uniform("directionalDirection", Type::vec(3))});
    const ExprId irradiance = f.mul(t.saturate(t.dot(n, lightDirection)), f.uniform("directionalColor", Type::vec(3)));
    const ExprId brdfLambert = f.mul(diffuseContribution, t.f(1 / kPi));
    const ExprId directDiffuse = f.mul(irradiance, brdfLambert);
    const ExprId directSpecular = f.mul(irradiance, brdfGgxMultiscatter(t, surface, lightDirection));

    // Hemisphere and ambient irradiance, then PhysicalLightingModel.indirect diffuse.
    const ExprId hemiWeight = f.add(f.mul(t.dot(normalWorld, f.call("normalize", {f.uniform("hemisphereDirection", Type::vec(3))})), t.f(0.5f)), t.f(0.5f));
    const ExprId hemisphere = f.call("mix", {f.uniform("hemisphereGround", Type::vec(3)), f.uniform("hemisphereSky", Type::vec(3)), hemiWeight});
    const ExprId indirectIrradiance = f.add(hemisphere, f.uniform("ambient", Type::vec(3)));
    const ExprId indirectDiffuse = f.mul(indirectIrradiance, brdfLambert);

    const ExprId emissive = f.uniform("emissive", Type::vec(3));
    const ExprId outgoing = f.add(f.add(f.add(directDiffuse, directSpecular), indirectDiffuse), emissive);
    f.output("color", f.construct(Type::vec(4), {srgbTransferOetf(t, f.call("clamp", {outgoing, t.f(0), t.f(1)})),
                                                 f.swizzle(diffuse, "w")}));
    for (const Program* stage : {&out.vertex, &out.fragment}) {
        for (const Diagnostic& d : stage->diagnostics()) {
            out.diagnostics.push_back(d.code + " " + d.node + ": " + d.reason + " (" + d.file + ":" + std::to_string(d.line) + ")");
        }
    }
    return out;
}

}  // namespace tn::engine::shader
