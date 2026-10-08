// PRD-514 phase 1: the render database draws the native scene graph. `lit_scene` builds the
// lit-render fixture as a scene (SphereGeometry, MeshStandardMaterial, DirectionalLight,
// HemisphereLight, PerspectiveCamera) and renders it with renderer.render(scene, camera)'s native
// path, against the browser's golden frame. `invalidation` checks that records follow revisions only.

#include "check.h"
#include "engine/renderer/post/traa.h"
#include "engine/renderer/render_database.h"
#include "engine/renderer/projection/plan.h"
#include "engine/shader/package.h"
#include "engine/player/skinned_crowd.h"
#include "engine/scene/geometries.h"
#include "mystral/webgpu/context.h"

#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstring>
#include <functional>
#include <limits>
#include <cstdlib>
#include <cmath>
#include <cstdio>
#include <string>
#include <thread>

extern "C" unsigned char* stbi_load(const char* filename, int* x, int* y, int* comp, int req_comp);
extern "C" void stbi_image_free(void* data);

using namespace tn::engine;

namespace {

void uniformBatchPreparation() {
    Material a(MaterialType::Standard), b(MaterialType::Standard);
    const std::array<double*, 27> left{
        &a.opacity, &a.alphaTest, &a.emissive.r, &a.emissive.g,
        &a.emissive.b, &a.emissiveIntensity, &a.roughness, &a.envMapIntensity,
        &a.metalness, &a.specular.r, &a.specular.g, &a.specular.b,
        &a.shininess, &a.ior, &a.specularIntensity, &a.specularColor.r,
        &a.specularColor.g, &a.specularColor.b, &a.clearcoat, &a.sheen,
        &a.transmission, &a.iridescence, &a.anisotropy, &a.dispersion,
        &a.normalScaleX, &a.normalScaleY, &a.aoMapIntensity,
    };
    const std::array<double*, 27> right{
        &b.opacity, &b.alphaTest, &b.emissive.r, &b.emissive.g,
        &b.emissive.b, &b.emissiveIntensity, &b.roughness, &b.envMapIntensity,
        &b.metalness, &b.specular.r, &b.specular.g, &b.specular.b,
        &b.shininess, &b.ior, &b.specularIntensity, &b.specularColor.r,
        &b.specularColor.g, &b.specularColor.b, &b.clearcoat, &b.sheen,
        &b.transmission, &b.iridescence, &b.anisotropy, &b.dispersion,
        &b.normalScaleX, &b.normalScaleY, &b.aoMapIntensity,
    };
    for (std::size_t i = 0; i < left.size(); ++i) {
        const double beforeA = *left[i], beforeB = *right[i];
        *left[i] = *right[i] + 0.25;
        CHECK(!projection::detail::sameUniforms(a, b));
        *left[i] = -0.0; *right[i] = 0.0;
        CHECK(projection::detail::sameUniforms(a, b));
        *left[i] = *right[i] = std::numeric_limits<double>::infinity();
        CHECK(projection::detail::sameUniforms(a, b));
        *left[i] = *right[i] = std::numeric_limits<double>::quiet_NaN();
        CHECK(!projection::detail::sameUniforms(a, b));
        *left[i] = beforeA; *right[i] = beforeB;
    }
    Scene scene; PerspectiveCamera camera; LightState lights; RenderDatabase database;
    camera.position.set(0, 10, 100);
    camera.lookAt(0, 0, 0);
    const auto geometry = makeBoxGeometry();
    std::vector<std::shared_ptr<Mesh>> meshes;
    for (int i = 0; i < 4096; ++i) {
        auto material = std::make_shared<Material>(MaterialType::Standard);
        material->color.setRGB(double(i) / 4096, 0.2, 0.3);
        auto mesh = std::make_shared<Mesh>(geometry, material);
        mesh->position.set(i % 64, 0, i / 64);
        scene.add(*mesh); meshes.push_back(mesh);
    }
    std::reverse(scene.children.begin(), scene.children.end());
    auto items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 1);
    if (items.size() != 1) return;
    CHECK(items[0].instanceCount == 4096 && items[0].instanceColors);
    CHECK(items[0].material->color[0] == 1 && items[0].material->color[1] == 1);
    // The dense radix lane must preserve the exact depth/id order of individual opaque draws.
    Matrix4 projectionView;
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    std::vector<std::pair<double, const Mesh*>> expected;
    for (const auto& mesh : meshes) {
        Vector3 origin;
        origin.setFromMatrixPosition(mesh->matrixWorld).applyMatrix4(projectionView);
        expected.emplace_back(origin.z, mesh.get());
    }
    std::sort(expected.begin(), expected.end(), [](const auto& a, const auto& b) {
        return a.first != b.first ? a.first < b.first : a.second->id() < b.second->id();
    });
    const auto* matrices = reinterpret_cast<const float*>(items[0].instanceMatrices->data());
    const auto* colors = reinterpret_cast<const float*>(items[0].instanceColors->data());
    for (std::size_t i = 0; i < expected.size(); ++i) {
        CHECK(matrices[i * 16 + 12] == float(expected[i].second->position.x));
        CHECK(matrices[i * 16 + 14] == float(expected[i].second->position.z));
        CHECK(colors[i * 3] == float(expected[i].second->material->color.r));
    }
    // Exercise signs/zero ties, nonfinite fallback, and groups with different active radix digits.
    Camera depthCamera;
    depthCamera.coordinateSystem = CoordinateSystem::WebGPU;
    for (int pattern = 0; pattern < 5; ++pattern) {
        const bool infinite = pattern == 1, multiple = pattern >= 2;
        depthCamera.projectionMatrix.identity();
        if (infinite) depthCamera.projectionMatrix.elements[15] = 0;
        std::array<std::vector<std::pair<double, const Mesh*>>, 2> expectedGroups;
        for (std::size_t i = 0; i < meshes.size(); ++i) {
            const std::size_t group =
                multiple ? (pattern == 3 ? std::size_t(i % 3 == 0) : i % 2) : 0;
            meshes[i]->material->roughness = group ? 0.25 : 1;
            const bool wide = (group + pattern) % 2 == 0;
            const double z = multiple
                ? (pattern == 4 && group == 0 ? 1
                   : wide ? std::ldexp(double(int(i % 33) - 16), pattern * 20)
                          : 1 + std::ldexp(double(i % 33), -40 - pattern))
                : (infinite ? double(i % 33 + 1) : double(int(i % 33) - 16));
            meshes[i]->position.z = z == 0 && i % 2 ? -0.0 : z;
            expectedGroups[group].emplace_back(infinite ? std::numeric_limits<double>::infinity() : z, meshes[i].get());
        }
        for (auto& group : expectedGroups)
            std::sort(group.begin(), group.end(), [](const auto& a, const auto& b) {
                return a.first != b.first ? a.first < b.first : a.second->id() < b.second->id();
            });
        items = database.prepare(scene, depthCamera, lights);
        CHECK(items.size() == (multiple ? 2 : 1));
        if (items.size() != (multiple ? 2 : 1)) return;
        for (const auto& item : items) {
            const auto& group = expectedGroups[item.material->roughness == 0.25 ? 1 : 0];
            CHECK(item.instanceCount == group.size() && item.instanceColors);
            if (item.instanceCount != group.size() || !item.instanceColors) return;
            matrices = reinterpret_cast<const float*>(item.instanceMatrices->data());
            colors = reinterpret_cast<const float*>(item.instanceColors->data());
            for (std::size_t i = 0; i < group.size(); ++i) {
                CHECK(matrices[i * 16 + 12] == float(group[i].second->position.x));
                CHECK(matrices[i * 16 + 14] == float(group[i].second->position.z));
                CHECK(colors[i * 3] == float(group[i].second->material->color.r));
            }
        }
    }
    // Depths that round together as float32 keep their exact double order, and equal depths keep id
    // order: positive, negative, straddling zero (with both zeros), and beyond float32's range.
    depthCamera.projectionMatrix.identity();
    const auto scrambled = [](std::size_t i, unsigned modulus) { return double((i * 2654435761u) % modulus); };
    const std::vector<std::function<double(std::size_t)>> roundedDepths = {
        [&](std::size_t i) { return 1 + std::ldexp(scrambled(i, 211), -30); },
        [&](std::size_t i) { return -1 - std::ldexp(scrambled(i, 211), -30); },
        [&](std::size_t i) {
            if (i % 97 == 0) return i % 2 ? -0.0 : 0.0;
            return std::ldexp(scrambled(i, 211) - 105, -60);
        },
        [&](std::size_t i) { return i % 50 == 0 ? double(int(i % 7)) : 1e39 * (1 + std::ldexp(scrambled(i, 211), -40)); },
        [&](std::size_t i) { return -1e39 * (1 + std::ldexp(scrambled(i, 211), -40)); },
    };
    for (const auto& depthOf : roundedDepths) {
        std::vector<std::pair<double, const Mesh*>> rounded;
        for (std::size_t i = 0; i < meshes.size(); ++i) {
            meshes[i]->material->roughness = 1;
            meshes[i]->position.z = depthOf(i);
            rounded.emplace_back(meshes[i]->position.z, meshes[i].get());
        }
        std::sort(rounded.begin(), rounded.end(), [](const auto& a, const auto& b) {
            return a.first != b.first ? a.first < b.first : a.second->id() < b.second->id();
        });
        items = database.prepare(scene, depthCamera, lights);
        CHECK(items.size() == 1 && items[0].instanceCount == rounded.size() && items[0].instanceColors);
        if (items.size() == 1 && items[0].instanceColors) {
            colors = reinterpret_cast<const float*>(items[0].instanceColors->data());
            for (std::size_t i = 0; i < rounded.size(); ++i)
                CHECK(colors[i * 3] == float(rounded[i].second->material->color.r));
        }
    }
    for (std::size_t i = 0; i < meshes.size(); ++i) {
        meshes[i]->position.z = double(i / 64);
        meshes[i]->material->roughness = 1;
    }
    const auto rebuilds = database.rebuilds();
    for (auto& mesh : meshes) mesh->position.y = 2;
    meshes[0]->material->color.r = 0.8;
    items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 1 && database.rebuilds() == rebuilds);
    CHECK(meshes[0]->matrixWorld.elements[13] == 2);
    // Ordinary member edits are checked immediately, without a version bump.
    meshes[0]->material->roughness = 0.5;
    items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 2);
    meshes[0]->material->roughness = 1;
    meshes[0]->material->fog = false;
    items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 2);
    meshes[0]->material->fog = true;
    meshes[0]->setRenderOrder(2);
    items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 2);
    scene.remove(*meshes[0]);
    items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 1 && items[0].instanceCount == 4095);
    Object3D parent; parent.position.x = 100; scene.add(parent);
    database.prepare(scene, camera, lights);
    parent.add(*meshes[1]);
    database.prepare(scene, camera, lights);
    CHECK(meshes[1]->matrixWorld.elements[12] == 101);
    parent.position.x = 200;
    parent.updateWorldMatrix(true, false); // a query refreshed the parent before the render
    database.prepare(scene, camera, lights);
    CHECK(meshes[1]->matrixWorld.elements[12] == 201);
    Object3D copy; copy.copy(*meshes[1]); copy.updateMatrixWorld();
    CHECK(copy.matrixWorld.elements[12] == 1);
    parent.matrixWorldAutoUpdate = false;
    parent.matrixWorld.makeTranslation(300, 0, 0);
    database.prepare(scene, camera, lights);
    CHECK(meshes[1]->matrixWorld.elements[12] == 301);
    parent.remove(*meshes[1]);
    meshes[1]->updateMatrixWorld();
    CHECK(meshes[1]->matrixWorld.elements[12] == 1);
    scene.remove(parent);
    // All matrix hooks run before projection: earlier meshes see a later geometry edit too.
    struct GeometryChange final : Mesh {
        using Mesh::Mesh;
        std::shared_ptr<BufferAttribute> next;
        void updateMatrix() override {
            if (next) { geometry->setAttribute("position", next); next.reset(); }
            Object3D::updateMatrix();
        }
    } changer(geometry, meshes[2]->material);
    changer.next = makeBoxGeometry()->attributes.at("position");
    scene.add(changer);
    items = database.prepare(scene, camera, lights);
    CHECK(items.size() == 1 && database.lastBatches().second == 4095);
    if (items.size() == 1) CHECK(items[0].positions == geometry->attributes.at("position")->store.get());

    // The public child vector can change without a hierarchy-version bump.
    Scene reordered; Mesh ordinary(geometry, meshes[2]->material); DirectionalLight sun;
    RenderDatabase reorderDatabase; reordered.add(ordinary).add(sun);
    CHECK(reorderDatabase.prepare(reordered, camera, lights).size() == 1);
    for (int i = 0; i < 2; ++i) {
        std::reverse(reordered.children.begin(), reordered.children.end());
        const auto draws = reorderDatabase.prepare(reordered, camera, lights);
        CHECK(draws.size() == 1 && lights.direct.size() == 1);
        if (draws.size() == 1) CHECK(draws[0].key == ordinary.id());
    }
    struct HookMesh : Mesh {
        using Mesh::Mesh; std::string* trace = nullptr;
        void updateMatrixWorld(bool force = false) override {
            *trace += 'M'; Mesh::updateMatrixWorld(force);
        }
    };
    struct HookLight : DirectionalLight {
        std::string* trace = nullptr;
        void updateMatrixWorld(bool force = false) override {
            *trace += 'L'; DirectionalLight::updateMatrixWorld(force);
        }
    };
    struct HookScene : Scene {
        std::string* trace = nullptr;
        void updateMatrixWorld(bool force = false) override {
            *trace += 'S'; Scene::updateMatrixWorld(force);
        }
    };
    struct HookCamera : PerspectiveCamera {
        std::string* trace = nullptr; Mesh* watched = nullptr;
        void updateMatrixWorld(bool force = false) override {
            *trace += 'C'; watched->position.x += 1; PerspectiveCamera::updateMatrixWorld(force);
        }
    };
    for (int mode = 0; mode < 5; ++mode) {
        std::string trace;
        Scene plainScene; HookScene hookScene; hookScene.trace = &trace;
        Mesh plainMesh(geometry, meshes[2]->material);
        HookMesh hookMesh(geometry, meshes[2]->material); hookMesh.trace = &trace;
        DirectionalLight plainLight; HookLight hookLight; hookLight.trace = &trace;
        PerspectiveCamera plainCamera; HookCamera hookCamera; hookCamera.trace = &trace;
        Scene& world = mode == 2 || mode == 4 ? hookScene : plainScene;
        Mesh& mesh = mode == 0 || mode == 4 ? hookMesh : plainMesh;
        DirectionalLight& light = mode == 1 || mode == 4 ? hookLight : plainLight;
        PerspectiveCamera& view = mode == 3 || mode == 4 ? hookCamera : plainCamera;
        hookCamera.watched = &mesh; mesh.position.x = 1; world.add(mesh).add(light);
        RenderDatabase db;
        CHECK(db.prepare(world, view, lights).size() == 1);
        CHECK(trace == (mode == 0 ? "M" : mode == 1 ? "L" : mode == 2 ? "S" : mode == 3 ? "C" : "SMLC"));
        CHECK(mesh.matrixWorld.elements[12] == 1);
        CHECK(mesh.position.x == (mode >= 3 ? 2 : 1));
    }
    // Build the replacement subtree before warming so no later add() invalidates the old cache.
    Scene nested; Mesh before(geometry, meshes[2]->material), after(geometry, meshes[2]->material);
    Mesh descendant(geometry, meshes[2]->material); after.add(descendant);
    after.position.x = 10; descendant.position.x = 2; nested.add(before);
    RenderDatabase nestedDatabase; CHECK(nestedDatabase.prepare(nested, camera, lights).size() == 1);
    nested.children[0] = &after; before.parent = nullptr; after.parent = &nested;
    const auto nestedDraws = nestedDatabase.prepare(nested, camera, lights);
    CHECK(nestedDraws.size() == 2);
    CHECK(descendant.matrixWorld.elements[12] == 12);
    struct MoveOnUpdate : Object3D {
        Mesh* watched = nullptr;
        void updateMatrix() override { watched->position.x += 1; Object3D::updateMatrix(); }
    };
    // Queries from a light target, camera child or shadow camera must follow scene updates.
    for (int mode = 0; mode < 4; ++mode) {
        Scene world; PerspectiveCamera view; DirectionalLight light;
        Mesh mesh(geometry, meshes[2]->material); mesh.position.x = 1;
        auto hook = std::make_shared<MoveOnUpdate>(); hook->watched = &mesh;
        if (mode == 0) light.target = hook;
        if (mode == 1) hook->add(*light.target);
        if (mode == 2) view.add(*hook);
        if (mode == 3) { light.setCastShadow(true); light.shadow.camera->add(*hook); }
        world.add(light).add(mesh);
        RenderDatabase db; db.shadowMapEnabled = mode == 3;
        CHECK(db.prepare(world, view, lights).size() == 1);
        CHECK(mesh.position.x == 2 && mesh.matrixWorld.elements[12] == 1);
    }

    // Replacing a flat slot with a layer-excluded child must release the old resource owners.
    Scene replaced; RenderDatabase replacementDatabase;
    auto removed = std::make_shared<Mesh>(makeBoxGeometry(), std::make_shared<Material>(MaterialType::Standard));
    std::weak_ptr<BufferGeometry> removedGeometry = removed->geometry;
    std::weak_ptr<Material> removedMaterial = removed->material;
    replaced.add(*removed);
    CHECK(replacementDatabase.prepare(replaced, camera, lights).size() == 1);
    replaced.remove(*removed);
    removed.reset();
    Mesh excluded(makeBoxGeometry(), std::make_shared<Material>(MaterialType::Standard));
    excluded.setLayer(1); replaced.add(excluded);
    CHECK(replacementDatabase.prepare(replaced, camera, lights).empty());
    CHECK(removedGeometry.expired() && removedMaterial.expired());
}

