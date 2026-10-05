#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "engine/renderer/renderer.h"
#include "engine/scene/camera.h"
#include "engine/scene/geometry.h"
#include "engine/scene/lights.h"
#include "engine/scene/material.h"
#include "engine/scene/nodes.h"

namespace tn::engine {

/**
 * The render database (PRD-514 phase 1): `renderer.render(scene, camera)` on the native path. It
 * reads the native scene graph — never a JS scene — and keeps one draw record per mesh, rebuilt
 * only when that mesh's revision, its geometry's revision or its material's version moves; an
 * unchanged scene rebuilds nothing.
 *
 * Per call it does what three's Renderer.render does before drawing: updateMatrixWorld on the scene
 * (matrixWorldAutoUpdate) and on a parentless camera, switches the camera to WebGPU clip space,
 * then projects the scene as projectObject does — invisible subtrees skipped, layers tested
 * against the camera's — into meshes and lights.
 *
 * Not yet: frustum culling (PRD-519; it changes cost, not pixels), more than one directional or
 * hemisphere light (refused by name), shadows, groups and multi-material meshes.
 */
class RenderDatabase {
public:
    uint64_t render(Renderer& renderer, Object3D& scene, Camera& camera, std::array<double, 4> clear = {0, 0, 0, 1});

    /** Records rebuilt since construction; the invalidation test reads it. */
    [[nodiscard]] uint64_t rebuilds() const { return rebuilds_; }
    /** Why the last render left something out (TN_NATIVE_MATERIAL_UNSUPPORTED, TN_NATIVE_LIGHTS_UNSUPPORTED...). */
    [[nodiscard]] const std::vector<std::string>& diagnostics() const { return diagnostics_; }

private:
    struct Record {
        uint64_t objectRevision = 0;
        uint64_t geometryRevision = 0;
        uint32_t materialVersion = 0;
        // Held, so neither is released while the record's item points into it, and a new one can
        // never take its address and pass for it. The mesh is known by its id, never reused.
        std::shared_ptr<const BufferGeometry> geometry;
        std::shared_ptr<const Material> material;
        uint64_t meshId = 0;
        shader::StandardMaterial params;
        DrawItem item;
        bool drawable = false;
        uint64_t seen = 0;  // the render it was last projected in
    };
    void project(Object3D& object, const Camera& camera, std::vector<DrawItem>& items, LightState& lights);
    Record& record(const Mesh& mesh);

    // Drawn meshes that carry onBeforeRender, run after projection and before submission.
    struct PendingCallback {
        std::shared_ptr<const Object3D> keep;  // a callback may detach it; the call still finds it
        const Mesh* mesh;
        Record* record;
    };
    std::vector<PendingCallback> callbacks_;
    std::unordered_map<const Object3D*, Record> records_;
    std::vector<std::string> diagnostics_;
    uint64_t rebuilds_ = 0;
    uint64_t frame_ = 0;
    int directional_ = 0;
    int hemisphere_ = 0;
};

}  // namespace tn::engine
