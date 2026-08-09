#pragma once

namespace mystral::js {
class Engine;
}

namespace mystral::physics {

bool initializeNativePhysicsBindings(js::Engine* engine);

}  // namespace mystral::physics