// Consumer preparation, with no GPU: scene fog and sky must reach the same DrawItems used by render().
void sceneEnvironment() {
    CHECK(Texture{}.flipY && Texture{}.minFilter == 1008 && !DataTexture{}.flipY);
    RenderDatabase database;
    Scene scene; PerspectiveCamera camera(55, 4.0 / 3, 0.1, 100); camera.position.set(1, 2, 6);
    LightState lights;
    auto material = std::make_shared<Material>(MaterialType::Standard);
    auto mesh = std::make_shared<Mesh>(makeSphereGeometry(), material); scene.add(*mesh);
    auto sky = std::make_shared<DataTexture>(); sky->mapping = 303; sky->width = 128; sky->height = 64;
    sky->data.resize(128 * 64 * 4, 255); sky->needsUpdate();
    scene.backgroundTexture = scene.environment = sky;
    scene.backgroundIntensity = scene.environmentIntensity = 2.5;
    scene.fog = std::make_shared<FogExp2>(Color(0.1, 0.4, 0.8), 0.003);
    auto draws = database.prepare(scene, camera, lights);
    CHECK(draws.size() == 2); if (draws.size() != 2) return;
    CHECK(draws[0].background && !draws[0].depthWrite && !draws[0].fog && draws[0].map == sky.get());
    CHECK(draws[0].material->color[0] == 2.5f && draws[0].side == 1);
    CHECK(draws[0].matrixWorld[12] == 1 && draws[0].matrixWorld[14] == 6);
    shader::VertexVariant skyVariant; skyVariant.background = draws[0].background; skyVariant.map = draws[0].map != nullptr;
    const auto skyVertex = shader::buildStage(shader::buildBasic(skyVariant).vertex, 0);
    CHECK(skyVertex.wgsl.ok() && !skyVertex.attributes.empty());
    for (const auto& attribute : skyVertex.attributes)
        CHECK((attribute.name == "position" && draws[0].positions) || (attribute.name == "normal" && draws[0].normals));
    CHECK(draws[1].fog == scene.fog.get() && draws[1].envMap == sky.get() && draws[1].envMapIntensity == 2.5);
    CameraState state; state.matrixWorldInverse = camera.matrixWorldInverse.elements;
    const auto sorted = Renderer::sortDraws(draws, state); CHECK(sorted.front().second->background);
    material->fog = false; scene.backgroundIntensity = 1.25;
    draws = database.prepare(scene, camera, lights);
    CHECK(!draws[1].fog && draws[0].material->color[0] == 1.25f);
    scene.backgroundTexture.reset(); scene.environment = sky;
    draws = database.prepare(scene, camera, lights); CHECK(draws.size() == 1 && !draws[0].background && draws[0].envMap == sky.get());
    scene.backgroundTexture = sky;
    OrthographicCamera ortho(-4, 4, 3, -3, 0.1, 100);
    draws = database.prepare(scene, ortho, lights); CHECK(draws[0].matrixWorld[0] == 9);
}

