#pragma once

#include <unordered_set>

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "engine/renderer/renderer.h"
#include "engine/animation/skinning/palette.h"
#include "engine/scene/camera.h"
#include "engine/scene/geometry.h"
#include "engine/scene/lights.h"
#include "engine/scene/material.h"
#include "engine/scene/nodes.h"

namespace tn::engine {

/**
 * The render database (PRD-514 phase 1): `renderer.render(scene, camera)` on the native path. It
 * reads the native scene graph — never a JS scene — and keeps one draw record per mesh, rebuilt
 * only when its geometry's identity/revision or material's identity/version moves. Transforms and
 * mutable uniforms refresh independently; moving a mesh does not rebuild its resource record.
 *
 * Per call it does what three's Renderer.render does before drawing: updateMatrixWorld on the scene
 * (matrixWorldAutoUpdate) and on a parentless camera, switches the camera to WebGPU clip space,
 * then projects the scene as projectObject does — invisible subtrees skipped, layers tested
 * against the camera's — into meshes and lights.
 *
 * Lights: every directional, point and spot light, summed in three's id order; one hemisphere light
 * (more are refused by name). Not yet: frustum culling (PRD-519; it changes cost, not pixels),
 * shadows, groups and multi-material meshes.
 */
class RenderDatabase {
  public:
    uint64_t render(Renderer& renderer, Object3D& scene, Camera& camera, std::array<double, 4> clear = {0, 0, 0, 0},
                    std::array<double, 2>* cpuMs = nullptr);

    /** CPU preparation used by render; returned pointers remain valid until the next prepare. */
    std::vector<DrawItem> prepare(Object3D& scene, Camera& camera, LightState& lights);

    /** Records rebuilt since construction; the invalidation test reads it. */
    [[nodiscard]] uint64_t rebuilds() const { return rebuilds_; }
    /** Why the last render left something out (TN_NATIVE_MATERIAL_UNSUPPORTED, TN_NATIVE_LIGHTS_UNSUPPORTED...). */
    [[nodiscard]] const std::vector<std::string>& diagnostics() const { return diagnostics_; }

    /**
     * Automatic batching (PRD-519): opaque plain meshes that share a geometry and material uniforms
     * (base colours travel per instance),
     * at least kMinBatchMembers of them and none with a render callback, draw as one instanced
     * draw. Compatible skinned rigs share one palette draw per pass even across other draws.
     * On by default; off draws every mesh on its own, subject to the measured pixel-edge budget.
     */
    bool batching = true;
    bool profiling = false;
    // Matrix setup, projection/record refresh (including fused flat-scene matrices), batch packing, remaining.
    [[nodiscard]] const std::array<double, 4>& lastPrepareMs() const { return prepareMs_; }
    /** three's `renderer.shadowMap.enabled`: off, no light draws or reads a shadow map. */
    bool shadowMapEnabled = false;
    static constexpr std::size_t kMinBatchMembers = 4;
    /** Draws the last render merged by batching: groups made and meshes they absorbed. */
    [[nodiscard]] std::pair<std::size_t, std::size_t> lastBatches() const { return {batchGroups_, batchMembers_}; }

  private:
    std::shared_ptr<BufferGeometry> backgroundGeometry_;
    shader::StandardMaterial backgroundParams_;
    using GeometryKey = std::array<BufferStore*, 4>;
    struct alignas(64) Record {
        uint64_t geometryRevision = 0;
        uint64_t meshId = 0;
        uint64_t seen = 0; // the render it was last projected in
        uint32_t materialVersion = 0;
        bool drawable = false, materialized = false;
        // Held, so neither is released while the record's item points into it, and a new one can
        // never take its address and pass for it. The mesh is known by its id, never reused.
        std::shared_ptr<const BufferGeometry> geometry;
        std::shared_ptr<const Material> material;
        GeometryKey buffers{};
        struct Draw {
            shader::StandardMaterial params;
            DrawItem item;
        };
        std::unique_ptr<Draw> draw; // materialize only actual draws, not every batched member
    };
    void project(Object3D& object, const Camera& camera, std::vector<DrawItem>& items, LightState& lights,
                 bool updateChildren = false, bool force = false, Record* cached = nullptr, bool plainMesh = false);
    void batch(std::vector<DrawItem>& items, Object3D& scene,
               const std::vector<std::pair<double, const DrawItem*>>& ordered);
    std::vector<std::shared_ptr<BufferStore>> batchStores_; // reused frame to frame, one per group
    std::vector<std::shared_ptr<BufferStore>> batchColors_;
    std::vector<shader::StandardMaterial> batchParams_;
    std::vector<std::unique_ptr<SkinnedPalette>> skinnedPalettes_; // borrowed by this frame's draws
    std::size_t batchGroups_ = 0, batchMembers_ = 0;
    Record& record(const Mesh& mesh, bool materialize = true);
    Record& record(const Mesh& mesh, Record& cached, bool materialize = true);
    DrawItem& refresh(const Mesh& mesh, Record& record);
    void batchMeshes(std::vector<DrawItem>& items);
    void addBatchMesh(const Mesh& mesh, Record& record);
    struct BatchMember {
        const Mesh* mesh;
        const Material* material;
        double depth;
        uint64_t id;
        int order;
        Record* record;
    };
    struct MeshGroup {
        GeometryKey geometry;
        std::vector<std::size_t> members;
        bool orderedIds = true;
    };
    std::vector<BatchMember> batchMeshes_;
    struct alignas(64) BatchTransform { std::array<float, 16> matrix; };
    std::vector<BatchTransform> batchTransforms_; // one cache line per matrix, in scene order
    std::vector<std::array<float, 3>> batchRgb_;
    std::vector<MeshGroup> meshGroups_;
    std::size_t meshGroupCount_ = 0;
    std::unordered_map<std::size_t, std::vector<std::size_t>> meshCandidates_;
    std::optional<std::size_t> lastMeshGroup_;
    Matrix batchProjView_{};

    // Drawn meshes that carry onBeforeRender, run after projection and before submission.
    struct PendingCallback {
        std::shared_ptr<const Object3D> keep; // a callback may detach it; the call still finds it
        const Mesh* mesh;
        Record* record;
    };
    std::vector<PendingCallback> callbacks_;
    std::unordered_map<const Object3D*, Record> records_;
    std::vector<Record> flatRecords_; // scene-order slots; no per-mesh hash lookup on the flat lane
    std::vector<uint8_t> flatPlainMeshes_;
    bool flatParentIdentity_ = false;
    std::vector<std::size_t> sortScratch_;
    std::vector<uint64_t> depthKeys_;
    std::vector<std::string> diagnostics_;
    uint64_t rebuilds_ = 0;
    uint64_t frame_ = 0;
    std::size_t previousDrawCount_ = 0;
    std::array<double, 4> prepareMs_{};
    std::vector<std::pair<uint64_t, DirectLight>> direct_; // this render's direct lights with their ids
    std::unordered_set<const void*> skeletonsUpdated_;     // skeletons this render already updated
    int hemisphere_ = 0;
};

} // namespace tn::engine
