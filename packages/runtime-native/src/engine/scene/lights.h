#pragma once

// three@0.185.1's lights the native renderer draws (PRD-514): Light, AmbientLight, DirectionalLight,
// HemisphereLight, PointLight and SpotLight, and the directional light's shadow. Skipped: spot and
// point shadows (PRD-514 phase 3), RectAreaLight/LightProbe (not yet drawn), SpotLight.map, dispose,
// toJSON.

#include <memory>

#include "engine/foundation/math/Color.h"
#include "engine/foundation/math/Vector.h"
#include "engine/scene/camera.h"
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

/**
 * three's LightShadow with its defaults: the camera the shadow map is drawn from, the map's size in
 * texels, and the receiver-side bias, normal offset, filter radius and darkness.
 */
class LightShadow {
public:
    explicit LightShadow(std::unique_ptr<Camera> camera) : camera(std::move(camera)) {}
    std::unique_ptr<Camera> camera;
    double intensity = 1;
    double bias = 0;
    double normalBias = 0;
    double radius = 1;
    Vector2 mapSize{512, 512};
};

class DirectionalLight : public Light {
public:
    explicit DirectionalLight(Color color = Color(1, 1, 1), double intensity = 1);
    [[nodiscard]] std::string_view type() const override { return "DirectionalLight"; }
    /** The light points from its position towards target's world position; not in the scene by default. */
    std::unique_ptr<Object3D> ownTarget;
    Object3D* target;
    /** DirectionalLightShadow: an OrthographicCamera(-5, 5, 5, -5, 0.5, 500). */
    LightShadow shadow{std::make_unique<OrthographicCamera>(-5, 5, 5, -5, 0.5, 500)};
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
