// Pump-silence observer contract: no display, no GPU, no runtime.
//
// Proves the injected-clock logic of `mystral/pump_silence.h` directly:
// inter-entry retention with no filter and no windowing, the 64-cap with
// overflow counting, the once-only endpoint, and the fail-closed empty flush.
// Real-host retention (multi-pump gap, shutdown flush, SIGKILL absence) lives
// in `tests/pump-silence.test.mjs`, which drives the built desktop binary.

#include "mystral/pump_silence.h"

#include <cmath>
#include <cstdio>
#include <string>

namespace {

int failures = 0;

void expect(bool condition, const std::string& what, const std::string& detail = "") {
    if (condition) {
        std::printf("ok - %s\n", what.c_str());
        return;
    }
    failures += 1;
    std::printf("FAIL - %s%s%s\n", what.c_str(), detail.empty() ? "" : ": ", detail.c_str());
}

}  // namespace

int main() {
    // Inter-entry gap: 0 -> 10 -> 410 retains the 400 ms stall, keeps the max.
    {
        mystral::PumpSilenceObserver observer;
        observer.notePumpEntry(0.0);
        observer.notePumpEntry(10.0);
        observer.notePumpEntry(410.0);
        expect(observer.pumpCount() == 3, "three entries counted");
        expect(observer.maxGapMs() == 400.0, "max gap is the 400 ms stall");
        expect(observer.firstPumpAtMs() == 0.0, "first pump anchors process-to-first-pump");
        expect(observer.retainedLongGaps() == 1, "one long gap retained");
    }
    // Never-entered control: the empty observer stays empty, so a missing
    // observation can never read as a small-but-present maximum.
    {
        mystral::PumpSilenceObserver empty;
        expect(empty.pumpCount() == 0, "never-entered pump stays at zero");
        expect(empty.maxGapMs() == 0.0, "never-entered max stays zero");
        expect(empty.retainedLongGaps() == 0, "never-entered retains nothing");
    }
    // Cap: the global max survives past 64 retained gaps; overflow is counted.
    {
        mystral::PumpSilenceObserver observer;
        observer.notePumpEntry(0.0);
        double at = 0.0;
        for (int i = 0; i < 70; ++i) {
            at += 300.0;
            observer.notePumpEntry(at);
        }
        expect(observer.maxGapMs() == 300.0, "max survives past the retain cap");
        expect(observer.retainedLongGaps() == mystral::PumpSilenceObserver::kMaxRetainedGaps,
               "retained gaps stop at the cap");
        expect(observer.droppedLongGaps() == 6, "overflow counted, not dropped silently",
               std::to_string(observer.droppedLongGaps()));
    }
    // Endpoint: once-only. A first-frame flush suppresses the shutdown one,
    // so a launch emits exactly one line; shutdown still flushes a run that
    // never presented.
    {
        mystral::PumpSilenceObserver observer;
        observer.notePumpEntry(100.0);
        observer.flush(150.0);
        expect(observer.flushed(), "first flush marks the endpoint");
        observer.flush(999.0);
        expect(observer.flushed(), "second flush is a no-op");
        mystral::PumpSilenceObserver unpresented;
        unpresented.notePumpEntry(50.0);
        expect(!unpresented.flushed(), "shutdown path still open without a present");
        unpresented.flush(400.0);
        expect(unpresented.flushed(), "shutdown flush closes the endpoint");
    }
    // Non-positive gaps are not intervals: a backwards clock step advances
    // the counters but must not move the maximum or the retained list.
    {
        mystral::PumpSilenceObserver observer;
        observer.notePumpEntry(100.0);
        observer.notePumpEntry(90.0);
        observer.notePumpEntry(500.0);
        expect(observer.pumpCount() == 3, "backwards step still counts entries");
        expect(observer.maxGapMs() == 410.0, "backwards step does not set the max",
               std::to_string(observer.maxGapMs()));
        expect(observer.retainedLongGaps() == 1, "backwards step is not retained");
    }
    // Requested snapshot: non-consuming. A displacement-correlated endpoint
    // must not suppress the once-only diagnostic lines or reset counters.
    {
        mystral::PumpSilenceObserver observer;
        observer.notePumpEntry(10.0);
        observer.notePumpEntry(20.0);
        const std::string first = observer.snapshot(30.0);
        const std::string second = observer.snapshot(40.0);
        expect(!observer.flushed(), "snapshots never mark the endpoint");
        expect(observer.pumpCount() == 2, "snapshots preserve counter state");
        expect(first.find("\"atMs\":30.000") != std::string::npos, "snapshot stamps the request time",
               first);
        expect(second.find("\"atMs\":40.000") != std::string::npos, "later snapshot moves forward",
               second);
        expect(first.find("\"trailingGapMs\":10.000") != std::string::npos,
               "snapshot measures the trailing interval", first);
    }
    if (failures == 0) std::printf("pump-silence contract passed\n");
    return failures == 0 ? 0 : 1;
}
