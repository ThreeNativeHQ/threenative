#pragma once

// Scene, Group and Mesh, ported from three@0.185.1 src/scenes/Scene.js, src/objects/Group.js and
// src/objects/Mesh.js.
//
// Not ported, and why:
//   - `Scene`'s background/environment/fog/overrideMaterial are `Color`, `Texture`, `Fog` and
//     `Material` values (N08/N09), so they are opaque pointers here until those classes exist. Their
//     numeric companions (intensity, blurriness, the two rotations) are ported.
//   - `Mesh`'s morph targets, `getVertexPosition` and `raycast` need BufferGeometry (PRD-508 phase 3),
//     so `geometry` and `material` are opaque pointers for now.
//   - `toJSON`, `clone`: out of scope for the object model, as in Object3D.

#include <memory>
#include <string_view>

#include "engine/foundation/math/Color.h"
#include "engine/foundation/math/Matrix.h"
#include "engine/scene/geometry.h"
#include "engine/scene/object3d.h"

namespace tn::engine {

class BufferGeometry;
class Material;
class Texture;

/** three's Scene: an Object3D root plus what the renderer reads about the whole frame. */
class Scene : public Object3D {
  public:
    [[nodiscard]] std::string_view type() const override { return "Scene"; }

    std::shared_ptr<Color> background; // null = no background
    std::shared_ptr<Texture> environment;
    void* fog = nullptr;               // Fog* or FogExp2*
    void* overrideMaterial = nullptr;

    double backgroundBlurriness = 0;
    double backgroundIntensity = 1;
    Euler backgroundRotation;
    double environmentIntensity = 1;
    Euler environmentRotation;

    /** three's `copy`, minus the `clone()` of each opaque pointer: those need their own classes. */
    Scene& copy(const Scene& source);
};

/** three's Group: an Object3D with no members, so a name reads better than `new Object3D()`. */
class Group : public Object3D {
  public:
    [[nodiscard]] std::string_view type() const override { return "Group"; }
};

/** three's Mesh: an Object3D that also carries a geometry and a material. */
class Mesh : public Object3D {
  public:
    Mesh() = default;
    Mesh(std::shared_ptr<BufferGeometry> geometry, std::shared_ptr<Material> material)
        : geometry(std::move(geometry)), material(std::move(material)) {
        updateMorphTargets();
    }

    /** three's updateMorphTargets: one zero influence per morph target the geometry carries. */
    void updateMorphTargets() {
        morphTargetInfluences.clear();
        if (!geometry) return;
        const std::size_t count = !geometry->morphPositions.empty() ? geometry->morphPositions.size()
                                                                     : geometry->morphNormals.size();
        morphTargetInfluences.assign(count, 0.0);
    }
    std::vector<double> morphTargetInfluences;

    [[nodiscard]] std::string_view type() const override { return "Mesh"; }

    // Shared, as a three Mesh references its geometry and material: the mesh keeps them alive while
    // it draws them. A material array (groups) arrives with PRD-514's multi-material work.
    std::shared_ptr<BufferGeometry> geometry;
    std::shared_ptr<Material> material;
};

/**
 * three's InstancedMesh: one geometry and material drawn `count` times, each through its own matrix
 * and, once `setColorAt` has made the attribute, its own colour. Like three, the instance arrays are
 * float32, every matrix starts as the identity, and a write through `setMatrixAt`/`setColorAt` reaches
 * the GPU when the attribute's `setNeedsUpdate()` (three's `needsUpdate = true`) is called.
 */
class InstancedMesh : public Mesh {
  public:
    InstancedMesh(std::shared_ptr<BufferGeometry> geometry, std::shared_ptr<Material> material, uint32_t count);

    [[nodiscard]] std::string_view type() const override { return "InstancedMesh"; }

    InstancedMesh& setMatrixAt(uint32_t index, const Matrix4& matrix);
    Matrix4& getMatrixAt(uint32_t index, Matrix4& target) const;
    InstancedMesh& setColorAt(uint32_t index, const Color& color);
    Color& getColorAt(uint32_t index, Color& target) const;

    /** three's `Mesh.boundingSphere`, which InstancedMesh computes over its instances, not the geometry. */
    std::shared_ptr<Sphere> boundingSphere;
    /** three's `InstancedMesh.computeBoundingSphere`: the union of every drawn instance's own sphere. */
    void computeBoundingSphere();

    std::shared_ptr<BufferAttribute> instanceMatrix; // 16 floats per instance
    std::shared_ptr<BufferAttribute> instanceColor;  // 3 floats per instance; null until setColorAt
    uint32_t count;                                  // how many instances draw (at most the capacity)
};

} // namespace tn::engine