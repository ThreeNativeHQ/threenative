#include "mystral/video/video_recorder.h"

#include <cstdint>
#include <iostream>

namespace {

WGPUDevice fakeDevice() { return reinterpret_cast<WGPUDevice>(static_cast<uintptr_t>(1)); }
WGPUQueue fakeQueue() { return reinterpret_cast<WGPUQueue>(static_cast<uintptr_t>(1)); }
WGPUInstance fakeInstance() { return reinterpret_cast<WGPUInstance>(static_cast<uintptr_t>(1)); }

}  // namespace

// The GPU readback recorder dereferences the WebGPU bindings state during capture, so it must
// refuse to be built without one rather than fail later inside a frame.
//
// This drives `createGpuReadback` rather than `create`. `create` prefers ScreenCaptureKit on
// macOS and Windows.Graphics.Capture on Windows, and neither consults the bindings state at all —
// on those platforms `create` returns an OS recorder and never reaches the rule under test. The
// previous version of this test asserted that `create` returned null, which is only true on a
// platform with no OS capture; it passed on Linux and failed on macOS for the correct reason.
int main() {
    if (mystral::video::VideoRecorder::createGpuReadback(
            fakeDevice(), fakeQueue(), fakeInstance(), nullptr)) {
        std::cerr << "video recorder accepted a missing WebGPU bindings state" << std::endl;
        return 1;
    }

    // The same refusal for the WebGPU handles the recorder needs.
    if (mystral::video::VideoRecorder::createGpuReadback(
            nullptr, fakeQueue(), fakeInstance(), fakeInstance())) {
        std::cerr << "video recorder accepted a missing WebGPU device" << std::endl;
        return 1;
    }

    std::cout << "native video recorder missing-state guard passed" << std::endl;
    return 0;
}
