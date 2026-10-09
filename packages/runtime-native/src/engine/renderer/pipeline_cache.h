#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include <webgpu/webgpu.h>

#include "engine/shader/package.h"

namespace tn::engine {

/** What a render pipeline depends on besides its shaders. */
struct PipelineTarget {
    WGPUTextureFormat color = WGPUTextureFormat_RGBA8Unorm;  // Undefined: depth-only (shadow) pass
    WGPUTextureFormat depth = WGPUTextureFormat_Depth32Float;
    WGPUCullMode cull = WGPUCullMode_Back;
    uint8_t blend = 0;       // 0 none, else three's NormalBlending (1) or AdditiveBlending (2), premultipliedAlpha false
    bool depthWrite = true;  // material.depthWrite
    WGPUPipelineLayout layout = nullptr;  // explicit layout (dynamic-offset uniforms); null: auto
    // `skinIndex` as the geometry stores it: three's Uint8/16/32 attribute read as vec4<u32>.
    WGPUVertexFormat skinIndex = WGPUVertexFormat_Uint16x4;
    WGPUFrontFace frontFace = WGPUFrontFace_CCW;
    WGPUCompareFunction depthCompare = WGPUCompareFunction_LessEqual;
    // material.polygonOffset: WebGPUPipelineUtils' depthBias (polygonOffsetUnits) and
    // depthBiasSlopeScale (polygonOffsetFactor); zero without it.
    int32_t depthBias = 0;
    float depthBiasSlopeScale = 0;
    // Bit i: vertex attribute i (in the stage's attribute order) steps per instance
    // (an InstancedBufferAttribute), beside instanceMatrix* and instanceColor.
    uint64_t instanceStepMask = 0;
};

/**
 * Render pipelines by what they are made of (PRD-514): the stages' WGSL text — deterministic by
 * construction (PRD-511) — their vertex layout and the target formats. The first request compiles;
 * every later one, every frame, is a lookup.
 */
class PipelineCache {
public:
    explicit PipelineCache(WGPUDevice device) : device_(device) {}
    ~PipelineCache();
    PipelineCache(const PipelineCache&) = delete;
    PipelineCache& operator=(const PipelineCache&) = delete;

    /** `fragment` null builds a depth-only pipeline. Returns null when the device refuses it. */
    WGPURenderPipeline get(const shader::StageModule& vertex, const shader::StageModule* fragment, const PipelineTarget& target);

    uint64_t compiles() const { return compiles_; }
    /** Lookups that had to build the text key: the ones an id did not answer. */
    uint64_t textLookups() const { return textLookups_; }
    size_t size() const { return pipelines_.size(); }

private:
    /** The same pipeline by the ids of its stages' texts: a lookup that copies and hashes no WGSL. */
    struct IdKey {
        uint64_t vertex, fragment;
        size_t vertexSize, fragmentSize;  // an edit that changes the length also changes the key
        PipelineTarget target;
        bool operator==(const IdKey& o) const;
    };
    struct IdKeyHash {
        size_t operator()(const IdKey& key) const;
    };
    WGPUDevice device_;
    std::unordered_map<std::string, WGPURenderPipeline> pipelines_;
    std::unordered_map<IdKey, WGPURenderPipeline, IdKeyHash> byId_;  // aliases of pipelines_, never owners
    uint64_t compiles_ = 0;
    uint64_t textLookups_ = 0;
};

}  // namespace tn::engine
