#include "engine/scene/raycaster.h"
#include "render_database.h"

#include "engine/animation/skinning/skeleton.h"
#include "engine/renderer/projection/plan.h"

#include <algorithm>
#include <cmath>

namespace tn::engine {

namespace {

Matrix toArray(const Matrix4& m) {
    Matrix out{};
    for (int i = 0; i < 16; ++i)
        out[i] = m.elements[i];
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

constexpr double kRadToDeg = 180 / 3.141592653589793; // MathUtils.RAD2DEG

// LightShadow.updateMatrices in three's WebGPU coordinate system: the shadow camera stands at the
// light, looks at the target, and `matrix` is the uv/depth bias matrix times its projection-view.
DirectLight::Shadow shadowOf(LightShadow& shadow, const std::array<double, 3>& from, const std::array<double, 3>& to) {
    Camera& camera = *shadow.camera;
    if (camera.coordinateSystem != CoordinateSystem::WebGPU) camera.coordinateSystem = CoordinateSystem::WebGPU;
    if (auto* o = dynamic_cast<OrthographicCamera*>(&camera)) o->updateProjectionMatrix();
    if (auto* p = dynamic_cast<PerspectiveCamera*>(&camera)) p->updateProjectionMatrix();
    camera.position.set(from[0], from[1], from[2]);
    camera.lookAt(Vector3(to[0], to[1], to[2]));
    camera.updateMatrixWorld();
    Matrix4 projScreen;
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    Matrix4 matrix;
    matrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    matrix.multiply(projScreen);
    DirectLight::Shadow out;
    out.view = toArray(camera.matrixWorldInverse);
    out.projection = toArray(camera.projectionMatrix);
    out.matrix = toArray(matrix);
    out.bias = shadow.bias;
    out.normalBias = shadow.normalBias;
    out.radius = shadow.radius;
    out.intensity = shadow.intensity;
    out.width = static_cast<uint32_t>(shadow.mapSize.x);
    out.height = static_cast<uint32_t>(shadow.mapSize.y);
    return out;
}

// PointShadowNode.renderShadow in WebGPU: the camera at the light, far = distance || far, turned to
// each face in _cubeDirectionsWebGPU with _cubeUpsWebGPU; shadow.matrix is the translation to the light.
DirectLight::Shadow pointShadowOf(LightShadow& shadow, const std::array<double, 3>& at, double distance) {
    static const double kDirections[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, 1}, {0, 0, -1}};
    static const double kUps[6][3] = {{0, -1, 0}, {0, -1, 0}, {0, 0, -1}, {0, 0, 1}, {0, -1, 0}, {0, -1, 0}};
    auto& camera = static_cast<PerspectiveCamera&>(*shadow.camera);
    camera.coordinateSystem = CoordinateSystem::WebGPU;
    if (distance != 0) camera.far = distance;
    camera.updateProjectionMatrix();
    DirectLight::Shadow out;
    for (int face = 0; face < 6; ++face) {
        camera.position.set(at[0], at[1], at[2]);
        camera.up.set(kUps[face][0], kUps[face][1], kUps[face][2]);
        camera.lookAt(Vector3(at[0] + kDirections[face][0], at[1] + kDirections[face][1], at[2] + kDirections[face][2]));
        camera.updateMatrixWorld();
        out.faceViews[face] = toArray(camera.matrixWorldInverse);
    }
    Matrix4 matrix;
    matrix.makeTranslation(-at[0], -at[1], -at[2]);
    out.cube = true;
    out.view = out.faceViews[0];
    out.projection = toArray(camera.projectionMatrix);
    out.matrix = toArray(matrix);
    out.bias = shadow.bias;
    out.normalBias = shadow.normalBias;
    out.radius = shadow.radius;
    out.intensity = shadow.intensity;
    out.width = out.height = static_cast<uint32_t>(shadow.mapSize.x);
    out.near = camera.near;
    out.far = camera.far;
    return out;
}

MaterialKind kindOf(MaterialType type) {
    switch (type) {
    case MaterialType::Basic:
        return MaterialKind::Basic;
    case MaterialType::Lambert:
        return MaterialKind::Lambert;
    case MaterialType::Phong:
        return MaterialKind::Phong;
    case MaterialType::Physical:
        return MaterialKind::Physical;
    default:
        return MaterialKind::Standard;
    }
}

shader::StandardMaterial paramsOf(const Material& m) {
    shader::StandardMaterial p;
    p.color = {float(m.color.r), float(m.color.g), float(m.color.b)};
    p.opacity = float(m.opacity);
    p.alphaTest = float(m.alphaTest);
    p.roughness = float(m.roughness);
    p.metalness = float(m.metalness);
    p.envMapIntensity = float(m.envMapIntensity);
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

} // namespace

RenderDatabase::Record& RenderDatabase::record(const Mesh& mesh) {
    Record& r = records_[&mesh];
    const Material* material = mesh.material.get();
    const uint64_t geometryRevision = mesh.geometry ? mesh.geometry->revision() : 0;
    const uint32_t materialVersion = material ? material->version() : 0;
    if (r.drawable && r.meshId == mesh.id() && r.objectRevision == mesh.revision() && r.geometry == mesh.geometry &&
        r.geometryRevision == geometryRevision && r.material.get() == material &&
        r.materialVersion == materialVersion) {
        return r; // nothing the record depends on moved
    }
    ++rebuilds_;
    r = Record{};
    r.meshId = mesh.id();
    r.objectRevision = mesh.revision();
    r.geometry = mesh.geometry;
    r.geometryRevision = geometryRevision;
    r.material = mesh.material;
    r.materialVersion = materialVersion;
    if (!mesh.geometry || !material)
        return r;
    r.params = paramsOf(*material);
    if (const auto unsupported = shader::unsupportedFeatures(r.params); !unsupported.empty()) {
        for (const std::string& u : unsupported)
            diagnostics_.push_back("TN_NATIVE_MATERIAL_UNSUPPORTED " + std::string(material->typeName()) + ": " + u);
        return r;
    }
    DrawItem& d = r.item;
    d.key = d.id = mesh.id();
    d.positions = store(*mesh.geometry, "position");
    d.normals = store(*mesh.geometry, "normal");
    d.uvs = store(*mesh.geometry, "uv");
    d.indices = mesh.geometry->index ? mesh.geometry->index->store.get() : nullptr;
    // The diffuse map is sampled only when its image is decoded and the geometry carries uv; an
    // image-less glTF placeholder (source only) keeps drawing its flat colour as before.
    if (d.uvs != nullptr) {
        const auto found = material->maps.find("map");
        if (found != material->maps.end() && found->second && found->second->hasImage())
            d.map = found->second.get();
    }
    d.matrixWorld = toArray(mesh.matrixWorld);
    d.kind = kindOf(material->type);
    d.renderOrder = mesh.renderOrder();
    d.transparent = material->transparent;
    d.depthWrite = material->depthWrite;
    d.materialKey = material;
    d.positionNode = material->positionNode;
    d.nodes = material->nodes;
    d.side = static_cast<uint8_t>(material->side);
    r.drawable = d.positions != nullptr;
    return r;
}

void RenderDatabase::project(Object3D& object, const Camera& camera, std::vector<DrawItem>& items, LightState& lights) {
    if (!object.visible())
        return;
    if (object.layers().test(camera.layers())) {
        if (auto* lod = dynamic_cast<LOD*>(&object); lod && lod->autoUpdate) lod->update(camera);
        const std::string_view type = object.type();
        if (type == "Mesh" || type == "InstancedMesh" || type == "SkinnedMesh" || type == "Sprite") {
            const auto& mesh = static_cast<const Mesh&>(object);
            Record& r = record(mesh);
            r.seen = frame_;
            if (r.drawable && r.material->visible) {
                // Uniform values refresh every frame, as three's do: a write through a member object
                // (`material.color.r = x` in JS) changes the colour without a version bump.
                r.params = paramsOf(*r.material);
                r.item.material = &r.params;
                // A positionNode deforms per material: its own draw, as the TS projection keeps it exact.
                r.item.batchable = type == "Mesh" && !mesh.onBeforeRender && !r.material->transparent &&
                                   !r.material->positionNode && !r.material->nodes.positionNode;
                r.item.castShadow = mesh.castShadow();
                r.item.receiveShadow = mesh.receiveShadow();
                const bool morphed = !mesh.geometry->morphPositions.empty() && !mesh.morphTargetInfluences.empty();
                r.item.morphGeometry = morphed ? mesh.geometry.get() : nullptr;
                r.item.morphInfluences = morphed ? &mesh.morphTargetInfluences : nullptr;
                if (morphed) r.item.batchable = false;
                items.push_back(r.item);
                if (type == "SkinnedMesh") {
                    // three's skinning() updates each skeleton once per frame before its first draw.
                    const auto& skinned = static_cast<const SkinnedMesh&>(mesh);
                    DrawItem& d = items.back();
                    d.skinnedRig = static_cast<SkinnedMesh*>(&object);
                    d.skinIndices = store(*mesh.geometry, "skinIndex");
                    d.skinWeights = store(*mesh.geometry, "skinWeight");
                    if (skinned.skeleton && d.skinIndices && d.skinWeights) {
                        if (skeletonsUpdated_.insert(skinned.skeleton.get()).second) skinned.skeleton->update();
                        d.boneMatrices = &skinned.skeleton->boneMatrices;
                        d.bindMatrix = toArray(skinned.bindMatrix);
                        d.bindMatrixInverse = toArray(skinned.bindMatrixInverse);
                    }
                }
                if (type == "InstancedMesh") {
                    // Read every frame, as three does: count changes and setColorAt's first call (which
                    // creates the colour attribute) need no record rebuild.
                    const auto& instanced = static_cast<const InstancedMesh&>(mesh);
                    DrawItem& d = items.back();
                    d.instanceMatrices = instanced.instanceMatrix->store.get();
                    d.instanceColors = instanced.instanceColor ? instanced.instanceColor->store.get() : nullptr;
                    d.instanceCount =
                        static_cast<uint32_t>(std::min<uint64_t>(instanced.count, instanced.instanceMatrix->count()));
                }
                if (type == "Sprite") {
                    const auto& sprite = static_cast<const Sprite&>(mesh);
                    DrawItem& d = items.back();
                    d.sprite = true; d.castShadow = false;
                    d.instanceCount = sprite.count;
                    d.spriteCenter = {sprite.center.x, sprite.center.y};
                    d.spriteRotation = mesh.material->rotation;
                    d.spriteSizeAttenuation = mesh.material->sizeAttenuation;
                }
                if (mesh.onBeforeRender)
                    callbacks_.push_back({mesh.weak_from_this().lock(), &mesh, &r});
            }
        } else if (type == "AmbientLight") {
            const auto& l = static_cast<const AmbientLight&>(object);
            for (int c = 0; c < 3; ++c)
                lights.ambient[c] += scaled(l.color, l.intensity)[c];
        } else if (type == "DirectionalLight") {
            auto& l = static_cast<DirectionalLight&>(object); // its shadow camera moves, as three's does
            const auto from = worldPosition(l), to = worldPosition(*l.target);
            direct_.emplace_back(object.id(), DirectLight::directional(normalized({from[0] - to[0], from[1] - to[1], from[2] - to[2]}),
                                                                      scaled(l.color, l.intensity)));
            if (shadowMapEnabled && l.castShadow())
                direct_.back().second.shadow = shadowOf(l.shadow, from, to);
        } else if (type == "PointLight") {
            auto& l = static_cast<PointLight&>(object); // its shadow camera moves, as three's does
            DirectLight d;
            d.kind = DirectLight::Kind::Point;
            d.color = scaled(l.color, l.intensity);
            d.position = worldPosition(l);
            d.distance = l.distance;
            d.decay = l.decay;
            if (shadowMapEnabled && l.castShadow())
                d.shadow = pointShadowOf(l.shadow, d.position, l.distance);
            direct_.emplace_back(object.id(), d);
        } else if (type == "SpotLight") {
            // SpotLightNode.update: coneCos = cos(angle), penumbraCos = cos(angle * (1 - penumbra)); the
            // axis is lightTargetDirection, from the target to the light.
            auto& l = static_cast<SpotLight&>(object); // its shadow camera moves, as three's does
            DirectLight d;
            d.kind = DirectLight::Kind::Spot;
            d.color = scaled(l.color, l.intensity);
            d.position = worldPosition(l);
            const auto to = worldPosition(*l.target);
            d.direction = normalized({d.position[0] - to[0], d.position[1] - to[1], d.position[2] - to[2]});
            d.distance = l.distance;
            d.decay = l.decay;
            d.coneCos = std::cos(l.angle);
            d.penumbraCos = std::cos(l.angle * (1 - l.penumbra));
            if (shadowMapEnabled && l.castShadow()) {
                // SpotLightShadow.updateMatrices: the camera's fov covers the cone (times focus), its
                // aspect is the map's, and its far is the light's distance when it has one.
                auto& camera = static_cast<PerspectiveCamera&>(*l.shadow.camera);
                camera.fov = kRadToDeg * 2 * l.angle * l.shadow.focus;
                camera.aspect = (l.shadow.mapSize.x / l.shadow.mapSize.y) * l.shadow.aspect;
                camera.far = l.distance != 0 ? l.distance : camera.far;
                d.shadow = shadowOf(l.shadow, d.position, to);
            }
            direct_.emplace_back(object.id(), d);
        } else if (type == "HemisphereLight") {
            const auto& l = static_cast<const HemisphereLight&>(object);
            if (hemisphere_++ == 0) {
                lights.hemisphereSky = scaled(l.color, l.intensity);
                lights.hemisphereGround = scaled(l.groundColor, l.intensity);
                lights.hemisphereUp = normalized(worldPosition(l));
            }
        }
    } else if (const auto it = records_.find(&object); it != records_.end()) {
        it->second.seen = frame_; // in the scene, on another camera's layer: its record stays
    }
    for (Object3D* child : object.children)
        project(*child, camera, items, lights);
}

// Groups batchable items by what they draw (geometry buffers, material, kind, render order) and
// replaces each group of kMinBatchMembers or more with one instanced item: identity model matrix,
// the members' world matrices (float32, as a uniform holds them) as instance matrices, drawn in the
// first member's place.
void RenderDatabase::batch(std::vector<DrawItem>& items, Object3D& scene) {
    const auto decision = std::any_of(items.begin(), items.end(), [](const DrawItem& item) { return item.skinnedRig; })
                              ? projection::decide(scene) : projection::Decision{};
    skinnedPalettes_.clear();
    std::vector<std::vector<std::size_t>> groups;
    for (std::size_t i = 0; i < items.size(); ++i) {
        const DrawItem& d = items[i];
        const auto verdict = decision.verdict.find(d.skinnedRig);
        const bool skinned = d.boneMatrices && verdict != decision.verdict.end() && verdict->second == "skinned";
        if (!d.batchable && !skinned)
            continue;
        auto same = [&](const std::vector<std::size_t>& g) {
            const DrawItem& o = items[g.front()];
            if (bool(o.skinnedRig) != bool(d.skinnedRig))
                return false;
            if (skinned &&
                (o.skinnedRig->geometry != d.skinnedRig->geometry ||
                 o.skinnedRig->skeleton->bones.size() != d.skinnedRig->skeleton->bones.size() ||
                 projection::detail::batchFlags(*o.skinnedRig) != projection::detail::batchFlags(*d.skinnedRig)))
                return false;
            return o.positions == d.positions && o.normals == d.normals && o.indices == d.indices &&
                   o.materialKey == d.materialKey && o.kind == d.kind && o.renderOrder == d.renderOrder &&
                   o.castShadow == d.castShadow && o.receiveShadow == d.receiveShadow;
        };
        auto it = std::find_if(groups.begin(), groups.end(), same);
        if (it == groups.end())
            groups.push_back({i});
        else
            it->push_back(i);
    }
    std::vector<bool> absorbed(items.size(), false);
    std::vector<DrawItem> merged;
    for (const std::vector<std::size_t>& g : groups) {
        const bool skinned = items[g.front()].skinnedRig != nullptr;
        if (!skinned && g.size() < kMinBatchMembers)
            continue;
        SkinnedPalette* palette = nullptr;
        if (skinned) {
            skinnedPalettes_.push_back(
                std::make_unique<SkinnedPalette>(items[g.front()].skinnedRig->skeleton->bones.size(), g.size(), false));
            palette = skinnedPalettes_.back().get();
            palette->begin();
        }
        if (batchStores_.size() <= batchGroups_)
            batchStores_.push_back(std::make_shared<BufferStore>(Scalar::F32, 0));
        BufferStore& store = *batchStores_[batchGroups_++];
        if (store.count() != g.size() * 16)
            store.resize(g.size() * 16);
        std::vector<float> matrices;
        matrices.reserve(g.size() * 16);
        for (std::size_t i : g) {
            if (palette) {
                const auto slot = palette->claim(items[i].skinnedRig);
                palette->write(*slot, *items[i].skinnedRig, false); // project updated this skeleton once
            }
            // SkinnedPalette already folds world placement into the bones. Instance transforms
            // must be identity; applying each rig's matrix here would transform it twice.
            const Matrix identity{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
            for (double e : palette ? identity : items[i].matrixWorld)
                matrices.push_back(static_cast<float>(e));
            absorbed[i] = true;
        }
        store.write(0, matrices.data(), matrices.size() * sizeof(float));
        store.needsUpdate();
        DrawItem d = items[g.front()];
        d.sortOrigin = {d.matrixWorld[12], d.matrixWorld[13], d.matrixWorld[14]};
        d.matrixWorld = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        d.instanceMatrices = &store;
        d.instanceCount = static_cast<uint32_t>(g.size());
        if (palette) {
            palette->end();
            d.boneMatrices = &palette->matrices();
            d.boneStride = palette->bones();
            d.bindMatrix = d.bindMatrixInverse = d.matrixWorld;
        }
        merged.push_back(d);
        batchMembers_ += g.size();
    }
    if (merged.empty())
        return;
    std::vector<DrawItem> out;
    out.reserve(items.size() - batchMembers_ + merged.size());
    for (std::size_t i = 0; i < items.size(); ++i)
        if (!absorbed[i])
            out.push_back(items[i]);
    out.insert(out.end(), merged.begin(), merged.end());
    items = std::move(out);
}

std::vector<DrawItem> RenderDatabase::prepare(Object3D& scene, Camera& camera, LightState& lights) {
    ++frame_;
    diagnostics_.clear();
    hemisphere_ = 0;
    // Renderer.render: world matrices first, then the camera in the renderer's coordinate system.
    if (scene.matrixWorldAutoUpdate)
        scene.updateMatrixWorld();
    if (camera.parent == nullptr && camera.matrixWorldAutoUpdate)
        camera.updateMatrixWorld();
    if (camera.coordinateSystem != CoordinateSystem::WebGPU) {
        camera.coordinateSystem = CoordinateSystem::WebGPU;
        if (auto* p = dynamic_cast<PerspectiveCamera*>(&camera))
            p->updateProjectionMatrix();
        if (auto* o = dynamic_cast<OrthographicCamera*>(&camera))
            o->updateProjectionMatrix();
    }
    std::vector<DrawItem> items;
    lights = LightState{};
    lights.hemisphereSky = lights.hemisphereGround = {0, 0, 0};
    callbacks_.clear();
    direct_.clear();
    skeletonsUpdated_.clear();
    project(scene, camera, items, lights);
    // three's LightsNode sorts its lights by id; the direct terms are summed in that order.
    std::stable_sort(direct_.begin(), direct_.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    for (const auto& [id, light] : direct_) lights.direct.push_back(light);
    // three's onBeforeRender, before the object is drawn: after projection, so a callback that edits
    // the scene cannot invalidate the traversal, and before submission, so a uniform it sets (a
    // material colour) reaches this frame. A callee that threw is a diagnostic, never a crash.
    for (const PendingCallback& p : callbacks_) {
        const RenderCallback callback = p.mesh->onBeforeRender;
        if (!callback)
            continue;
        std::string error;
        if (!(*callback)({&scene, &camera, p.mesh->geometry, p.mesh->material}, error))
            diagnostics_.push_back("TN_CALLBACK_FAILED onBeforeRender: " + error);
        p.record->params = paramsOf(*p.record->material);
    }
    callbacks_.clear();
    if (hemisphere_ > 1)
        diagnostics_.push_back("TN_NATIVE_LIGHTS_UNSUPPORTED: " + std::to_string(hemisphere_) +
                               " hemisphere lights; one is drawn");
    // Objects that left the scene leave the database.
    for (auto it = records_.begin(); it != records_.end();) {
        if (it->second.seen != frame_) {
            it = records_.erase(it);
        } else {
            ++it;
        }
    }
    batchGroups_ = batchMembers_ = 0;
    if (batching) {
        CameraState state;
        state.matrixWorldInverse = toArray(camera.matrixWorldInverse);
        state.projectionMatrix = toArray(camera.projectionMatrix);
        std::vector<DrawItem> ordered;
        ordered.reserve(items.size());
        for (const auto& [depth, item] : Renderer::sortDraws(items, state)) ordered.push_back(*item);
        items = std::move(ordered);
        batch(items, scene);
    }
    // Resolve the scene fallback every frame: environment can change without a material version bump.
    const Scene* world = dynamic_cast<const Scene*>(&scene);
    for (DrawItem& item : items) {
        if (item.kind != MaterialKind::Standard && item.kind != MaterialKind::Physical) continue;
        const Material& material = *static_cast<const Material*>(item.materialKey);
        const auto found = material.maps.find("envMap");
        const Texture* env = found != material.maps.end() ? found->second.get() : nullptr;
        item.envMap = env ? env : world ? world->environment.get() : nullptr;
        item.envMapIntensity = env ? material.envMapIntensity : world ? world->environmentIntensity : 1;
        if (item.envMap && !item.envMap->hasImage()) item.envMap = nullptr;
    }
    return items;
}

uint64_t RenderDatabase::render(Renderer& renderer, Object3D& scene, Camera& camera, std::array<double, 4> clear) {
    LightState lights;
    const auto items = prepare(scene, camera, lights);
    CameraState state;
    state.matrixWorld = toArray(camera.matrixWorld);
    state.matrixWorldInverse = toArray(camera.matrixWorldInverse);
    state.projectionMatrix = toArray(camera.projectionMatrix);
    return renderer.render(items, state, lights, clear);
}

} // namespace tn::engine
