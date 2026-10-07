#include "check.h"
#include "engine/renderer/render_database.h"
#include "engine/scene/geometries.h"

#include <algorithm>
#include <chrono>

using namespace tn::engine;

namespace {
double measure(int count) {
    Scene scene;
    PerspectiveCamera camera;
    RenderDatabase database;
    database.profiling = true;
    LightState lights;
    const auto geometry = makeBoxGeometry();
    std::vector<std::shared_ptr<Mesh>> meshes;
    meshes.reserve(count);
    for (int i = 0; i < count; ++i) {
        auto material = std::make_shared<Material>(MaterialType::Standard);
        material->color.setHex(0xff0000 | i);
        material->roughness = 0.75;
        auto mesh = std::make_shared<Mesh>(geometry, material);
        mesh->position.set(i % 256, 0, i / 256);
        scene.add(*mesh);
        meshes.push_back(std::move(mesh));
    }
    // Equal cache conditions at every size: otherwise 4k fits in LLC while 64k spills, and the
    // ratio measures cache capacity rather than complexity. Pressure stays outside the timer.
    static std::vector<uint64_t> pressure(64 * 1024 * 1024 / sizeof(uint64_t), 1);
    static volatile uint64_t cacheSink;
    std::vector<double> times;
    std::array<std::vector<double>, 4> phases;
    for (int frame = 0; frame < 30; ++frame) {
        for (int i = 0; i < count; ++i) {
            meshes[i]->position.y = (frame + i % 7) * 0.01;
            meshes[i]->rotation.set(frame * 0.01, i * 0.001, 0);
        }
        const volatile uint64_t* memory = pressure.data();
        uint64_t sum = 0;
        for (std::size_t i = 0; i < pressure.size(); i += 8)
            sum += memory[i];
        cacheSink = sum;
        const auto start = std::chrono::steady_clock::now();
        const auto items = database.prepare(scene, camera, lights);
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        CHECK(items.size() == 1 && items.front().instanceCount == static_cast<uint32_t>(count));
        CHECK(database.diagnostics().empty());
        CHECK(database.rebuilds() == static_cast<uint64_t>(count));
        if (frame >= 3) {
            times.push_back(ms);
            for (int phase = 0; phase < 4; ++phase)
                phases[phase].push_back(database.lastPrepareMs()[phase]);
        }
    }
    std::sort(times.begin(), times.end());
    for (auto& phase : phases)
        std::sort(phase.begin(), phase.end());
    std::printf("cold-cache update %d: %.4f ms (matrix %.4f, records %.4f, batch %.4f, other %.4f)\n", count,
                times[times.size() / 2], phases[0][13], phases[1][13], phases[2][13], phases[3][13]);
    return times[times.size() / 2];
}

void scaling() {
    const double small = measure(4096), medium = measure(16384), large = measure(65536);
    std::printf("scaling: 16k/4k %.2fx, 64k/4k %.2fx (limit 20x)\n", medium / small, large / small);
    CHECK(large <= small * 20);
}
} // namespace

TN_TEST_MAIN({"scaling", scaling})
