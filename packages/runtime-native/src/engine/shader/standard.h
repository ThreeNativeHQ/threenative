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
    float roughness = 1;
    float metalness = 0;
    std::array<float, 3> emissive{0, 0, 0};
    float emissiveIntensity = 1;
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
 * MeshBasicMaterial with no maps and no environment: BasicLightingModel's indirect diffuse is
 * 1 x AO x diffuseColor, so the outgoing light is the colour itself. Same vertex uniforms as the
 * standard program (normalMatrix unused); fragment uniform diffuse (rgb, opacity). Linear out.
 */
StandardPrograms buildBasic();

}  // namespace tn::engine::shader
