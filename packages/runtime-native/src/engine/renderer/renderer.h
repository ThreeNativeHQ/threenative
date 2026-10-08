#pragma once

#include <array>
#include <map>
#include <cstdint>
#include <optional>
#include <span>
#include <unordered_map>
#include <memory>
#include <vector>

#include <webgpu/webgpu.h>

#include "engine/foundation/buffers.h"
#include "engine/scene/geometry.h"
#include "engine/renderer/geometry_cache.h"
#include "engine/renderer/gpu_resources.h"
#include "engine/renderer/pipeline_cache.h"
#include "engine/renderer/probes/volume.h"
#include "engine/renderer/shadows/virtual/atlas.h"
#include "engine/shader/output.h"
#include "engine/shader/package.h"
#include "engine/shader/standard.h"

namespace tn::engine {

using Matrix = std::array<double, 16>;  // column-major, as three's Matrix4.elements

class SkinnedMesh;
class TraaPass;
class PostEffects;
struct TraaOptions;
class Fog;
class Texture;  // the material's diffuse `map` (engine/scene/texture.h)

/** Which program a draw uses; each kind reads the StandardMaterial fields it needs. */
enum class MaterialKind : uint8_t { Standard, Basic, Lambert, Phong, Physical };

/** One opaque draw. The render database (PRD-514 phase 1) fills these from the scene graph. */
struct DrawItem {
    bool background = false;
    const Fog* fog = nullptr;
    Matrix backgroundRotation{};
    uint64_t key = 0;                    // the renderable's stable identity; its GPU record persists under it
    BufferStore* positions = nullptr;    // vec3 float
    BufferStore* normals = nullptr;      // vec3 float; unused by Basic
    BufferStore* uvs = nullptr;          // vec2 float; only a mapped material's program reads it
    BufferStore* indices = nullptr;      // u16 or u32; null draws non-indexed
    Matrix matrixWorld{};
    // A merged draw retains its first member's render-list origin when its model becomes identity.
    std::optional<std::array<double, 3>> sortOrigin;
    const shader::StandardMaterial* material = nullptr;
    /** The material's diffuse `map`, if any: the fragment samples it at `uvTransform * vec3(uv, 1)`. */
    const Texture* map = nullptr;
    /** A tangent-space normalMap (decoded image, uv present) and the material's normalScale. */
    const Texture* normalMap = nullptr;
    double normalScaleX = 1, normalScaleY = 1;
    /** The environment (scene.environment or material.envMap): its PMREM is sampled for IBL. */
    const Texture* envMap = nullptr;
    double envMapIntensity = 1;
    Matrix envRotation{1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
    MaterialKind kind = MaterialKind::Standard;
    // Render-list inputs, as three's RenderList reads them.
    uint64_t id = 0;           // Object3D.id: the sort's last tiebreak
    int renderOrder = 0;       // Object3D.renderOrder
    bool transparent = false;  // material.transparent: drawn after opaques, back to front, blended
    bool depthWrite = true;    // material.depthWrite
    // SkinnedMesh: the skin attributes, the skeleton's palette this frame and the bind matrices.
    BufferStore* skinIndices = nullptr; // u8, u16 or u32 ×4
    BufferStore* skinWeights = nullptr; // f32 ×4
    // Morph targets: the geometry (its morphPositions/morphNormals) and the mesh's influences.
    const BufferGeometry* morphGeometry = nullptr;
    const std::vector<double>* morphInfluences = nullptr;
    const std::vector<float>* boneMatrices = nullptr;
    Matrix bindMatrix{}, bindMatrixInverse{};
    SkinnedMesh* skinnedRig = nullptr; // authored rig, for projection eligibility and palette writes
    uint32_t boneStride = 0;           // palette matrices per instance; zero on exact skinned draws
    /** three's flipSided: mirrored authored meshes reverse the front-face winding. */
    [[nodiscard]] WGPUFrontFace frontFace() const {
        Matrix4 world;
        world.elements = matrixWorld;
        return world.determinant() < 0 ? WGPUFrontFace_CW : WGPUFrontFace_CCW;
    }
    bool castShadow = false;    // Object3D.castShadow: drawn into every shadow map
    bool receiveShadow = false; // Object3D.receiveShadow: its lit program reads the shadow maps
    uint8_t side = 0;           // material.side: 0 FrontSide, 1 BackSide, 2 DoubleSide
    uint8_t blending = 1;       // material.blending: 0 NoBlending, 1 NormalBlending, 2 AdditiveBlending
    // InstancedMesh: one mat4 (16 floats) per instance, an optional rgb per instance, and how many draw.
    BufferStore* instanceMatrices = nullptr;
    BufferStore* instanceColors = nullptr;
    uint32_t instanceCount = 1;
    bool sprite = false, spriteSizeAttenuation = true;
    std::array<double, 2> spriteCenter{0.5, 0.5};
    double spriteRotation = 0;
    // Automatic batching (RenderDatabase): which material it draws, and whether it may share a draw.
    const void* materialKey = nullptr;
    bool batchable = false;
    shader::MaterialNodes nodes;
    std::shared_ptr<const shader::PositionNode> positionNode;  // the material's; null keeps positionLocal
};

struct CameraState {
    Matrix matrixWorldInverse{};
    // The camera's own world matrix: three transforms a view-space reflection direction by it
    // (cameraWorldMatrix) for environment radiance.
    Matrix matrixWorld{};
    // In three's WebGPUCoordinateSystem (clip z 0..1): WebGPURenderer.render switches a camera to it
    // and recomputes projectionMatrix, so the render database does the same before it fills this.
    Matrix projectionMatrix{};
};

/** One direct light, world space and linear colour with its intensity folded in. */
struct DirectLight {
    enum class Kind : uint8_t { Directional, Point, Spot };
    Kind kind = Kind::Directional;
    std::array<double, 3> color{0, 0, 0};
    std::array<double, 3> direction{0, 1, 0}; // directional: towards the light; spot: target to light
    std::array<double, 3> position{0, 0, 0};  // point and spot
    double distance = 0, decay = 2;           // point and spot: the cutoff (0 none) and the falloff exponent
    double coneCos = 0, penumbraCos = 0;      // spot: cos(angle) and cos(angle * (1 - penumbra))
    /**
     * Set when the light casts a shadow and the shadow map is on (three's LightShadow after
     * updateMatrices): the shadow camera's view and projection draw the depth map, and `matrix` takes a
     * world position to the map's uv and depth.
     */
    struct Shadow {
        Matrix view{}, projection{}, matrix{};
        double bias = 0, normalBias = 0, radius = 1, intensity = 1;
        uint32_t width = 512, height = 512;
        // A point light's: a cube map, one view per face (PointShadowNode's WebGPU face order), and
        // the camera's near and far, which turn a distance into the stored depth.
        bool cube = false;
        std::array<Matrix, 6> faceViews{};
        double near = 0, far = 0;
    };
    std::optional<Shadow> shadow;
    static DirectLight directional(std::array<double, 3> towards, std::array<double, 3> color) {
        DirectLight l;
        l.direction = towards;
        l.color = color;
        return l;
    }
};

/** Light values in world space and linear colour, intensity folded in (three's physically correct units). */
struct LightState {
    std::vector<DirectLight> direct; // three's LightsNode order: by Object3D id
    std::array<double, 3> hemisphereSky{0, 0, 0};
    std::array<double, 3> hemisphereGround{0, 0, 0};
    std::array<double, 3> hemisphereUp{0, 1, 0};
    std::array<double, 3> ambient{0, 0, 0};
    /** three's `renderer.shadowMap.type` is PCFSoftShadowMap: directional and spot maps read with
     *  PCFSoftShadowFilter; otherwise PCFShadowMap's filter. Point lights read PointShadowFilter either way. */
    bool softShadows = false;
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

