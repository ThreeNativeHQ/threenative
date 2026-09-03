// After the first present, a synchronous pipeline compile on the main loop is a named hitch.
//
// PRD-327 Phase 4. The launch stall budget freezes at the first present — before PRD-327 that was
// where the story ended, because every pipeline compiled there: 8,038 ms across 105 calls on a
// Pixel 8. Real async compilation (Phase 1) moved the launch's compiles off the main loop, but a
// material that appears mid-game still compiles synchronously inside a frame, and after the first
// present `stall_budget.h` no longer counts it — the player feels an anonymous 200 ms spike and
// the record says nothing. This is the shape test for the two halves of the fix: the budget keeps
// a per-frame `pipelineCompile` accumulator after it has reported, the hitch reporter reads and
// resets it on every present, and `TN_FRAME_HITCH` carries `{pipelineCompileMs,
// pipelineCompileCalls}` for its window.
//
// It is a contract test, not a benchmark: no GPU, no device, no timing assertion — the numbers it
// feeds are synthetic and the assertions are about which numbers reach which report.

#include "mystral/cold_start.h"
#include "mystral/stall_budget.h"

#include <cstdio>
#include <cstring>
#include <string>

#if !defined(_WIN32)
#include <unistd.h>
#endif

namespace {

/**
 * Captures everything the instruments print to stdout while the guard lives.
 *
 * `TN_STALL_SEGMENTS` and `TN_FRAME_HITCH` are printf'd on desktop — the payload is the contract,
 * and the only way to assert on a payload is to read it off the stream the reader would read.
 */
class StdoutCapture {
  public:
    StdoutCapture() {
#if !defined(_WIN32)
        std::fflush(stdout);
        file_ = std::tmpfile();
        saved_ = ::dup(STDOUT_FILENO);
        ::dup2(fileno(file_), STDOUT_FILENO);
#else
        (void)file_;
        (void)saved_;
#endif
    }

    ~StdoutCapture() {
#if !defined(_WIN32)
        std::fflush(stdout);
        ::dup2(saved_, STDOUT_FILENO);
        ::close(saved_);
#endif
    }

    std::string text() {
#if !defined(_WIN32)
        std::fflush(stdout);
        rewind(file_);
        std::string out;
        char buffer[4096];
        size_t read = 0;
        while ((read = std::fread(buffer, 1, sizeof(buffer), file_)) > 0) out.append(buffer, read);
        return out;
#else
        return {};
#endif
    }

    StdoutCapture(const StdoutCapture&) = delete;
    StdoutCapture& operator=(const StdoutCapture&) = delete;

  private:
    std::FILE* file_ = nullptr;
    int saved_ = -1;
};

int failures = 0;

void expect(bool condition, const std::string& what, const std::string& detail = "") {
    if (condition) {
        std::printf("ok - %s\n", what.c_str());
        return;
    }
    failures += 1;
    std::printf("FAIL - %s%s%s\n", what.c_str(), detail.empty() ? "" : ": ", detail.c_str());
}

bool contains(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}

}  // namespace

