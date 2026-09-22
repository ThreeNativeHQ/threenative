// Android's presentation cap must be paced from the display, not the render thread's clock.
//
// This drives the production owner (`paceToPresentationCap`) with the same feed the Choreographer
// JNI callback calls. Display timestamps are synthetic nanoseconds, so the assertions are the
// pacing arithmetic and the condvar handoff, not wall-clock luck; only the pre-existing software
// fallback and bounded timeout are measured in real time.
//
// Pre-fix this file was compiled against the same production owner but fed nanoseconds as if they
// were milliseconds, so every display target was unreachable and the 83 ms fallback made the
// checks pass. The units and actual pacing path are now asserted explicitly.

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
using mystral::webgpu::PresentationPacingPath;
using mystral::webgpu::setPresentationCapHz;

// `notePresentationFrame` takes the raw Choreographer timestamp in nanoseconds, so a millisecond
// is a million of them. 60 Hz truncates to 16,666,666 ns.
constexpr int64_t frameMs(int64_t milliseconds) {
    return milliseconds * 1'000'000;
}
constexpr int64_t kFrame60Ns = 16'666'666;  // 1'000'000'000 / 60, truncated

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

std::future<PresentationPacingPath> runPaceAsync() {
    return std::async(std::launch::async, [] { return paceToPresentationCap(); });
}

// True when the paced call has returned by now.
bool paceReturned(std::future<PresentationPacingPath>& work, int milliseconds) {
    return work.wait_for(std::chrono::milliseconds(milliseconds)) == std::future_status::ready;
}

void checkPath(std::future<PresentationPacingPath>& work, PresentationPacingPath expected,
               const std::string& what) {
    const bool ready = paceReturned(work, 250);
    check(ready && work.get() == expected, what);
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
    check(paceToPresentationCap() == PresentationPacingPath::Uncapped, "maxFps 0 uses uncapped pacing");
    const auto elapsed = clock::now() - begin;
    check(elapsed < std::chrono::milliseconds(5), "maxFps 0 returns without waiting");
    notePresentationFramesStopped();
}

// Readiness: with no display signal (startup, or before the activity resumes) the pre-existing
// software deadline still paces. The first call schedules; the next one waits it out.
void testNoSignalUsesSoftwareDeadline() {
    resetPacing(60);
    check(paceToPresentationCap() == PresentationPacingPath::SoftwareDeadline,
          "no display signal schedules software pacing");
    const auto begin = clock::now();
    const auto path = paceToPresentationCap();  // must wait the software interval
    const auto elapsed = clock::now() - begin;
    check(elapsed >= std::chrono::milliseconds(8) && elapsed < std::chrono::milliseconds(250),
          "no display signal falls back to the software interval (waited " +
              std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()) +
              " ms)");
    check(path == PresentationPacingPath::SoftwareDeadline, "no display signal keeps software pacing");
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
    checkPath(work, PresentationPacingPath::Display, "the target display frame unblocks cap 60");
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
    checkPath(work, PresentationPacingPath::Display, "the exact fractional target unblocks display release");
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
    checkPath(work, PresentationPacingPath::Display, "cap 30 unblocks on the second display frame");
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
    checkPath(work, PresentationPacingPath::Display, "cap 120 unblocks on the first display frame");
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
    checkPath(late, PresentationPacingPath::Display, "a late display frame unblocks without waiting");
    auto next = runPaceAsync();
    check(!paceReturned(next, 8), "the next present reschedules one interval from the late frame");
    notePresentationFrame(frameMs(220));  // 200 + one interval is 216.67 ms
    checkPath(next, PresentationPacingPath::Display, "the rescheduled target unblocks");
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
    checkPath(next, PresentationPacingPath::Display, "the carried target releases on the display frame");
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
    checkPath(work, PresentationPacingPath::SoftwareDeadline, "pause unblocks the parked render thread");
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
    checkPath(lost, PresentationPacingPath::DisplayTimeoutFallback,
              "a lost display signal releases the present through the bounded wait");
    const auto boundedElapsed = clock::now() - boundedBegin;
    check(boundedElapsed >= std::chrono::milliseconds(60) && boundedElapsed < std::chrono::milliseconds(250),
          "the first lost-signal release is the bounded timeout, not a display frame");

    check(paceToPresentationCap() == PresentationPacingPath::SoftwareDeadline,
          "the next present retains software pacing instead of re-waiting the lost display");

    // A fresh callback re-arms display pacing; the first present schedules from it, the next waits.
    notePresentationFrame(frameMs(1000));
    check(paceToPresentationCap() == PresentationPacingPath::Display,
          "a fresh display frame schedules display pacing");
    auto rearmed = runPaceAsync();
    check(!paceReturned(rearmed, 8), "a fresh display frame re-arms display pacing");
    notePresentationFrame(frameMs(1000) + kFrame60Ns);
    checkPath(rearmed, PresentationPacingPath::Display, "the re-armed target unblocks on the display frame");
    notePresentationFramesStopped();
}

// Resume: a frame fed while the signal is stopped must not be remembered as the display, and
// once the activity starts the signal again the display path works.
void testStopThenStartReArmsDisplay() {
    resetPacing(60);
    notePresentationFramesStopped();
    notePresentationFrame(frameMs(1000));  // ignored: the signal is not running
    notePresentationFramesStarted();
    check(paceToPresentationCap() == PresentationPacingPath::SoftwareDeadline,
          "a frame fed while stopped is not remembered as the display");
    check(paceToPresentationCap() == PresentationPacingPath::SoftwareDeadline,
          "a stopped frame keeps software pacing");

    notePresentationFrame(frameMs(100));
    check(paceToPresentationCap() == PresentationPacingPath::Display,
          "restarting the display signal schedules display pacing");
    auto rearmed = runPaceAsync();
    check(!paceReturned(rearmed, 8), "restarting the display signal re-arms display pacing");
    notePresentationFrame(frameMs(120));
    checkPath(rearmed, PresentationPacingPath::Display, "the re-armed target unblocks on the display frame");
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
