#include "engine/scene/material.h"

namespace tn::engine {

namespace {
uint32_t nextMaterialId = 0;  // three's `_materialId`
}

Material::Material(MaterialType t) : type(t), id(nextMaterialId++) {
    specular.setHex(0x111111);  // MeshPhongMaterial's default, through ColorManagement as setHex does
}

std::string_view Material::typeName() const {
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
