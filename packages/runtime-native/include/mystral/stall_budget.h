#pragma once

// Attribution for the launch stall — the dark span between "the game finished loading" and
// "the player saw a frame".
//
// PRD-218 opens on a measured hole rather than a regression. On a Pixel 8 the fps-framework
// game reported `enterTotal:994` — one second of real asset and world load — and then presented
// nothing for **12.3 seconds**. Every marker the repository owned sat on one side of that span
// or the other: `TN_COLD_START game_eval_begin` at 196 ms, `TN_COLD_START first_frame` at
// 14,711 ms, and between them the process emitted not one line. `TN_FRAME_HITCH` reported the
// gap's width, which is the one thing that was never in doubt. Nobody could say what filled it,
// so PRD-214 excluded the same phenomenon from its windows as "startup-shaped" and moved on.
//
// This header is the instrument that makes the span speak. It accumulates wall time inside the
// native calls the first frame is known to serialise — pipeline and shader compilation, texture
// and buffer upload, queue submission — and reports them against the measured gap on the frame
// that finally presents. What it does not attribute it reports as residual, by subtraction and
// under that name, because a budget that quietly absorbed its own error would let the next
// unattributed twelve seconds look explained.
//
// The shape is deliberately dull and greppable, one line, on the first present:
//
//     TN_STALL_SEGMENTS:{"toFirstFrameMs":14711.455,"segments":{...},"attributedMs":...,
//                        "residualMs":...,"attributedShare":0.87}
//
// `attribute-launch-stall.mjs` parses that line and fails closed when it is missing or when the
// named segments cover too little of the gap. Removing the instrumentation therefore fails the
// instrument rather than silently reporting an unexplained launch, which is the intent.
//
// Cost: one `steady_clock::now()` pair per instrumented call and an add into a fixed array. The
// calls it wraps are microseconds at their cheapest and seconds at their worst, so the
// measurement cannot become the stall it measures. Accumulation stops at the first present —
// after that the counters are frozen and the scopes are two clock reads and a branch — with one
// deliberate exception (PRD-327 Phase 4): a *synchronous* pipeline compile on the main loop after
// the first present is the late-game hitch this instrument exists to name, so `PipelineCompile`
// keeps accumulating into a per-frame side accumulator that the hitch reporter drains on every
// present and reports inside `TN_FRAME_HITCH`. Every other segment stays frozen.

#include <array>
#include <chrono>
#include <cstdio>

#include "mystral/cold_start.h"

#ifdef __ANDROID__
#include <android/log.h>
#endif

namespace mystral {

/**
 * The named parts of the launch stall.
 *
 * Each one is a call the first rendered frame is known to make synchronously on the main loop.
 * They are named for what the work *is*, not for the binding that happens to host it, so a
 * segment survives a binding being moved or split.
 */
enum class StallSegment : int {
    /** `device.createRenderPipeline` / `createComputePipeline`, including descriptor translation. */
    PipelineCompile = 0,
    /** `device.createShaderModule` — WGSL parse and front-end compile. */
    ShaderCompile,
    /** `queue.writeTexture` and `device.createTexture` — the 346 MB the town uploads. */
    TextureUpload,
    /** `queue.writeBuffer` and `device.createBuffer` — geometry and uniforms. */
    BufferUpload,
    /** `queue.submit` — command translation and driver handoff. */
    QueueSubmit,
    Count,
};

inline constexpr int kStallSegmentCount = static_cast<int>(StallSegment::Count);

/** Wire names for the segments, in enum order. Kept beside the enum so the two cannot drift. */
inline constexpr std::array<const char*, kStallSegmentCount> kStallSegmentNames = {
    "pipelineCompile", "shaderCompile", "textureUpload", "bufferUpload", "queueSubmit",
};

/**
 * Accumulates the named segments and reports them once, against the measured gap.
 *
 * One instance per process. Nothing here allocates, and nothing logs until the report.
 */
class StallBudget {
  public:
    /** What one present's drain of the late-compile accumulator measured. */
    struct PostPresentCompile {
        double ms = 0.0;
        unsigned long long calls = 0;
    };

    /**
     * Adds `elapsedMs` to one segment.
     *
     * Once the launch has been reported the named totals freeze; only `PipelineCompile` keeps
     * counting, into the per-frame accumulator `takePostPresentPipelineCompile()` drains — the
     * late-game synchronous compile `TN_FRAME_HITCH` reports (PRD-327 Phase 4).
     */
    void add(StallSegment segment, double elapsedMs) {
        if (reported_) {
            if (segment == StallSegment::PipelineCompile) {
                postPresentPipelineCompileMs_ += elapsedMs;
                postPresentPipelineCompileCalls_ += 1;
            }
            return;
        }
        totals_[static_cast<int>(segment)] += elapsedMs;
        calls_[static_cast<int>(segment)] += 1;
    }

    /**
     * Returns the pipeline-compile time and call count accrued since the previous call, and
     * resets them — one drain per present, from the hitch reporter's call site.
     */
    PostPresentCompile takePostPresentPipelineCompile() {
        PostPresentCompile taken;
        taken.ms = postPresentPipelineCompileMs_;
        taken.calls = postPresentPipelineCompileCalls_;
        postPresentPipelineCompileMs_ = 0.0;
        postPresentPipelineCompileCalls_ = 0;
        return taken;
    }

