#pragma once

// Pump-silence observation for PRD-360.
//
// PRD-360 asks for "no event-pump silence >250 ms" across launch. `HostGapMeter`
// (`runtime.cpp`) cannot answer it: it is keyed to rAF dispatch (a compile stall
// registers no frame callback), drops every period over 2 s, and reports only
// after a full 300-sample window. `TN_FRAME_HITCH` opens after the first present,
// so it cannot see the pre-first-frame stall either.
//
// This observer stamps every `pollEvents()` entry on the `coldStartNowMs()`
// clock — unconditionally at the head, before the `kEvents` bracket, so the
// platform-poll, lifecycle-termination and paused early returns are all covered
// — and retains the maximum gap plus every gap >= 250 ms with no filter and no
// windowing. One `TN_PUMP_SILENCE` line is emitted at the bounded endpoint (the
// first present, beside `first_frame`); nothing is logged per frame and nothing
// here changes scheduling, quality, or scene work. `HostGapMeter` semantics are
// untouched: it answers steady-state attribution, this answers launch silence.
//
// Fail-closed shape: a run whose pump never entered emits no line, and a flush
// with zero entries reports `"observed":false`. A harness must treat a missing
// line — or `observed:false` — as failure, never as a pass. A pump that stalls
// and never resumes never reaches the endpoint, so it cannot report a small
// retained maximum as success.
//
// Production call sites pass `coldStartNowMs()` explicitly, so unit probes can
// drive the same code with a deterministic injected clock.
//
// Threading: poll entry, first-present, and loop-exit all run on the one game
// thread, so no mutex. A worker-thread caller would corrupt the counts.

#include <cstdio>
#include <string>
#include <vector>

#ifdef __ANDROID__
#include <android/log.h>
#endif

namespace mystral {

class PumpSilenceObserver {
  public:
    /** A gap worth retaining: the PRD-360 acceptance threshold. */
    static constexpr double kLongGapMs = 250.0;
    /** Bound on retained long gaps; overflow is counted, never silently dropped. */
    static constexpr size_t kMaxRetainedGaps = 64;

    /** Stamp one pump entry. `nowMs` is `coldStartNowMs()` at `pollEvents()` head. */
    void notePumpEntry(double nowMs) {
        if (pumpCount_ == 0) firstPumpAtMs_ = nowMs;
        if (pumpCount_ > 0) {
            const double gapMs = nowMs - lastPumpAtMs_;
            // A non-positive gap means the clock went backwards between two
            // entries; it is not a short interval and must not move the
            // maximum or the retained list. Counters still advance.
            if (gapMs > 0) {
                if (gapMs > maxGapMs_) {
                    maxGapMs_ = gapMs;
                    maxGapAtMs_ = lastPumpAtMs_;
                }
                if (gapMs >= kLongGapMs) {
                    if (longGaps_.size() < kMaxRetainedGaps) {
                        longGaps_.push_back(gapMs);
                    } else {
                        droppedLongGaps_ += 1;
                    }
                }
            }
        }
        lastPumpAtMs_ = nowMs;
        pumpCount_ += 1;
    }

    /**
     * Non-consuming snapshot of the current state at `nowMs`, for the
     * displacement-correlated endpoint. Unlike `flush()` it preserves counter
     * state: a requested endpoint snapshot must never suppress the once-only
     * first-present/shutdown diagnostic lines.
     */
    std::string snapshot(double nowMs) const {
        const bool observed = pumpCount_ > 0;
        const double trailingGapMs = observed ? (nowMs - lastPumpAtMs_) : -1.0;
        std::string out = "{\"observed\":";
        out += observed ? "true" : "false";
        out += ",\"pumpCount\":" + std::to_string(pumpCount_);
        out += ",\"firstPumpAtMs\":" + toFixed(firstPumpAtMs_);
        out += ",\"lastPumpAtMs\":" + toFixed(observed ? lastPumpAtMs_ : -1.0);
        out += ",\"maxGapMs\":" + toFixed(maxGapMs_);
        out += ",\"maxGapAtMs\":" + toFixed(maxGapAtMs_);
        out += ",\"trailingGapMs\":" + toFixed(trailingGapMs);
        out += ",\"atMs\":" + toFixed(nowMs);
        out += ",\"longGaps\":[";
        for (size_t i = 0; i < longGaps_.size(); ++i) {
            if (i > 0) out += ",";
            out += toFixed(longGaps_[i]);
        }
        out += "],\"droppedLongGaps\":" + std::to_string(droppedLongGaps_) + "}";
        return out;
    }

    /**
     * Emit the bounded observation. `nowMs` is `coldStartNowMs()` at the
     * endpoint, so the trailing interval since the last entry is measured
     * rather than dropped. Emits once; later calls are no-ops.
     */
    void flush(double nowMs) {
        if (flushed_) return;
        flushed_ = true;
        const bool observed = pumpCount_ > 0;
        const double trailingGapMs = observed ? (nowMs - lastPumpAtMs_) : -1.0;
        std::string out = "{\"observed\":";
        out += observed ? "true" : "false";
        out += ",\"pumpCount\":" + std::to_string(pumpCount_);
        out += ",\"firstPumpAtMs\":" + toFixed(firstPumpAtMs_);
        out += ",\"lastPumpAtMs\":" + toFixed(observed ? lastPumpAtMs_ : -1.0);
        out += ",\"maxGapMs\":" + toFixed(maxGapMs_);
        out += ",\"maxGapAtMs\":" + toFixed(maxGapAtMs_);
        out += ",\"trailingGapMs\":" + toFixed(trailingGapMs);
        out += ",\"longGaps\":[";
        for (size_t i = 0; i < longGaps_.size(); ++i) {
            if (i > 0) out += ",";
            out += toFixed(longGaps_[i]);
        }
        out += "],\"droppedLongGaps\":" + std::to_string(droppedLongGaps_) + "}";
        const std::string marker = "TN_PUMP_SILENCE:" + out;
#ifdef __ANDROID__
        __android_log_print(ANDROID_LOG_INFO, "MystralColdStart", "%s", marker.c_str());
#else
        std::printf("%s\n", marker.c_str());
        std::fflush(stdout);
#endif
    }

    // Introspection for unit probes (injected clocks). Not on any transport.
    unsigned long long pumpCount() const { return pumpCount_; }
    double maxGapMs() const { return maxGapMs_; }
    double firstPumpAtMs() const { return firstPumpAtMs_; }
    double lastPumpAtMs() const { return lastPumpAtMs_; }
    size_t retainedLongGaps() const { return longGaps_.size(); }
    unsigned long long droppedLongGaps() const { return droppedLongGaps_; }
    bool flushed() const { return flushed_; }

  private:
    static std::string toFixed(double value) {
        char buffer[32];
        std::snprintf(buffer, sizeof(buffer), "%.3f", value);
        return std::string(buffer);
    }

    unsigned long long pumpCount_ = 0;
    double firstPumpAtMs_ = -1.0;
    double lastPumpAtMs_ = -1.0;
    double maxGapMs_ = 0.0;
    double maxGapAtMs_ = -1.0;
    std::vector<double> longGaps_;
    unsigned long long droppedLongGaps_ = 0;
    bool flushed_ = false;
};

/** Process-wide observer. One launch, one endpoint, one report. */
inline PumpSilenceObserver& pumpSilence() {
    static PumpSilenceObserver observer;
    return observer;
}

}  // namespace mystral