std::vector<uint8_t> read(Renderer& r, EventQueue& events) {
    std::vector<uint8_t> out;
    bool done = false;
    r.readPixels([&](GpuStatus s, std::vector<uint8_t> px) {
        if (s == GpuStatus::Ok) out = std::move(px);
        done = true;
    });
    for (int i = 0; i < 4000 && !done; ++i) {
        r.poll();
        events.drain();
        if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return out;
}

// The lit-render fixture's scene, built through the native classes as its ops build it.
struct LitScene {
    Scene scene;
    PerspectiveCamera camera;
    std::shared_ptr<BufferGeometry> geometry = makeSphereGeometry(1, 32, 16);
    std::shared_ptr<Material> material = std::make_shared<Material>(MaterialType::Standard);
    Mesh mesh{geometry, material};
    DirectionalLight light{Color().setHex(0xffffff), 3};
    HemisphereLight sky{Color().setHex(0xaabb91), Color().setHex(0x222222), 0.6};
    LitScene() {
        camera.fov = 60;
        camera.aspect = 4.0 / 3;
        camera.near = 0.1;
        camera.far = 100;
        camera.position.y = 1.4;
        camera.position.z = 3.2;
        camera.lookAt(0, 0, 0);
        light.position.set(2, 3, 1);
        material->color.setRGB(0.8, 0.35, 0.2);
        material->roughness = 0.35;
        material->metalness = 0.1;
        scene.add(mesh);
        scene.add(light);
        scene.add(sky);
        camera.updateProjectionMatrix();
        scene.updateMatrixWorld(true);
    }
};

void litScene() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(320, 240);
    renderer.setOutput(OutputState{shader::ToneMapping::ACESFilmic, 1, true});
    LitScene s;
    RenderDatabase database;
    database.render(renderer, s.scene, s.camera, {0.05, 0.06, 0.08, 1});
    for (const std::string& d : database.diagnostics()) std::fprintf(stderr, "%s\n", d.c_str());
    CHECK(database.diagnostics().empty());
    const std::vector<uint8_t> px = read(renderer, events);
    // The desktop frame, raw RGBA, for the browser build's parity scenario (PRD-532).
    if (FILE* out = std::fopen(TN_NATIVE_LIT_OUT, "wb")) {
        std::fwrite(px.data(), 1, px.size(), out);
        std::fclose(out);
    }
    const std::string png = std::string(TN_GOLDENS_DIR) + "/lit-render.png";
    int w = 0, h = 0, c = 0;
    unsigned char* golden = stbi_load(png.c_str(), &w, &h, &c, 4);
    CHECK(golden && w == 320 && h == 240 && px.size() == 320 * 240 * 4);
    if (!golden || px.size() != 320 * 240 * 4) return;
    int worst = 0;
    size_t over1 = 0;
    for (size_t i = 0; i < px.size(); i += 4)
        for (int k = 0; k < 3; ++k) {
            const int d = std::abs(int(px[i + k]) - int(golden[i + k]));
            worst = std::max(worst, d);
            over1 += d > 1;
        }
    stbi_image_free(golden);
    std::printf("scene lit-render vs browser: worst %d, %.3f%% of channels over 1\n", worst, over1 * 100.0 / (320 * 240 * 3));
    CHECK(worst <= 8 && over1 < 320 * 240 * 3 / 1000);
}

std::vector<uint8_t> readTexture(Renderer& r, EventQueue& events, Handle texture) {
    std::vector<uint8_t> out;
    bool done = false;
    r.gpu().readTexture(texture, [&](GpuStatus s, std::vector<uint8_t> px) {
        if (s == GpuStatus::Ok) out = std::move(px);
        done = true;
    });
    for (int i = 0; i < 4000 && !done; ++i) {
        r.poll();
        events.drain();
        if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return out;
}

// presentNext puts the output pass into the target itself: the bytes the blit copies, for the
// formats a window surface takes, frame after frame, without disturbing the readable frame.
void presentDirect() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(160, 120);
    renderer.setOutput(OutputState{shader::ToneMapping::ACESFilmic, 1, true});
    LitScene s;
    RenderDatabase database;
    for (const WGPUTextureFormat format : {WGPUTextureFormat_RGBA8Unorm, WGPUTextureFormat_BGRA8Unorm}) {
        const WGPUTextureUsage usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
        const Handle copied = renderer.gpu().createTexture(160, 120, format, usage);
        const Handle direct = renderer.gpu().createTexture(160, 120, format, usage);
        WGPUTextureView copiedView = wgpuTextureCreateView(renderer.gpu().texture(copied), nullptr);
        WGPUTextureView directView = wgpuTextureCreateView(renderer.gpu().texture(direct), nullptr);
        for (int frame = 0; frame < 3; ++frame) {
            s.mesh.rotation.y = 0.4 * (frame + 1);
            database.render(renderer, s.scene, s.camera, {0.05, 0.06, 0.08, 1});
            CHECK(renderer.blitTo(context.getQueue(), copiedView, format));
            const std::vector<uint8_t> expected = readTexture(renderer, events, copied);
            const std::vector<uint8_t> readable = read(renderer, events);
            renderer.presentNext(directView, format);
            database.render(renderer, s.scene, s.camera, {0.05, 0.06, 0.08, 1});
            const std::vector<uint8_t> actual = readTexture(renderer, events, direct);
            CHECK(database.diagnostics().empty());
            CHECK(expected.size() == 160 * 120 * 4 && actual == expected);
            CHECK(std::any_of(expected.begin(), expected.end(), [&](uint8_t b) { return b != expected[0]; }));
            CHECK(read(renderer, events) == readable);  // a presented frame leaves the readable one alone
        }
        wgpuTextureViewRelease(copiedView);
        wgpuTextureViewRelease(directView);
        renderer.gpu().destroy(copied);
        renderer.gpu().destroy(direct);
    }
    // A frame that fails between arming and render() must not leave its borrowed view armed: the
    // next, ordinary frame may not draw into a view the caller has since released.
    const Handle stale = renderer.gpu().createTexture(160, 120, WGPUTextureFormat_RGBA8Unorm,
                                                      WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc);
    WGPUTextureView staleView = wgpuTextureCreateView(renderer.gpu().texture(stale), nullptr);
    auto sky = std::make_shared<DataTexture>();
    sky->mapping = 300;  // prepare() refuses anything but equirectangular reflection mapping
    s.scene.backgroundTexture = sky;
    bool threw = false;
    try {
        Renderer::PresentScope armed(renderer, staleView, WGPUTextureFormat_RGBA8Unorm);
        database.render(renderer, s.scene, s.camera, {0.05, 0.06, 0.08, 1});
    } catch (const std::runtime_error&) {
        threw = true;
    }
    CHECK(threw);
    s.scene.backgroundTexture.reset();
    database.render(renderer, s.scene, s.camera, {0.05, 0.06, 0.08, 1});
    const std::vector<uint8_t> untouched = readTexture(renderer, events, stale);
    CHECK(untouched.size() == 160 * 120 * 4 &&
          std::all_of(untouched.begin(), untouched.end(), [](uint8_t b) { return b == 0; }));
    wgpuTextureViewRelease(staleView);
    renderer.gpu().destroy(stale);
}

