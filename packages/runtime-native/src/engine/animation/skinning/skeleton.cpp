// Bone and Skeleton (PRD-518 phase 1): three@0.185.1 src/objects/Bone.js and Skeleton.js, method
// for method, over the ported Object3D and Matrix4. Skeleton never throws; a null bone slot is
// three's `undefined`, skipped by pose and replaced by the identity in update.

#include "engine/animation/skinning/skeleton.h"

#include <cstddef>
#include <utility>

namespace tn::engine {

Skeleton::Skeleton(std::vector<std::shared_ptr<Bone>> bones, std::vector<Matrix4> boneInverses)
    : bones(std::move(bones)), boneInverses(std::move(boneInverses)) {
    init();
}

void Skeleton::init() {
    boneMatrices.assign(bones.size() * 16, 0.0f);

    if (boneInverses.empty()) {
        calculateInverses();
    } else if (bones.size() != boneInverses.size()) {
        // three warns and rebuilds one identity per bone.
        boneInverses.assign(bones.size(), Matrix4{});
    }
}

void Skeleton::calculateInverses() {
    boneInverses.clear();
    for (std::size_t i = 0; i < bones.size(); ++i) {
        Matrix4 inverse;
        if (bones[i]) inverse.copy(bones[i]->matrixWorld).invert();
        boneInverses.push_back(inverse);
    }
}

void Skeleton::pose() {
    // Recover the bind-time world matrices.
    for (std::size_t i = 0; i < bones.size(); ++i) {
        if (bones[i]) bones[i]->matrixWorld.copy(boneInverses[i]).invert();
    }

    // Compute the local matrices, positions, rotations and scales.
    for (std::size_t i = 0; i < bones.size(); ++i) {
        Bone* bone = bones[i].get();
        if (bone == nullptr) continue;
        if (bone->parent != nullptr && dynamic_cast<Bone*>(bone->parent) != nullptr) {
            bone->matrix.copy(bone->parent->matrixWorld).invert();
            bone->matrix.multiply(bone->matrixWorld);
        } else {
            bone->matrix.copy(bone->matrixWorld);
        }
        bone->matrix.decompose(bone->position, bone->quaternion, bone->scale);
    }
}

void Skeleton::update() {
    static const Matrix4 identity{};
    Matrix4 offset;
    for (std::size_t i = 0; i < bones.size(); ++i) {
        const Matrix4& matrix = bones[i] ? bones[i]->matrixWorld : identity;
        offset.multiplyMatrices(matrix, boneInverses[i]);
        for (std::size_t k = 0; k < 16; ++k)
            boneMatrices[i * 16 + k] = static_cast<float>(offset.elements[k]);
    }
}

Bone* Skeleton::getBoneByName(std::string_view name) const {
    for (const std::shared_ptr<Bone>& bone : bones) {
        if (bone && bone->name == name) return bone.get();
    }
    return nullptr;
}

void SkinnedMesh::bind(std::shared_ptr<Skeleton> next, const Matrix4* matrix) {
    skeleton = std::move(next);
    if (matrix == nullptr) {
        updateMatrixWorld(true);
        if (skeleton) skeleton->calculateInverses();
        matrix = &matrixWorld;
    }
    bindMatrix.copy(*matrix);
    bindMatrixInverse.copy(*matrix).invert();
}

void SkinnedMesh::updateMatrixWorld(bool force) {
    Mesh::updateMatrixWorld(force);
    if (attached) bindMatrixInverse.copy(matrixWorld).invert();
    else bindMatrixInverse.copy(bindMatrix).invert();
}

} // namespace tn::engine
