#include "check.h"
#include "engine/renderer/shadows/virtual/atlas.h"
#include "engine/shader/standard.h"
#include "engine/shader/package.h"

#include <cmath>

using namespace tn::engine;
using namespace tn::engine::shadows;

void atlas() {
    std::string error;
    AtlasOptions options;
    options.clipExtents = {8, 24}; options.mapSize = 256; options.pageTexels = 64;
    options.refreshStep = {0}; options.lightDistance = 20; options.depthRange = 40;
    auto atlas = PageAtlas::create(options, error);
    CHECK(atlas.has_value());
    if (!atlas) return;
    const Vector3 eye(0, 0, 0), sun(0, 1, 1);
    auto pages = atlas->update(eye, sun);
    CHECK(pages.size() == 16);
    CHECK(atlas->table().size() == (18 + 32) * 4);
    CHECK(atlas->table()[35] == 1 && atlas->table()[71] == 0);
    for (const auto& page : pages) {
        const auto [px, py] = atlas->origin(page.slot);
        CHECK(px + atlas->stride() <= atlas->edge() && py + atlas->stride() <= atlas->edge());
        // Page projection into the padded tile and page-table translation agree at the centre.
        Vector3 center = page.axisU;
        center.multiplyScalar((page.lowU + page.highU) / 2).addScaledVector(page.axisV, (page.lowV + page.highV) / 2);
        center.applyMatrix4(page.view).applyMatrix4(page.projection);
        CHECK(std::abs(center.x) < 1e-12 && std::abs(center.y) < 1e-12);
        const int tableRow = 18 + (3 - page.y) * 4 + page.x;
        CHECK(atlas->table()[tableRow * 4] == px && atlas->table()[tableRow * 4 + 1] == py);
    }
    CHECK(atlas->update(eye, sun).size() == 16); // coarsest warm-up
    CHECK(atlas->update(eye, sun).empty()); // cached
    Box3 changed; changed.set(Vector3(-1, 0, -1), Vector3(1, 2, 1));
    atlas->invalidate(changed);
    CHECK(atlas->update(eye, sun).size() == 16);
    pages = atlas->update(Vector3(100, 0, 0), sun);
    CHECK(pages.size() == 16 && pages.front().level == 0);
    CHECK(atlas->table()[35] == 1 && atlas->table()[71] == 0); // no stale coarse-page frame
    CHECK(atlas->table()[16] == -100);
    CHECK(atlas->update(Vector3(100, 0, 0), sun).size() == 16);
    CHECK(atlas->update(Vector3(100, 0, 0), sun, true).size() == 16); // explicit rotation cut
    CHECK(atlas->table()[71] == 0);
    options.adaptiveRefresh = true;
    CHECK(!PageAtlas::create(options, error) && error == "TN_VIRTUAL_SHADOW_UNSUPPORTED: adaptiveRefresh");
    options.adaptiveRefresh = false;
    options.mapSize = 255;
    CHECK(!PageAtlas::create(options, error));
    options.mapSize = 256; options.selectionGuard = {0.1}; options.refreshStep = {0.2};
    CHECK(!PageAtlas::create(options, error));
}

void sampling() {
    using namespace shader;
    const auto standard = buildStandard({}, {}, {"2"});
    const auto lambert = buildLambert({}, {"2"});
    const auto phong = buildPhong({}, {"2"});
    for (const auto* p : {&standard, &lambert, &phong}) {
        const auto vertex = buildStage(p->vertex, 0), fragment = buildStage(p->fragment, 1);
        CHECK(vertex.wgsl.ok() && fragment.wgsl.ok());
        CHECK(fragment.wgsl.code.find("vsmTable0") != std::string::npos);
        CHECK(fragment.wgsl.code.find("textureSampleCompare") != std::string::npos);
        CHECK(vertex.wgsl.code.find("positionWorld") != std::string::npos);
    }
}

TN_TEST_MAIN({"atlas", atlas}, {"sampling", sampling})