// The instance storage keeps its elements between frames: N instances, then fewer, then more, must
// each draw exactly what a renderer that never saw another count draws.
void instanceCounts() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer reused(context.getInstance(), context.getDevice(), context.getQueue(), events);
    const auto configure = [](Renderer& r) {
        r.setSize(96, 72);
        r.setOutput(OutputState{shader::ToneMapping::ACESFilmic, 1, true});
    };
    configure(reused);
    Scene scene;
    PerspectiveCamera camera(50, 96.0 / 72, 0.1, 100);
    camera.position.set(0, 0, 22);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const auto geometry = makeBoxGeometry();
    std::vector<std::shared_ptr<Mesh>> meshes;
    for (int i = 0; i < 100; ++i) {
        auto material = std::make_shared<Material>(MaterialType::Standard);
        material->color.setRGB(double(i) / 100, 0.3, 1 - double(i) / 100);
        material->roughness = i % 2 ? 0.3 : 0.8;  // two uniform groups: two instanced draws, the second at a base
        auto mesh = std::make_shared<Mesh>(geometry, material);
        mesh->position.set((i % 10 - 4.5) * 1.6, (i / 10 - 4.5) * 1.6, 0);
        scene.add(*mesh);
        meshes.push_back(mesh);
    }
    DirectionalLight light{Color().setHex(0xffffff), 3};
    light.position.set(3, 5, 8);
    scene.add(light);
    RenderDatabase reusedDb;
    for (const int count : {60, 20, 90, 100, 12, 12, 55}) {
        for (int i = 0; i < 100; ++i) meshes[i]->setVisible(i < count);
        reusedDb.render(reused, scene, camera, {0.05, 0.06, 0.08, 1});
        Renderer fresh(context.getInstance(), context.getDevice(), context.getQueue(), events);  // never saw another count
        configure(fresh);
        RenderDatabase freshDb;
        freshDb.render(fresh, scene, camera, {0.05, 0.06, 0.08, 1});
        const std::vector<uint8_t> a = read(reused, events), b = read(fresh, events);
        CHECK(a.size() == 96 * 72 * 4 && a == b);
        CHECK(reusedDb.lastBatches().second == static_cast<std::size_t>(count) && reusedDb.lastBatches().first == 2);
    }
}

// The flat lane's compact fast path (RenderDatabase::projectCompact) must decide exactly what the
// general project() decides. The same population, flat and then made non-flat by one parented
// object, must give the same draws: hidden, other-layer, transparent, mirrored, callback and
// ordinary batching meshes alike.
bool sameFloats(const void* a, const void* b, std::size_t bytes) {
    const auto* x = static_cast<const float*>(a);
    const auto* y = static_cast<const float*>(b);
    for (std::size_t i = 0; i < bytes / sizeof(float); ++i)
        if (x[i] != y[i]) return false;  // numeric: the two lanes may differ in the sign of a zero
    return true;
}

void flatLaneEquivalence() {
    struct Population {
        Scene scene;
        Object3D parent, child;  // only the non-flat variant attaches them
        std::vector<std::shared_ptr<Mesh>> meshes;
        std::shared_ptr<BufferGeometry> geometry = makeBoxGeometry();
        explicit Population(bool flat) {
            for (int i = 0; i < 96; ++i) {
                auto material = std::make_shared<Material>(MaterialType::Standard);
                material->color.setRGB(double(i) / 96, 0.4, 0.2);
                material->roughness = i % 5 == 0 ? 0.5 : 0.75;  // two uniform groups
                material->transparent = i % 9 == 0;
                auto mesh = std::make_shared<Mesh>(geometry, material);
                mesh->position.set((i % 12 - 5.5) * 1.7, (i / 12 - 3.5) * 1.7, -double(i % 7));
                if (i % 10 == 0) mesh->scale.x = -1;  // mirrored: negative determinant
                if (i % 11 == 0) mesh->setLayerMask(2);  // not on the camera's layer
                if (i % 8 == 1) mesh->setVisible(false);
                if (i % 13 == 2)
                    mesh->onBeforeRender = std::make_shared<const std::function<bool(const RenderCallbackArgs&, std::string&)>>(
                        [](const RenderCallbackArgs&, std::string&) { return true; });
                scene.add(*mesh);
                meshes.push_back(mesh);
            }
            if (!flat) {
                parent.add(child);
                scene.add(parent);
            }
        }
    };
    PerspectiveCamera camera(50, 4.0 / 3, 0.1, 100);
    camera.position.set(0, 0, 24);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    Population flatScene(true), generalScene(false);
    RenderDatabase flatDb, generalDb;
    for (int frame = 0; frame < 3; ++frame) {
        for (auto* population : {&flatScene, &generalScene})
            for (std::size_t i = 0; i < population->meshes.size(); ++i)
                population->meshes[i]->position.y += 0.05 * double(i % 4);  // they move, records stay
        LightState flatLights, generalLights;
        const auto flatItems = flatDb.prepare(flatScene.scene, camera, flatLights);
        auto generalItems = generalDb.prepare(generalScene.scene, camera, generalLights);
        CHECK(flatDb.diagnostics().empty() && generalDb.diagnostics().empty());
        CHECK(flatItems.size() == generalItems.size() && flatItems.size() > 3);
        CHECK(flatDb.lastBatches() == generalDb.lastBatches());
        CHECK(flatDb.rebuilds() == generalDb.rebuilds());
        for (std::size_t i = 0; i < std::min(flatItems.size(), generalItems.size()); ++i) {
            const DrawItem &a = flatItems[i], &b = generalItems[i];
            CHECK(a.instanceCount == b.instanceCount && a.transparent == b.transparent && a.matrixWorld == b.matrixWorld);
            CHECK(a.material->roughness == b.material->roughness && a.material->color == b.material->color);
            CHECK((a.instanceMatrices == nullptr) == (b.instanceMatrices == nullptr));
            if (a.instanceMatrices && b.instanceMatrices) {
                CHECK(a.instanceMatrices->byteLength() == b.instanceMatrices->byteLength());
                CHECK(sameFloats(a.instanceMatrices->data(), b.instanceMatrices->data(), a.instanceMatrices->byteLength()));
            }
            CHECK((a.instanceColors == nullptr) == (b.instanceColors == nullptr));
            if (a.instanceColors && b.instanceColors) {
                CHECK(a.instanceColors->byteLength() == b.instanceColors->byteLength());
                CHECK(sameFloats(a.instanceColors->data(), b.instanceColors->data(), a.instanceColors->byteLength()));
            }
        }
    }
}

// @invariant clip positions are asked for only by a frame that draws a second pipeline depth-Equal
// against the colour pass. Plain frames compile as three's do; under TRAA the colour programs and the
// velocity program are flagged together, and a program built before the toggle is not rebuilt in place.
void invariantScope() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    s.light.setCastShadow(true);  // a shadow depth program exists beside the colour program
    s.mesh.setCastShadow(true);
    RenderDatabase database;
    database.shadowMapEnabled = true;
    const auto flagged = [](const std::string& source) { return source.find("@invariant") != std::string::npos; };
    database.render(renderer, s.scene, s.camera);
    const auto plain = renderer.programVertexSources();
    CHECK(!plain.empty());
    for (const auto& [key, source] : plain) CHECK(!flagged(source));
    CHECK(std::any_of(plain.begin(), plain.end(), [](const auto& p) { return p.first.rfind("depth|", 0) == 0; }));
    renderer.setTraa(TraaOptions{});
    database.render(renderer, s.scene, s.camera);
    std::size_t colour = 0, velocity = 0;
    for (const auto& [key, source] : renderer.programVertexSources()) {
        const bool before = std::any_of(plain.begin(), plain.end(), [&](const auto& p) { return p.first == key; });
        if (key == "traa-velocity") { ++velocity; CHECK(flagged(source)); }
        else if (key.rfind("depth|", 0) == 0) CHECK(!flagged(source));  // the shadow depth program shares its stage with nothing, TRAA or not
        else if (before) CHECK(!flagged(source));                         // built by the plain frame, untouched
        else { ++colour; CHECK(flagged(source)); }
    }
    CHECK(velocity == 1 && colour >= 1);  // the TRAA frame built its own flagged colour program beside the plain one
}