    /**
     * A storage buffer a positionNode reads, bound by its name (`storage("positions", ...)` in the
     * graph): e.g. the positions a compute pass wrote. It stays bound until set again.
     */
    void setStorage(const std::string& name, Handle buffer, uint64_t bytes) { externalStorage_[name] = {buffer, bytes}; }

    // VirtualShadowNode's explicit depth, fixed refresh/gate path. Unsupported policies are
    // named at this boundary rather than silently selected by a light's ordinary shadow.
    /** ProbeVolume's seven padded SH sub-volumes, bound by the sampling node's name. */
    void setProbeVolume(const std::string& name, const probes::ProbeVolume& volume, bool capture = false);
    /** Linear HDR capture before post/tone mapping; tightly packed RGBA16Float bytes. */
    GpuStatus readProbePixels(ReadbackCallback done);
    /** The post normal target (RGBA16Float, packed rows); InvalidHandle until a post pass has read "normal". */
    GpuStatus readNormalPixels(ReadbackCallback done);
    /** Textures the renderer holds GPU copies of (a destroyed Texture's are released at the next frame). */
    std::size_t materialTextureCount() const { return materialTextures_.size(); }
    /** What the last frame refused or skipped by name; cleared at the start of each frame. */
    const std::vector<std::string>& diagnostics() const { return diagnostics_; }
    /** Separate capture targets: probe work never resizes the presented frame or its post history. */
    Renderer& probeCaptureRenderer();
    void setVirtualShadow(std::size_t light, const shadows::AtlasOptions& options);
    void cutVirtualShadows() { virtualCut_ = true; }
    void setOutput(const OutputState& output);
    /** A post pass between the scene and the output transform; null draws the scene straight out. */
    void setPostNode(std::shared_ptr<const shader::PostNode> post);
    void setPostGraph(shader::graph::Node root);
    /** A render-graph normal/history input supplied by its native producer; borrowed view. */
    void setPostInput(const std::string& name, WGPUTextureView view);
    void setTraa(const TraaOptions& options);
    TraaPass* traaDebugPass() const { return traa_.get(); }
    void cutHistory();
    const OutputState& output() const { return output_; }