int main() {
    // ---- The launch itself still attributes as before -------------------------------
    // Guard: the post-present accumulator must not disturb the launch report's shape, which
    // `attribute-launch-stall.mjs` parses and fails closed on.
    std::string launchLine;
    {
        StdoutCapture capture;
        mystral::stallBudget().add(mystral::StallSegment::PipelineCompile, 100.0);
        mystral::stallBudget().add(mystral::StallSegment::ShaderCompile, 50.0);
        mystral::stallBudget().markFirstFrameBegan();
        // Everything before the mark is launch work the frame did not pay for; the report
        // attributes the gap, not the whole launch, so a post-mark compile is what shows up.
        mystral::stallBudget().add(mystral::StallSegment::PipelineCompile, 10.0);
        mystral::stallBudget().add(mystral::StallSegment::TextureUpload, 10.0);
        const double firstFrameMs = mystral::coldStartNowMs() + 40.0;
        mystral::stallBudget().report(firstFrameMs);
        launchLine = capture.text();
    }
    expect(contains(launchLine, "TN_STALL_SEGMENTS:"), "launch report emits TN_STALL_SEGMENTS",
           launchLine);
    expect(contains(launchLine, "\"pipelineCompile\":{\"ms\":10.000,\"calls\":1"),
           "the gap's pipelineCompile is the post-mark 10 ms only", launchLine);
    expect(contains(launchLine, "\"attributedShare\""), "launch report carries its attribution share",
           launchLine);

    // ---- Post-present compiles accumulate, and reading them resets them -------------
    // The launch has been reported; the scopes for PipelineCompile stay live and every further
    // main-loop compile lands in the per-frame accumulator the hitch reporter drains.
    mystral::stallBudget().add(mystral::StallSegment::PipelineCompile, 12.5);
    mystral::stallBudget().add(mystral::StallSegment::PipelineCompile, 3.5);
    // A post-present shader compile is NOT this instrument's subject: the launch budget stays
    // frozen for every other segment, or the first frame's numbers would keep growing forever.
    mystral::stallBudget().add(mystral::StallSegment::ShaderCompile, 99.0);

    const mystral::StallBudget::PostPresentCompile drained =
        mystral::stallBudget().takePostPresentPipelineCompile();
    expect(drained.ms > 15.9 && drained.ms < 16.1, "post-present compile total is 16 ms",
           std::to_string(drained.ms));
    expect(drained.calls == 2, "post-present compile call count is 2", std::to_string(drained.calls));

    const mystral::StallBudget::PostPresentCompile drainedAgain =
        mystral::stallBudget().takePostPresentPipelineCompile();
    expect(drainedAgain.ms == 0.0 && drainedAgain.calls == 0,
           "the read resets the per-frame accumulator",
           "second read was " + std::to_string(drainedAgain.ms) + " ms / " +
               std::to_string(drainedAgain.calls) + " calls");

    // ---- The hitch window carries the compile it covered ---------------------------
    // Mirror the production call site exactly: every present drains the per-frame accumulator
    // into the hitch sample, and the window summary carries the window's totals.
    std::string hitchLine;
    {
        StdoutCapture capture;
        // The first record after a launch only starts the clock (there is no interval to sample
        // yet), exactly as the first present does; prime it so the window below closes in here.
        mystral::frameHitches().record(
            mystral::stallBudget().takePostPresentPipelineCompile().ms, 0);
        for (int frame = 0; frame < mystral::FrameHitchRecorder::kWindow; frame += 1) {
            if (frame == 5) mystral::stallBudget().add(mystral::StallSegment::PipelineCompile, 16.0);
            const mystral::StallBudget::PostPresentCompile perFrame =
                mystral::stallBudget().takePostPresentPipelineCompile();
            mystral::frameHitches().record(perFrame.ms, perFrame.calls);
        }
        hitchLine = capture.text();
    }
    expect(contains(hitchLine, "TN_FRAME_HITCH:"), "the hitch window emits TN_FRAME_HITCH",
           hitchLine);
    expect(contains(hitchLine, "\"pipelineCompileMs\":16.000"),
           "the hitch names the pipelineCompile milliseconds it covered", hitchLine);
    expect(contains(hitchLine, "\"pipelineCompileCalls\":1"),
           "the hitch names the pipelineCompile call count it covered", hitchLine);

    // The process-wide singletons are one launch, one window, one report; anything after the
    // window is dropped rather than attributed to a window that already closed.
    mystral::stallBudget().add(mystral::StallSegment::PipelineCompile, 500.0);
    mystral::frameHitches().record(500.0, 1);
    expect(true, "records past the window are accepted and dropped without crashing");

    if (failures == 0) {
        std::printf("TN_STALL_HITCH_TEST:{\"pass\":true}\n");
        std::printf("native stall budget hitch contract passed\n");
        return 0;
    }
    std::printf("TN_STALL_HITCH_TEST:{\"pass\":false,\"failures\":%d}\n", failures);
    return 1;
}
