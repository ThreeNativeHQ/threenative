#pragma once

// three@0.185.1's lights the native renderer draws (PRD-514): Light, AmbientLight,
// DirectionalLight and HemisphereLight. Skipped: shadows (`light.shadow`, PRD-514 phase 3),
// PointLight/SpotLight/RectAreaLight/LightProbe (not yet drawn), dispose, toJSON.

#include <memory>

#include "engine/foundation/math/Color.h"
#include "engine/scene/object3d.h"

namespace tn::engine {

class Light : public Object3D {
public:
    explicit Light(Color color = Color(1, 1, 1), double intensity = 1) : color(color), intensity(intensity) {}
    [[nodiscard]] std::string_view type() const override { return "Light"; }
    Color color;
    double intensity;
};

class AmbientLight : public Light {
public:
    using Light::Light;
    [[nodiscard]] std::string_view type() const override { return "AmbientLight"; }
};

class DirectionalLight : public Light {
public:
    explicit DirectionalLight(Color color = Color(1, 1, 1), double intensity = 1);
    [[nodiscard]] std::string_view type() const override { return "DirectionalLight"; }
    /** The light points from its position towards target's world position; not in the scene by default. */
    std::unique_ptr<Object3D> ownTarget;
    Object3D* target;
};

class HemisphereLight : public Light {
public:
    HemisphereLight(Color skyColor = Color(1, 1, 1), Color groundColor = Color(1, 1, 1), double intensity = 1);
    [[nodiscard]] std::string_view type() const override { return "HemisphereLight"; }
    Color groundColor;
};

}  // namespace tn::engine
