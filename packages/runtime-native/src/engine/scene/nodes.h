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

#include <string_view>

#include "engine/scene/object3d.h"

namespace tn::engine {

class BufferGeometry;

/** three's Scene: an Object3D root plus what the renderer reads about the whole frame. */
class Scene : public Object3D {
public:
    [[nodiscard]] std::string_view type() const override { return "Scene"; }

    void* background = nullptr;      // Color* or Texture*
    void* environment = nullptr;    // Texture*
    void* fog = nullptr;             // Fog* or FogExp2*
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
    Mesh(BufferGeometry* geometry, void* material) : geometry(geometry), material(material) {}

    [[nodiscard]] std::string_view type() const override { return "Mesh"; }

    BufferGeometry* geometry = nullptr;  // borrowed, as Object3D's children are
    void* material = nullptr;            // Material* or Material**, PRD-514
};

}  // namespace tn::engine