    /** Reallocates the targets; the next render draws at the new extent. Zero sizes clamp to 1. */
    void setSize(uint32_t width, uint32_t height);
    uint32_t width() const { return width_; }
    uint32_t height() const { return height_; }

    /** The submission order, shared with batching so palette slots follow the exact draws. */
    static std::vector<std::pair<double, const DrawItem*>> sortDraws(std::span<const DrawItem> items,
                                                                  const CameraState& camera);

    /**
     * Draws one frame and returns its render ID (every render call gets its own, from 1). Items are
     * drawn in three's order: opaque by renderOrder, then depth front to back, then id; transparent
     * after them by renderOrder, then depth back to front, then id.
     */
    uint64_t render(std::span<const DrawItem> items, const CameraState& camera, const LightState& lights,
                    std::array<double, 4> clear = {0, 0, 0, 0});
    /**
     * Draws the last render() output into `target` and submits it, so a windowed player puts the
     * very same frame on the screen the render database just built. `format` is the target view's
     * format. Returns false when the program for it is refused; the frame stays readable either way.
     */
    bool blitTo(WGPUQueue queue, WGPUTextureView target, WGPUTextureFormat format);
    /**
     * The next render() draws its output pass straight into `target`, a view of `format`, in place
     * of the intermediate RGBA8 frame and the blitTo that copies it: a presented frame costs one
     * pass, one encoder and one submission fewer. The pixels are the same bytes. That frame is not
     * kept, so readPixels() still answers the one before; a caller that reads frames back uses
     * blitTo. `target` is borrowed for that one render() call and must outlive it.
     */
    void presentNext(WGPUTextureView target, WGPUTextureFormat format) {
        presentTarget_ = target;
        presentFormat_ = format;
    }
    /** Disarms presentNext(); a no-op once render() has taken the view. */
    void cancelPresent() { presentTarget_ = nullptr; }
    /**
     * presentNext() for the lifetime of a scope: whatever happens between arming and render() (a
     * throw while the scene is prepared, an early return), the borrowed view is disarmed on exit,
     * so no later frame draws into a view its owner has released.
     */
    class PresentScope {
    public:
        PresentScope(Renderer& renderer, WGPUTextureView target, WGPUTextureFormat format) : renderer_(renderer) {
            renderer_.presentNext(target, format);
        }
        ~PresentScope() { renderer_.cancelPresent(); }
        PresentScope(const PresentScope&) = delete;
        PresentScope& operator=(const PresentScope&) = delete;
    private:
        Renderer& renderer_;
    };
    /** The last frame's pixels, RGBA8 rows tightly packed, delivered from poll(). */
    GpuStatus readPixels(ReadbackCallback done);
    void poll() { gpu_.poll(); }
    EventQueue& events() { return events_; }

