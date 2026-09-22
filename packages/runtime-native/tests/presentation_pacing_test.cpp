// Android's presentation cap must be paced from the display, not the render thread's clock.
//
// This drives the production owner (`paceToPresentationCap`) with the same feed the Choreographer
// JNI callback calls. Display timestamps are synthetic nanoseconds, so the assertions are the
// pacing arithmetic and the condvar handoff, not wall-clock luck; only the pre-existing software
// fallback is measured in real time. The measured runtime baseline is retained in the PRD, not
// restated here.
//
// Pre-fix this file was compiled against the same production owner but fed nanoseconds as if they
// were milliseconds, so every display target was unreachable and the 83 ms fallback made the
// checks pass. The units are now explicit, display release is bounded well below that fallback,
// and the lost-signal case fails until the schedule is dropped on timeout.

#include "mystral/webgpu/bindings.h"
#include "../src/webgpu/bindings_presentation.h"

#include <chrono>
#include <future>
#include <iostream>
#include <string>
#include <vector>

namespace {

using mystral::webgpu::notePresentationFrame;
using mystral::webgpu::notePresentationFramesStarted;
using mystral::webgpu::notePresentationFramesStopped;
using mystral::webgpu::paceToPresentationCap;
using mystral::webgpu::setPresentationCapHz;

// `notePresentationFrame` takes the raw Choreographer timestamp in nanoseconds, so a millisecond
// is a million of them. 60 Hz truncates to 16,666,666 ns.
constexpr int64_t frameMs(int64_t milliseconds) {
    return milliseconds * 1'000'000;
}
constexpr int64_t kFrame60Ns = 16'666'666;  // 1'000'000'000 / 60, truncated

// A display release wakes the parked worker through the condition variable, so it returns in well
// under a millisecond; the lost-signal fallback takes the 83 ms timeout. A bound of 50 ms tells
// the two apart and would have caught the earlier false pass that allowed 250 ms.
constexpr int kDisplayReleaseMs = 50;

std::vector<std::string> failures;

void check(bool condition, const std::string& what) {
    if (condition) {
        std::cout << "PASS " << what << '\n';
        return;
    }
    failures.push_back(what);
    std::cerr << "FAIL " << what << '\n';
}

using clock = std::chrono::steady_clock;

std::future<void> runPaceAsync() {
    return std::async(std::launch::async, [] { paceToPresentationCap(); });
}

// True when the paced call has returned by now. `wait_for` observes the handoff, so it is the same
// answer under load: the worker is either blocked in the wait or it is done.
bool paceReturned(std::future<void>& work, int milliseconds) {
    return work.wait_for(std::chrono::milliseconds(milliseconds)) == std::future_status::ready;
}

// Leaves the global pacing state clean for the next case, and never leaves a worker parked: the
// stop notification is what the activity sends on pause.
void resetPacing(uint32_t capHz) {
    notePresentationFramesStopped();
    setPresentationCapHz(capHz);
}

// Uncapped: the only way a game presents above the ceiling is maxFps 0, and it must not wait,
// even with a live display signal.
void testUncappedIgnoresDisplay() {
    resetPacing(0);
    notePresentationFramesStarted();
    notePresentationFrame(frameMs(1));
    const auto begin = clock::now();
    paceToPresentationCap();
    const auto elapsed = clock::now() - begin;
    check(elapsed < std::chrono::milliseconds(5), "maxFps 0 returns without waiting");
    notePresentationFramesStopped();
}

// Readiness: with no display signal (startup, or before the activity resumes) the pre-existing
// software deadline still paces. The first call schedules; the next one waits it out.
void testNoSignalUsesSoftwareDeadline() {
    resetPacing(60);
    paceToPresentationCap();  // first paced frame: schedule, no wait
    const auto begin = clock::now();
    paceToPresentationCap();  // must wait the software interval
    const auto elapsed = clock::now() - begin;
    check(elapsed >= std::chrono::milliseconds(8) && elapsed < std::chrono::milliseconds(250),
          "no display signal falls back to the software interval (waited " +
              std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()) +
              " ms)");
    notePresentationFramesStopped();
}

// cap == panel refresh: wait exactly one display frame. Feeding a display frame short of the
// target must not unblock, and the target frame must -- the difference between one present per
// vsync and the extra-frame double sleep that would halve the visible rate.
void testCapAtRefreshWaitsOneFrame() {
    resetPacing(60);  // interval 16,666,666 ns
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // schedule target 16,666,666
    auto work = runPaceAsync();
    check(!paceReturned(work, 8), "cap 60 is still waiting before the target frame");
    notePresentationFrame(frameMs(8));  // short of 16.67 ms
    check(!paceReturned(work, 8), "a display frame short of the target does not unblock");
    notePresentationFrame(frameMs(20));  // the first frame at or past the target
    check(paceReturned(work, kDisplayReleaseMs),
          "the target display frame unblocks cap 60 (display release, not the 83 ms fallback)");
    notePresentationFramesStopped();
}