void directionalTarget() {
    Scene scene;
    PerspectiveCamera camera;
    DirectionalLight light;
    light.position.set(0, 3, 0);
    light.setCastShadow(true);
    scene.add(light);
    Object3D parent;
    parent.position.x = 1;
    parent.add(*light.target);
    light.target->position.x = 2;
    RenderDatabase database;
    database.shadowMapEnabled = true;
    LightState lights;
    database.prepare(scene, camera, lights);
    CHECK(lights.direct.size() == 1);
    if (lights.direct.empty()) return;
    CHECK(light.target->matrixWorld.elements[12] == 3);
    const double axis = 1 / std::sqrt(2.0);
    CHECK(std::abs(lights.direct[0].direction[0] + axis) < 1e-12);
    CHECK(std::abs(lights.direct[0].direction[1] - axis) < 1e-12);
    Vector3 direction;
    light.shadow.camera->getWorldDirection(direction);
    CHECK(std::abs(direction.x - axis) < 1e-12 && std::abs(direction.y + axis) < 1e-12);
    light.target->matrixWorldAutoUpdate = false;
    light.target->matrixWorld.makeTranslation(0, 1, 0);
    light.target->position.x = 10;
    database.prepare(scene, camera, lights);
    CHECK(lights.direct[0].direction[0] == 0 && lights.direct[0].direction[1] == 1);
}

void invalidation() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    RenderDatabase database;
    database.render(renderer, s.scene, s.camera);
    const uint64_t first = database.rebuilds();
    CHECK(first == 1);
    for (int frame = 0; frame < 300; ++frame) database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first);  // an unchanged scene rebuilds nothing
    s.mesh.position.x = 0.5;  // a transform: the mesh's revision moves on the next updateMatrixWorld
    database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first);
    s.material->color.setRGB(0, 1, 0);
    s.material->needsUpdate();  // three's material.needsUpdate = true
    database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first + 1);
    s.scene.remove(s.mesh);  // a mesh that leaves the scene leaves the database
    database.render(renderer, s.scene, s.camera);
    s.scene.add(s.mesh);
    database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first + 2);
    for (int frame = 0; frame < 300; ++frame) database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first + 2);
}

// The alpha-transparency fixture as a scene: an OrthographicCamera, so WebGL clip z would put every
// plane behind the near plane — the WebGPU switch render() makes is what keeps them on screen —
// and transparent meshes sorted back to front by depth, renderOrder and Object3D.id.
void alphaScene() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(256, 128);
    Scene scene;
    OrthographicCamera camera(-2, 2, 1, -1, 0.1, 10);
    camera.position.z = 5;
    const auto big = makePlaneGeometry(1.6, 1.6), small = makePlaneGeometry(1, 1);
    struct Spec {
        std::shared_ptr<BufferGeometry> geometry;
        double r, g, b;
        bool transparent;
        double opacity, x, z;
        int renderOrder;
    };
    const Spec specs[] = {{big, 0, 0, 1, true, 0.5, 0.2, 0.5, 0},       {big, 0, 1, 0, true, 0.5, -0.3, 0, 0},
                          {big, 1, 0, 0, false, 1, -0.8, -0.5, 0},       {small, 1, 0, 1, true, 0.6, 1.35, -0.4, 2},
                          {small, 1, 1, 0, true, 0.6, 1.0, 0.4, 1}};
    std::vector<std::shared_ptr<Material>> materials;
    std::vector<std::unique_ptr<Mesh>> meshes;
    for (const Spec& s : specs) {
        materials.push_back(std::make_shared<Material>(MaterialType::Basic));
        Material& m = *materials.back();
        m.color.setRGB(s.r, s.g, s.b);
        m.transparent = s.transparent;
        m.opacity = s.opacity;
        meshes.push_back(std::make_unique<Mesh>(s.geometry, materials.back()));
        Mesh& mesh = *meshes.back();
        mesh.position.x = s.x;
        mesh.position.z = s.z;
        mesh.setRenderOrder(s.renderOrder);
        scene.add(mesh);
    }
    RenderDatabase database;
    database.render(renderer, scene, camera, {0.1, 0.1, 0.1, 1});
    const std::vector<uint8_t> px = read(renderer, events);
    const std::string png = std::string(TN_GOLDENS_DIR) + "/alpha-transparency.png";
    int w = 0, h = 0, c = 0;
    unsigned char* golden = stbi_load(png.c_str(), &w, &h, &c, 4);
    CHECK(golden && w == 256 && h == 128 && px.size() == 256 * 128 * 4);
    if (!golden || px.size() != 256 * 128 * 4) return;
    int worst = 0;
    for (size_t i = 0; i < px.size(); i += 4)
        for (int k = 0; k < 3; ++k) worst = std::max(worst, std::abs(int(px[i + k]) - int(golden[i + k])));
    stbi_image_free(golden);
    std::printf("scene alpha-transparency vs browser: worst %d\n", worst);
    CHECK(worst <= 1);
}

// An unported material property is refused by name and its mesh is not drawn, never silently drawn
// with a simpler shader (PRD-514 decision 4); a supported material in the same scene still draws.
void materialUnsupported() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    auto coated = std::make_shared<Material>(MaterialType::Physical);
    coated->clearcoat = 0.5;
    Mesh refused{s.geometry, coated};
    refused.position.x = 1;
    s.scene.add(refused);
    RenderDatabase database;
    database.render(renderer, s.scene, s.camera);
    bool named = false;
    for (const std::string& d : database.diagnostics()) {
        std::fprintf(stderr, "%s\n", d.c_str());
        named = named || (d.rfind("TN_NATIVE_MATERIAL_UNSUPPORTED MeshPhysicalMaterial", 0) == 0 && d.find("clearcoat") != std::string::npos);
    }
    CHECK(named);
    CHECK(database.diagnostics().size() == 1);  // the standard mesh beside it is not refused
}

// PRD-514: an edit between frames shows on the next frame, and nothing a frame no longer draws stays
// behind: a released geometry's GPU copies are freed and never served to a geometry that reuses its
// address.
void updates() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    RenderDatabase database;
    const auto frame = [&] {
        database.render(renderer, s.scene, s.camera, {0, 0, 0, 1});
        CHECK(database.diagnostics().empty());
        return read(renderer, events);
    };
    const auto lit = [](const std::vector<uint8_t>& px) {
        size_t n = 0;
        for (size_t i = 0; i + 3 < px.size(); i += 4) n += (px[i] | px[i + 1] | px[i + 2]) != 0;
        return n;
    };
    const size_t center = (24 * 64 + 32) * 4;
    std::vector<uint8_t> px = frame();
    CHECK(px.size() == 64 * 48 * 4 && px[center] > px[center + 2]);  // the orange sphere

    // A material edit is blue on the next frame.
    s.material->color.setRGB(0.1, 0.2, 0.9);
    s.material->needsUpdate();
    px = frame();
    CHECK(px[center + 2] > px[center]);

    // Positions edited in place and flagged (three's attribute.needsUpdate) shrink the next frame.
    const size_t whole = lit(px);
    BufferStore& positions = *s.geometry->attributes.at("position")->store;
    float* p = reinterpret_cast<float*>(positions.data());
    for (uint64_t i = 0; i < positions.count(); ++i) p[i] *= 0.25f;
    positions.needsUpdate();
    px = frame();
    CHECK(lit(px) > 0 && lit(px) * 4 < whole);

    // 200 geometry swaps, each old geometry released. Same vertex count, alternating radius: a new
    // geometry at a released one's address must draw its own radius, never the old GPU copy, and the
    // GPU keeps copies of the live geometry and at most the one the previous frame drew.
    s.geometry.reset();
    size_t silhouette[2] = {0, 0};
    int stale = 0;
    for (int i = 0; i < 200; ++i) {
        s.mesh.geometry = makeSphereGeometry(i % 2 ? 0.5 : 1, 16, 8);
        const size_t n = lit(frame());
        if (i < 2) silhouette[i] = n;
        else stale += n != silhouette[i % 2];
    }
    CHECK(silhouette[1] > 0 && silhouette[1] < silhouette[0]);
    CHECK(stale == 0);
    if (stale) std::fprintf(stderr, "frames drawn from a released geometry: %d\n", stale);
    CHECK(renderer.geometry().entries() <= 6);
    if (renderer.geometry().entries() > 6) std::fprintf(stderr, "GPU copies: %zu\n", renderer.geometry().entries());
}

