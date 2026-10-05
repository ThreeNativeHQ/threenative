#pragma once

#include "engine/abi/binding.h"

namespace tn::binding {

/** The math classes (PRD-501): Vector2/3/4, Matrix3/4, Quaternion, Euler, Color and primitives. */
void registerMathBindings(Registry& classes);

/** Every engine class any caller can reach; each work package adds its own register function. */
inline void registerAll(Registry& classes) { registerMathBindings(classes); }

}  // namespace tn::binding
