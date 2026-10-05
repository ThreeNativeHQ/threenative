// PRD-514 phase 1: the render database draws the native scene graph. `lit_scene` builds the
// lit-render fixture as a scene (SphereGeometry, MeshStandardMaterial, DirectionalLight,
// HemisphereLight, PerspectiveCamera) and renders it with renderer.render(scene, camera)'s native
// path, against the browser's golden frame. `invalidation` checks that records follow revisions only.

#include "check.h"
#include "engine/renderer/render_database.h"
#include "engine/scene/geometries.h"
#include "mystral/webgpu/context.h"

#include <chrono>
#include <cmath>
#include <string>
#include <thread>

extern "C" unsigned char* stbi_load(const char* filename, int* x, int* y, int* comp, int req_comp);
extern "C" void stbi_image_free(void* data);

using namespace tn::engine;

namespace {

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
    CHECK(database.rebuilds() == first + 1);
    s.material->color.setRGB(0, 1, 0);
    s.material->needsUpdate();  // three's material.needsUpdate = true
    database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first + 2);
    s.scene.remove(s.mesh);  // a mesh that leaves the scene leaves the database
    database.render(renderer, s.scene, s.camera);
    s.scene.add(s.mesh);
    database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first + 3);
    for (int frame = 0; frame < 300; ++frame) database.render(renderer, s.scene, s.camera);
    CHECK(database.rebuilds() == first + 3);
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

}  // namespace

TN_TEST_MAIN({"lit_scene", litScene}, {"invalidation", invalidation},
            {"alpha_scene", alphaScene},
            {"material_unsupported", materialUnsupported})