    /** What the last render() submitted, as three's renderer.info.render counts it. */
    struct FrameStats {
        uint32_t draws = 0;
        uint64_t triangles = 0;
        struct SkinnedPass {
            uint32_t batches = 0, draws = 0, exactDraws = 0, instances = 0;
        };
        SkinnedPass mainSkinned, shadowSkinned;
    };
    const FrameStats& lastFrame() const { return lastFrame_; }
    /**
     * GPU time of the most recent frame whose timestamps came back, first shadow pass (else scene
     * pass) start to output pass end, in milliseconds; negative until one has, and always on a device without timestamp-query.
     */
    double lastGpuMs() const { return timing_->lastMs; }
    /**
     * Whether frames are timed on the GPU: off by default, since a timed frame resolves its query
     * set and reads it back, a cost every frame pays and only a caller of lastGpuMs wants.
     */
    void setGpuTimer(bool on) { gpuTimer_ = on; }
    /** How many GPU times have come back, so a caller samples each one once. */
    uint64_t gpuSamples() const { return timing_->samples; }
    /** Whether the last timed frame's GPU time began at its first shadow pass (else at the scene pass). */
    bool gpuTimerBeganAtShadow() const { return timerBeganAtShadow_; }

    /** Every built program's vertex WGSL by program key: what a test reads to see how the frame's programs were compiled. */
    std::vector<std::pair<std::string, std::string>> programVertexSources() const {
        std::vector<std::pair<std::string, std::string>> out;
        for (const auto& [key, program] : programs_) out.emplace_back(key, program->vertex.wgsl.code);
        return out;
    }
    GpuResources& gpu() { return gpu_; }
    const GeometryCache& geometry() const { return geometry_; }
    const PipelineCache& pipelines() const { return pipelines_; }

private:
    // The uniforms a material program may read, resolved to block offsets once per program.
    enum Slot : uint8_t {
        kModelMatrix, kViewMatrix, kProjectionMatrix, kNormalMatrix, kDiffuse, kAlphaTest, kOpaque, kRoughness,
        kMetalness, kEmissive, kSpecular, kShininess, kIor, kSpecularIntensity, kSpecularColor,
        kUvTransform, kHemisphereSky, kHemisphereGround, kHemisphereDirection, kAmbient, kBoneBase, kBindMatrix,
        kBindMatrixInverse, kMorphBase, kMorphInfluenceBase, kMorphVertexCount, kMorphBaseInfluence,
        kEnvMapIntensity, kCameraWorldMatrix, kEnvMapTexelWidth, kEnvMapTexelHeight, kEnvMapMaxMip, kBoneStride, kFogColor, kFogNear, kFogFar, kFogDensity, kBackgroundRotation, kEnvRotation, kInstanceBase, kNormalScale, kNormalUvTransform, kSlotCount
    };
    // Per direct light i, `light{i}<Field>` (shader::LightLayout).
    enum LightField : uint8_t { kLightColor, kLightDirection, kLightPosition, kLightDistance, kLightDecay, kLightAxis,
                                kLightConeCos, kLightPenumbraCos, kLightShadowMatrix, kLightShadowBias,
                                kLightShadowNormalBias, kLightShadowRadius, kLightShadowMapSize,
                                kLightShadowIntensity, kLightShadowNear, kLightShadowFar, kLightFieldCount };
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
        std::vector<std::array<const shader::UniformField*, kLightFieldCount>> lightSlots;
    };
    void buildLayouts(Program& program);
    /** The program for a material kind, vertex variant and light layout, built on first use. */
    Program& program(MaterialKind kind, const shader::VertexVariant& variant, const std::string& lights,
                     bool softShadows = false);
    /** The shadow pass's depth-only program for a vertex variant (0 plain, 1 instanced). */
    Program& depthProgram(const shader::VertexVariant& variant);
    Program& add(const std::string& key, shader::StageModule vertex, shader::StageModule fragment);
    WGPUBindGroup bindGroup(WGPUBindGroupLayout layout, const shader::StageModule& stage, Handle uniforms,
                            WGPUTextureView view, WGPUSampler sampler,
                            WGPUTextureView mapView = nullptr, WGPUSampler mapSampler = nullptr,
                            WGPUTextureView envView = nullptr, WGPUSampler envSampler = nullptr,
                            WGPUTextureView normalView = nullptr, WGPUSampler normalSampler = nullptr);
    /** The GPU texture and sampler for a material map, (re)built when the texture's version moves. */
    struct MaterialTexture {
        Handle gpu;
        WGPUTexture mipped = nullptr;  // the texture when it carries a mip chain (gpu is then unused)
        WGPUTextureView view = nullptr;
        WGPUSampler sampler = nullptr;
        uint32_t version = 0;
    };
    const MaterialTexture* materialTexture(const Texture& texture);
    struct BackgroundCube {
        WGPUTexture texture = nullptr;
        WGPUTextureView view = nullptr;
        WGPUSampler sampler = nullptr;
        uint32_t version = 0;
    };
    BackgroundCube& backgroundCube(const Texture& texture);
    std::map<uint64_t, BackgroundCube> backgroundCubes_;  // by Texture::ident
    void releaseMaterialTextures();
    /** Releases what the caches built for textures that no longer exist. */
    void sweepTextures();
    void dropMapGroups();
    /**
     * The PMREM cubeUV form of an equirectangular (or PMREM) environment, built on first use and
     * rebuilt when the source texture's version moves (three's PMREMGenerator.fromEquirectangular).
     */
    struct EnvironmentGpu {
        const Texture* source = nullptr;
        uint32_t version = 0;
        WGPUTexture texture = nullptr;   // the cubeUV render target, sampled by the material
        WGPUTextureView view = nullptr;
        WGPUTexture pingpong = nullptr;
        WGPUTextureView pingView = nullptr;
        WGPUSampler sampler = nullptr;
        uint32_t width = 0, height = 0, cubeSize = 0;
        uint32_t lodMax = 0, lods = 0;
        float texelWidth = 0, texelHeight = 0, maxMip = 0;
    };
    EnvironmentGpu& environment(const Texture& equirect);
    void buildEnvironmentPipelines();
    void releaseEnvironments();
    void rebuildGroups();
    void releaseTargets();
    GpuStatus readRgba16(WGPUTexture texture, ReadbackCallback done);
    void releaseOutputGroup();
    void outputPass(WGPUCommandEncoder encoder, bool timed, WGPUTextureView present, WGPUTextureFormat presentFormat);

