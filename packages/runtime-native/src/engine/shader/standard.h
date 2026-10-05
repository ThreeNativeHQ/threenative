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
    // MeshPhysicalMaterial specular inputs, read by buildPhysical. Defaults match three's
    // MeshPhysicalMaterial: ior 1.5, specularIntensity 1, specularColor linear white.
    float ior = 1.5f;
    float specularIntensity = 1;
    std::array<float, 3> specularColor{1, 1, 1};
    // MeshPhysicalMaterial: any non-default value is a feature in use.
    float clearcoat = 0;
    float sheen = 0;
    float transmission = 0;
    float iridescence = 0;
    float anisotropy = 0;
    float dispersion = 0;
};

/**
 * Per-draw vertex variants (package VariantBits). `instanced`: three's instance() — the vertex reads
 * its instance matrix as four per-instance vec4 attributes (instanceMatrix0..3), transforms
 * positionLocal by it and normalLocal by its inverse transpose. `instanceColor`: the per-instance
 * colour (attribute instanceColor) multiplies the material colour, as setupDiffuseColor does.
 */
struct VertexVariant {
    bool instanced = false;
    bool instanceColor = false;
    /**
     * three's skinning(): `skinIndex` (vec4<u32>) and `skinWeight` attributes, the frame's bone
     * matrices in the storage buffer `boneMatrices` from `boneBase` on, `bindMatrix` and
     * `bindMatrixInverse` uniforms.
     */
    bool skinned = false;
    /**
     * three's morphReference(): `morphTargets` targets read from the storage buffer `morphData`
     * (vec4 per vertex and target; a normal entry after each position one when `morphNormals`) from
     * `morphBase`, with `morphVertexCount` vertices per target; influences from `morphInfluences` at
     * `morphInfluenceBase`; the base scale `morphBaseInfluence`.
     */
    uint8_t morphTargets = 0;
    bool morphNormals = false;
    /** A stable key: two variants with the same key build the same program. */
    [[nodiscard]] std::string key() const {
        return std::to_string(instanced) + std::to_string(instanceColor) + std::to_string(skinned) + "m" +
               std::to_string(morphTargets) + (morphNormals ? "n" : "");
    }
};

/**
 * The direct lights a lit program reads, in three's LightsNode order (sorted by Object3D id): one
 * character each, 'd' directional, 'p' point, 's' spot. Light i reads `light{i}Color` (intensity
 * folded in) and, by kind, `light{i}Direction` (view space, towards the light), `light{i}Position`
 * (view space), `light{i}Distance`, `light{i}Decay`, `light{i}Axis` (view space, target to light),
 * `light{i}ConeCos` and `light{i}PenumbraCos`. An upper-case kind also casts a shadow the mesh
 * receives: `light{i}ShadowMatrix`, `ShadowBias`, `ShadowNormalBias`, `ShadowRadius`,
 * `ShadowMapSize` and `ShadowIntensity`, and the depth texture `shadow{i}`. A program is specialized per layout, as three's is per
 * lights hash; the default is the one directional light the first renderer drew.
 */
struct LightLayout {
    std::string kinds = "d";
    /** Any upper-case kind: that light's shadow map is read (`light{i}Shadow*`, texture `shadow{i}`). */
    [[nodiscard]] bool shadowed() const {
        for (const char c : kinds)
            if (c >= 'A' && c <= 'Z') return true;
        return false;
    }
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
StandardPrograms buildStandard(const StandardMaterial& material, const VertexVariant& variant = {},
                               const LightLayout& lights = {});

/**
 * MeshPhysicalNodeMaterial's non-feature path: the standard program with setupSpecular's physical
 * F0/F90 — specularColorBlended = mix(min(pow2((ior-1)/(ior+1)) * specularColor, vec3(1)) *
 * specularIntensity, diffuseColor.rgb, metalness), specularF90 = mix(specularIntensity, 1, metalness)
 * — instead of the standard's fixed 0.04 / 1. A physical feature in use (clearcoat, sheen, …) is
 * still refused by name. Same uniforms as buildStandard plus ior, specularIntensity, specularColor.
 */
StandardPrograms buildPhysical(const StandardMaterial& material, const VertexVariant& variant = {},
                               const LightLayout& lights = {});

/**
 * MeshLambertNodeMaterial: PhongLightingModel with specular off — BRDF_Lambert direct and indirect
 * diffuse, no specular. Same vertex and light uniforms as the standard program; it reads no dfg,
 * metalness or roughness. Linear HDR out, materialAlpha tail.
 */
StandardPrograms buildLambert(const VertexVariant& variant = {}, const LightLayout& lights = {});

/**
 * MeshPhongNodeMaterial: PhongLightingModel with the Blinn-Phong specular term
 * (BRDF_BlinnPhong: F_Schlick with `specular` f0 and f90 1, G 0.25, D_BlinnPhong with `shininess`).
 * Same uniforms as buildLambert plus specular (vec3) and shininess (f32). Linear HDR out.
 */
StandardPrograms buildPhong(const VertexVariant& variant = {}, const LightLayout& lights = {});

/**
 * MeshBasicMaterial with no maps and no environment: BasicLightingModel's indirect diffuse is
 * 1 x AO x diffuseColor, so the outgoing light is the colour itself. Same vertex uniforms as the
 * standard program (normalMatrix unused); fragment uniform diffuse (rgb, opacity). Linear out.
 */
StandardPrograms buildBasic(const VertexVariant& variant = {});

/**
 * NodeMaterial.setupDiffuseColor's alpha tail, shared by every material program: discard when
 * alphaTest > 0 and alpha <= alphaTest, then alpha 1 for an opaque material (builder.isOpaque()).
 * Uniform-driven (uniforms "alphaTest", "opaque" 0/1) rather than per-variant programs; the output is
 * the same. Returns the alpha to write.
 */
ExprId materialAlpha(Program& f, ExprId alpha);

}  // namespace tn::engine::shader
