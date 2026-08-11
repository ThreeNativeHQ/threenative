#pragma once

// Cold-start segment markers.
//
// PRD-070 opens on a hole rather than a regression: nothing in this repository measured launch
// time, so a 4x change in it could ship unnoticed the way a 50x frame-rate change already had.
// Every marker below is one boundary in the launch, stamped from a single monotonic clock so a
// reader subtracts two numbers rather than two log timestamps from two different clocks.
//
// The shape is deliberately dull and greppable:
//
//     TN_COLD_START:{"segment":"compile_begin","atMs":1234.567}
//
// `measure-cold-start.mjs` requires every segment it knows about and fails closed on a missing
// one. Adding a marker here without teaching that script about it is harmless; removing or
// renaming one fails the instrument, which is the intent.

#include <chrono>
#include <cstdio>

#ifdef __ANDROID__
#include <android/log.h>
#endif

namespace mystral {

/** Milliseconds from an arbitrary but process-stable origin. */
inline double coldStartNowMs() {
    static const std::chrono::steady_clock::time_point origin = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - origin)
        .count();
}

/** Emits one launch-boundary marker. Cheap enough to leave compiled in on every build. */
inline void coldStartMark(const char* segment) {
    const double atMs = coldStartNowMs();
#ifdef __ANDROID__
    __android_log_print(ANDROID_LOG_INFO, "MystralColdStart",
                        "TN_COLD_START:{\"segment\":\"%s\",\"atMs\":%.3f}", segment, atMs);
#else
    std::printf("TN_COLD_START:{\"segment\":\"%s\",\"atMs\":%.3f}\n", segment, atMs);
    std::fflush(stdout);
#endif
}

/**
 * Records the first frames after the first present and reports the distribution once.
 *
 * A hitch is a distribution claim, never a mean: the cost this exists to catch is one 400 ms
 * frame at second three, and an average over the same window hides it completely. So the report
 * carries the maximum and the frame it landed on, plus p50 and p99 for context.
 *
 * The window is fixed and allocated once. Nothing here allocates or logs per frame — the whole
 * point is an instrument that can stay compiled in without becoming the hitch it measures.
 */
class FrameHitchRecorder {
  public:
    static constexpr int kWindow = 300;

    /** Call once per presented frame. Emits the summary on the frame that closes the window. */
    void record() {
        const double now = coldStartNowMs();
        if (previousMs_ < 0.0) {
            previousMs_ = now;
            return;
        }
        const double frameMs = now - previousMs_;
        previousMs_ = now;
        if (count_ >= kWindow) return;
        samples_[count_] = frameMs;
        count_ += 1;
        if (count_ == kWindow) report();
    }

  private:
    void report() {
        double sorted[kWindow];
        for (int index = 0; index < kWindow; index += 1) sorted[index] = samples_[index];
        // Insertion sort: 300 elements, once per launch, and it keeps the header dependency-free.
        for (int index = 1; index < kWindow; index += 1) {
            const double value = sorted[index];
            int slot = index - 1;
            while (slot >= 0 && sorted[slot] > value) {
                sorted[slot + 1] = sorted[slot];
                slot -= 1;
            }
            sorted[slot + 1] = value;
        }
        double worst = 0.0;
        int worstAt = -1;
        for (int index = 0; index < kWindow; index += 1) {
            if (samples_[index] > worst) {
                worst = samples_[index];
                worstAt = index;
            }
        }
        const double p50 = sorted[kWindow / 2];
        const double p99 = sorted[(kWindow * 99) / 100];
        const char* format =
            "TN_FRAME_HITCH:{\"window\":%d,\"maxMs\":%.3f,\"maxAtFrame\":%d,\"p99Ms\":%.3f,"
            "\"p50Ms\":%.3f}";
#ifdef __ANDROID__
        __android_log_print(ANDROID_LOG_INFO, "MystralColdStart", format, kWindow, worst, worstAt,
                            p99, p50);
#else
        std::printf(format, kWindow, worst, worstAt, p99, p50);
        std::printf("\n");
        std::fflush(stdout);
#endif
    }

    double samples_[kWindow] = {};
    double previousMs_ = -1.0;
    int count_ = 0;
};

/** The process-wide recorder. One launch, one window, one report. */
inline FrameHitchRecorder& frameHitches() {
    static FrameHitchRecorder recorder;
    return recorder;
}

}  // namespace mystral