// PRD-514: two cameras with different layers, rendered in one tick, each see only their layer's mesh
// and get distinct render IDs; ticking both keeps every record, so no frame rebuilds the other's.
void multiCameraLayers() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    s.mesh.position.x = -1.2;
    s.mesh.setLayer(1);
    auto blue = std::make_shared<Material>(MaterialType::Standard);
    blue->color.setRGB(0.1, 0.2, 0.9);
    Mesh right{s.geometry, blue};
    right.position.x = 1.2;
    right.setLayer(2);
    s.scene.add(right);
    for (Object3D* light : {static_cast<Object3D*>(&s.light), static_cast<Object3D*>(&s.sky)}) {
        light->enableLayer(1);
        light->enableLayer(2);
    }
    PerspectiveCamera second;  // the same view as the first, on another layer
    second.fov = s.camera.fov;
    second.aspect = s.camera.aspect;
    second.near = s.camera.near;
    second.far = s.camera.far;
    second.position.copy(s.camera.position);
    second.lookAt(0, 0, 0);
    second.updateProjectionMatrix();
    s.camera.setLayer(1);
    second.setLayer(2);
    RenderDatabase database;
    const auto lit = [](const std::vector<uint8_t>& px, int x) {
        const size_t i = (24 * 64 + size_t(x)) * 4;
        return px.size() == 64 * 48 * 4 && (px[i] | px[i + 1] | px[i + 2]) != 0;
    };
    const uint64_t first = database.render(renderer, s.scene, s.camera);
    const std::vector<uint8_t> a = read(renderer, events);
    const uint64_t other = database.render(renderer, s.scene, second);
    const std::vector<uint8_t> b = read(renderer, events);
    CHECK(first != other);
    CHECK(lit(a, 14) && !lit(a, 50));  // layer 1: the left mesh only
    CHECK(!lit(b, 14) && lit(b, 50));  // layer 2: the right mesh only
    CHECK(database.diagnostics().empty());
    const uint64_t built = database.rebuilds();
    for (int tick = 0; tick < 100; ++tick) {
        database.render(renderer, s.scene, s.camera);
        database.render(renderer, s.scene, second);
    }
    CHECK(database.rebuilds() == built);
    if (database.rebuilds() != built) std::fprintf(stderr, "rebuilds over 100 ticks: %llu\n", (unsigned long long)(database.rebuilds() - built));
}

// PRD-531/506: onBeforeRender runs once per drawn frame with the scene and camera, before the draw,
// so a colour it sets reaches the same frame; a callee that threw is a diagnostic, not a crash.
void renderCallback() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    RenderDatabase database;
    int calls = 0;
    RenderCallbackArgs seen;
    s.mesh.onBeforeRender = std::make_shared<const std::function<bool(const RenderCallbackArgs&, std::string&)>>(
        [&](const RenderCallbackArgs& a, std::string&) {
            ++calls;
            seen = a;
            s.material->color.setRGB(0.1, 0.2, 0.9);
            return true;
        });
    database.render(renderer, s.scene, s.camera, {0, 0, 0, 1});
    const std::vector<uint8_t> px = read(renderer, events);
    const size_t center = (24 * 64 + 32) * 4;
    CHECK(calls == 1);
    CHECK(seen.scene == &s.scene && seen.camera == &s.camera);
    CHECK(seen.geometry == s.geometry && seen.material == s.material);
    CHECK(px.size() == 64 * 48 * 4 && px[center + 2] > px[center]);  // blue in the frame it was set
    CHECK(database.diagnostics().empty());

    s.mesh.onBeforeRender = std::make_shared<const std::function<bool(const RenderCallbackArgs&, std::string&)>>(
        [](const RenderCallbackArgs&, std::string& error) {
            error = "boom";
            return false;
        });
    database.render(renderer, s.scene, s.camera, {0, 0, 0, 1});
    CHECK(database.diagnostics().size() == 1 && database.diagnostics()[0] == "TN_CALLBACK_FAILED onBeforeRender: boom");

    s.mesh.setVisible(false);  // a mesh not drawn is not called
    calls = 0;
    s.mesh.onBeforeRender = std::make_shared<const std::function<bool(const RenderCallbackArgs&, std::string&)>>(
        [&](const RenderCallbackArgs&, std::string&) {
            ++calls;
            return true;
        });
    database.render(renderer, s.scene, s.camera, {0, 0, 0, 1});
    CHECK(calls == 0);
}

// PRD-519 groundwork: an InstancedMesh draws exactly what the same objects drawn one by one draw.
// Nine lit spheres, rotated, non-uniformly scaled and coloured per instance, render once as one
// InstancedMesh (one draw, three's instance(): matrix per instance, normals by its inverse
// transpose, instanceColor times the material colour) and once as nine Meshes with those world
// matrices and colours (nine draws). The frames must match to within float rounding.
void instanced() {
    if (std::getenv("TN_DUMP_WGSL")) {
        const auto p = shader::buildBasic({true, true});
        std::printf("%s\n", shader::buildStage(p.vertex, 0).wgsl.code.c_str());
        return;
    }
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(160, 120);
    PerspectiveCamera camera(50, 4.0 / 3, 0.1, 100);
    camera.position.set(0, 2, 9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    // Spheres, not boxes: a box's normals are axis-aligned, and for those the instance matrix and its
    // inverse transpose point the same way, so only a curved surface tests the normal transform.
    auto geometry = makeSphereGeometry(0.6, 24, 16);
    const Color base = Color().setHex(0xdddddd);
    std::vector<Matrix4> matrices;
    std::vector<Color> colors;
    for (int i = 0; i < 9; ++i) {
        const Vector3 position((i % 3 - 1) * 2.6, (i / 3 - 1) * 1.9, -0.4 * i);
        Quaternion q;
        q.setFromEuler(Euler(0.3 * i, 0.5 + 0.2 * i, 0.1 * i));
        const Vector3 scale(0.6 + 0.1 * i, 1.0 - 0.05 * i, 0.8 + (i % 2) * 0.5);  // non-uniform: the normal path
        matrices.push_back(Matrix4().compose(position, q, scale));
        colors.push_back(Color().setHSL(i / 9.0, 0.7, 0.5));
    }
    const auto light = [](Object3D& scene) {
        auto sun = std::make_shared<DirectionalLight>(Color().setHex(0xffffff), 2.5);
        sun->position.set(3, 4, 5);
        auto sky = std::make_shared<HemisphereLight>(Color().setHex(0xb0c4de), Color().setHex(0x302820), 0.8);
        scene.add(*sun);
        scene.add(*sky);
        return std::make_pair(sun, sky);
    };

    Scene batched;
    const auto keepA = light(batched);
    auto material = std::make_shared<Material>(MaterialType::Standard);
    material->color = base;
    material->roughness = 0.6;
    auto mesh = std::make_shared<InstancedMesh>(geometry, material, 9);
    for (int i = 0; i < 9; ++i) mesh->setMatrixAt(i, matrices[i]).setColorAt(i, colors[i]);
    batched.add(*mesh);
    RenderDatabase dbA;
    dbA.render(renderer, batched, camera);
    const auto statsA = renderer.lastFrame();
    const std::vector<uint8_t> a = read(renderer, events);

    Scene separate;
    const auto keepB = light(separate);
    std::vector<std::shared_ptr<Mesh>> meshes;
    for (int i = 0; i < 9; ++i) {
        auto m = std::make_shared<Material>(MaterialType::Standard);
        // The instance colour is stored as float32 and multiplies the material colour in the shader.
        m->color.setRGB(float(colors[i].r) * base.r, float(colors[i].g) * base.g, float(colors[i].b) * base.b);
        m->roughness = 0.6;
        auto one = std::make_shared<Mesh>(geometry, m);
        one->matrixAutoUpdate = false;
        one->matrix = matrices[i];
        separate.add(*one);
        meshes.push_back(one);
    }
    RenderDatabase dbB;
    dbB.batching = false; // the reference is nine separate draws, not the engine's own instancing
    dbB.render(renderer, separate, camera);
    const auto statsB = renderer.lastFrame();
    const std::vector<uint8_t> b = read(renderer, events);

    CHECK(a.size() == b.size() && !a.empty());
    std::size_t lit = 0, differ = 0;
    int worst = 0;
    for (std::size_t p = 0; p + 3 < a.size() && a.size() == b.size(); p += 4) {
        int d = 0;
        for (int c = 0; c < 3; ++c) d = std::max(d, std::abs(int(a[p + c]) - int(b[p + c])));
        worst = std::max(worst, d);
        if (d > 2) ++differ;
        if (a[p] + a[p + 1] + a[p + 2] > 0) ++lit;
    }
    std::printf("instanced: draws %u vs %u, triangles %llu vs %llu, %zu covered pixels, %zu differ by more than 2 (worst %d)\n",
                statsA.draws, statsB.draws, (unsigned long long)statsA.triangles, (unsigned long long)statsB.triangles,
                lit, differ, worst);
    // Each frame adds the output pass (one draw, one triangle) to the scene's.
    CHECK(statsA.draws == 1 + 1 && statsB.draws == 9 + 1 && statsA.triangles == statsB.triangles);
    CHECK(lit > 1000 && differ == 0);
    for (const std::string& d : dbA.diagnostics()) std::fprintf(stderr, "%s\n", d.c_str());
    CHECK(dbA.diagnostics().empty());
}

// PRD-519 phase 1: a mixed scene renders the same batched and fully unbatched. Automatic batching
// merges opaque plain meshes sharing a geometry and material (at least four) into instanced draws;
// below the minimum, transparent meshes, a different render order and a mesh with a render callback
// stay single. Batching on and off must give the same frame, with fewer draws on.
void batchedVsUnbatched() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(200, 150);
    PerspectiveCamera camera(55, 4.0 / 3, 0.1, 100);
    camera.position.set(0, 3, 13);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    Scene scene;
    auto sun = std::make_shared<DirectionalLight>(Color().setHex(0xffffff), 2.2);
    sun->position.set(2, 5, 4);
    auto sky = std::make_shared<HemisphereLight>(Color().setHex(0xc0d0ff), Color().setHex(0x403020), 0.7);
    scene.add(*sun);
    scene.add(*sky);
    auto sphere = makeSphereGeometry(0.5, 20, 14);
    auto box = makeBoxGeometry(0.8, 0.8, 0.8);
    const auto material = [](MaterialType type, uint32_t hex, bool transparent = false) {
        auto m = std::make_shared<Material>(type);
        m->color.setHex(hex);
        if (transparent) {
            m->transparent = true;
            m->opacity = 0.5;
        }
        return m;
    };
    auto standard = material(MaterialType::Standard, 0x88aaee), lambert = material(MaterialType::Lambert, 0xee9955),
         glass = material(MaterialType::Standard, 0x99ffcc, true), single = material(MaterialType::Phong, 0xdddd66);
    std::vector<std::shared_ptr<Mesh>> meshes;
    const auto place = [&](const std::shared_ptr<BufferGeometry>& g, const std::shared_ptr<Material>& m, double x,
                           double y, double z, int order = 0) {
        auto mesh = std::make_shared<Mesh>(g, m);
        mesh->position.set(x, y, z);
        mesh->rotation.set(0.3 * x, 0.2 * y, 0.1 * z);
        mesh->scale.set(1 + 0.05 * x, 1 - 0.03 * y, 1);
        if (order) mesh->setRenderOrder(order);
        scene.add(*mesh);
        meshes.push_back(mesh);
        return mesh;
    };
    for (int i = 0; i < 6; ++i) place(sphere, standard, -5 + i * 2.0, 2.4, 0);       // one batch of six
    for (int i = 0; i < 3; ++i) place(sphere, single, -2 + i * 2.0, -2.6, 1);        // three: below the minimum
    for (int i = 0; i < 5; ++i) place(box, lambert, -4 + i * 2.0, 0.4, -1);          // a second batch of five
    for (int i = 0; i < 4; ++i) place(sphere, glass, -3 + i * 2.0, -0.9, 2.5);       // transparent: never batched
    for (int i = 0; i < 4; ++i) place(box, standard, -3 + i * 2.0, 4.2, -2, 1);      // another render order
    auto watched = place(sphere, standard, 4, -2.6, 1);                              // a callback keeps it single
    int callbacks = 0;
    watched->onBeforeRender = std::make_shared<const std::function<bool(const RenderCallbackArgs&, std::string&)>>(
        [&](const RenderCallbackArgs&, std::string&) { return ++callbacks, true; });

    RenderDatabase database;
    database.batching = false;
    database.render(renderer, scene, camera);
    const auto unbatchedStats = renderer.lastFrame();
    const std::vector<uint8_t> unbatched = read(renderer, events);
    database.batching = true;
    database.render(renderer, scene, camera);
    const auto batchedStats = renderer.lastFrame();
    const auto [groups, members] = database.lastBatches();
    const std::vector<uint8_t> batched = read(renderer, events);

    std::size_t covered = 0, differ = 0;
    int worst = 0;
    for (std::size_t p = 0; p + 3 < batched.size() && batched.size() == unbatched.size(); p += 4) {
        int d = 0;
        for (int c = 0; c < 3; ++c) d = std::max(d, std::abs(int(batched[p + c]) - int(unbatched[p + c])));
        worst = std::max(worst, d);
        if (d > 2) ++differ;
        if (batched[p] + batched[p + 1] + batched[p + 2] > 0) ++covered;
    }
    std::printf("batched vs unbatched: %zu groups of %zu meshes; draws %u vs %u, triangles %llu vs %llu; "
                "%zu covered pixels, %zu differ by more than 2 (worst %d); callback ran %d times\n",
                groups, members, batchedStats.draws, unbatchedStats.draws, (unsigned long long)batchedStats.triangles,
                (unsigned long long)unbatchedStats.triangles, covered, differ, worst, callbacks);
    CHECK(batched.size() == unbatched.size() && !batched.empty());
    CHECK(groups == 3 && members == 6 + 5 + 4);                 // standard spheres, lambert boxes, ordered boxes
    CHECK(batchedStats.draws == unbatchedStats.draws - members + groups);
    CHECK(batchedStats.triangles == unbatchedStats.triangles);
    CHECK(covered > 2000 && differ == 0);
    CHECK(callbacks == 2);                                       // the callback mesh drew in both renders
    for (const std::string& d : database.diagnostics()) std::fprintf(stderr, "%s\n", d.c_str());
    CHECK(database.diagnostics().empty());
}

