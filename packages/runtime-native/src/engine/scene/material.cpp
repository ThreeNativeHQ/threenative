#include "engine/scene/material.h"

namespace tn::engine {

namespace {
uint32_t nextMaterialId = 0;  // three's `_materialId`
}

Material::Material(MaterialType t, bool node) : type(t), nodeMaterial(node), id(nextMaterialId++) {
    specular.setHex(0x111111);  // MeshPhongMaterial's default, through ColorManagement as setHex does
}

std::shared_ptr<Material> Material::clone() const {
    auto copy = std::make_shared<Material>(*this);
    copy->id = nextMaterialId++;
    copy->version_ = 0;
    return copy;
}

std::string_view Material::typeName() const {
    if (spriteMaterial) return nodeMaterial ? "SpriteNodeMaterial" : "SpriteMaterial";
    if (lineMaterial) return "LineBasicMaterial";
    if (nodeMaterial) return type == MaterialType::Basic ? "MeshBasicNodeMaterial" : "MeshStandardNodeMaterial";
    switch (type) {
        case MaterialType::Basic: return "MeshBasicMaterial";
        case MaterialType::Lambert: return "MeshLambertMaterial";
        case MaterialType::Phong: return "MeshPhongMaterial";
        case MaterialType::Standard: return "MeshStandardMaterial";
        case MaterialType::Physical: return "MeshPhysicalMaterial";
    }
    return "Material";
}

}  // namespace tn::engine