// Fractional interval: the 60 Hz period is not a whole millisecond. A frame one nanosecond short
// of the truncated target must not unblock, and the exact target must -- the remainder is carried
// in nanoseconds, not rounded away.
void testFractionalTargetResolvesAtExactTarget() {
    resetPacing(60);
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // target 16,666,666 ns
    auto work = runPaceAsync();
    check(!paceReturned(work, 8), "cap 60 waits for the exact fractional target");
    notePresentationFrame(kFrame60Ns - 1);
    check(!paceReturned(work, 8), "a frame one nanosecond short of the fractional target does not unblock");
    notePresentationFrame(kFrame60Ns);
    check(paceReturned(work, kDisplayReleaseMs), "the exact fractional target unblocks display release");
    notePresentationFramesStopped();
}

// cap below panel refresh: skip display frames, not present twice-a-frame. A 30 cap on a 60 Hz
// display waits two display periods, so it must ignore the first frame after the target and
// unblock only on the second.
void testBelowRefreshCapSkipsFrames() {
    resetPacing(30);  // interval 33,333,333 ns
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // schedule target 33,333,333
    auto work = runPaceAsync();
    check(!paceReturned(work, 10), "cap 30 waits before the target frame");
    notePresentationFrame(frameMs(16));  // one display period: not enough
    check(!paceReturned(work, 10), "cap 30 ignores the first display frame");
    notePresentationFrame(frameMs(34));  // the second display period
    check(paceReturned(work, kDisplayReleaseMs), "cap 30 unblocks on the second display frame");
    notePresentationFramesStopped();
}

// cap above panel refresh: the display is the ceiling. A 120 cap on a 60 Hz display still waits
// one display frame -- not zero (which would busy-spin past the panel) and not two.
void testAboveRefreshCapStaysPanelLimited() {
    resetPacing(120);  // interval 8,333,333 ns, shorter than the 16.67 ms display period
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // schedule target 8,333,333
    auto work = runPaceAsync();
    check(!paceReturned(work, 5), "cap 120 waits for a display frame, it does not busy-spin");
    notePresentationFrame(frameMs(16));  // one display period
    check(paceReturned(work, kDisplayReleaseMs), "cap 120 unblocks on the first display frame");
    notePresentationFramesStopped();
}

// A late frame reschedules forward instead of asking for a catch-up burst, and the next present
// waits one interval from that late frame.
void testLateFrameReschedulesWithoutBurst() {
    resetPacing(60);
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // target 16,666,666
    auto late = runPaceAsync();
    notePresentationFrame(frameMs(200));  // the loop fell far behind the schedule
    check(paceReturned(late, kDisplayReleaseMs), "a late display frame unblocks without waiting");
    auto next = runPaceAsync();
    check(!paceReturned(next, 8), "the next present reschedules one interval from the late frame");
    notePresentationFrame(frameMs(220));  // 200 + one interval is 216.67 ms
    check(paceReturned(next, kDisplayReleaseMs), "the rescheduled target unblocks");
    notePresentationFramesStopped();
}

// Carried remainder when the display frame already arrived: if a display frame is past the
// scheduled target before pace is called, the next target must advance from that target
// (20 + 20 == 40 ms), not reset from the frame just seen (33.33 + 20 == 53.33 ms). Rescheduling
// from the frame loses the remainder and parks the following present past the display frame that
// should have released it, until the 90 ms bounded timeout.
void testAlreadyArrivedFrameCarriesSchedule() {
    resetPacing(50);  // interval 20,000,000 ns; timeout 2*20 + 50 == 90 ms
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // schedule target 20,000,000
    notePresentationFrame(frameMs(33) + 333'333);  // 33,333,333 ns: past the target before pace
    paceToPresentationCap();  // target must advance to 40,000,000, not reset to 53,333,333
    auto next = runPaceAsync();
    check(!paceReturned(next, 8), "the next present waits for the carried target");
    notePresentationFrame(frameMs(50));  // 50,000,000 ns is past the 40 ms carried target
    check(paceReturned(next, kDisplayReleaseMs),
          "the carried target releases on the display frame, before the 90 ms timeout");
    notePresentationFramesStopped();
}

// Lifecycle: pause must unblock a render thread parked on the display wait, well before the
// bounded timeout would, so the loop can reach Android's own lifecycle wait. A stop is exactly
// what the activity sends before it removes the callback.
void testPauseUnblocksWaiter() {
    resetPacing(60);  // timeout is 2 intervals + 50 ms == 83 ms
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // target 16,666,666
    auto work = runPaceAsync();
    check(!paceReturned(work, 10), "the render thread is parked on the display wait");
    const auto begin = clock::now();
    notePresentationFramesStopped();
    check(paceReturned(work, 250), "pause unblocks the parked render thread");
    const auto elapsed = clock::now() - begin;
    check(elapsed < std::chrono::milliseconds(60),
          "pause unblocks before the wait timeout (took " +
              std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()) +
              " ms)");
}

