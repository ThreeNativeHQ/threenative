#pragma once

#include <string>

#include "engine/inspect/endpoint.h"
#include "engine/scene/camera.h"
#include "engine/scene/lights.h"
#include "engine/scene/nodes.h"

namespace tn::engine::player {

/**
 * `inspect-demo`, the one built-in game (PRD-529 phase 2): no scripting, so a playtest proves the
 * engine and not a bundle. A floor, a named box `player`, a named sphere `beacon` under a
 * directional light, and the held arrow or WASD keys move `player` 0.1 per tick on the floor plane.
 */
class InspectDemo {
  public:
    explicit InspectDemo(std::string name = "inspect-demo");

    Scene& scene() { return scene_; }
    const Scene& scene() const { return scene_; }
    PerspectiveCamera& camera() { return camera_; }
    const std::string& name() const { return name_; }

    /**
     * One fixed tick. The endpoint's queued input is taken first, so input injected before tick N is
     * read by tick N's game code (PRD-529 phase 1, box 41) rather than tick N+1.
     */
    void step(inspect::Endpoint& endpoint);

  private:
    void apply(const inspect::InputEvent& event);

    std::string name_;
    Scene scene_;
    PerspectiveCamera camera_;
    Mesh floor_;
    Mesh player_;
    Mesh beacon_;
    DirectionalLight light_;
    bool heldLeft_ = false, heldRight_ = false, heldForward_ = false, heldBack_ = false;
};

}  // namespace tn::engine::player