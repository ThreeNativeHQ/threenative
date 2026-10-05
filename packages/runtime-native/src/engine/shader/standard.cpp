// The standard materials, ported from three@0.185.1's TSL node chain line by line where order of
// operations is observable: src/nodes/functions/BSDF/{F_Schlick,V_GGX_SmithCorrelated,D_GGX,
// BRDF_GGX,BRDF_GGX_Multiscatter,BRDF_Lambert,DFGLUT}.js, functions/material/getRoughness.js,
// functions/PhysicalLightingModel.js (direct, indirect diffuse), lighting/HemisphereLightNode.js.
// Lambert and Phong come from functions/PhongLightingModel.js (its Blinn-Phong D_BlinnPhong and
// BRDF_BlinnPhong) as materials/nodes/Mesh{Lambert,Phong}NodeMaterial.js wire them.

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

// D_BlinnPhong( dotNH ) = ( shininess * 0.5 + 1.0 ) * (1/pi) * pow( dotNH, shininess )
ExprId dBlinnPhong(Tsl& t, ExprId shininess, ExprId dotNH) {
    Program& p = t.p;
    const ExprId base = p.add(p.mul(shininess, t.f(0.5f)), t.f(1));
    return p.mul(p.mul(base, t.f(1 / kPi)), p.call("pow", {dotNH, shininess}));
}

