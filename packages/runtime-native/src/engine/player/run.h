#pragma once

#include <cstdint>
#include <functional>
#include <string>

#include "engine/foundation/json.h"
#include "engine/scene/object3d.h"

namespace tn::engine {

class Camera;

namespace inspect {
class Endpoint;
}  // namespace inspect

namespace player {

/**
 * One desktop game for the native-engine player loop (PRD-529, PRD-531 phase 3): the world, the
 * camera, the per-tick update and the resources the inspect endpoint samples. The loop owns the SDL
 * window, the renderer, the mailbox and screenshots; a game owns only what it draws, so the JS-free
 * C++ demo and a game bundle on V8 share the same window, loop, mailbox and render path.
 */
struct Game {
    std::string name = "inspect-demo";
    Object3D* scene = nullptr;
    Camera* camera = nullptr;
    /** The game runtime named in `describe` and `sample.profile`: "cpp" for a built-in game, "v8"
     *  for a game bundle on the V8 adapter. */
    std::string gameRuntime = "cpp";
    /** One fixed tick; `dt` is the step in seconds. The loop calls it once per `advance` tick. */
    std::function<void(double dt)> update;
    /** A registered resource by id, or null. The loop answers `profile` itself; the `tick` is the
     *  simulation tick that last ran, for a state snapshot. */
    std::function<json::Value(const std::string& id, uint64_t tick)> resource;
    /** A hook after each frame's render (the V8 adapter's callback safe point). */
    std::function<void()> afterRender;
    /** Binds the endpoint, so a game reads the input queued for each tick itself. */
    std::function<void(inspect::Endpoint& endpoint)> attach;
};

/** Runs one game until the window closes or the runner stops the process. */
int run(const Game& game);

}  // namespace player
}  // namespace tn::engine
