#pragma once

#include "engine/abi/binding.h"

namespace tn::binding {

/** The math classes (PRD-501): Vector2/3/4, Matrix3/4, Quaternion, Euler, Color and primitives. */
void registerMathBindings(Registry& classes);

/** The scene graph (PRD-508): Object3D, Scene, Group, Mesh and the cameras. */
void registerSceneBindings(Registry& classes);

/** Object3D's own getters, setters, members and methods, for a derived node to build on. */
void registerObject3DBindings(ClassBinding& b);

/** Geometry (PRD-508): BufferAttribute, BufferGeometry and the built-in generators. */
void registerGeometryBindings(Registry& classes);

/** Materials and lights (PRD-514): the five mesh materials and three lights the renderer draws. */
void registerMaterialBindings(Registry& classes);

/** Every engine class any caller can reach; each work package adds its own register function. */
inline void registerAll(Registry& classes) {
    registerMathBindings(classes);
    registerSceneBindings(classes);
    registerGeometryBindings(classes);
    registerMaterialBindings(classes);
}

}  // namespace tn::binding
