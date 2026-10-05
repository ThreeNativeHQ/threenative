#pragma once

// three@0.185.1's lights the native renderer draws (PRD-514): Light, AmbientLight, DirectionalLight,
// HemisphereLight, PointLight and SpotLight. Skipped: shadows (`light.shadow`, PRD-514 phase 3),
// RectAreaLight/LightProbe (not yet drawn), SpotLight.map, dispose, toJSON.

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

/** three's PointLight: light from its world position; `distance` 0 is no cutoff; `decay` 2 is physical. */
class PointLight : public Light {
public:
    explicit PointLight(Color color = Color(1, 1, 1), double intensity = 1, double distance = 0, double decay = 2)
        : Light(color, intensity), distance(distance), decay(decay) {}
    [[nodiscard]] std::string_view type() const override { return "PointLight"; }
    double distance;
    double decay;
};

/** three's SpotLight: a point light limited to a cone towards `target` (off the scene by default). */
class SpotLight : public Light {
public:
    explicit SpotLight(Color color = Color(1, 1, 1), double intensity = 1, double distance = 0,
                       double angle = 1.0471975511965976, double penumbra = 0, double decay = 2);
    [[nodiscard]] std::string_view type() const override { return "SpotLight"; }
    double distance;
    double angle;    // radians, the cone's half angle; three's default is PI / 3
    double penumbra; // 0..1, the fraction of the cone that fades
    double decay;
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
