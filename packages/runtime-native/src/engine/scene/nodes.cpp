// Scene: three@0.185.1 src/scenes/Scene.js. Group adds nothing to Object3D and Mesh only carries the
// two opaque pointers, so only `copy` has a body.

#include "engine/scene/nodes.h"

#include <array>

namespace tn::engine {

Scene& Scene::copy(const Scene& source) {
    Object3D::copy(source);
    // three clones background, environment, fog and overrideMaterial here; each is a class this port
    // does not own yet (N08/N09), so the pointers carry over instead and the values are shared.
    background = source.background;
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

} // namespace tn::engine