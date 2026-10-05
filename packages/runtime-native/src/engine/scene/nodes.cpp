// Scene: three@0.185.1 src/scenes/Scene.js. Group adds nothing to Object3D and Mesh only carries the
// two opaque pointers, so only `copy` has a body.

#include "engine/scene/nodes.h"

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

}  // namespace tn::engine