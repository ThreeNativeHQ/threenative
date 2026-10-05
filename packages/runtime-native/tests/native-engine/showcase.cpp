// A visual check of the native renderer for the PR's progress record: a roughness x metalness grid
// of standard-material spheres through Renderer (scene target, output pass), written as a PNG.
//   tn-native-engine-showcase [out.png] [none|linear|reinhard|cineon|aces|agx|neutral]

#include "engine/renderer/renderer.h"
#include "mystral/webgpu/context.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <thread>
#include <vector>

extern "C" int stbi_write_png(const char* filename, int w, int h, int comp, const void* data, int stride);

using namespace tn::engine;

namespace {

constexpr uint32_t kWidth = 960;
constexpr uint32_t kHeight = 540;
constexpr double kPi = 3.141592653589793;

struct Sphere {
    BufferStore positions{Scalar::F32, 0};
    BufferStore normals{Scalar::F32, 0};
    BufferStore indices{Scalar::U16, 0};
};

// three's SphereGeometry(1, segments, rings) layout and winding.
std::unique_ptr<Sphere> sphere(int segments, int rings) {
    auto s = std::make_unique<Sphere>();
    std::vector<float> p;
    std::vector<uint16_t> idx;
    for (int y = 0; y <= rings; ++y)
        for (int x = 0; x <= segments; ++x) {
            const double u = double(x) / segments, v = double(y) / rings;
            p.insert(p.end(), {float(-std::cos(u * 2 * kPi) * std::sin(v * kPi)), float(std::cos(v * kPi)),
                               float(std::sin(u * 2 * kPi) * std::sin(v * kPi))});
        }
    for (int y = 0; y < rings; ++y)
        for (int x = 0; x < segments; ++x) {
            const uint16_t a = y * (segments + 1) + x + 1, b = y * (segments + 1) + x, c = (y + 1) * (segments + 1) + x,
                           d = (y + 1) * (segments + 1) + x + 1;
            if (y != 0) idx.insert(idx.end(), {a, b, d});
            if (y != rings - 1) idx.insert(idx.end(), {b, c, d});
        }
    s->positions.resize(p.size());
    s->positions.write(0, p.data(), p.size() * 4);
    s->normals.resize(p.size());
    s->normals.write(0, p.data(), p.size() * 4);
    s->indices.resize(idx.size());
    s->indices.write(0, idx.data(), idx.size() * 2);
    return s;
}

std::optional<shader::ToneMapping> toneMapping(const char* name) {
    using T = shader::ToneMapping;
    const std::pair<const char*, T> names[] = {{"linear", T::Linear}, {"reinhard", T::Reinhard}, {"cineon", T::Cineon},
                                               {"aces", T::ACESFilmic}, {"agx", T::AgX}, {"neutral", T::Neutral}};
    for (const auto& [n, t] : names)
        if (std::strcmp(n, name) == 0) return t;
    return std::nullopt;
}

}  // namespace

int main(int argc, char** argv) {
    const char* outPath = argc > 1 ? argv[1] : "showcase.png";
    mystral::webgpu::Context context;
    if (!context.initializeHeadless()) return std::fprintf(stderr, "no GPU device\n"), 1;
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(kWidth, kHeight);
    renderer.setOutput(OutputState{argc > 2 ? toneMapping(argv[2]) : std::nullopt, 1, true});

    const auto ball = sphere(64, 32);
    // A roughness x metalness grid: roughness 0 -> 1 left to right, metalness 0, 0.5, 1 top to bottom.
    std::vector<shader::StandardMaterial> materials;
    for (int row = 0; row < 3; ++row)
        for (int col = 0; col < 6; ++col) {
            shader::StandardMaterial m;
            m.color = {1.0f, 0.71f, 0.29f};  // gold-ish albedo, linear
            m.roughness = col / 5.0f;
            m.metalness = row * 0.5f;
            materials.push_back(m);
        }
    std::vector<DrawItem> items;
    for (int i = 0; i < 18; ++i) {
        DrawItem item;
        item.key = i + 1;
        item.positions = &ball->positions;
        item.normals = &ball->normals;
        item.indices = &ball->indices;
        item.matrixWorld = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ((i % 6) - 2.5) * 2.3, (1 - i / 6) * 2.3, 0, 1};
        item.material = &materials[i];
        items.push_back(item);
    }
    // three's PerspectiveCamera(35.5 deg, 16:9, 0.1, 100) at z = 13 looking at the origin.
    CameraState camera;
    camera.matrixWorldInverse = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -13, 1};
    const double near = 0.1, far = 100, top = near * std::tan(0.31), aspect = double(kWidth) / kHeight;
    camera.projectionMatrix = {near / (aspect * top), 0, 0, 0, 0, near / top, 0, 0, 0, 0, -far / (far - near), -1,
                               0, 0, -far * near / (far - near), 0};  // WebGPU clip z
    LightState lights;
    lights.directionalDirection = {-0.5, 0.8, 0.6};
    lights.directionalColor = {3, 3, 3};
    lights.hemisphereSky = {0.9, 1.0, 1.2};
    lights.hemisphereGround = {0.25, 0.2, 0.15};
    lights.ambient = {0.05, 0.05, 0.05};
    renderer.render(items, camera, lights, {0.002, 0.002, 0.003, 1});

    std::vector<uint8_t> pixels;
    bool done = false;
    renderer.readPixels([&](GpuStatus s, std::vector<uint8_t> out) {
        if (s == GpuStatus::Ok) pixels = std::move(out);
        done = true;
    });
    for (int i = 0; i < 5000 && !done; ++i) {
        renderer.poll();
        events.drain();
        if (!done) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    if (pixels.empty()) return std::fprintf(stderr, "readback failed\n"), 1;
    if (!stbi_write_png(outPath, kWidth, kHeight, 4, pixels.data(), kWidth * 4)) return std::fprintf(stderr, "png write failed\n"), 1;
    std::printf("SHOWCASE_OK %s %ux%u, %zu draws, %zu triangles each\n", outPath, kWidth, kHeight, items.size(),
                ball->indices.byteLength() / 6);
    return 0;
}