// PRD-518 box 38: the same animated poses and refusals, with batching on and off, including shadows.
void skinnedCrowdPixels() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(320, 180);
    player::SkinnedCrowd crowd;
    auto* bound = static_cast<SkinnedMesh*>(crowd.scene().getObjectByName("walker-0"));
    bound->bindMatrix.makeTranslation(0.15, 0, 0);
    auto* detached = static_cast<SkinnedMesh*>(crowd.scene().getObjectByName("walker-1"));
    detached->attached = false;
    crowd.scene().getObjectByName("walker-2")->scale.setScalar(1.2);
    RenderDatabase database;
    database.shadowMapEnabled = true;
    for (int pose = 0; pose < 3; ++pose) {
        for (int tick = 0; tick < 30; ++tick)
            crowd.update(1.0 / 60);
        database.batching = false;
        database.render(renderer, crowd.scene(), crowd.camera());
        const auto separate = read(renderer, events);
        const auto exactStats = renderer.lastFrame();
        database.batching = true;
        database.render(renderer, crowd.scene(), crowd.camera());
        const auto batched = read(renderer, events);
        const auto stats = renderer.lastFrame();
        CHECK(!batched.empty() && separate.size() == batched.size());
        CHECK(stats.triangles == exactStats.triangles);
        for (const auto& pass : {stats.mainSkinned, stats.shadowSkinned}) {
            CHECK(pass.batches == 1 && pass.draws == 5 && pass.exactDraws == 4 && pass.instances == 64);
        }
        CHECK(exactStats.mainSkinned.draws == 68 && exactStats.shadowSkinned.draws == 68);
        std::size_t covered = 0, differ = 0;
        int worst = 0;
        for (std::size_t p = 0; p + 3 < batched.size() && separate.size() == batched.size(); p += 4) {
            int delta = 0;
            for (int channel = 0; channel < 3; ++channel)
                delta = std::max(delta, std::abs(int(batched[p + channel]) - int(separate[p + channel])));
            worst = std::max(worst, delta);
            differ += delta > 2;
            covered += batched[p] + batched[p + 1] + batched[p + 2] > 0;
        }
        std::printf("skinned crowd pose %d: %zu covered, %zu pixels differ >2, worst %d\n", pose, covered, differ,
                    worst);
        // CPU f32 world-space palettes (world * bindInverse * bone * bind) round differently
        // from the exact shader's model/bind transforms, moving a triangle edge across a pixel
        // centre. The GPU measured 1 pixel >2 levels in each pose; allow at most 4 edge pixels.
        CHECK(covered > 1000 && differ <= 4);
        CHECK(database.diagnostics().empty());
    }
}

// PRD-526: glTF stores WEIGHTS_0 as normalized unsigned bytes. The shader reads vec4<f32>, so the
// vertex format must be Unorm8x4: bound as Float32x4 the buffer reads as zeros and the rig vanishes.
void skinnedNormalizedWeights() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(320, 180);
    player::SkinnedCrowd crowd;
    RenderDatabase database;
    database.batching = false;
    database.render(renderer, crowd.scene(), crowd.camera());
    const auto floats = read(renderer, events);
    auto* walker = static_cast<SkinnedMesh*>(crowd.scene().getObjectByName("walker-0"));
    const auto weights = walker->geometry->attributes.at("skinWeight");
    std::vector<double> bytes;
    for (uint64_t i = 0; i < weights->count() * 4; ++i)
        bytes.push_back(std::round(weights->getComponent(i / 4, int(i % 4)) * 255));
    walker->geometry->setAttribute("skinWeight", BufferAttribute::fromDoubles(Scalar::U8, bytes, 4, true));
    database.render(renderer, crowd.scene(), crowd.camera());
    const auto normalized = read(renderer, events);
    CHECK(!floats.empty() && floats.size() == normalized.size());
    std::size_t covered = 0, differ = 0;
    for (std::size_t p = 0; p + 3 < floats.size(); p += 4) {
        int delta = 0;
        for (int channel = 0; channel < 3; ++channel)
            delta = std::max(delta, std::abs(int(floats[p + channel]) - int(normalized[p + channel])));
        differ += delta > 8;
        covered += floats[p] + floats[p + 1] + floats[p + 2] > 0;
    }
    std::printf("normalized skin weights: %zu covered pixels, %zu differ by more than 8 levels\n", covered, differ);
    // One-in-255 weight rounding moves a few edge pixels; a vanished rig would differ by thousands.
    CHECK(covered > 1000 && differ <= 40);
}

