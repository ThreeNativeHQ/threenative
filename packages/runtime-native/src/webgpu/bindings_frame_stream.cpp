/** Packed WebGPU frame-operation stream replay. */

#include "bindings_frame_stream.h"

#include "bindings_commands.h"
#include "bindings_presentation.h"
#include "mystral/webgpu/bindings.h"
#include "mystral/webgpu_compat.h"

#if defined(MYSTRAL_WEBGPU_WGPU)
#if __has_include(<webgpu/wgpu.h>)
#include <webgpu/wgpu.h>
#else
#include <wgpu/wgpu.h>
#endif
#endif

#include <cmath>
#include <cstring>
#include <iostream>
#include <iterator>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

namespace {

struct PackedFrameReader {
    const uint8_t* data = nullptr;
    size_t size = 0;
    size_t cursor = 0;
    size_t recordEnd = 0;
    bool ok = true;
    size_t remaining() const { return cursor <= recordEnd ? recordEnd - cursor : 0; }
    uint32_t u32() {
        uint32_t v = 0;
        if (!ok || remaining() < sizeof(v)) {
            ok = false;
            return 0;
        }
        std::memcpy(&v, data + cursor, sizeof(v));
        cursor += sizeof(v);
        return v;
    }
    double f64() {
        double v = 0;
        if (!ok || remaining() < sizeof(v)) {
            ok = false;
            return 0;
        }
        std::memcpy(&v, data + cursor, sizeof(v));
        cursor += sizeof(v);
        return v;
    }
};

}  // namespace