// BRDF_BlinnPhong( lightDirection ): F_Schlick(specularColor, 1.0, dotVH) * 0.25 * D_BlinnPhong,
// with G_BlinnPhong_Implicit = float(0.25). lightDirection is view space, like normalView.
ExprId brdfBlinnPhong(Tsl& t, ExprId normalView, ExprId positionViewDirection, ExprId lightDirection,
                      ExprId specularColor, ExprId shininess) {
    Program& p = t.p;
    const ExprId halfDir = p.call("normalize", {p.add(lightDirection, positionViewDirection)});
    const ExprId dotNH = t.saturate(t.dot(normalView, halfDir));
    const ExprId dotVH = t.saturate(t.dot(positionViewDirection, halfDir));
    const ExprId F = fSchlick(t, specularColor, t.f(1), dotVH);
    return p.mul(p.mul(F, t.f(0.25f)), dBlinnPhong(t, shininess, dotNH));
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

// three's instance() on the local vertex: positionLocal = (instanceMatrix * positionLocal).xyz and
// normalLocal = transformNormal(normalLocal, instanceMatrix), i.e. normalize(transpose(inverse(
// mat3(instanceMatrix))) * normal). WGSL has no inverse(): for columns a, b, c the inverse transpose is
// mat3(cross(b, c), cross(c, a), cross(a, b)) / dot(a, cross(b, c)), the sign kept for mirrored instances.
struct LocalVertex {
    ExprId position;      // vec4, w = 1
    ExprId normal;        // vec3; kInvalid without one
    ExprId instanceColor; // vec3; kInvalid without one. Written last (outputInstanceColor): varyings
                          // take locations in first-use order, and every fragment reads it last.
};

static LocalVertex localVertex(Program& v, const VertexVariant& variant, bool withNormal) {
    ExprId position = v.attribute("position", Type::vec(3));
    ExprId normal = withNormal ? v.attribute("normal", Type::vec(3)) : kInvalid;
    if (variant.instanced) {
        const ExprId c0 = v.attribute("instanceMatrix0", Type::vec(4)), c1 = v.attribute("instanceMatrix1", Type::vec(4)),
                     c2 = v.attribute("instanceMatrix2", Type::vec(4)), c3 = v.attribute("instanceMatrix3", Type::vec(4));
        const ExprId matrix = v.construct(Type::mat(4, 4), {c0, c1, c2, c3});
        position = v.swizzle(v.mul(matrix, v.construct(Type::vec(4), {position, v.constant(1.0f)})), "xyz");
        if (withNormal) {
            const ExprId a = v.swizzle(c0, "xyz"), b = v.swizzle(c1, "xyz"), c = v.swizzle(c2, "xyz");
            const ExprId bc = v.call("cross", {b, c});
            const ExprId inverseTranspose =
                v.construct(Type::mat(3, 3), {bc, v.call("cross", {c, a}), v.call("cross", {a, b})});
            normal = v.call("normalize", {v.div(v.mul(inverseTranspose, normal), v.call("dot", {a, bc}))});
        }
    }
    const ExprId instanceColor = variant.instanceColor ? v.attribute("instanceColor", Type::vec(3)) : kInvalid;
    return {v.construct(Type::vec(4), {position, v.constant(1.0f)}), normal, instanceColor};
}

static void outputInstanceColor(Program& v, const LocalVertex& local) {
    if (local.instanceColor != kInvalid) v.output("instanceColor", local.instanceColor);
}

// setupDiffuseColor: an instanced mesh with instanceColor multiplies the material colour by it.
static ExprId materialColor(Program& f, const VertexVariant& variant, ExprId diffuse) {
    const ExprId color = f.swizzle(diffuse, "xyz");
    return variant.instanceColor ? f.mul(f.varying("instanceColor", Type::vec(3)), color) : color;
}

// One direct light's direction and colour, three's setupDirect for DirectionalLightNode,
// PointLightNode (directPointLight with getDistanceAttenuation) and SpotLightNode (that, times
// smoothstep(coneCos, penumbraCos, angleCos)), at the fragment's view-space position.
struct Incoming {
    ExprId direction;
    ExprId color;
};

static Incoming incoming(Program& f, Tsl& t, char kind, std::size_t index, ExprId positionView) {
    const std::string at = "light" + std::to_string(index);
    const ExprId color = f.uniform(at + "Color", Type::vec(3));
    if (kind == 'd') return {f.call("normalize", {f.uniform(at + "Direction", Type::vec(3))}), color};
    const ExprId lightVector = f.sub(f.uniform(at + "Position", Type::vec(3)), positionView);
    const ExprId direction = f.call("normalize", {lightVector});
    const ExprId distance = f.call("length", {lightVector});
    const ExprId cutoff = f.uniform(at + "Distance", Type::f32());
    const ExprId falloff = f.div(t.f(1), f.call("max", {f.call("pow", {distance, f.uniform(at + "Decay", Type::f32())}), t.f(0.01f)}));
    const ExprId cut = f.mul(falloff, t.pow2(t.saturate(t.oneMinus(t.pow2(t.pow2(f.div(distance, cutoff)))))));
    const ExprId attenuation = f.select(f.less(t.f(0), cutoff), cut, falloff);
    if (kind == 'p') return {direction, f.mul(color, attenuation)};
    const ExprId angleCos = t.dot(direction, f.call("normalize", {f.uniform(at + "Axis", Type::vec(3))}));
    const ExprId spot = f.call("smoothstep", {f.uniform(at + "ConeCos", Type::f32()), f.uniform(at + "PenumbraCos", Type::f32()), angleCos});
    return {direction, f.mul(f.mul(color, spot), attenuation)};
}

// The MeshStandardNodeMaterial / MeshPhysicalNodeMaterial body. `physical` swaps setupSpecular's
// fixed 0.04 F0 / 1 F90 for the physical ior, specularIntensity and specularColor formula; every
// other node is identical, so the standard output stays bit-identical.
static StandardPrograms buildStandardProgram(const StandardMaterial& material, bool physical,
                                             const VertexVariant& variant, const LightLayout& lights) {
    StandardPrograms out;
    out.diagnostics = unsupportedFeatures(material);
    if (!out.diagnostics.empty()) return out;

    Program& v = out.vertex;
    const ExprId model = v.uniform("modelMatrix", Type::mat(4, 4));
    const ExprId view = v.uniform("viewMatrix", Type::mat(4, 4));
    const ExprId normalMatrix = v.uniform("normalMatrix", Type::mat(3, 3));
    const LocalVertex local = localVertex(v, variant, true);
    const ExprId position = local.position, normal = local.normal;
    const ExprId positionView = v.mul(view, v.mul(model, position));
    v.output("position", v.mul(v.uniform("projectionMatrix", Type::mat(4, 4)), positionView));
    // transformNormalToView: normalize(view * vec4(modelNormalMatrix * normal, 0)), normalized per
    // vertex before it is interpolated (v_normalViewGeometry); normalMatrix is that product.
    v.output("normalView", v.call("normalize", {v.mul(normalMatrix, normal)}));
    v.output("positionView", v.swizzle(positionView, "xyz"));
    outputInstanceColor(v, local);

    Program& f = out.fragment;
    Tsl t{f};
    // normalViewGeometry is the varying renormalized (three's .normalize().toVar()); getGeometryRoughness
    // differentiates that, not the raw varying.
    const ExprId n = f.call("normalize", {f.varying("normalView", Type::vec(3))});
    const ExprId normalViewGeometry = n;
    const ExprId positionViewDirection = f.call("normalize", {f.neg(f.varying("positionView", Type::vec(3)))});
    // normalWorld = normalView.transformNormalByInverseViewMatrix(cameraViewMatrix), in the fragment:
    // normalize((vec4(normalView, 0) * viewMatrix).xyz).
    const ExprId normalWorld = f.call("normalize", {f.swizzle(f.mul(f.construct(Type::vec(4), {n, f.constant(0.0f)}),
                                                                     f.uniform("viewMatrix", Type::mat(4, 4))), "xyz")});
    const ExprId diffuse = f.uniform("diffuse", Type::vec(4));
    const ExprId diffuseColor = materialColor(f, variant, diffuse);
    const ExprId metalness = f.uniform("metalness", Type::f32());

    // getRoughness: max(roughness, 0.0525) + getGeometryRoughness, capped at 1.
    const ExprId dxy = f.call("max", {f.call("abs", {f.call("dFdx", {normalViewGeometry})}),
                                      f.call("abs", {f.call("dFdy", {normalViewGeometry})})});
    const ExprId geometryRoughness =
        f.call("max", {f.call("max", {f.swizzle(dxy, "x"), f.swizzle(dxy, "y")}), f.swizzle(dxy, "z")});
    const ExprId roughness = f.call("min", {f.add(f.call("max", {f.uniform("roughness", Type::f32()), t.f(0.0525f)}),
                                                  geometryRoughness), t.f(1)});

    // MeshStandardNodeMaterial.setupSpecular, or MeshPhysicalNodeMaterial's setupSpecular.
    // specularF90 (mix(specularIntensity, 1, metalness)) feeds only PhysicalLightingModel's indirect
    // specular, which arrives with environment lighting; direct light passes f90: 1 for every material.
    ExprId specularColorBlended;
    if (physical) {
        const ExprId ior = f.uniform("ior", Type::f32());
        const ExprId specularIntensity = f.uniform("specularIntensity", Type::f32());
        const ExprId f0Base =
            f.call("min", {f.mul(t.pow2(f.div(f.sub(ior, t.f(1)), f.add(ior, t.f(1)))),
                                 f.uniform("specularColor", Type::vec(3))),
                           f.construct(Type::vec(3), {t.f(1)})});
        const ExprId specularColor = f.mul(f0Base, specularIntensity);
        specularColorBlended = f.call("mix", {specularColor, diffuseColor, metalness});
    } else {
        specularColorBlended =
            f.call("mix", {f.construct(Type::vec(3), {t.f(0.04f)}), diffuseColor, metalness});
    }
    const ExprId diffuseContribution = f.mul(diffuseColor, t.oneMinus(metalness));
    const Surface surface{n, positionViewDirection, roughness, specularColorBlended, t.f(1), f.texture2d("dfg")};

    // PhysicalLightingModel.direct for each light, accumulated in three's order.
    const ExprId brdfLambert = f.mul(diffuseContribution, t.f(1 / kPi));
    const ExprId fragmentView = f.varying("positionView", Type::vec(3));
    ExprId directDiffuse = f.construct(Type::vec(3), {t.f(0)}), directSpecular = directDiffuse;
    for (std::size_t i = 0; i < lights.kinds.size(); ++i) {
        const Incoming light = incoming(f, t, lights.kinds[i], i, fragmentView);
        const ExprId irradiance = f.mul(t.saturate(t.dot(n, light.direction)), light.color);
        directDiffuse = f.add(directDiffuse, f.mul(irradiance, brdfLambert));
        directSpecular = f.add(directSpecular, f.mul(irradiance, brdfGgxMultiscatter(t, surface, light.direction)));
    }

    // Hemisphere and ambient irradiance, then PhysicalLightingModel.indirect diffuse.
    const ExprId hemiWeight = f.add(f.mul(t.dot(normalWorld, f.call("normalize", {f.uniform("hemisphereDirection", Type::vec(3))})), t.f(0.5f)), t.f(0.5f));
    const ExprId hemisphere = f.call("mix", {f.uniform("hemisphereGround", Type::vec(3)), f.uniform("hemisphereSky", Type::vec(3)), hemiWeight});
    const ExprId indirectIrradiance = f.add(hemisphere, f.uniform("ambient", Type::vec(3)));
    const ExprId indirectDiffuse = f.mul(indirectIrradiance, brdfLambert);

    const ExprId emissive = f.uniform("emissive", Type::vec(3));
    const ExprId outgoing = f.add(f.add(f.add(directDiffuse, directSpecular), indirectDiffuse), emissive);
    // Linear HDR out: tone mapping and the output colour space belong to the output pass (output.h).
    f.output("color", f.construct(Type::vec(4), {outgoing, materialAlpha(f, f.swizzle(diffuse, "w"))}));
    for (const Program* stage : {&out.vertex, &out.fragment}) {
        for (const Diagnostic& d : stage->diagnostics()) {
            out.diagnostics.push_back(d.code + " " + d.node + ": " + d.reason + " (" + d.file + ":" + std::to_string(d.line) + ")");
        }
    }
    return out;
}

StandardPrograms buildStandard(const StandardMaterial& material, const VertexVariant& variant, const LightLayout& lights) {
    return buildStandardProgram(material, false, variant, lights);
}
StandardPrograms buildPhysical(const StandardMaterial& material, const VertexVariant& variant, const LightLayout& lights) {
    return buildStandardProgram(material, true, variant, lights);
}

namespace {

// The PhongLightingModel chain shared by MeshLambertNodeMaterial (specular off) and
// MeshPhongNodeMaterial (Blinn-Phong specular): direct and indirect Lambert diffuse from the same
// one directional, one hemisphere and one ambient light the standard program reads.
StandardPrograms buildLit(bool phong, const VertexVariant& variant, const LightLayout& lights) {
    StandardPrograms out;
    Program& v = out.vertex;
    const ExprId model = v.uniform("modelMatrix", Type::mat(4, 4));
    const ExprId view = v.uniform("viewMatrix", Type::mat(4, 4));
    const ExprId normalMatrix = v.uniform("normalMatrix", Type::mat(3, 3));
    const LocalVertex local = localVertex(v, variant, true);
    const ExprId position = local.position, normal = local.normal;
    const ExprId positionView = v.mul(view, v.mul(model, position));
    v.output("position", v.mul(v.uniform("projectionMatrix", Type::mat(4, 4)), positionView));
    // transformNormalToView: normalize(view * vec4(modelNormalMatrix * normal, 0)), normalized per
    // vertex before it is interpolated (v_normalViewGeometry); normalMatrix is that product.
    v.output("normalView", v.call("normalize", {v.mul(normalMatrix, normal)}));
    v.output("positionView", v.swizzle(positionView, "xyz"));
    outputInstanceColor(v, local);

    Program& f = out.fragment;
    Tsl t{f};
    const ExprId n = f.call("normalize", {f.varying("normalView", Type::vec(3))});
    const ExprId positionViewDirection = f.call("normalize", {f.neg(f.varying("positionView", Type::vec(3)))});
    // normalWorld = normalView.transformNormalByInverseViewMatrix(cameraViewMatrix), in the fragment:
    // normalize((vec4(normalView, 0) * viewMatrix).xyz).
    const ExprId normalWorld = f.call("normalize", {f.swizzle(f.mul(f.construct(Type::vec(4), {n, f.constant(0.0f)}),
                                                                     f.uniform("viewMatrix", Type::mat(4, 4))), "xyz")});
    const ExprId diffuse = f.uniform("diffuse", Type::vec(4));
    const ExprId diffuseColor = materialColor(f, variant, diffuse);

    // PhongLightingModel.direct for each light, in three's order: BRDF_Lambert, and with phong the
    // Blinn-Phong specular (shininess clamped to 1e-4, the material's specular colour).
    const ExprId brdfLambert = f.mul(diffuseColor, t.f(1 / kPi));
    const ExprId fragmentView = f.varying("positionView", Type::vec(3));
    const ExprId shininess = phong ? f.call("max", {f.uniform("shininess", Type::f32()), t.f(1e-4f)}) : kInvalid;
    ExprId directDiffuse = f.construct(Type::vec(3), {t.f(0)}), directSpecular = directDiffuse;
    for (std::size_t i = 0; i < lights.kinds.size(); ++i) {
        const Incoming light = incoming(f, t, lights.kinds[i], i, fragmentView);
        const ExprId irradiance = f.mul(t.saturate(t.dot(n, light.direction)), light.color);
        directDiffuse = f.add(directDiffuse, f.mul(irradiance, brdfLambert));
        if (phong)
            directSpecular = f.add(directSpecular, f.mul(irradiance, brdfBlinnPhong(t, n, positionViewDirection, light.direction,
                                                                                 f.uniform("specular", Type::vec(3)), shininess)));
    }

    // Hemisphere and ambient irradiance, then PhongLightingModel.indirect diffuse.
    const ExprId hemiWeight = f.add(f.mul(t.dot(normalWorld, f.call("normalize", {f.uniform("hemisphereDirection", Type::vec(3))})), t.f(0.5f)), t.f(0.5f));
    const ExprId hemisphere = f.call("mix", {f.uniform("hemisphereGround", Type::vec(3)), f.uniform("hemisphereSky", Type::vec(3)), hemiWeight});
    const ExprId indirectIrradiance = f.add(hemisphere, f.uniform("ambient", Type::vec(3)));
    const ExprId indirectDiffuse = f.mul(indirectIrradiance, brdfLambert);

    ExprId lighting = f.add(directDiffuse, indirectDiffuse);
    if (phong) lighting = f.add(lighting, directSpecular);
    const ExprId emissive = f.uniform("emissive", Type::vec(3));
    const ExprId outgoing = f.add(lighting, emissive);
    // Linear HDR out: tone mapping and the output colour space belong to the output pass (output.h).
    f.output("color", f.construct(Type::vec(4), {outgoing, materialAlpha(f, f.swizzle(diffuse, "w"))}));
    for (const Program* stage : {&out.vertex, &out.fragment}) {
        for (const Diagnostic& d : stage->diagnostics()) {
            out.diagnostics.push_back(d.code + " " + d.node + ": " + d.reason + " (" + d.file + ":" + std::to_string(d.line) + ")");
        }
    }
    return out;
}

}  // namespace

StandardPrograms buildLambert(const VertexVariant& variant, const LightLayout& lights) { return buildLit(false, variant, lights); }
StandardPrograms buildPhong(const VertexVariant& variant, const LightLayout& lights) { return buildLit(true, variant, lights); }

StandardPrograms buildBasic(const VertexVariant& variant) {
    StandardPrograms out;
    Program& v = out.vertex;
    const LocalVertex local = localVertex(v, variant, false);
    v.output("position", v.mul(v.uniform("projectionMatrix", Type::mat(4, 4)),
                               v.mul(v.uniform("viewMatrix", Type::mat(4, 4)), v.mul(v.uniform("modelMatrix", Type::mat(4, 4)), local.position))));
    outputInstanceColor(v, local);
    Program& f = out.fragment;
    const ExprId diffuse = f.uniform("diffuse", Type::vec(4));
    f.output("color", f.construct(Type::vec(4), {materialColor(f, variant, diffuse), materialAlpha(f, f.swizzle(diffuse, "w"))}));
    return out;
}

ExprId materialAlpha(Program& f, ExprId alpha) {
    const ExprId alphaTest = f.uniform("alphaTest", Type::f32());
    const ExprId no = f.constant(false);
    // alpha <= alphaTest is !(alphaTest < alpha); the test applies only when alphaTest > 0.
    const ExprId atOrBelow = f.select(f.less(alphaTest, alpha), no, f.constant(true));
    f.If(f.select(f.less(f.constant(0.0f), alphaTest), atOrBelow, no), [&] { f.discard(); });
    return f.call("mix", {alpha, f.constant(1.0f), f.uniform("opaque", Type::f32())});
}

}  // namespace tn::engine::shader
