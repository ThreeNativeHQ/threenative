#include "mystral/video/video_recorder.h"

#include <cstdint>
#include <iostream>

int main() {
    auto recorder = mystral::video::VideoRecorder::create(
        reinterpret_cast<WGPUDevice>(static_cast<uintptr_t>(1)),
        reinterpret_cast<WGPUQueue>(static_cast<uintptr_t>(1)),
        reinterpret_cast<WGPUInstance>(static_cast<uintptr_t>(1)),
        nullptr);
    if (recorder) {
        std::cerr << "video recorder accepted a missing WebGPU bindings state" << std::endl;
        return 1;
    }
    std::cout << "native video recorder missing-state guard passed" << std::endl;
    return 0;
}