bool replayPackedFrameOpStream(BindingsState* state, js::JSValueHandle frame) {
    size_t bytes = 0;
    const auto* data = static_cast<const uint8_t*>(state->engine->getArrayBufferData(frame, &bytes));
    if (!data || bytes < 16) { state->engine->throwException("frame op stream: truncated header"); return false; }
    PackedFrameReader r{data, bytes, 0, bytes, true};
    const uint32_t magic = r.u32(), version = r.u32(), declaredBytes = r.u32(), declaredOps = r.u32();
    if (magic != 0x544e4652 || (version != 1 && version != 2) || declaredBytes < 16 || declaredBytes > bytes) { state->engine->throwException("frame op stream: invalid header"); return false; }
    r.size = declaredBytes;
    r.recordEnd = declaredBytes;
    auto& encoders = state->frameReplay.encoders;
    auto& renderPasses = state->frameReplay.renderPasses;
    auto& renderOwners = state->frameReplay.renderOwners;
    auto& computePasses = state->frameReplay.computePasses;
    auto& computeOwners = state->frameReplay.computeOwners;
    auto& commandBuffers = state->frameReplay.commandBuffers;
    auto& renderColors = state->frameReplay.renderPassColors;
    auto& dynamicOffsets = state->frameReplay.dynamicOffsets;
    auto& renderBundles = state->frameReplay.renderBundles;
    auto& submittedCommandBuffers = state->frameReplay.submittedCommandBuffers;
    auto& rawCommandBuffers = state->frameReplay.rawCommandBuffers;
    encoders.clear();
    renderPasses.clear();
    renderOwners.clear();
    computePasses.clear();
    computeOwners.clear();
    commandBuffers.clear();
    renderColors.clear();
    dynamicOffsets.clear();
    renderBundles.clear();
    submittedCommandBuffers.clear();
    rawCommandBuffers.clear();
    if (state->profiling.captureFrameOpStreamTrace)
        state->profiling.frameOpStreamLastOrder.clear();
    auto fail = [&](const std::string& detail) {
        const std::string message = "frame op stream: " + detail;
        std::cerr << "[WebGPU] Frame op stream replay failed: " << detail << std::endl;
        state->engine->throwException(message.c_str());
        r.ok = false;
    };
    auto buffer = [&](uint32_t id) -> WGPUBuffer {
        const auto it = state->registries.bufferRegistry.find(id);
        if (it == state->registries.bufferRegistry.end()) {
            fail("unknown buffer id " + std::to_string(id));
            return nullptr;
        }
        return it->second.buffer;
    };
    auto texture = [&](uint32_t id) -> WGPUTexture {
        const auto it = state->registries.textureRegistry.find(id);
        if (it == state->registries.textureRegistry.end()) {
            fail("unknown texture id");
            return nullptr;
        }
        return it->second.texture;
    };
    auto viewFor = [&](uint32_t id) -> WGPUTextureView {
        const auto it = state->registries.textureViewRegistry.find(id);
        if (it == state->registries.textureViewRegistry.end()) {
            fail("unknown texture view id");
            return nullptr;
        }
        return it->second;
    };
    auto encoder = [&](uint32_t id) -> WGPUCommandEncoder {
        const auto it = encoders.find(id);
        if (it == encoders.end()) {
            fail("unknown command encoder id");
            return nullptr;
        }
        return it->second;
    };
    auto renderPass = [&](uint32_t id) -> WGPURenderPassEncoder {
        const auto it = renderPasses.find(id);
        if (it == renderPasses.end()) {
            fail("unknown render pass id");
            return nullptr;
        }
        return it->second;
    };
    auto computePass = [&](uint32_t id) -> WGPUComputePassEncoder {
        const auto it = computePasses.find(id);
        if (it == computePasses.end()) {
            fail("unknown compute pass id");
            return nullptr;
        }
        return it->second;
    };
    // Query sets are created outside the frame (they outlive it), so the stream only ever names
    // one by id. An unknown id fails the frame rather than silently skipping the timing.
    auto querySetFor = [&](uint32_t id) -> WGPUQuerySet {
        const auto it = state->registries.querySetRegistry.find(id);
        if (it == state->registries.querySetRegistry.end()) {
            fail("unknown query set id " + std::to_string(id));
            return nullptr;
        }
        return it->second;
    };
    auto readTextureCopy = [&](WGPUImageCopyTexture_Compat& copy) {
        copy.texture = texture(r.u32());
        copy.mipLevel = r.u32();
        copy.origin = {r.u32(), r.u32(), r.u32()};
        const uint32_t aspect = r.u32();
        copy.aspect = aspect == 1 ? WGPUTextureAspect_DepthOnly
                                   : aspect == 2 ? WGPUTextureAspect_StencilOnly
                                                 : WGPUTextureAspect_All;
    };
    auto readExtent = [&]() { return WGPUExtent3D{r.u32(), r.u32(), r.u32()}; };
    static const char* names[] = {"", "writeBuffer", "createCommandEncoder", "beginRenderPass", "render.setPipeline", "render.setBindGroup", "render.setVertexBuffer", "render.setIndexBuffer", "render.draw", "render.drawIndexed", "render.drawIndirect", "render.drawIndexedIndirect", "render.setViewport", "render.setScissorRect", "render.setBlendConstant", "render.setStencilReference", "render.executeBundles", "render.end", "beginComputePass", "compute.setPipeline", "compute.setBindGroup", "compute.dispatchWorkgroups", "compute.end", "copyBufferToBuffer", "copyBufferToTexture", "copyTextureToBuffer", "copyTextureToTexture", "clearBuffer", "finish", "submit", "writeTexture", "copyExternalImageToTexture", "buffer.destroy", "texture.destroy", "resolveQuerySet"};
    uint32_t seen = 0;
    uint32_t replaySubmits = 0;
    while (r.cursor < declaredBytes && r.ok) {
        const size_t start = r.cursor;
        r.recordEnd = declaredBytes;
        const uint32_t opcode = r.u32(), recordBytes = r.u32();
        if (!r.ok || opcode == 0 || opcode >= std::size(names) || recordBytes < 8 || (recordBytes & 7) || start + recordBytes > declaredBytes) { fail("malformed record header"); break; }
        r.recordEnd = start + recordBytes;
        if (state->profiling.captureFrameOpStreamTrace) {
            state->profiling.frameOpStreamLastOrder.emplace_back(names[opcode]);
        }
        seen += 1;
#if TN_ANDROID_JS_PROFILE
        const auto opProfileStart = beginProfiledBinding();
#endif
        switch (opcode) {
        case 1: {
            const uint32_t id = r.u32();
            const double off = r.f64();
            const uint32_t n = r.u32();
            if (!r.ok) {
                fail("truncated writeBuffer record");
                break;
            }
            const auto info = state->registries.bufferRegistry.find(id);
            if (!std::isfinite(off) || off < 0 || std::floor(off) != off || static_cast<uint64_t>(off) % 4 || (n & 3) ||
                r.cursor + n > r.recordEnd || info == state->registries.bufferRegistry.end() ||
                static_cast<uint64_t>(off) > info->second.size || n > info->second.size - static_cast<uint64_t>(off)) {
                fail(info == state->registries.bufferRegistry.end() ? "unknown buffer id " + std::to_string(id)
                                                                    : "invalid writeBuffer bounds");
                break;
            }
            WGPUBuffer b = info->second.buffer;
            if (state->profiling.frameOpStreamNativeCallObserver)
                state->profiling.frameOpStreamNativeCallObserver("writeBuffer");
            if (!stageWriteInUploadStaging(state, b, static_cast<uint64_t>(off), data + r.cursor, n, n))
                wgpuQueueWriteBuffer(state->queue, b, static_cast<uint64_t>(off), data + r.cursor, n);
#if TN_ANDROID_JS_PROFILE
            state->profiling.androidJsNativeProfile.writeBufferBytes += n;
            state->profiling.androidJsNativeProfile.writeBufferTargets.insert(b);
#endif
                r.cursor = (r.cursor + n + 7) & ~size_t(7); break;
        }
            case 2: { const uint32_t id = r.u32(); if (!id || encoders.find(id) != encoders.end()) { fail("duplicate command encoder id"); break; } WGPUCommandEncoderDescriptor d{}; auto e = wgpuDeviceCreateCommandEncoder(state->device, &d); if (!e) { fail("createCommandEncoder failed"); break; } encoders[id] = e; break; }
            case 3: {
                const uint32_t eid = r.u32(), pid = r.u32(), count = r.u32();
                if (!pid || renderPasses.find(pid) != renderPasses.end()) {
                    fail("duplicate render pass id");
                    break;
                }
                auto e = encoder(eid);
                if (!r.ok)
                    break;
                const size_t colorAttachmentBytes = version >= 2 ? 52 : 48;
                if (r.remaining() < 8 || count > (r.remaining() - 8) / colorAttachmentBytes) {
                    fail("render pass color attachment count exceeds record");
                    break;
                }
                bool touchesSurface = false;
                renderColors.resize(count);
                for (auto& c : renderColors) {
                    c = {};
                    c.view = viewFor(r.u32());
                    if (!r.ok)
                        break;
                    touchesSurface = touchesSurface || isCurrentSurfaceTextureView(state, c.view);
                    const uint32_t resolve = r.u32();
                    if (!r.ok)
                        break;
                    c.resolveTarget = resolve ? viewFor(resolve) : nullptr;
                    if (!r.ok)
                        break;
                    touchesSurface = touchesSurface || isCurrentSurfaceTextureView(state, c.resolveTarget);
                    c.loadOp = r.u32() ? WGPULoadOp_Load : WGPULoadOp_Clear;
                    c.storeOp = r.u32() ? WGPUStoreOp_Discard : WGPUStoreOp_Store;
                    c.clearValue = {r.f64(), r.f64(), r.f64(), r.f64()};
                    c.depthSlice = version >= 2 ? r.u32() : WGPU_DEPTH_SLICE_UNDEFINED;
                }
                WGPURenderPassDepthStencilAttachment depth{};
                WGPURenderPassDescriptor d{};
                d.colorAttachmentCount = renderColors.size();
                d.colorAttachments = renderColors.data();
                if (r.u32()) {
                    depth.view = viewFor(r.u32());
                    if (!r.ok)
                        break;
                    depth.depthClearValue = r.f64();
                    depth.depthLoadOp = r.u32() ? WGPULoadOp_Load : WGPULoadOp_Clear;
                    depth.depthStoreOp = r.u32() ? WGPUStoreOp_Discard : WGPUStoreOp_Store;
                    depth.depthReadOnly = r.u32();
                    depth.stencilClearValue = r.u32();
                    const auto sl = r.u32(), ss = r.u32();
                    depth.stencilLoadOp = sl == 2 ? WGPULoadOp_Undefined : sl ? WGPULoadOp_Load : WGPULoadOp_Clear;
                    depth.stencilStoreOp = ss == 2 ? WGPUStoreOp_Undefined
                                           : ss    ? WGPUStoreOp_Discard
                                                   : WGPUStoreOp_Store;
                    depth.stencilReadOnly = r.u32();
                    d.depthStencilAttachment = &depth;
                }
                WGPURenderPassTimestampWrites_Compat rtw{};
                if (r.u32()) {
                    rtw.querySet = querySetFor(r.u32());
                    if (!r.ok)
                        break;
                    rtw.beginningOfPassWriteIndex = r.u32();
                    rtw.endOfPassWriteIndex = r.u32();
                    if (!rtw.querySet)
                        break;
                    d.timestampWrites = &rtw;
                }
                if (!r.ok)
                    break;
#if TN_ANDROID_JS_PROFILE
                const auto beginPassStart = beginProfiledBinding();
#endif
                if (state->profiling.frameOpStreamNativeCallObserver)
                    state->profiling.frameOpStreamNativeCallObserver("beginRenderPass");
                auto p = wgpuCommandEncoderBeginRenderPass(e, &d);
#if TN_ANDROID_JS_PROFILE
                endProfiledBinding(state, ProfiledRenderCommand::BeginRenderPass, beginPassStart);
#endif
                if (!p) {
                    fail("beginRenderPass failed");
                    break;
                }
                if (touchesSurface) {
                    state->presentation.surfaceRenderEncoder = e;
                    state->presentation.surfaceRenderPassEnded = false;
                }
                renderPasses[pid] = p;
                renderOwners[pid] = e;
                break;
            }
            case 4: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const auto it = state->registries.renderPipelineRegistry.find(r.u32());
                if (!r.ok)
                    break;
                if (it == state->registries.renderPipelineRegistry.end())
                    fail("unknown render pipeline id");
                else
                    wgpuRenderPassEncoderSetPipeline(p, it->second);
                break;
            }
            case 5: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const uint32_t index = r.u32(), gid = r.u32(), n = r.u32();
                if (!r.ok)
                    break;
                if (n > r.remaining() / sizeof(uint32_t)) {
                    fail("render bind group offset count exceeds record");
                    break;
                }
                state->frameReplay.dynamicOffsets.resize(n);
                for (auto& v : dynamicOffsets)
                    v = r.u32();
                if (!r.ok)
                    break;
                const auto it = state->registries.bindGroupRegistry.find(gid);
                if (it == state->registries.bindGroupRegistry.end())
                    fail("unknown bind group id");
                else
                    wgpuRenderPassEncoderSetBindGroup(p, index, it->second, n, dynamicOffsets.data());
                break;
            }
            case 6: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const uint32_t slot = r.u32();
                auto b = buffer(r.u32());
                if (!r.ok)
                    break;
                const uint64_t off = static_cast<uint64_t>(r.f64());
                const double z = r.f64();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderSetVertexBuffer(
                    p, slot, b, off, z < 0 ? WGPU_WHOLE_SIZE : static_cast<uint64_t>(z));
                break;
            }
            case 7: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                auto b = buffer(r.u32());
                if (!r.ok)
                    break;
                const auto f = r.u32() ? WGPUIndexFormat_Uint32 : WGPUIndexFormat_Uint16;
                const uint64_t off = static_cast<uint64_t>(r.f64());
                const double z = r.f64();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderSetIndexBuffer(
                    p, b, f, off, z < 0 ? WGPU_WHOLE_SIZE : static_cast<uint64_t>(z));
                break;
            }
            case 8: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const auto a = r.u32(), b = r.u32(), c = r.u32(), d = r.u32();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderDraw(p, a, b, c, d);
                break;
            }
            case 9: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const auto a = r.u32(), b = r.u32(), c = r.u32();
                const int32_t d = static_cast<int32_t>(r.u32());
                const auto e = r.u32();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderDrawIndexed(p, a, b, c, d, e);
                break;
            }
            case 10: case 11: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                auto b = buffer(r.u32());
                if (!r.ok)
                    break;
                const uint64_t off = static_cast<uint64_t>(r.f64());
                if (!r.ok)
                    break;
                if (opcode == 10)
                    wgpuRenderPassEncoderDrawIndirect(p, b, off);
                else
                    wgpuRenderPassEncoderDrawIndexedIndirect(p, b, off);
                break;
            }
            case 12: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const float x = r.f64(), y = r.f64(), w = r.f64(), h = r.f64(), a = r.f64(), b = r.f64();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderSetViewport(p, x, y, w, h, a, b);
                break;
            }
            case 13: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const auto x = r.u32(), y = r.u32(), w = r.u32(), h = r.u32();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderSetScissorRect(p, x, y, w, h);
                break;
            }
            case 14: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                WGPUColor c{r.f64(), r.f64(), r.f64(), r.f64()};
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderSetBlendConstant(p, &c);
                break;
            }
            case 15: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const auto reference = r.u32();
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderSetStencilReference(p, reference);
                break;
            }
            case 16: {
                auto p = renderPass(r.u32());
                if (!r.ok)
                    break;
                const uint32_t n = r.u32();
                if (!r.ok)
                    break;
                if (n > r.remaining() / sizeof(uint32_t)) {
                    fail("render bundle count exceeds record");
                    break;
                }
                state->frameReplay.renderBundles.resize(n);
                for (auto& bundle : renderBundles) {
                    const auto it = state->registries.renderBundleRegistry.find(r.u32());
                    if (it == state->registries.renderBundleRegistry.end()) {
                        fail("unknown render bundle id");
                        break;
                    }
                    bundle = it->second;
                }
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderExecuteBundles(p, renderBundles.size(), renderBundles.data());
                break;
            }
            case 17: {
                const uint32_t id = r.u32();
                auto p = renderPass(id);
                if (!r.ok)
                    break;
                wgpuRenderPassEncoderEnd(p);
                wgpuRenderPassEncoderRelease(p);
                const auto owner = renderOwners.find(id);
                if (owner != renderOwners.end() && owner->second == state->presentation.surfaceRenderEncoder)
                    state->presentation.surfaceRenderPassEnded = true;
                renderPasses.erase(id);
                renderOwners.erase(id);
                break;
            }
            case 18: {
                const uint32_t eid = r.u32(), pid = r.u32();
                if (!pid || computePasses.find(pid) != computePasses.end()) {
                    fail("duplicate compute pass id");
                    break;
                }
                auto e = encoder(eid);
                if (!r.ok)
                    break;
                WGPUComputePassDescriptor d{};
                WGPUComputePassTimestampWrites_Compat ctw{};
                const uint32_t hasTimestampWrites = r.u32();
                if (!r.ok)
                    break;
                if (hasTimestampWrites) {
                    ctw.querySet = querySetFor(r.u32());
                    if (!r.ok)
                        break;
                    ctw.beginningOfPassWriteIndex = r.u32();
                    ctw.endOfPassWriteIndex = r.u32();
                    if (!r.ok)
                        break;
                    d.timestampWrites = &ctw;
                }
                if (state->profiling.frameOpStreamNativeCallObserver)
                    state->profiling.frameOpStreamNativeCallObserver("beginComputePass");
                auto p = wgpuCommandEncoderBeginComputePass(e, &d);
                if (!p)
                    fail("beginComputePass failed");
                else {
                    computePasses[pid] = p;
                    computeOwners[pid] = e;
                }
                break;
            }
            case 19: {
                auto p = computePass(r.u32());
                if (!r.ok)
                    break;
                const auto it = state->registries.computePipelineRegistry.find(r.u32());
                if (!r.ok)
                    break;
                if (it == state->registries.computePipelineRegistry.end())
                    fail("unknown compute pipeline id");
                else
                    wgpuComputePassEncoderSetPipeline(p, it->second);
                break;
            }
            case 20: {
                auto p = computePass(r.u32());
                if (!r.ok)
                    break;
                const auto index = r.u32(), gid = r.u32(), n = r.u32();
                if (!r.ok)
                    break;
                if (n > r.remaining() / sizeof(uint32_t)) {
                    fail("compute bind group offset count exceeds record");
                    break;
                }
                state->frameReplay.dynamicOffsets.resize(n);
                for (auto& v : dynamicOffsets)
                    v = r.u32();
                if (!r.ok)
                    break;
                const auto it = state->registries.bindGroupRegistry.find(gid);
                if (it == state->registries.bindGroupRegistry.end())
                    fail("unknown bind group id");
                else
                    wgpuComputePassEncoderSetBindGroup(p, index, it->second, n, dynamicOffsets.data());
                break;
            }
            case 21: {
                auto p = computePass(r.u32());
                if (!r.ok)
                    break;
                const auto x = r.u32(), y = r.u32(), z = r.u32();
                if (!r.ok)
                    break;
                wgpuComputePassEncoderDispatchWorkgroups(p, x, y, z);
                break;
            }
            case 22: {
                const auto id = r.u32();
                auto p = computePass(id);
                if (!r.ok)
                    break;
                wgpuComputePassEncoderEnd(p);
                wgpuComputePassEncoderRelease(p);
                computePasses.erase(id);
                computeOwners.erase(id);
                break;
            }
            case 23: {
                auto e = encoder(r.u32());
                if (!r.ok)
                    break;
                auto s = buffer(r.u32());
                if (!r.ok)
                    break;
                const uint64_t so = r.f64();
                auto d = buffer(r.u32());
                if (!r.ok)
                    break;
                const uint64_t od = r.f64(), z = r.f64();
                if (!r.ok)
                    break;
                wgpuCommandEncoderCopyBufferToBuffer(e, s, so, d, od, z);
                break;
            }
            case 24: {
                auto e = encoder(r.u32());
                if (!r.ok)
                    break;
                WGPUImageCopyBuffer_Compat s{};
                s.buffer = buffer(r.u32());
                if (!r.ok)
                    break;
                s.layout.offset = r.f64();
                s.layout.bytesPerRow = r.u32();
                s.layout.rowsPerImage = r.u32();
                WGPUImageCopyTexture_Compat d{};
                readTextureCopy(d);
                if (!r.ok)
                    break;
                auto z = readExtent();
                if (!r.ok)
                    break;
                if (!s.layout.rowsPerImage)
                    s.layout.rowsPerImage = z.height;
                wgpuCommandEncoderCopyBufferToTexture(e, &s, &d, &z);
                break;
            }
            case 25: {
                auto e = encoder(r.u32());
                if (!r.ok)
                    break;
                WGPUImageCopyTexture_Compat s{};
                readTextureCopy(s);
                if (!r.ok)
                    break;
                WGPUImageCopyBuffer_Compat d{};
                d.buffer = buffer(r.u32());
                if (!r.ok)
                    break;
                d.layout.offset = r.f64();
                d.layout.bytesPerRow = r.u32();
                d.layout.rowsPerImage = r.u32();
                auto z = readExtent();
                if (!r.ok)
                    break;
                if (!d.layout.rowsPerImage)
                    d.layout.rowsPerImage = z.height;
                wgpuCommandEncoderCopyTextureToBuffer(e, &s, &d, &z);
                break;
            }
            case 26: {
                auto e = encoder(r.u32());
                if (!r.ok)
                    break;
                WGPUImageCopyTexture_Compat s{}, d{};
                readTextureCopy(s);
                if (!r.ok)
                    break;
                readTextureCopy(d);
                if (!r.ok)
                    break;
                auto z = readExtent();
                if (!r.ok)
                    break;
                wgpuCommandEncoderCopyTextureToTexture(e, &s, &d, &z);
                break;
            }
            case 27: {
                auto e = encoder(r.u32());
                if (!r.ok)
                    break;
                auto b = buffer(r.u32());
                if (!r.ok)
                    break;
                const uint64_t o = r.f64();
                const double z = r.f64();
                if (!r.ok)
                    break;
                wgpuCommandEncoderClearBuffer(
                    e, b, o, z < 0 ? WGPU_WHOLE_SIZE : static_cast<uint64_t>(z));
                break;
            }
            case 28: {
                const auto eid = r.u32(), cid = r.u32();
                if (!r.ok)
                    break;
                if (!cid || commandBuffers.find(cid) != commandBuffers.end()) {
                    fail("duplicate command buffer id");
                    break;
                }
                auto e = encoder(eid);
                if (!r.ok)
                    break;
                WGPUCommandBufferDescriptor d{};
                auto c = wgpuCommandEncoderFinish(e, &d);
                if (!c)
                    fail("finish failed");
                else
                    commandBuffers[cid] = c;
                encoders.erase(eid);
                wgpuCommandEncoderRelease(e);
                break;
            }
            case 29: {
                const uint32_t n = r.u32();
                if (!r.ok)
                    break;
                if (n > r.remaining() / sizeof(uint32_t)) {
                    fail("submit command buffer count exceeds record");
                    break;
                }
                state->frameReplay.submittedCommandBuffers.resize(n);
                for (auto& value : submittedCommandBuffers) {
                    const uint32_t id = r.u32();
                    if (!r.ok)
                        break;
                    const auto it = commandBuffers.find(id);
                    if (it == commandBuffers.end()) {
                        fail("unknown command buffer id");
                        break;
                    }
                    value = {id, it->second};
                }
                if (r.ok) {
#if TN_ANDROID_JS_PROFILE
                    const auto submitStart = beginProfiledBinding();
#endif
                    flushUploadStaging(state);
                    state->frameReplay.rawCommandBuffers.resize(submittedCommandBuffers.size());
                    for (size_t i = 0; i < submittedCommandBuffers.size(); ++i)
                        rawCommandBuffers[i] = submittedCommandBuffers[i].second;
                    wgpuQueueSubmit(
                        state->queue, rawCommandBuffers.size(), rawCommandBuffers.data());
#if TN_ANDROID_JS_PROFILE
                    endProfiledBinding(state, ProfiledRenderCommand::Submit, submitStart);
                    state->profiling.androidJsNativeProfile.submits += 1;
#endif
                    replaySubmits += 1;
                    for (const auto& [id, commandBuffer] : submittedCommandBuffers) {
                        wgpuCommandBufferRelease(commandBuffer);
                        commandBuffers.erase(id);
                    }
#if TN_ANDROID_JS_PROFILE
                    const auto pollStart = beginProfiledBinding();
#endif
#if defined(MYSTRAL_WEBGPU_DAWN)
                    wgpuDeviceTick(state->device);
#elif defined(MYSTRAL_WEBGPU_WGPU)
                    wgpuDevicePoll(state->device, false, nullptr);
#endif
#if TN_ANDROID_JS_PROFILE
                    endProfiledBinding(state, ProfiledRenderCommand::DevicePoll, pollStart);
#endif
                }
                break;
            }
            case 30: {
                WGPUImageCopyTexture_Compat d{};
                readTextureCopy(d);
                if (!r.ok)
                    break;
                WGPUTextureDataLayout_Compat l{};
                l.offset = r.f64();
                l.bytesPerRow = r.u32();
                l.rowsPerImage = r.u32();
                auto z = readExtent();
                if (!r.ok)
                    break;
                if (!l.rowsPerImage)
                    l.rowsPerImage = z.height;
                const uint32_t n = r.u32();
                if (!r.ok)
                    break;
                if (n > r.remaining()) {
                    fail("upload payload exceeds record");
                    break;
                }
                flushUploadStaging(state);
                if (state->profiling.frameOpStreamNativeCallObserver)
                    state->profiling.frameOpStreamNativeCallObserver("writeTexture");
                wgpuQueueWriteTexture(state->queue, &d, data + r.cursor, n, &l, &z);
                r.cursor = (r.cursor + n + 7) & ~size_t(7);
                break;
            }
            case 31: {
                const uint32_t sourceWidth = r.u32(), sourceHeight = r.u32(), originX = r.u32();
                const uint32_t originY = r.u32(), flipY = r.u32();
                if (!r.ok)
                    break;
                WGPUImageCopyTexture_Compat d{};
                readTextureCopy(d);
                if (!r.ok)
                    break;
                auto z = readExtent();
                if (!r.ok)
                    break;
                const uint32_t n = r.u32();
                if (!r.ok)
                    break;
                const uint64_t sourcePixels = static_cast<uint64_t>(sourceWidth) * sourceHeight;
                const uint64_t sourceBytes = sourcePixels * 4;
                const uint64_t croppedPixels = static_cast<uint64_t>(z.width) * z.height;
                const uint64_t croppedBytes = croppedPixels * 4;
                if (!sourceWidth || !sourceHeight || n > r.remaining() ||
                    sourceBytes / 4 != sourcePixels || sourceBytes > n ||
                    croppedBytes / 4 != croppedPixels || croppedBytes > n ||
                    originX > sourceWidth || originY > sourceHeight ||
                    z.width > sourceWidth - originX || z.height > sourceHeight - originY ||
                    z.width > std::numeric_limits<uint32_t>::max() / 4) {
                    fail("external image payload bounds invalid");
                    break;
                }
                state->frameReplay.externalImageCrop.resize(static_cast<size_t>(croppedBytes));
                auto& cropped = state->frameReplay.externalImageCrop;
                for (uint32_t y = 0; y < z.height; y++) {
                    const uint32_t sourceY = flipY ? (originY + z.height - 1 - y) : (originY + y);
                    std::memcpy(cropped.data() + uint64_t(y) * z.width * 4,
                                data + r.cursor + (uint64_t(sourceY) * sourceWidth + originX) * 4,
                                uint64_t(z.width) * 4);
                }
                WGPUTextureDataLayout_Compat l{};
                l.bytesPerRow = z.width * 4;
                l.rowsPerImage = z.height;
                flushUploadStaging(state);
                if (state->profiling.frameOpStreamNativeCallObserver)
                    state->profiling.frameOpStreamNativeCallObserver("writeTexture");
                wgpuQueueWriteTexture(state->queue, &d, cropped.data(), cropped.size(), &l, &z);
                r.cursor = (r.cursor + n + 7) & ~size_t(7);
                break;
            }
            case 32: {
                const uint32_t id = r.u32();
                if (!r.ok)
                    break;
                if (state->registries.bufferRegistry.find(id) == state->registries.bufferRegistry.end())
                    fail("unknown buffer id");
                else {
                    flushUploadStaging(state);
                    releaseBufferRegistryEntry(state, id);
                }
                break;
            }
            case 33: {
                const uint32_t id = r.u32();
                if (!r.ok)
                    break;
                if (state->registries.textureRegistry.find(id) == state->registries.textureRegistry.end())
                    fail("unknown texture id");
                else {
                    flushUploadStaging(state);
                    releaseTextureRegistryEntry(state, id);
                }
                break;
            }
            // resolveQuerySet: the only way timestamps leave the query set for a buffer the game
            // can map. An unknown query set or buffer fails the frame; a resolve that quietly did
            // nothing leaves bytes that read exactly like a measurement of a very fast pass.
            case 34: {
                auto e = encoder(r.u32());
                if (!r.ok)
                    break;
                auto q = querySetFor(r.u32());
                if (!r.ok)
                    break;
                const uint32_t first = r.u32(), count = r.u32();
                auto dst = buffer(r.u32());
                if (!r.ok)
                    break;
                const double offset = r.f64();
                if (!r.ok)
                    break;
                if (!(offset >= 0.0)) {
                    fail("resolveQuerySet destinationOffset must be non-negative");
                    break;
                }
                wgpuCommandEncoderResolveQuerySet(e, q, first, count, dst,
                                                  static_cast<uint64_t>(offset));
                break;
            }
            default:
                fail("unsupported frame op opcode " + std::to_string(opcode));
                break;
        }
