#include "render_database.h"

#include <cmath>

namespace tn::engine {

namespace {

Matrix toArray(const Matrix4& m) {
    Matrix out{};
    for (int i = 0; i < 16; ++i) out[i] = m.elements[i];
    return out;
}

std::array<double, 3> scaled(const Color& c, double s) { return {c.r * s, c.g * s, c.b * s}; }

std::array<double, 3> worldPosition(const Object3D& o) {
    return {o.matrixWorld.elements[12], o.matrixWorld.elements[13], o.matrixWorld.elements[14]};
}

std::array<double, 3> normalized(std::array<double, 3> v) {
    const double l = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return l > 0 ? std::array<double, 3>{v[0] / l, v[1] / l, v[2] / l} : v;
}

MaterialKind kindOf(MaterialType type) {
    switch (type) {
        case MaterialType::Basic: return MaterialKind::Basic;
        case MaterialType::Lambert: return MaterialKind::Lambert;
        case MaterialType::Phong: return MaterialKind::Phong;
        case MaterialType::Physical: return MaterialKind::Physical;
        default: return MaterialKind::Standard;
    }
}

shader::StandardMaterial paramsOf(const Material& m) {
    shader::StandardMaterial p;
    p.color = {float(m.color.r), float(m.color.g), float(m.color.b)};
    p.opacity = float(m.opacity);
    p.alphaTest = float(m.alphaTest);
    p.roughness = float(m.roughness);
    p.metalness = float(m.metalness);
    p.emissive = {float(m.emissive.r), float(m.emissive.g), float(m.emissive.b)};
    p.emissiveIntensity = float(m.emissiveIntensity);
    p.specular = {float(m.specular.r), float(m.specular.g), float(m.specular.b)};
    p.shininess = float(m.shininess);
    p.ior = float(m.ior);
    p.specularIntensity = float(m.specularIntensity);
    p.specularColor = {float(m.specularColor.r), float(m.specularColor.g), float(m.specularColor.b)};
    p.clearcoat = float(m.clearcoat);
    p.sheen = float(m.sheen);
    p.transmission = float(m.transmission);
    p.iridescence = float(m.iridescence);
    p.anisotropy = float(m.anisotropy);
    p.dispersion = float(m.dispersion);
    return p;
}

BufferStore* store(const BufferGeometry& g, const char* name) {
    const auto it = g.attributes.find(name);
    return it == g.attributes.end() || !it->second ? nullptr : it->second->store.get();
}

}  // namespace

RenderDatabase::Record& RenderDatabase::record(const Mesh& mesh) {
    Record& r = records_[&mesh];
    const Material* material = mesh.material.get();
    const uint64_t geometryRevision = mesh.geometry ? mesh.geometry->revision() : 0;
    const uint32_t materialVersion = material ? material->version() : 0;
    if (r.drawable && r.meshId == mesh.id() && r.objectRevision == mesh.revision() && r.geometry == mesh.geometry &&
        r.geometryRevision == geometryRevision && r.material.get() == material && r.materialVersion == materialVersion) {
        return r;  // nothing the record depends on moved
    }
    ++rebuilds_;
    r = Record{};
    r.meshId = mesh.id();
    r.objectRevision = mesh.revision();
    r.geometry = mesh.geometry;
    r.geometryRevision = geometryRevision;
    r.material = mesh.material;
    r.materialVersion = materialVersion;
    if (!mesh.geometry || !material) return r;
    r.params = paramsOf(*material);
    if (const auto unsupported = shader::unsupportedFeatures(r.params); !unsupported.empty()) {
        for (const std::string& u : unsupported) diagnostics_.push_back("TN_NATIVE_MATERIAL_UNSUPPORTED " + std::string(material->typeName()) + ": " + u);
        return r;
    }
    DrawItem& d = r.item;
    d.key = d.id = mesh.id();
    d.positions = store(*mesh.geometry, "position");
    d.normals = store(*mesh.geometry, "normal");
    d.indices = mesh.geometry->index ? mesh.geometry->index->store.get() : nullptr;
    d.matrixWorld = toArray(mesh.matrixWorld);
    d.kind = kindOf(material->type);
    d.renderOrder = mesh.renderOrder();
    d.transparent = material->transparent;
    d.depthWrite = material->depthWrite;
    r.drawable = d.positions != nullptr;
    return r;
}

void RenderDatabase::project(Object3D& object, const Camera& camera, std::vector<DrawItem>& items, LightState& lights) {
    if (!object.visible()) return;
    if (object.layers().test(camera.layers())) {
        const std::string_view type = object.type();
        if (type == "Mesh") {
            const auto& mesh = static_cast<const Mesh&>(object);
            Record& r = record(mesh);
            r.seen = frame_;
            if (r.drawable && r.material->visible) {
                // Uniform values refresh every frame, as three's do: a write through a member object
                // (`material.color.r = x` in JS) changes the colour without a version bump.
                r.params = paramsOf(*r.material);
                r.item.material = &r.params;
                items.push_back(r.item);
                if (mesh.onBeforeRender) callbacks_.push_back({mesh.weak_from_this().lock(), &mesh, &r});
            }
        } else if (type == "AmbientLight") {
            const auto& l = static_cast<const AmbientLight&>(object);
            for (int c = 0; c < 3; ++c) lights.ambient[c] += scaled(l.color, l.intensity)[c];
        } else if (type == "DirectionalLight") {
            const auto& l = static_cast<const DirectionalLight&>(object);
            if (directional_++ == 0) {
                const auto from = worldPosition(l), to = worldPosition(*l.target);
                lights.directionalDirection = normalized({from[0] - to[0], from[1] - to[1], from[2] - to[2]});
                lights.directionalColor = scaled(l.color, l.intensity);
            }
        } else if (type == "HemisphereLight") {
            const auto& l = static_cast<const HemisphereLight&>(object);
            if (hemisphere_++ == 0) {
                lights.hemisphereSky = scaled(l.color, l.intensity);
                lights.hemisphereGround = scaled(l.groundColor, l.intensity);
                lights.hemisphereUp = normalized(worldPosition(l));
            }
        }
    } else if (const auto it = records_.find(&object); it != records_.end()) {
        it->second.seen = frame_;  // in the scene, on another camera's layer: its record stays
    }
    for (Object3D* child : object.children) project(*child, camera, items, lights);
}

uint64_t RenderDatabase::render(Renderer& renderer, Object3D& scene, Camera& camera, std::array<double, 4> clear) {
    ++frame_;
    diagnostics_.clear();
    directional_ = hemisphere_ = 0;
    // Renderer.render: world matrices first, then the camera in the renderer's coordinate system.
    if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
    if (camera.parent == nullptr && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    if (camera.coordinateSystem != CoordinateSystem::WebGPU) {
        camera.coordinateSystem = CoordinateSystem::WebGPU;
        if (auto* p = dynamic_cast<PerspectiveCamera*>(&camera)) p->updateProjectionMatrix();
        if (auto* o = dynamic_cast<OrthographicCamera*>(&camera)) o->updateProjectionMatrix();
    }
    std::vector<DrawItem> items;
    LightState lights;
    lights.directionalColor = lights.hemisphereSky = lights.hemisphereGround = {0, 0, 0};
    callbacks_.clear();
    project(scene, camera, items, lights);
    // three's onBeforeRender, before the object is drawn: after projection, so a callback that edits
    // the scene cannot invalidate the traversal, and before submission, so a uniform it sets (a
    // material colour) reaches this frame. A callee that threw is a diagnostic, never a crash.
    for (const PendingCallback& p : callbacks_) {
        const RenderCallback callback = p.mesh->onBeforeRender;
        if (!callback) continue;
        std::string error;
        if (!(*callback)({&scene, &camera, p.mesh->geometry, p.mesh->material}, error))
            diagnostics_.push_back("TN_CALLBACK_FAILED onBeforeRender: " + error);
        p.record->params = paramsOf(*p.record->material);
    }
    callbacks_.clear();
    if (directional_ > 1) diagnostics_.push_back("TN_NATIVE_LIGHTS_UNSUPPORTED: " + std::to_string(directional_) + " directional lights; one is drawn");
    if (hemisphere_ > 1) diagnostics_.push_back("TN_NATIVE_LIGHTS_UNSUPPORTED: " + std::to_string(hemisphere_) + " hemisphere lights; one is drawn");
    // Objects that left the scene leave the database.
    for (auto it = records_.begin(); it != records_.end();) {
        if (it->second.seen != frame_) {
            it = records_.erase(it);
        } else {
            ++it;
        }
    }
    CameraState state;
    state.matrixWorldInverse = toArray(camera.matrixWorldInverse);
    state.projectionMatrix = toArray(camera.projectionMatrix);
    return renderer.render(items, state, lights, clear);
}

}  // namespace tn::engine