    WGPUInstance instance_;
    std::unique_ptr<Renderer> probeCapture_;
    WGPUDevice device_;
    WGPUQueue queue_;
    EventQueue& events_;
    GpuResources gpu_;
    GeometryCache geometry_;
    PipelineCache pipelines_;
    // By MaterialKind, vertex variant (0 plain, 1 instanced, 2 instanced with instanceColor) and light
    // layout; held by pointer so a frame's plan keeps its addresses while new programs are added.
    std::map<std::string, std::unique_ptr<Program>> programs_;
    WGPUTexture lut_ = nullptr;
    WGPUTextureView lutView_ = nullptr;
    WGPUSampler lutSampler_ = nullptr;
    // Shadow maps by direct-light index (Depth24Plus, three's DepthTexture of UnsignedIntType), and
    // the less-equal comparison sampler with linear filtering PCFShadowMap samples them with.
    struct ShadowMap {
        WGPUTexture texture = nullptr;
        WGPUTextureView view = nullptr;      // sampled: 2D, or a cube for a point light
        WGPUTextureView faces[6] = {};       // a cube's faces, each drawn as a 2D depth target
        uint32_t width = 0, height = 0;
        bool cube = false;
    };
    // 2D maps and cube maps in separate slots, so a program built while light i was a directional
    // light still binds a 2D map after light i becomes a point light.
    std::vector<ShadowMap> shadowMaps_, cubeShadowMaps_;
    struct VirtualShadow {
        shadows::PageAtlas atlas;
        ShadowMap map;
        std::map<uint64_t, Box3> casters;
        std::map<uint64_t, std::string> casterPrograms;
    };
    std::map<std::size_t, VirtualShadow> virtualShadows_;
    bool virtualCut_ = false;
    WGPUSampler compareSampler_ = nullptr;
    Handle color_;
    WGPUTexture depth_ = nullptr;
    WGPUTextureView colorView_ = nullptr;
    WGPUTextureView depthView_ = nullptr;
    WGPUTexture sceneColor_ = nullptr;  // linear HDR, what materials draw into
    WGPUTextureView sceneView_ = nullptr;
    // View-space normals for post passes that read "normal" (three's MRT `normal: normalView`),
    // drawn after the main pass; created with the first such frame, released with the targets.
    WGPUTexture normalTexture_ = nullptr;
    WGPUTextureView normalView_ = nullptr;
    shader::StageModule normalFragment_;
    std::vector<std::string> diagnostics_;
    OutputState output_;
    std::shared_ptr<const shader::PostNode> post_;
    std::unique_ptr<TraaPass> traa_;
    std::unique_ptr<PostEffects> postEffects_;
    std::map<std::string, std::vector<float>> postUniforms_;
    shader::StageModule blitVertex_, blitFragment_;  // blitTo's pass-through copy
    shader::StageModule outputVertex_;
    shader::StageModule outputFragment_;
    Handle outputTriangle_;
    Handle outputUniforms_;
    WGPUSampler outputSampler_ = nullptr;
    WGPUBindGroup outputGroup_ = nullptr;
    WGPUBindGroupLayout outputLayout_ = nullptr;
    WGPUPipelineLayout outputPipelineLayout_ = nullptr;
    WGPUTextureView presentTarget_ = nullptr;  // presentNext: the output pass draws here, not into colorView_
    WGPUTextureFormat presentFormat_ = WGPUTextureFormat_Undefined;
    uint32_t width_ = 0;
    uint32_t height_ = 0;
    uint64_t renderId_ = 0;
    FrameStats lastFrame_;
    WGPURenderBundle mainBundle_ = nullptr;
    std::vector<uint64_t> mainBundleKey_;
    FrameStats mainBundleStats_;
    bool timerBeganAtShadow_ = false;
    bool gpuTimer_ = false;
    WGPUQuerySet timestamps_ = nullptr;  // scene pass begin/end [0, 1], output pass begin/end [2, 3], first shadow pass begin [4, 5]
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
    // Every skinned draw's bone palette this frame, one storage buffer the skinned programs index
    // from their `boneBase`; grown (and the bind groups rebuilt) like the uniform buffer.
    // Per-frame storage the vertex variants read, by binding name: `boneMatrices` (skinning),
    // `morphData` and `morphInfluences` (morph targets). Each starts at 64 bytes so a program always
    // has a buffer to bind, and grows (bind groups rebuilt) like the uniform buffer.
    struct FrameStorage {
        std::vector<float> data;
        Handle buffer;
        uint64_t capacity = 0;
    };
    struct ProbeTexture {
        WGPUTexture texture = nullptr;
        WGPUTextureView view = nullptr;
        WGPUSampler sampler = nullptr;
        WGPUExtent3D size{};
    };
    std::map<std::string, ProbeTexture> probeTextures_;
    std::map<std::string, FrameStorage> storages_;
    std::map<std::string, std::pair<Handle, uint64_t>> externalStorage_;  // setStorage, by name
    // A material's diffuse map: its GPU texture/sampler, and, per (program, texture), the bind group
    // that binds it alongside the frame's uniforms. Cleared when the uniform buffer is rebuilt.
    std::unordered_map<uint64_t, MaterialTexture> materialTextures_;  // by Texture::ident, never an address
    std::map<std::string, WGPUBindGroup> mapGroups_;
    // PMREM (three's PMREMGenerator.fromEquirectangular): the cubeUV tiles and the pipelines that
    // fill them, keyed by the equirect source texture.
    std::map<uint64_t, EnvironmentGpu> environments_;  // by Texture::ident
    WGPUBindGroupLayout envLayout_ = nullptr;
    WGPUPipelineLayout envPipelineLayout_ = nullptr;
    WGPURenderPipeline envEquirectPipeline_ = nullptr;
    WGPURenderPipeline envGgxPipeline_ = nullptr;
    Handle envVertex_{};      // per-LOD: 36 vertices, position vec3 + expandedUv vec2 + face f32
    uint64_t envVertexCapacity_ = 0;
    Handle envUniforms_{};    // one aligned slice per PMREM pass
    uint64_t envUniformCapacity_ = 0;
};

}  // namespace tn::engine
