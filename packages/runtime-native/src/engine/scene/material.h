#pragma once
#include <memory>
#include <map>

// three@0.185.1's Material and the five mesh materials, as the properties the native renderer
// reads (PRD-514). One class carries every type's fields; `type` says which three class it is, and
// each constructor sets that class's defaults. Skipped: maps (no texture binding yet), blending
// modes other than NormalBlending, stencil, clipping planes, polygon offset, dithering, fog, node
// slots (colorNode etc.), userData, clone/toJSON. Physical features beyond ior/specular are kept as
// numbers so the renderer can refuse them by name (TN_MATERIAL_UNSUPPORTED) rather than drop them.

#include <cstdint>
#include <string>
#include <string_view>

#include "engine/foundation/math/Color.h"
#include "engine/shader/position_node.h"

namespace tn::engine {

enum class MaterialType : uint8_t { Basic, Lambert, Phong, Standard, Physical };
enum class Side : uint8_t { Front = 0, Back = 1, Double = 2 };  // three's FrontSide/BackSide/DoubleSide

/**
 * A texture as a material slot names it: until the native texture path (N07) owns image data, a
 * loaded glTF texture records its name and the glTF image it reads.
 */
struct Texture {
    std::string name;
    int source = -1; // the glTF image index
};

class Material {
public:
    explicit Material(MaterialType type);
    [[nodiscard]] std::string_view typeName() const;  // "MeshStandardMaterial", ...

    const MaterialType type;
    const uint32_t id;  // three's material id counter
    std::string name;

    // Material
    bool transparent = false;
    double opacity = 1;
    double alphaTest = 0;
    bool depthTest = true;
    bool depthWrite = true;
    Side side = Side::Front;
    bool visible = true;
    bool toneMapped = true;
    /** NodeMaterial.positionNode: a builder graph replacing the local position; null keeps it. */
    std::shared_ptr<const shader::PositionNode> positionNode;

    // Mesh*Material
    Color color{1, 1, 1};
    Color emissive{0, 0, 0};
    double emissiveIntensity = 1;
    double roughness = 1;            // Standard, Physical
    double metalness = 0;            // Standard, Physical
    Color specular;                  // Phong: Color(0x111111)
    double shininess = 30;           // Phong
    double ior = 1.5;                // Physical
    double specularIntensity = 1;    // Physical
    Color specularColor{1, 1, 1};    // Physical
    double clearcoat = 0, sheen = 0, transmission = 0, iridescence = 0, anisotropy = 0, dispersion = 0;
    bool vertexColors = false;
    bool flatShading = false;
    double normalScaleX = 1, normalScaleY = 1; // normalScale
    double aoMapIntensity = 1;
    // Texture slots by three's property name (`map`, `normalMap`, ...); empty slots are absent.
    std::map<std::string, std::shared_ptr<const Texture>> maps;

    /** three's `material.needsUpdate = true`: the renderer rebuilds what depends on the material. */
    void needsUpdate() { ++version_; }
    [[nodiscard]] uint32_t version() const { return version_; }

private:
    uint32_t version_ = 0;
};

}  // namespace tn::engine
