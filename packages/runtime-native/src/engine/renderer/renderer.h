#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <unordered_map>
#include <memory>
#include <vector>

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
enum class MaterialKind : uint8_t { Standard, Basic, Lambert, Phong, Physical };

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
    // InstancedMesh: one mat4 (16 floats) per instance, an optional rgb per instance, and how many draw.
    BufferStore* instanceMatrices = nullptr;
    BufferStore* instanceColors = nullptr;
    uint32_t instanceCount = 1;
    // Automatic batching (RenderDatabase): which material it draws, and whether it may share a draw.
    const void* materialKey = nullptr;
    bool batchable = false;
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

    /** What the last render() submitted, as three's renderer.info.render counts it. */
    struct FrameStats {
        uint32_t draws = 0;
        uint64_t triangles = 0;
    };
    const FrameStats& lastFrame() const { return lastFrame_; }
    /**
     * GPU time of the most recent frame whose timestamps came back, scene pass start to output pass
     * end, in milliseconds; negative until one has, and always on a device without timestamp-query.
     */
    double lastGpuMs() const { return timing_->lastMs; }
    /** How many GPU times have come back, so a caller samples each one once. */
    uint64_t gpuSamples() const { return timing_->samples; }

    GpuResources& gpu() { return gpu_; }
    const GeometryCache& geometry() const { return geometry_; }
    const PipelineCache& pipelines() const { return pipelines_; }

private:
    // The uniforms a material program may read, resolved to block offsets once per program.
    enum Slot : uint8_t {
        kModelMatrix, kViewMatrix, kProjectionMatrix, kNormalMatrix, kDiffuse, kAlphaTest, kOpaque, kRoughness,
        kMetalness, kEmissive, kSpecular, kShininess, kIor, kSpecularIntensity, kSpecularColor,
        kDirectionalDirection, kDirectionalColor, kHemisphereSky, kHemisphereGround, kHemisphereDirection, kAmbient,
        kSlotCount
    };
    struct Program {
        shader::StageModule vertex;
        shader::StageModule fragment;
        // Explicit layouts: each stage's uniform block is a dynamic-offset slice of the frame's one
        // uniform buffer, so a draw costs a bind-group offset, not a buffer and a bind group of its own.
        WGPUBindGroupLayout layouts[2] = {};
        WGPUPipelineLayout pipelineLayout = nullptr;
        WGPUBindGroup groups[2] = {};  // over the current frame buffer; rebuilt when it grows
        const shader::UniformField* vertexSlots[kSlotCount] = {};
        const shader::UniformField* fragmentSlots[kSlotCount] = {};
    };
    void buildLayouts(Program& program);
    WGPUBindGroup bindGroup(WGPUBindGroupLayout layout, const shader::StageModule& stage, Handle uniforms,
                            WGPUTextureView view, WGPUSampler sampler);
    void releaseTargets();
    void releaseOutputGroup();
    void outputPass(WGPUCommandEncoder encoder, bool timed);

    WGPUDevice device_;
    EventQueue& events_;
    GpuResources gpu_;
    GeometryCache geometry_;
    PipelineCache pipelines_;
    // By MaterialKind, then vertex variant: 0 plain, 1 instanced, 2 instanced with instanceColor.
    Program programs_[5][3];
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
    FrameStats lastFrame_;
    WGPUQuerySet timestamps_ = nullptr;  // scene pass begin/end [0, 1], output pass begin/end [2, 3]
    Handle timestampResolve_;
    // Shared with the readback callback by weak reference: a backend may deliver it after this
    // renderer is gone (wgpu does at teardown), and it must then find nothing to write into.
    struct Timing {
        bool pending = false;  // a resolve is being read back; the next frames are not timed
        double lastMs = -1;
        uint64_t samples = 0;
    };
    std::shared_ptr<Timing> timing_ = std::make_shared<Timing>();
    std::vector<uint8_t> frameUniforms_;  // every draw's uniform blocks, written to the GPU once a frame
    Handle uniformBuffer_;
    uint64_t uniformCapacity_ = 0;
};

}  // namespace tn::engine