// PRD-526: a tangent-space normalMap bends the lit normal along the uv axes (three's perturbNormal2Arb).
// A plane facing the camera: lit from +x, a map tilting every normal toward +x (red high) brightens it,
// one tilting away darkens it, and no map sits between; lit from +y the same holds for green, whose
// direction is where dFdy's sign shows. The same maps as a loaded `Texture` (mipmapped) must agree
// with the DataTexture (one level). Each arm's textures are destroyed before the next arm builds its
// own: the renderer's texture cache must not serve a dead texture's image to one built at its address.
void normalMapTilt() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(160, 120);
    renderer.setOutput(OutputState{std::nullopt, 1, true});
    struct Tilt { int red, green; bool loaded; };  // red < 0: no map
    auto brightness = [&](Tilt tilt, std::array<double, 3> lightAt) {
        Scene scene;
        PerspectiveCamera camera;
        camera.fov = 40; camera.aspect = 4.0 / 3; camera.near = 0.1; camera.far = 50;
        camera.position.z = 3;
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        auto material = std::make_shared<Material>(MaterialType::Standard);
        material->roughness = 1;
        if (tilt.red >= 0) {
            std::vector<double> texels;
            for (int i = 0; i < 4; ++i) texels.insert(texels.end(), {double(tilt.red), double(tilt.green), 220, 255});
            if (tilt.loaded) {
                auto map = std::make_shared<Texture>();  // what the glTF loader makes: mipmapped, not a DataTexture
                map->width = map->height = 2;
                map->flipY = false;
                for (double v : texels) map->data.push_back(static_cast<uint8_t>(v));
                map->needsUpdate();
                material->maps["normalMap"] = map;
            } else {
                auto map = std::make_shared<DataTexture>();
                map->setImage(texels, "Uint8Array", 2, 2, kTextureRGBAFormat, kTextureUnsignedByteType);
                map->needsUpdate();
                material->maps["normalMap"] = map;
            }
        }
        Mesh plane(makePlaneGeometry(3, 3), material);
        DirectionalLight light{Color().setHex(0xffffff), 3};
        light.position.set(lightAt[0], lightAt[1], lightAt[2]);
        scene.add(plane);
        scene.add(light);
        scene.updateMatrixWorld(true);
        RenderDatabase database;
        database.render(renderer, scene, camera, {0, 0, 0, 1});
        CHECK(database.diagnostics().empty());
        const auto px = read(renderer, events);
        CHECK(px.size() == 160 * 120 * 4);
        double sum = 0;
        for (int y = 40; y < 80; ++y)
            for (int x = 60; x < 100; ++x) sum += px[(size_t(y) * 160 + x) * 4 + 1];
        return sum / (40 * 40);
    };
    const std::array<double, 3> fromRight{4, 0, 2}, fromAbove{0, 4, 2};
    const double none = brightness({-1, 128, false}, fromRight);
    const double toward = brightness({191, 128, false}, fromRight), away = brightness({64, 128, false}, fromRight);
    const double noneUp = brightness({-1, 128, false}, fromAbove);
    const double up = brightness({128, 191, false}, fromAbove), down = brightness({128, 64, false}, fromAbove);
    const double loadedToward = brightness({191, 128, true}, fromRight);
    const double loadedUp = brightness({128, 191, true}, fromAbove);
    std::printf("normal map tilt: x %.1f/%.1f/%.1f, y %.1f/%.1f/%.1f, loaded %.1f/%.1f\n", toward, none, away, up, noneUp, down,
                loadedToward, loadedUp);
    CHECK(toward > none + 8 && none > away + 8);
    CHECK(up > noneUp + 8 && noneUp > down + 8);  // green: the dFdy sign
    CHECK(std::abs(loadedToward - toward) < 2 && std::abs(loadedUp - up) < 2);
    brightness({-1, 128, false}, fromRight);  // the next frame sweeps the last arm's dead texture too
    CHECK(renderer.materialTextureCount() == 0);  // no dead texture's GPU copy is kept
}

// PRD-526 review: a decoded map the standard program does not read is refused by name, never drawn without it.
void unsupportedMapSlot() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    LitScene s;
    auto rough = std::make_shared<Material>(MaterialType::Standard);
    auto map = std::make_shared<DataTexture>();
    map->setImage({255, 255, 255, 255}, "Uint8Array", 1, 1, kTextureRGBAFormat, kTextureUnsignedByteType);
    rough->maps["roughnessMap"] = map;
    Mesh refused{s.geometry, rough};
    refused.position.x = 1;
    s.scene.add(refused);
    RenderDatabase database;
    database.render(renderer, s.scene, s.camera);
    bool named = false;
    for (const std::string& d : database.diagnostics())
        named = named || (d.rfind("TN_NATIVE_MATERIAL_UNSUPPORTED", 0) == 0 && d.find("roughnessMap") != std::string::npos);
    CHECK(named);
    CHECK(database.diagnostics().size() == 1);  // the plain mesh beside it is not refused
}

// PRD-526 review: the float32 copies of quantized attributes follow their sources. A scene that loads and
// unloads quantized geometry must not keep one copy per geometry it ever saw.
void convertedCopiesAreSwept() {
    RenderDatabase database;
    PerspectiveCamera camera;
    camera.updateProjectionMatrix();
    // Each round's attribute stays allocated (a distinct key) while its store is replaced, so the old
    // source is gone but its table entry is not overwritten by an address reuse.
    std::vector<std::shared_ptr<BufferAttribute>> retained;
    for (int round = 0; round < 300; ++round) {
        Scene scene;
        auto geometry = makeBoxGeometry(1, 1, 1);
        const auto normals = geometry->attributes.at("normal");
        std::vector<double> quantized;
        for (uint64_t i = 0; i < normals->count(); ++i)
            for (int c = 0; c < 3; ++c) quantized.push_back(std::round(normals->getComponent(i, c) * 127));
        auto attribute = BufferAttribute::fromDoubles(Scalar::I8, quantized, 3, true);
        geometry->setAttribute("normal", attribute);
        retained.push_back(attribute);
        auto material = std::make_shared<Material>(MaterialType::Standard);
        Mesh mesh(geometry, material);
        scene.add(mesh);
        scene.updateMatrixWorld(true);
        LightState lights;
        const auto items = database.prepare(scene, camera, lights);
        CHECK(items.size() == 1 && items[0].normals != nullptr);
        CHECK(items[0].normals->scalar() == Scalar::F32);  // the renderer is handed floats
        attribute->store = std::make_shared<BufferStore>(Scalar::I8, 3);  // the source dies
    }
    std::printf("converted copies held after 300 geometries: %zu\n", database.convertedCount());
    CHECK(database.convertedCount() <= 130);
}

// The frame's GPU time starts at its first shadow pass, which runs before the scene pass; before the
// fix it started at the scene pass and a shadowed scene's shadow work was never timed.
void gpuTimerCoversShadows() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(64, 48);
    if (!wgpuDeviceHasFeature(context.getDevice(), WGPUFeatureName_TimestampQuery)) {
        std::printf("no timestamp-query on this device: nothing to time\n");
        return;
    }
    for (const bool shadows : {true, false}) {
        LitScene s;
        s.light.setCastShadow(shadows);
        s.mesh.setCastShadow(shadows);
        RenderDatabase database;
        database.shadowMapEnabled = shadows;
        const uint64_t before = renderer.gpuSamples();
        // A sample is read back asynchronously: render a few frames, as a game does, until one lands.
        for (int frame = 0; frame < 8 && renderer.gpuSamples() == before; ++frame) {
            database.render(renderer, s.scene, s.camera);
            while (renderer.gpu().completedSerial() < renderer.gpu().submittedSerial()) {
                renderer.poll();
                events.drain();
            }
            const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(250);
            while (renderer.gpuSamples() == before && std::chrono::steady_clock::now() < until) {
                renderer.poll();
                events.drain();
            }
        }
        CHECK(renderer.gpuSamples() > before);  // a timestamp-query device times the frame
        CHECK(renderer.gpuTimerBeganAtShadow() == shadows);
    }
}

}  // namespace

TN_TEST_MAIN({"uniform_batch_preparation", uniformBatchPreparation}, {"scene_environment", sceneEnvironment}, {"lit_scene", litScene}, {"present_direct", presentDirect}, {"invariant_scope", invariantScope}, {"instance_counts", instanceCounts}, {"flat_lane_equivalence", flatLaneEquivalence}, {"directional_target", directionalTarget}, {"invalidation", invalidation}, {"alpha_scene", alphaScene},
             {"material_unsupported", materialUnsupported}, {"updates", updates},
             {"multi_camera_layers", multiCameraLayers}, {"render_callback", renderCallback}, {"instanced", instanced},
             {"batched_vs_unbatched", batchedVsUnbatched}, {"skinned_crowd", skinnedCrowdPixels}, {"skinned_normalized_weights", skinnedNormalizedWeights}, {"normal_map_tilt", normalMapTilt}, {"unsupported_map_slot", unsupportedMapSlot}, {"converted_copies_swept", convertedCopiesAreSwept}, {"gpu_timer_covers_shadows", gpuTimerCoversShadows})