    /** True once `report` has run, so the scopes can stop paying for a frozen budget. */
    bool reported() const { return reported_; }

    /**
     * Marks the instant the first frame's work began, and snapshots the counters at it.
     *
     * Everything before this instant is honest launch cost — process start, bundle evaluation,
     * asset load — and the game already reports it as `TN_FPS_BOOT_MS`. The stall is what happens
     * *after* the loop starts a frame and before that frame reaches the display, which is the span
     * `TN_FRAME_HITCH` reports as `gapMs` and the span this budget has to explain. Attributing
     * against the whole launch instead would credit the named segments with load time they did not
     * spend and, worse, would let a genuinely unexplained stall hide behind a slow asset read.
     *
     * Idempotent: only the first call counts.
     */
    void markFirstFrameBegan() {
        if (firstFrameBeganMs_ >= 0.0 || reported_) return;
        firstFrameBeganMs_ = coldStartNowMs();
        for (int index = 0; index < kStallSegmentCount; index += 1) {
            beforeFrame_[index] = totals_[index];
            beforeFrameCalls_[index] = calls_[index];
        }
    }

    /**
     * Emits the attribution for the launch, once, from the first present.
     *
     * `toFirstFrameMs` is the same clock `TN_COLD_START first_frame` stamps, so a reader can line
     * the two up without trusting two log timestamps from two different clocks.
     */
    void report(double toFirstFrameMs) {
        if (reported_) return;
        reported_ = true;

        // The span this budget owes an explanation for: the first frame's own duration, which is
        // what the player sat through after the loading screen stopped moving. A launch that never
        // reached markFirstFrameBegan attributes against the whole launch, which is the honest
        // fallback and says so by reporting `frameBeganAtMs` as -1.
        const bool haveFrameStart = firstFrameBeganMs_ >= 0.0;
        const double gapMs = haveFrameStart ? toFirstFrameMs - firstFrameBeganMs_ : toFirstFrameMs;

        double attributed = 0.0;
        double inGap[kStallSegmentCount] = {};
        unsigned long long gapCalls[kStallSegmentCount] = {};
        for (int index = 0; index < kStallSegmentCount; index += 1) {
            inGap[index] = haveFrameStart ? totals_[index] - beforeFrame_[index] : totals_[index];
            gapCalls[index] =
                haveFrameStart ? calls_[index] - beforeFrameCalls_[index] : calls_[index];
            attributed += inGap[index];
        }
        // Subtraction, not a sixth counter: the residual is by definition what the named segments
        // failed to explain, and a counter for it would be a claim rather than a remainder.
        const double residual = gapMs - attributed;
        const double share = gapMs > 0.0 ? attributed / gapMs : 0.0;

        char line[1400];
        int written = std::snprintf(
            line, sizeof(line),
            "TN_STALL_SEGMENTS:{\"toFirstFrameMs\":%.3f,\"frameBeganAtMs\":%.3f,\"gapMs\":%.3f,"
            "\"segments\":{",
            toFirstFrameMs, haveFrameStart ? firstFrameBeganMs_ : -1.0, gapMs);
        for (int index = 0; index < kStallSegmentCount && written > 0; index += 1) {
            written += std::snprintf(line + written, sizeof(line) - static_cast<size_t>(written),
                                     "%s\"%s\":{\"ms\":%.3f,\"calls\":%llu}", index == 0 ? "" : ",",
                                     kStallSegmentNames[static_cast<size_t>(index)], inGap[index],
                                     gapCalls[index]);
        }
        if (written > 0) {
            std::snprintf(line + written, sizeof(line) - static_cast<size_t>(written),
                          "},\"attributedMs\":%.3f,\"residualMs\":%.3f,\"attributedShare\":%.4f}",
                          attributed, residual, share);
        }

#ifdef __ANDROID__
        __android_log_print(ANDROID_LOG_INFO, "MystralColdStart", "%s", line);
#else
        std::printf("%s\n", line);
        std::fflush(stdout);
#endif
    }

  private:
    double totals_[kStallSegmentCount] = {};
    unsigned long long calls_[kStallSegmentCount] = {};
    double beforeFrame_[kStallSegmentCount] = {};
    unsigned long long beforeFrameCalls_[kStallSegmentCount] = {};
    double postPresentPipelineCompileMs_ = 0.0;
    unsigned long long postPresentPipelineCompileCalls_ = 0;
    double firstFrameBeganMs_ = -1.0;
    bool reported_ = false;
};

/** The process-wide budget. One launch, one report. */
inline StallBudget& stallBudget() {
    static StallBudget budget;
    return budget;
}

/**
 * Times one call into `segment` for as long as the scope lives.
 *
 * Deliberately a plain RAII type rather than a macro with a hidden name: these wrap bindings that
 * return early on error, and a scope guard is the only shape that survives every return path.
 */
class StallScope {
  public:
    explicit StallScope(StallSegment segment)
        : segment_(segment),
          active_(!stallBudget().reported() || segment == StallSegment::PipelineCompile) {
        if (active_) startMs_ = coldStartNowMs();
    }

    ~StallScope() {
        if (!active_) return;
        stallBudget().add(segment_, coldStartNowMs() - startMs_);
    }

    StallScope(const StallScope&) = delete;
    StallScope& operator=(const StallScope&) = delete;

  private:
    StallSegment segment_;
    bool active_;
    double startMs_ = 0.0;
};

}  // namespace mystral