#if TN_ANDROID_JS_PROFILE
        switch (opcode) {
            case 1: endProfiledBinding(state, ProfiledRenderCommand::WriteBuffer, opProfileStart); break;
            case 4: endProfiledBinding(state, ProfiledRenderCommand::SetPipeline, opProfileStart); break;
            case 5: endProfiledBinding(state, ProfiledRenderCommand::SetBindGroup, opProfileStart); break;
            case 6: endProfiledBinding(state, ProfiledRenderCommand::SetVertexBuffer, opProfileStart); break;
            case 7: endProfiledBinding(state, ProfiledRenderCommand::SetIndexBuffer, opProfileStart); break;
            case 8: endProfiledBinding(state, ProfiledRenderCommand::Draw, opProfileStart); break;
            case 9: endProfiledBinding(state, ProfiledRenderCommand::DrawIndexed, opProfileStart); break;
            case 16: endProfiledBinding(state, ProfiledRenderCommand::ExecuteBundles, opProfileStart); break;
            case 17: endProfiledBinding(state, ProfiledRenderCommand::EndRenderPass, opProfileStart); break;
            default: break;
        }
#endif
        if (!r.ok) break;
        if (r.cursor > r.recordEnd) { fail("record length mismatch"); break; }
        for (size_t padding = r.cursor; padding < r.recordEnd; ++padding) {
            if (data[padding] != 0) { fail("non-zero record padding"); break; }
        }
        if (!r.ok) break;
        r.cursor = r.recordEnd;
    }
    flushUploadStaging(state);
    state->profiling.frameOpStreamLastOpCount = seen;
    if (r.ok && (!renderPasses.empty() || !renderOwners.empty() || !computePasses.empty() ||
                 !computeOwners.empty() || !encoders.empty() || !commandBuffers.empty())) {
        fail("frame ended with unfinished GPU objects");
    }
    if (!r.ok || seen != declaredOps || r.cursor != declaredBytes) {
        if (r.ok) fail("operation census mismatch");
        for (const auto& [id, pass] : renderPasses) {
            wgpuRenderPassEncoderEnd(pass);
            wgpuRenderPassEncoderRelease(pass);
        }
        for (const auto& [id, pass] : computePasses) {
            wgpuComputePassEncoderEnd(pass);
            wgpuComputePassEncoderRelease(pass);
        }
        for (const auto& [id, commandBuffer] : commandBuffers) {
            wgpuCommandBufferRelease(commandBuffer);
        }
        for (const auto& [id, commandEncoder] : encoders) {
            wgpuCommandEncoderRelease(commandEncoder);
        }
        renderPasses.clear();
        renderOwners.clear();
        computePasses.clear();
        computeOwners.clear();
        encoders.clear();
        commandBuffers.clear();
        submittedCommandBuffers.clear();
        rawCommandBuffers.clear();
        renderBundles.clear();
        return false;
    }
    state->profiling.submitCount += replaySubmits;
    if (state->surface && state->presentation.currentTexture && state->presentation.surfaceRenderPassEnded)
        state->presentation.framePresentPending = true;
    renderPasses.clear();
    renderOwners.clear();
    computePasses.clear();
    computeOwners.clear();
    encoders.clear();
    commandBuffers.clear();
    submittedCommandBuffers.clear();
    rawCommandBuffers.clear();
    renderBundles.clear();
    return true;
}

bool flushRecordedFrameOps(BindingsState* state) {
    if (!state || !state->engine || !state->profiling.frameOpStreamDrain.ptr) return true;
    if (state->profiling.frameOpStreamFlushing) return true;
    state->profiling.frameOpStreamFlushing = true;
    const auto frame = state->engine->call(state->profiling.frameOpStreamDrain,
                                           state->engine->newUndefined(),
                                           {state->engine->newNumber(1)});
    bool replayed = true;
    if (!state->engine->isNull(frame) && !state->engine->isUndefined(frame)) {
        state->profiling.frameOpStreamReplayCrossings += 1;
        replayed = replayPackedFrameOpStream(state, frame);
        if (!replayed && !state->engine->hasException())
            state->engine->throwException("frame op stream: replay failed");
    }
    state->profiling.frameOpStreamFlushing = false;
    return replayed;
}

#endif

}  // namespace mystral::webgpu