// Lost signal: the activity stops feeding frames without pausing. The first present may wait out
// the bounded timeout once, but every later present must retain software pacing -- not re-wait
// that same timeout -- until a fresh display frame arrives, which must re-arm the display path
// rather than stay disabled.
void testLostSignalFallsBackAndRecovers() {
    resetPacing(60);  // timeout is 2 intervals + 50 ms == 83 ms
    notePresentationFramesStarted();
    notePresentationFrame(0);
    paceToPresentationCap();  // schedule target 16,666,666
    auto lost = runPaceAsync();
    check(!paceReturned(lost, 8), "the present is parked waiting for the display frame");
    const auto boundedBegin = clock::now();
    check(paceReturned(lost, 250), "a lost display signal releases the present through the bounded wait");
    const auto boundedElapsed = clock::now() - boundedBegin;
    check(boundedElapsed >= std::chrono::milliseconds(60) && boundedElapsed < std::chrono::milliseconds(250),
          "the first lost-signal release is the bounded timeout, not a display frame");

    const auto fallbackBegin = clock::now();
    paceToPresentationCap();  // must retain software pacing, not re-wait the display timeout
    const auto fallbackElapsed = clock::now() - fallbackBegin;
    check(fallbackElapsed < std::chrono::milliseconds(60),
          "the next present retains software pacing instead of re-waiting the lost display (took " +
              std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(fallbackElapsed).count()) +
              " ms)");

    // A fresh callback re-arms display pacing; the first present schedules from it, the next waits.
    notePresentationFrame(frameMs(1000));
    paceToPresentationCap();  // re-arm: schedule target 1016.67 ms, no wait
    auto rearmed = runPaceAsync();
    check(!paceReturned(rearmed, 8), "a fresh display frame re-arms display pacing");
    notePresentationFrame(frameMs(1000) + kFrame60Ns);
    check(paceReturned(rearmed, kDisplayReleaseMs), "the re-armed target unblocks on the display frame");
    notePresentationFramesStopped();
}

// Resume: a frame fed while the signal is stopped must not be remembered as the display, and
// once the activity starts the signal again the display path works.
void testStopThenStartReArmsDisplay() {
    resetPacing(60);
    notePresentationFramesStopped();
    notePresentationFrame(frameMs(1000));  // ignored: the signal is not running
    notePresentationFramesStarted();
    paceToPresentationCap();  // no remembered frame, so this is the software schedule
    const auto begin = clock::now();
    paceToPresentationCap();
    const auto elapsed = clock::now() - begin;
    check(elapsed < std::chrono::milliseconds(60),
          "a frame fed while stopped is not remembered as the display");

    notePresentationFrame(frameMs(100));
    paceToPresentationCap();  // display path: schedule target 116.67 ms
    auto rearmed = runPaceAsync();
    check(!paceReturned(rearmed, 8), "restarting the display signal re-arms display pacing");
    notePresentationFrame(frameMs(120));
    check(paceReturned(rearmed, kDisplayReleaseMs), "the re-armed target unblocks on the display frame");
    notePresentationFramesStopped();
}

}  // namespace

int main() {
    testUncappedIgnoresDisplay();
    testNoSignalUsesSoftwareDeadline();
    testCapAtRefreshWaitsOneFrame();
    testFractionalTargetResolvesAtExactTarget();
    testBelowRefreshCapSkipsFrames();
    testAboveRefreshCapStaysPanelLimited();
    testLateFrameReschedulesWithoutBurst();
    testAlreadyArrivedFrameCarriesSchedule();
    testPauseUnblocksWaiter();
    testLostSignalFallsBackAndRecovers();
    testStopThenStartReArmsDisplay();

    if (failures.empty()) {
        std::cout << "PRESENTATION_PACING_OK\n";
        return 0;
    }
    std::cerr << failures.size() << " presentation pacing check(s) failed\n";
    return 1;
}
