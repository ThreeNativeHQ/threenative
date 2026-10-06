#include "engine/player/demo.h"

#include <memory>

#include "engine/scene/geometries.h"
#include "engine/scene/lights.h"
#include "engine/scene/material.h"

namespace tn::engine::player {

namespace {

/** One metre per tick step, on the floor plane. */
constexpr double kStep = 0.1;

std::shared_ptr<Material> colour(double r, double g, double b, double roughness) {
    auto material = std::make_shared<Material>(MaterialType::Standard);
    material->color.setRGB(r, g, b);
    material->roughness = roughness;
    material->metalness = 0.0;
    return material;
}

}  // namespace

InspectDemo::InspectDemo(std::string name)
    : name_(std::move(name)), // A flattened box, not a rotated plane: its geometry is already horizontal, so the ground needs
      // no transform the scene graph would have to sync.
      floor_(makeBoxGeometry(40, 0.1, 40), colour(0.22, 0.24, 0.28, 0.9)),
      player_(makeBoxGeometry(1.4, 1.4, 1.4), colour(0.85, 0.35, 0.2, 0.35)),
      beacon_(makeSphereGeometry(0.7, 32, 16), colour(0.25, 0.7, 0.9, 0.25)),
      light_(Color().setHex(0xffffff), 3) {
    floor_.name = "floor";
    floor_.position.y = -0.05;  // its top face is the ground at y = 0
    player_.name = "player";
    player_.position.set(0, 0.7, 0);
    beacon_.name = "beacon";
    beacon_.position.set(-2.4, 0.7, 0.8);
    light_.position.set(4, 8, 4);

    camera_.fov = 50;
    camera_.aspect = 16.0 / 9.0;
    camera_.near = 0.1;
    camera_.far = 200;
    camera_.position.set(3.4, 2.6, 4.4);
    camera_.lookAt(0, 0.8, -1);
    camera_.updateProjectionMatrix();

    // Lights are projected by walking the scene graph, so each one is a child of the scene.
    scene_.add(floor_);
    scene_.add(player_);
    scene_.add(beacon_);
    scene_.add(light_);
}

void InspectDemo::apply(const inspect::InputEvent& event) {
    if (event.type != "keydown" && event.type != "keyup")
        return;
    // The endpoint already mapped `KeyW` to key "w"; the arrows keep their DOM key.
    const std::string& key = event.key;
    const bool down = event.type == "keydown";
    if (key == "ArrowLeft" || key == "a")
        heldLeft_ = down;
    else if (key == "ArrowRight" || key == "d")
        heldRight_ = down;
    else if (key == "ArrowUp" || key == "w")
        heldForward_ = down;
    else if (key == "ArrowDown" || key == "s")
        heldBack_ = down;
}

void InspectDemo::step(inspect::Endpoint& endpoint) {
    // The tick boundary: everything injected since the last tick is read before this tick runs.
    for (const inspect::InputEvent& event : endpoint.takeInput())
        apply(event);

    double dx = 0, dz = 0;
    if (heldRight_)
        dx += kStep;
    if (heldLeft_)
        dx -= kStep;
    if (heldBack_)
        dz += kStep;
    if (heldForward_)
        dz -= kStep;
    player_.position.x += dx;
    player_.position.z += dz;
    player_.position.y = 0.7;  // the floor keeps its feet on it
}

}  // namespace tn::engine::player