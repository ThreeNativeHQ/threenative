#include <iostream>

#include "mystral/webgpu/bindings.h"
#include "../src/webgpu/bindings_state.h"

int main() {
    auto* first = mystral::webgpu::createBindingsState();
    auto* second = mystral::webgpu::createBindingsState();
    if (!first || !second || first == second) return 1;

    first->presentCount = 2;
    second->presentCount = 7;
    first->frameEndCount = 11;
    second->frameEndCount = 19;

    const bool independent =
        mystral::webgpu::presentCount(first) == 2 &&
        mystral::webgpu::presentCount(second) == 7 &&
        first->frameEndCount == 11 &&
        second->frameEndCount == 19;
    mystral::webgpu::destroyBindingsState(first);
    mystral::webgpu::destroyBindingsState(second);
    if (!independent) return 1;

    std::cout << "native WebGPU bindings reentrancy passed" << std::endl;
    return 0;
}
