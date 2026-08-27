#pragma once

/**
 * PRD-226 ablation arms.
 *
 * Each arm removes exactly one layer from the real frame so the budget can be obtained by
 * subtraction instead of by sampling attribution. Sampling gave three different owners for the same
 * frame (loop-log F8, F12, F13) and five levers built on it delivered nothing.
 *
 * TN_ABLATE_BACKEND — the hot render-command entry points become no-ops that still evaluate their
 * arguments. JavaScript, the trampoline, wrapper creation and argument parsing all run exactly as
 * they do at HEAD; only the backend call and the GPU work it causes disappear. The frame stays
 * structurally valid (begin/end/submit and resource creation are untouched), so the run completes
 * and presents — it just presents the wrong picture. An ablation arm is not a visual-correctness
 * run and its screenshot proves liveness, not output.
 *
 * Both flags default OFF and are asserted absent from every shipped preset. A build with either one
 * defined is a measurement build and must never ship.
 */

#if defined(TN_ABLATE_BACKEND) && TN_ABLATE_BACKEND

// Pull in the real declarations first. The macros below rewrite these names, so every declaration
// must already exist — a later include of the same header is a no-op through its own guard.
#include <webgpu/webgpu.h>

namespace tn::ablation {
/** Evaluates every argument, then discards it — the call's cost is removed, its inputs are not. */
template <typename... Ts>
inline void sink(Ts&&...) {}
}  // namespace tn::ablation

#define TN_ABLATE_SINK(...) ::tn::ablation::sink(__VA_ARGS__)

// Render-pass command recording — the per-draw hot path.
#define wgpuRenderPassEncoderSetPipeline(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderSetBindGroup(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderSetVertexBuffer(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderSetIndexBuffer(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderDraw(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderDrawIndexed(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderSetViewport(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderPassEncoderSetScissorRect(...) TN_ABLATE_SINK(__VA_ARGS__)

// Uniform and attribute uploads — the highest-frequency single crossing on this scene.
#define wgpuQueueWriteBuffer(...) TN_ABLATE_SINK(__VA_ARGS__)

// Render bundles record the same commands through a second encoder type.
#define wgpuRenderBundleEncoderSetPipeline(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderBundleEncoderSetBindGroup(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderBundleEncoderSetVertexBuffer(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderBundleEncoderSetIndexBuffer(...) TN_ABLATE_SINK(__VA_ARGS__)
#define wgpuRenderBundleEncoderDrawIndexed(...) TN_ABLATE_SINK(__VA_ARGS__)

#endif  // TN_ABLATE_BACKEND
