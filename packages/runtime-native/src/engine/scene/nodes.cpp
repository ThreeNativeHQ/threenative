// Scene: three@0.185.1 src/scenes/Scene.js. Group adds nothing to Object3D and Mesh only carries the
// two opaque pointers, so only `copy` has a body.

#include "engine/scene/nodes.h"

#include <array>
#include "engine/scene/geometries.h"
#include "engine/scene/material.h"

namespace tn::engine {

Box3& Box3::setFromObject(Object3D& object, bool precise) {
    makeEmpty();
    return expandByObject(object, precise);
}

Box3& Box3::expandByObject(Object3D& object, bool precise) {
    object.updateWorldMatrix(false, false);
    if (auto* mesh = dynamic_cast<Mesh*>(&object); mesh && mesh->geometry) {
        const auto position = mesh->geometry->getAttribute("position");
        if (precise && position && dynamic_cast<InstancedMesh*>(mesh) == nullptr) {
            Vector3 vertex;
            for (uint64_t i = 0; i < position->count(); ++i) {
                mesh->getVertexPosition(i, vertex);
                expandByPoint(vertex.applyMatrix4(object.matrixWorld));
            }
        } else {
            Box3 box;
            box.copy(mesh->cachedBounds()).applyMatrix4(object.matrixWorld);
            unionWith(box);
        }
    }
    const auto count = object.children.size();
    for (size_t i = 0; i < count; ++i) expandByObject(*object.children[i], precise);
    return *this;
}

const Box3& Mesh::cachedBounds() {
    if (!geometry->boundingBox) geometry->computeBoundingBox();
    return *geometry->boundingBox;
}

const Box3& InstancedMesh::cachedBounds() {
    if (!boundingBox) computeBoundingBox();
    return *boundingBox;
}

void InstancedMesh::computeBoundingBox() {
    if (!boundingBox) boundingBox = std::make_shared<Box3>();
    boundingBox->makeEmpty();
    if (!geometry) return;
    if (!geometry->boundingBox) geometry->computeBoundingBox();
    Matrix4 instance;
    Box3 box;
    for (uint32_t i = 0; i < count; ++i) {
        getMatrixAt(i, instance);
        box.copy(*geometry->boundingBox).applyMatrix4(instance);
        boundingBox->unionWith(box);
    }
}

Scene& Scene::copy(const Scene& source) {
    Object3D::copy(source);
    // Resource clone support is not ported: this copy retains shared background/environment/fog
    // resources, as the existing scene copy contract does.
    background = source.background;
    backgroundTexture = source.backgroundTexture;
    environment = source.environment;
    fog = source.fog;
    overrideMaterial = source.overrideMaterial;
    backgroundBlurriness = source.backgroundBlurriness;
    backgroundIntensity = source.backgroundIntensity;
    backgroundRotation.copy(source.backgroundRotation);
    environmentIntensity = source.environmentIntensity;
    environmentRotation.copy(source.environmentRotation);
    matrixAutoUpdate = source.matrixAutoUpdate;
    return *this;
}

Sprite::Sprite(std::shared_ptr<Material> m) : Mesh(makePlaneGeometry(), std::move(m)) {
    if (!material) {
        material = std::make_shared<Material>(MaterialType::Basic);
        material->spriteMaterial = true;
        material->fog = false;
        material->transparent = true;
    }
}

InstancedMesh::InstancedMesh(std::shared_ptr<BufferGeometry> g, std::shared_ptr<Material> m, uint32_t instances)
    : Mesh(std::move(g), std::move(m)),
      instanceMatrix(std::make_shared<BufferAttribute>(Scalar::F32, uint64_t{instances} * 16, 16)), count(instances) {
    const Matrix4 identity;
    for (uint32_t i = 0; i < instances; ++i)
        setMatrixAt(i, identity);
}

InstancedMesh& InstancedMesh::setMatrixAt(uint32_t index, const Matrix4& matrix) {
    const std::array<double, 16> e = matrix.toArray();
    for (int c = 0; c < 16; ++c)
        instanceMatrix->setComponent(index, c, e[c]);
    return *this;
}

Matrix4& InstancedMesh::getMatrixAt(uint32_t index, Matrix4& target) const {
    std::array<double, 16> e{};
    for (int c = 0; c < 16; ++c)
        e[c] = instanceMatrix->getComponent(index, c);
    return target.fromArray(e.data());
}

// three creates the colour attribute on first use, every colour white, sized to the matrices.
InstancedMesh& InstancedMesh::setColorAt(uint32_t index, const Color& color) {
    if (!instanceColor) {
        const uint64_t capacity = instanceMatrix->count();
        instanceColor = BufferAttribute::fromFloats(std::vector<double>(capacity * 3, 1.0), 3);
    }
    instanceColor->setXYZ(index, color.r, color.g, color.b);
    return *this;
}

Color& InstancedMesh::getColorAt(uint32_t index, Color& target) const {
    if (!instanceColor)
        return target.setRGB(1, 1, 1); // three's answer before any setColorAt
    target.r = instanceColor->getX(index);
    target.g = instanceColor->getY(index);
    target.b = instanceColor->getZ(index);
    return target;
}

// three's InstancedMesh.computeBoundingSphere, in its order: the geometry's own sphere first, then
// every drawn instance's copy of it under its own matrix, unioned in.
void InstancedMesh::computeBoundingSphere() {
    if (!boundingSphere) boundingSphere = std::make_shared<Sphere>();
    if (!geometry) return;
    if (!geometry->boundingSphere) geometry->computeBoundingSphere();
    boundingSphere->makeEmpty();
    Matrix4 instance;
    Sphere world;
    for (uint32_t i = 0; i < count; ++i) {
        getMatrixAt(i, instance);
        world.copy(*geometry->boundingSphere).applyMatrix4(instance);
        boundingSphere->unionWith(world);
    }
}

} // namespace tn::engine
