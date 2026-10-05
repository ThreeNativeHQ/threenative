#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <unordered_map>

#include <webgpu/webgpu.h>

#include "engine/foundation/buffers.h"
#include "engine/renderer/geometry_cache.h"
#include "engine/renderer/gpu_resources.h"
#include "engine/renderer/pipeline_cache.h"
#include "engine/shader/output.h"
#include "engine/shader/package.h"
#include "engine/shader/standard.h"

namespace tn::engine {

using Matrix = std::array<double, 16>;  // column-major, as three's Matrix4.elements

/** Which program a draw uses; each kind reads the StandardMaterial fields it needs. */
enum class MaterialKind : uint8_t { Standard, Basic };

/** One opaque draw. The render database (PRD-514 phase 1) fills these from the scene graph. */
struct DrawItem {
    uint64_t key = 0;                    // the renderable's stable identity; its GPU record persists under it
    BufferStore* positions = nullptr;    // vec3 float
    BufferStore* normals = nullptr;      // vec3 float; unused by Basic
    BufferStore* indices = nullptr;      // u16 or u32; null draws non-indexed
    Matrix matrixWorld{};
    const shader::StandardMaterial* material = nullptr;
    MaterialKind kind = MaterialKind::Standard;
    // Render-list inputs, as three's RenderList reads them.
    uint64_t id = 0;           // Object3D.id: the sort's last tiebreak
    int renderOrder = 0;       // Object3D.renderOrder
    bool transparent = false;  // material.transparent: drawn after opaques, back to front, blended
    bool depthWrite = true;    // material.depthWrite
};

struct CameraState {
    Matrix matrixWorldInverse{};
    // In three's WebGPUCoordinateSystem (clip z 0..1): WebGPURenderer.render switches a camera to it
    // and recomputes projectionMatrix, so the render database does the same before it fills this.
    Matrix projectionMatrix{};
};

/** Light values in world space and linear colour, intensity folded in (three's physically correct units). */
struct LightState {
    std::array<double, 3> directionalDirection{0, 1, 0};  // towards the light
    std::array<double, 3> directionalColor{0, 0, 0};
    std::array<double, 3> hemisphereSky{0, 0, 0};
    std::array<double, 3> hemisphereGround{0, 0, 0};
    std::array<double, 3> hemisphereUp{0, 1, 0};
    std::array<double, 3> ambient{0, 0, 0};
};

/** three's renderer output settings: `toneMapping`, `toneMappingExposure`, `outputColorSpace`. */
struct OutputState {
    std::optional<shader::ToneMapping> toneMapping;  // empty: NoToneMapping
    double toneMappingExposure = 1;
    bool srgb = true;  // false: LinearSRGBColorSpace
};

/**
 * The native renderer's draw core (PRD-514): standard-material meshes into a linear RGBA16Float
 * scene target with depth, then three's output pass — tone mapping, then the output colour space —
 * into the RGBA8 frame, at the size the caller sets. The clear colour is linear and goes through the
 * output pass too, as three's background does. GPU records — geometry copies, pipelines, uniform buffers
 * and bind groups — persist across frames; a frame only rewrites uniforms and records commands.
 */
class Renderer {
public:
    Renderer(WGPUInstance instance, WGPUDevice device, WGPUQueue queue, EventQueue& events);
    ~Renderer();
    Renderer(const Renderer&) = delete;
    Renderer& operator=(const Renderer&) = delete;

    void setOutput(const OutputState& output);
    const OutputState& output() const { return output_; }

    /** Reallocates the targets; the next render draws at the new extent. Zero sizes clamp to 1. */
    void setSize(uint32_t width, uint32_t height);
    uint32_t width() const { return width_; }
    uint32_t height() const { return height_; }

    /**
     * Draws one frame and returns its render ID (every render call gets its own, from 1). Items are
     * drawn in three's order: opaque by renderOrder, then depth front to back, then id; transparent
     * after them by renderOrder, then depth back to front, then id.
     */
    uint64_t render(std::span<const DrawItem> items, const CameraState& camera, const LightState& lights,
                    std::array<double, 4> clear = {0, 0, 0, 1});
    /** The last frame's pixels, RGBA8 rows tightly packed, delivered from poll(). */
    GpuStatus readPixels(ReadbackCallback done);
    void poll() { gpu_.poll(); }

    /** Releases a renderable's GPU record (the database calls this when the object leaves the scene). */
    void forget(uint64_t key);

    GpuResources& gpu() { return gpu_; }
    const GeometryCache& geometry() const { return geometry_; }
    const PipelineCache& pipelines() const { return pipelines_; }

private:
    struct Program {
        shader::StageModule vertex;
        shader::StageModule fragment;
    };
    struct Record {
        MaterialKind kind = MaterialKind::Standard;
        Handle vertexUniforms;
        Handle fragmentUniforms;
        WGPUBindGroup vertexGroup = nullptr;
        WGPUBindGroup fragmentGroup = nullptr;
    };
    Record& record(uint64_t key, MaterialKind kind, const Program& program, WGPURenderPipeline pipeline);
    WGPUBindGroup bindGroup(WGPURenderPipeline pipeline, uint32_t group, const shader::StageModule& stage, Handle uniforms,
                            WGPUTextureView view, WGPUSampler sampler);
    void releaseTargets();
    void releaseOutputGroup();
    void outputPass(WGPUCommandEncoder encoder);

    WGPUDevice device_;
    EventQueue& events_;
    GpuResources gpu_;
    GeometryCache geometry_;
    PipelineCache pipelines_;
    Program programs_[2];  // by MaterialKind
    WGPUTexture lut_ = nullptr;
    WGPUTextureView lutView_ = nullptr;
    WGPUSampler lutSampler_ = nullptr;
    Handle color_;
    WGPUTexture depth_ = nullptr;
    WGPUTextureView colorView_ = nullptr;
    WGPUTextureView depthView_ = nullptr;
    WGPUTexture sceneColor_ = nullptr;  // linear HDR, what materials draw into
    WGPUTextureView sceneView_ = nullptr;
    OutputState output_;
    shader::StageModule outputVertex_;
    shader::StageModule outputFragment_;
    Handle outputTriangle_;
    Handle outputUniforms_;
    WGPUSampler outputSampler_ = nullptr;
    WGPUBindGroup outputGroup_ = nullptr;
    uint32_t width_ = 0;
    uint32_t height_ = 0;
    uint64_t renderId_ = 0;
    std::unordered_map<uint64_t, Record> records_;
};

}  // namespace tn::engine
