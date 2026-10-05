// The mesh materials and lights in the engine's one binding registry (PRD-514). One native Material
// carries every type's fields and `type` names the three class it is; each three class binds only the
// fields three declares on it, so `MeshBasicMaterial` has no `roughness` (PRD-531). A light
// inherits Object3D's bindings exactly as Mesh and Group do.
//
// Every material setter that changes what the renderer reads calls `needsUpdate()`, so the render
// database rebuilds. A Color member is read three ways: its components (`material.color.r`), the
// member itself (`material.color`, the one alias Ref), and a whole copy (`material.color = ref`).

#include "engine/abi/bindings.h"

#include "engine/foundation/math/Color.h"
#include "engine/scene/lights.h"
#include "engine/scene/material.h"
#include "engine/scene/object3d.h"

#include <memory>
#include <string>

namespace tn::binding {

using namespace tn::engine;

namespace {

double optional(const Args& a, size_t i, double fallback) {
    return i < a.size() ? number(a.at(i)) : fallback;
}

bool flag(const Value& v) { return v.kind == Value::Kind::Bool ? v.flag : number(v) != 0; }

template <typename T>
T* as(void* self) {
    return static_cast<T*>(self);
}

Value string(std::string text) { return Value{Value::Kind::String, 0, std::move(text)}; }

/** A light constructor colour: a NUMBER is a hex, exactly as `new Color(hex)` reads it. */
Color colorArg(const Value& v, Store& store) {
    if (v.kind == Value::Kind::Number) {
        Color color;
        color.setHex(v.number);
        return color;
    }
    if (v.kind == Value::Kind::Ref) return store.ref<Color>(v, "Color");
    throw Unsupported{"a light colour must be a number (hex) or a Color"};
}

/** Registers `<prefix>.x`/`y`/`z` for a Color field, read and written; `update` bumps a material. */
template <typename Owner>
void nestedColor(ClassBinding& b, const char* prefix, Color Owner::*field, bool update) {
    const char* const names[3] = {"r", "g", "b"};
    for (int i = 0; i < 3; ++i) {
        const std::string path = std::string(prefix) + "." + names[i];
        b.getters[path] = [field, i](void* self) {
            const Color& c = as<Owner>(self)->*field;
            return Value::of(i == 0 ? c.r : (i == 1 ? c.g : c.b));
        };
        b.setters[path] = [field, i, update](void* self, const Value& v) {
            Color& c = as<Owner>(self)->*field;
            (i == 0 ? c.r : (i == 1 ? c.g : c.b)) = number(v);
            if (update) as<Material>(self)->needsUpdate();
        };
    }
}

/** The Ref of one of `self`'s own members; the same Ref on every call, keeping its owner alive. */
template <typename Owner, typename M>
Method memberAliasMethod(M Owner::*field, const char* cls) {
    return [field, cls](void* self, const Args&, Store& store) {
        return memberAlias(store, self, as<Owner>(self)->*field, cls);
    };
}

/** A whole Color member write (`material.color = ref`) that copies the referenced Color. */
template <typename Owner>
Setter colorSetter(Color Owner::*field, bool update) {
    return [field, update](void* self, const Value& v, Store& store) {
        as<Owner>(self)->*field = store.ref<Color>(v, "Color");
        if (update) as<Material>(self)->needsUpdate();
    };
}

// ---------------------------------------------------------------------------- materials

void materialBool(ClassBinding& b, const char* name, bool Material::*field) {
    b.getters[name] = [field](void* self) { return Value::of(as<Material>(self)->*field); };
    b.setters[name] = [field](void* self, const Value& v) {
        as<Material>(self)->*field = flag(v);
        as<Material>(self)->needsUpdate();
    };
}

void materialNumber(ClassBinding& b, const char* name, double Material::*field) {
    b.getters[name] = [field](void* self) { return Value::of(as<Material>(self)->*field); };
    b.setters[name] = [field](void* self, const Value& v) {
        as<Material>(self)->*field = number(v);
        as<Material>(self)->needsUpdate();
    };
}

void registerMaterialBase(ClassBinding& b) {
    b.getters["type"] = [](void* self) { return string(std::string(as<Material>(self)->typeName())); };
    b.getters["id"] = [](void* self) { return Value::of(double(as<Material>(self)->id)); };
    b.getters["name"] = [](void* self) { return string(as<Material>(self)->name); };
    b.setters["name"] = [](void* self, const Value& v) {
        if (v.kind != Value::Kind::String) throw Unsupported{"name must be a string"};
        as<Material>(self)->name = v.text;
    };
    b.setters["needsUpdate"] = [](void* self, const Value& v) {
        if (flag(v)) as<Material>(self)->needsUpdate();
    };

    materialBool(b, "transparent", &Material::transparent);
    materialBool(b, "depthTest", &Material::depthTest);
    materialBool(b, "depthWrite", &Material::depthWrite);
    materialBool(b, "visible", &Material::visible);
    materialBool(b, "toneMapped", &Material::toneMapped);
    materialNumber(b, "opacity", &Material::opacity);
    materialNumber(b, "alphaTest", &Material::alphaTest);
    b.getters["side"] = [](void* self) { return Value::of(double(as<Material>(self)->side)); };
    b.setters["side"] = [](void* self, const Value& v) {
        const double side = number(v);  // FrontSide 0, BackSide 1, DoubleSide 2; anything else is refused
        if (side != 0 && side != 1 && side != 2) throw Unsupported{"side must be FrontSide, BackSide or DoubleSide"};
        as<Material>(self)->side = static_cast<Side>(static_cast<int>(side));
        as<Material>(self)->needsUpdate();
    };
}

/** A Color field read by component, as the member alias, and written whole. */
void materialColor(ClassBinding& b, const char* name, Color Material::*field) {
    nestedColor(b, name, field, true);
    fixedMember(b, name, memberAliasMethod(field, "Color"));
    b.setters[name] = colorSetter(field, true);
}

/** Exactly the fields three declares on each class, so a class publishes no sibling's surface. */
void registerTypeFields(ClassBinding& b, MaterialType type) {
    materialColor(b, "color", &Material::color);
    if (type == MaterialType::Basic) return;
    materialColor(b, "emissive", &Material::emissive);
    materialNumber(b, "emissiveIntensity", &Material::emissiveIntensity);
    if (type == MaterialType::Lambert) return;
    if (type == MaterialType::Phong) {
        materialColor(b, "specular", &Material::specular);
        materialNumber(b, "shininess", &Material::shininess);
        return;
    }
    materialNumber(b, "roughness", &Material::roughness);
    materialNumber(b, "metalness", &Material::metalness);
    if (type == MaterialType::Standard) return;
    materialNumber(b, "ior", &Material::ior);
    materialNumber(b, "specularIntensity", &Material::specularIntensity);
    materialColor(b, "specularColor", &Material::specularColor);
    materialNumber(b, "clearcoat", &Material::clearcoat);
    materialNumber(b, "sheen", &Material::sheen);
    materialNumber(b, "transmission", &Material::transmission);
    materialNumber(b, "iridescence", &Material::iridescence);
    materialNumber(b, "anisotropy", &Material::anisotropy);
    materialNumber(b, "dispersion", &Material::dispersion);
}

void registerMeshMaterial(ClassBinding& b, MaterialType type) {
    b.ctor = [type](const Args& a, Store&) -> std::shared_ptr<void> {
        if (!a.empty()) throw Unsupported{"a material parameters object is not supported"};
        return std::static_pointer_cast<void>(std::make_shared<Material>(type));
    };
    registerMaterialBase(b);
    registerTypeFields(b, type);
}

// ------------------------------------------------------------------------------- lights

void registerLightBase(ClassBinding& b) {
    b.getters["intensity"] = [](void* self) { return Value::of(as<Light>(self)->intensity); };
    b.setters["intensity"] = [](void* self, const Value& v) { as<Light>(self)->intensity = number(v); };
    nestedColor(b, "color", &Light::color, false);
    fixedMember(b, "color", memberAliasMethod(&Light::color, "Color"));
    b.setters["color"] = colorSetter(&Light::color, false);
}

void registerAmbientLight(ClassBinding& b) {
    registerObject3DBindings(b);
    b.ctor = [](const Args& a, Store& store) -> std::shared_ptr<void> {
        Color color = a.empty() ? Color(1, 1, 1) : colorArg(a.at(0), store);
        return std::static_pointer_cast<void>(std::make_shared<AmbientLight>(color, optional(a, 1, 1)));
    };
    registerLightBase(b);
}

// `light.shadow` by path: its numbers, the map size and the shadow camera's own numbers, which the
// renderer re-projects every frame it draws the map (the spot camera's fov, aspect and far are
// SpotLightShadow.updateMatrices' to set, so only near and far are bound there).
template <typename L, typename C>
void shadowBindings(ClassBinding& b, std::vector<const char*> cameraNames, std::vector<double C::*> cameraFields) {
    const auto number = [&b](const std::string& path, double LightShadow::*field) {
        b.getters[path] = [field](void* self) { return Value::of(as<L>(self)->shadow.*field); };
        b.setters[path] = [field](void* self, const Value& v) { as<L>(self)->shadow.*field = tn::binding::number(v); };
    };
    for (const auto& [name, field] : std::initializer_list<std::pair<const char*, double LightShadow::*>>{
             {"bias", &LightShadow::bias}, {"normalBias", &LightShadow::normalBias}, {"radius", &LightShadow::radius},
             {"intensity", &LightShadow::intensity}, {"focus", &LightShadow::focus}})
        number(std::string("shadow.") + name, field);
    for (const char* axis : {"x", "y", "width", "height"}) {
        const bool first = axis[0] == 'x' || axis[0] == 'w';
        const std::string path = std::string("shadow.mapSize.") + axis;
        b.getters[path] = [first](void* self) {
            const Vector2& size = as<L>(self)->shadow.mapSize;
            return Value::of(first ? size.x : size.y);
        };
        b.setters[path] = [first](void* self, const Value& v) {
            Vector2& size = as<L>(self)->shadow.mapSize;
            (first ? size.x : size.y) = tn::binding::number(v);
        };
    }
    for (std::size_t i = 0; i < cameraNames.size(); ++i) {
        const std::string path = std::string("shadow.camera.") + cameraNames[i];
        double C::*field = cameraFields[i];
        auto camera = [](void* self) { return static_cast<C*>(as<L>(self)->shadow.camera.get()); };
        b.getters[path] = [field, camera](void* self) { return Value::of(camera(self)->*field); };
        b.setters[path] = [field, camera](void* self, const Value& v) { camera(self)->*field = tn::binding::number(v); };
    }
}

void registerDirectionalLight(ClassBinding& b) {
    registerObject3DBindings(b);
    b.ctor = [](const Args& a, Store& store) -> std::shared_ptr<void> {
        Color color = a.empty() ? Color(1, 1, 1) : colorArg(a.at(0), store);
        return std::static_pointer_cast<void>(
            std::make_shared<DirectionalLight>(color, optional(a, 1, 1)));
    };
    registerLightBase(b);
    b.members["target"] = [](void* self, const Args&, Store& store) -> Value {
        DirectionalLight* light = as<DirectionalLight>(self);
        if (light->target == nullptr) return Value{};
        return store.adoptAlias("Object3D", light->target, self);
    };
    b.fixedMembers.insert("target");  // the light owns its target for its whole life
    shadowBindings<DirectionalLight, OrthographicCamera>(b, {"left", "right", "top", "bottom", "near", "far"},
                                                         {&OrthographicCamera::left, &OrthographicCamera::right,
                                                          &OrthographicCamera::top, &OrthographicCamera::bottom,
                                                          &OrthographicCamera::near, &OrthographicCamera::far});
}

// A number field of a light class: getter and setter over one member.
template <typename L> void numberField(ClassBinding& b, const char* name, double L::* member) {
    b.getters[name] = [member](void* self) { return Value::of(as<L>(self)->*member); };
    b.setters[name] = [member](void* self, const Value& v) { as<L>(self)->*member = number(v); };
}

// three's PointLight(color, intensity, distance = 0, decay = 2).
void registerPointLight(ClassBinding& b) {
    registerObject3DBindings(b);
    b.ctor = [](const Args& a, Store& store) -> std::shared_ptr<void> {
        Color color = a.empty() ? Color(1, 1, 1) : colorArg(a.at(0), store);
        return std::static_pointer_cast<void>(
            std::make_shared<PointLight>(color, optional(a, 1, 1), optional(a, 2, 0), optional(a, 3, 2)));
    };
    registerLightBase(b);
    numberField<PointLight>(b, "distance", &PointLight::distance);
    numberField<PointLight>(b, "decay", &PointLight::decay);
    shadowBindings<PointLight, PerspectiveCamera>(b, {"near", "far"}, {&PerspectiveCamera::near, &PerspectiveCamera::far});
}

// three's SpotLight(color, intensity, distance = 0, angle = PI / 3, penumbra = 0, decay = 2).
void registerSpotLight(ClassBinding& b) {
    registerObject3DBindings(b);
    b.ctor = [](const Args& a, Store& store) -> std::shared_ptr<void> {
        Color color = a.empty() ? Color(1, 1, 1) : colorArg(a.at(0), store);
        return std::static_pointer_cast<void>(std::make_shared<SpotLight>(
            color, optional(a, 1, 1), optional(a, 2, 0), optional(a, 3, 1.0471975511965976), optional(a, 4, 0),
            optional(a, 5, 2)));
    };
    registerLightBase(b);
    numberField<SpotLight>(b, "distance", &SpotLight::distance);
    numberField<SpotLight>(b, "angle", &SpotLight::angle);
    numberField<SpotLight>(b, "penumbra", &SpotLight::penumbra);
    numberField<SpotLight>(b, "decay", &SpotLight::decay);
    b.members["target"] = [](void* self, const Args&, Store& store) -> Value {
        SpotLight* light = as<SpotLight>(self);
        if (light->target == nullptr) return Value{};
        return store.adoptAlias("Object3D", light->target, self);
    };
    b.fixedMembers.insert("target"); // the light owns its target for its whole life
    shadowBindings<SpotLight, PerspectiveCamera>(b, {"near", "far"}, {&PerspectiveCamera::near, &PerspectiveCamera::far});
}

void registerHemisphereLight(ClassBinding& b) {
    registerObject3DBindings(b);
    b.ctor = [](const Args& a, Store& store) -> std::shared_ptr<void> {
        Color sky = a.empty() ? Color(1, 1, 1) : colorArg(a.at(0), store);
        Color ground = a.size() < 2 ? Color(1, 1, 1) : colorArg(a.at(1), store);
        return std::static_pointer_cast<void>(
            std::make_shared<HemisphereLight>(sky, ground, optional(a, 2, 1)));
    };
    registerLightBase(b);
    nestedColor(b, "groundColor", &HemisphereLight::groundColor, false);
    fixedMember(b, "groundColor", memberAliasMethod(&HemisphereLight::groundColor, "Color"));
    b.setters["groundColor"] = colorSetter(&HemisphereLight::groundColor, false);
}

}  // namespace

void registerMaterialBindings(Registry& classes) {
    registerMeshMaterial(classes["MeshBasicMaterial"], MaterialType::Basic);
    registerMeshMaterial(classes["MeshLambertMaterial"], MaterialType::Lambert);
    registerMeshMaterial(classes["MeshPhongMaterial"], MaterialType::Phong);
    registerMeshMaterial(classes["MeshStandardMaterial"], MaterialType::Standard);
    registerMeshMaterial(classes["MeshPhysicalMaterial"], MaterialType::Physical);
    registerAmbientLight(classes["AmbientLight"]);
    registerDirectionalLight(classes["DirectionalLight"]);
    registerPointLight(classes["PointLight"]);
    registerSpotLight(classes["SpotLight"]);
    registerHemisphereLight(classes["HemisphereLight"]);
}

}  // namespace tn::binding
