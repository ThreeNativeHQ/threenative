#include "check.h"
#include "engine/renderer/renderer.h"
#include "mystral/webgpu/context.h"

#include <chrono>
#include <cmath>
#include <optional>
#include <string>
#include <thread>

using namespace tn::engine;

namespace {

constexpr double kPi = 3.141592653589793;

// three's SphereGeometry(1, 32, 16) layout: non-indexed is enough for a coverage check.
struct Sphere {
    BufferStore positions{Scalar::F32, 0};
    BufferStore normals{Scalar::F32, 0};
    BufferStore indices{Scalar::U16, 0};
};

std::unique_ptr<Sphere> sphere(int segments, int rings) {
    auto s = std::make_unique<Sphere>();
    std::vector<float> p;
    std::vector<uint16_t> idx;
    for (int y = 0; y <= rings; ++y)
        for (int x = 0; x <= segments; ++x) {
            const double u = double(x) / segments, v = double(y) / rings;
            p.push_back(float(-std::cos(u * 2 * kPi) * std::sin(v * kPi)));
            p.push_back(float(std::cos(v * kPi)));
            p.push_back(float(std::sin(u * 2 * kPi) * std::sin(v * kPi)));
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
    s->normals.write(0, p.data(), p.size() * 4);  // unit sphere: normal == position
    s->indices.resize(idx.size());
    s->indices.write(0, idx.data(), idx.size() * 2);
    return s;
}

// A camera at z = 4 looking down -z, three's PerspectiveCamera(50, aspect, 0.1, 100), WebGPU clip z.
CameraState camera(double aspect) {
    CameraState c;
    c.matrixWorldInverse = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4, 1};
    const double top = 0.1 * std::tan(25 * kPi / 180), height = 2 * top, width = aspect * height;
    // three's makePerspective in WebGPUCoordinateSystem, which WebGPURenderer.render switches cameras to.
    const double x = 2 * 0.1 / width, y = 2 * 0.1 / height, cz = -100 / (100 - 0.1), d = -100 * 0.1 / (100 - 0.1);
    c.projectionMatrix = {x, 0, 0, 0, 0, y, 0, 0, 0, 0, cz, -1, 0, 0, d, 0};
    return c;
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

// Pixels that differ from the clear colour (black), and whether the centre pixel is lit.
size_t covered(const std::vector<uint8_t>& px) {
    size_t n = 0;
    for (size_t i = 0; i + 3 < px.size(); i += 4) n += (px[i] | px[i + 1] | px[i + 2]) != 0;
    return n;
}

void resizeReadback() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    const auto ball = sphere(32, 16);
    shader::StandardMaterial material;
    material.color = {0.8f, 0.3f, 0.2f};
    material.roughness = 0.5f;
    LightState lights;
    lights.directionalDirection = {0.5, 0.8, 0.6};
    lights.directionalColor = {3, 3, 3};
    lights.ambient = {0.1, 0.1, 0.1};
    DrawItem item;
    item.key = 1;
    item.positions = &ball->positions;
    item.normals = &ball->normals;
    item.indices = &ball->indices;
    item.matrixWorld = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    item.material = &material;

    uint64_t lastId = 0;
    for (auto [w, h] : {std::pair{64u, 48u}, std::pair{160u, 90u}, std::pair{90u, 150u}}) {
        renderer.setSize(w, h);
        CHECK(renderer.width() == w && renderer.height() == h);
        const uint64_t id = renderer.render({&item, 1}, camera(double(w) / h), lights);
        CHECK(id == lastId + 1);
        lastId = id;
        const std::vector<uint8_t> px = read(renderer, events);
        CHECK(px.size() == size_t{w} * h * 4);
        const size_t lit = covered(px);
        // A unit sphere 4 units away projects to a disc of NDC radius r = tan(asin(1/4)) / tan(25 deg)
        // vertically; its share of a frame of aspect a is pi r^2 / (4a). Rasterization edges stay within 10%.
        const double r = std::tan(std::asin(0.25)) / std::tan(25 * kPi / 180);
        const double expected = kPi * r * r / (4.0 * w / h);
        const double share = double(lit) / (double(w) * h);
        std::printf("%ux%u: %zu bytes, %.2f%% covered, %.2f%% expected\n", w, h, px.size(), share * 100, expected * 100);
        CHECK(std::abs(share / expected - 1) < 0.1);
        const size_t centre = (size_t{h / 2} * w + w / 2) * 4;
        CHECK(px.size() > centre && px[centre] > px[centre + 2]);  // the red-dominant material, not the clear colour
    }
    // Steady state: rendering the same item again compiles nothing and uploads nothing.
    const uint64_t uploads = renderer.geometry().stats().fullUploads;
    for (int i = 0; i < 30; ++i) renderer.render({&item, 1}, camera(90.0 / 150), lights);
    CHECK(renderer.pipelines().compiles() == 2);  // the standard program and the output pass
    CHECK(renderer.geometry().stats().fullUploads == uploads);
}

// three@0.185.1 in Chromium (WebGPU, NVIDIA Turing), tonemap-ramp-* goldens: the 8-bit sRGB output
// of linear grey 0..8 under each tone mapping, exposure 1. Read from the golden PNGs
// (packages/three-native/tests/compatibility/goldens/0.185.1/tonemap-ramp-<mapping>.png, strip centres).
extern "C" unsigned char* stbi_load(const char* filename, int* x, int* y, int* comp, int req_comp);
extern "C" void stbi_image_free(void* data);

struct Ramp {
    const char* name;
    std::optional<shader::ToneMapping> mapping;
    uint8_t out[9];
};
constexpr Ramp kRamps[] = {
    {"linear", shader::ToneMapping::Linear, {0, 255, 255, 255, 255, 255, 255, 255, 255}},
    {"reinhard", shader::ToneMapping::Reinhard, {0, 188, 213, 225, 231, 235, 238, 240, 242}},
    {"cineon", shader::ToneMapping::Cineon, {0, 216, 233, 240, 244, 246, 247, 248, 249}},
    {"aces", shader::ToneMapping::ACESFilmic, {0, 227, 242, 247, 250, 251, 252, 253, 253}},
    {"agx", shader::ToneMapping::AgX, {0, 202, 224, 233, 239, 242, 245, 246, 248}},
    {"neutral", shader::ToneMapping::Neutral, {0, 240, 250, 252, 253, 254, 254, 254, 254}},
};

// The tonemap-ramp fixtures, natively: nine MeshBasicMaterial strips (PlaneGeometry(2/9, 2)) of
// linear grey 0..8 side by side under OrthographicCamera(-1, 1, 1, -1, 0.1, 10) at z = 1, 288x64.
// Every strip's pixels must equal the browser reference's.
void outputRamp() {
    mystral::webgpu::Context context;
    CHECK(context.initializeHeadless());
    EventQueue events;
    Renderer renderer(context.getInstance(), context.getDevice(), context.getQueue(), events);
    renderer.setSize(288, 64);
    const double w = 2.0 / 9;
    const float quad[12] = {float(-w / 2), -1, 0, float(w / 2), -1, 0, float(-w / 2), 1, 0, float(w / 2), 1, 0};
    const uint16_t corners[6] = {0, 1, 2, 2, 1, 3};  // PlaneGeometry's winding, facing +z
    BufferStore positions(Scalar::F32, 12), indices(Scalar::U16, 6);
    positions.write(0, quad, sizeof quad);
    indices.write(0, corners, sizeof corners);
    shader::StandardMaterial greys[9];
    std::vector<DrawItem> strips(9);
    for (int k = 0; k < 9; ++k) {
        greys[k].color = {float(k), float(k), float(k)};
        strips[k].key = k + 1;
        strips[k].kind = MaterialKind::Basic;
        strips[k].positions = &positions;
        strips[k].indices = &indices;
        strips[k].material = &greys[k];
        strips[k].matrixWorld = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1 + (k + 0.5) * w, 0, 0, 1};
    }
    CameraState camera;
    camera.matrixWorldInverse = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1};
    camera.projectionMatrix = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1 / 9.9, 0, 0, 0, -0.1 / 9.9, 1};  // WebGPU clip z
    int worst = 0;
    for (const Ramp& ramp : kRamps) {
        renderer.setOutput(OutputState{ramp.mapping, 1, true});
        renderer.render(strips, camera, LightState{});
        const std::vector<uint8_t> px = read(renderer, events);
        CHECK(px.size() == 288 * 64 * 4);
        if (px.size() != 288 * 64 * 4) return;
        // Whole frame against the golden PNG, when the checkout has it.
        const std::string png = std::string(TN_GOLDENS_DIR) + "/tonemap-ramp-" + ramp.name + ".png";
        int gw = 0, gh = 0, gc = 0;
        if (unsigned char* golden = stbi_load(png.c_str(), &gw, &gh, &gc, 4)) {
            CHECK(gw == 288 && gh == 64);
            size_t mismatched = 0;
            for (size_t i = 0; gw == 288 && gh == 64 && i < px.size(); ++i) mismatched += std::abs(int(px[i]) - int(golden[i])) > 1;
            std::printf("%s: %zu of %zu channels differ from %s\n", ramp.name, mismatched, px.size(), png.c_str());
            CHECK(mismatched == 0);
            stbi_image_free(golden);
        } else {
            CHECK(!"golden PNG missing");
        }
        for (int k = 0; k < 9; ++k)
            for (int x : {k * 32 + 2, k * 32 + 16, k * 32 + 29})
                for (int y : {2, 32, 61}) {
                    const uint8_t* p = &px[(size_t(y) * 288 + x) * 4];
                    const int diff = std::abs(int(p[0]) - int(ramp.out[k]));
                    worst = std::max(worst, diff);
                    if (diff > 1) std::printf("%s strip %d (%d,%d): native %d, reference %d\n", ramp.name, k, x, y, p[0], ramp.out[k]);
                    CHECK(diff <= 1);
                    CHECK(p[0] == p[1] && p[1] == p[2] && p[3] == 255);
                }
    }
    std::printf("output ramp: 6 mappings x 9 strips x 9 samples, worst difference %d/255\n", worst);
    CHECK(renderer.pipelines().compiles() == 1 + 6);  // the basic program once, one output program per mapping
}

}  // namespace

TN_TEST_MAIN({"resize_readback", resizeReadback}, {"output_ramp", outputRamp})
