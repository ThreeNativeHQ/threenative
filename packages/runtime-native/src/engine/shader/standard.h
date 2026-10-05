#pragma once

#include <array>
#include <string>
#include <vector>

#include "engine/shader/ir.h"

namespace tn::engine::shader {

/**
 * MeshStandardMaterial / MeshPhysicalMaterial as the native engine reads them (PRD-512). Every field
 * defaults to the three@0.185.1 constructor value. A physical feature the native engine has not
 * ported is refused by name, never drawn as a simpler shader (§9.3).
 */
struct StandardMaterial {
    std::array<float, 3> color{1, 1, 1};
    float opacity = 1;
    float alphaTest = 0;  // > 0: fragments with opacity <= alphaTest are discarded
    float roughness = 1;
    float metalness = 0;
    std::array<float, 3> emissive{0, 0, 0};
    float emissiveIntensity = 1;
    // MeshPhongMaterial.specular and .shininess; read by buildPhong. three's default is
    // Color(0x111111), which setHex converts from sRGB: SRGBToLinear(17/255) = 0.0056053916.
    std::array<float, 3> specular{0.0056053916f, 0.0056053916f, 0.0056053916f};
    float shininess = 30;
    // MeshPhysicalMaterial: any non-default value is a feature in use.
    float clearcoat = 0;
    float sheen = 0;
    float transmission = 0;
    float iridescence = 0;
    float anisotropy = 0;
    float dispersion = 0;
};

/** TN_MATERIAL_UNSUPPORTED <feature> for each physical feature in use and not yet ported. */
std::vector<std::string> unsupportedFeatures(const StandardMaterial& material);

struct StandardPrograms {
    Program vertex{Stage::Vertex};
    Program fragment{Stage::Fragment};
    std::vector<std::string> diagnostics;  // TN_MATERIAL_UNSUPPORTED ...; empty when drawable
};

/**
 * Builds the standard material's two stages from the pinned node chain: BRDF_GGX_Multiscatter with
 * the DFG lookup, Lambert diffuse, getRoughness with geometry roughness, one directional, one
 * hemisphere and one ambient light (the N09 renderer generalizes lights). It writes linear HDR
 * colour; the output pass (output.h) tone maps and encodes it.
 * Uniforms: modelMatrix, viewMatrix, projectionMatrix, normalMatrix (vertex); diffuse (rgb,
 * opacity), roughness, metalness, emissive, directionalDirection (view space), directionalColor,
 * hemisphereSky, hemisphereGround, hemisphereDirection (world), ambient (fragment); texture "dfg".
 */
StandardPrograms buildStandard(const StandardMaterial& material);

/**
 * MeshLambertNodeMaterial: PhongLightingModel with specular off — BRDF_Lambert direct and indirect
 * diffuse, no specular. Same vertex and light uniforms as the standard program; it reads no dfg,
 * metalness or roughness. Linear HDR out, materialAlpha tail.
 */
StandardPrograms buildLambert();

/**
 * MeshPhongNodeMaterial: PhongLightingModel with the Blinn-Phong specular term
 * (BRDF_BlinnPhong: F_Schlick with `specular` f0 and f90 1, G 0.25, D_BlinnPhong with `shininess`).
 * Same uniforms as buildLambert plus specular (vec3) and shininess (f32). Linear HDR out.
 */
StandardPrograms buildPhong();

/**
 * MeshBasicMaterial with no maps and no environment: BasicLightingModel's indirect diffuse is
 * 1 x AO x diffuseColor, so the outgoing light is the colour itself. Same vertex uniforms as the
 * standard program (normalMatrix unused); fragment uniform diffuse (rgb, opacity). Linear out.
 */
StandardPrograms buildBasic();

/**
 * NodeMaterial.setupDiffuseColor's alpha tail, shared by every material program: discard when
 * alphaTest > 0 and alpha <= alphaTest, then alpha 1 for an opaque material (builder.isOpaque()).
 * Uniform-driven (uniforms "alphaTest", "opaque" 0/1) rather than per-variant programs; the output is
 * the same. Returns the alpha to write.
 */
ExprId materialAlpha(Program& f, ExprId alpha);

}  // namespace tn::engine::shader
