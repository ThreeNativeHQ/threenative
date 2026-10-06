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
    bool blend = false;      // three's NormalBlending, premultipliedAlpha false (a transparent material)
    bool depthWrite = true;  // material.depthWrite
    WGPUPipelineLayout layout = nullptr;  // explicit layout (dynamic-offset uniforms); null: auto
    // `skinIndex` as the geometry stores it: three's Uint8/16/32 attribute read as vec4<u32>.
    WGPUVertexFormat skinIndex = WGPUVertexFormat_Uint16x4;
    WGPUFrontFace frontFace = WGPUFrontFace_CCW;
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
    size_t size() const { return pipelines_.size(); }

private:
    WGPUDevice device_;
    std::unordered_map<std::string, WGPURenderPipeline> pipelines_;
    uint64_t compiles_ = 0;
};

}  // namespace tn::engine
