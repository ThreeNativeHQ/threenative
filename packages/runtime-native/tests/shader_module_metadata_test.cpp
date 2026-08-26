#include "../src/webgpu/bindings_state.h"

#include <cstdlib>
#include <iostream>
#include <unordered_set>

namespace {

std::unordered_set<WGPUShaderModule> releasedModules;

void recordRelease(WGPUShaderModule module) {
    if (!releasedModules.insert(module).second) {
        std::cerr << "shader-module-metadata: native module released twice" << std::endl;
        std::abort();
    }
}

}  // namespace

int main() {
    auto store = std::make_shared<mystral::webgpu::ShaderModuleMetadataStore>();
    std::weak_ptr<mystral::webgpu::ShaderModuleMetadataStore> weakStore = store;
    const auto first = reinterpret_cast<WGPUShaderModule>(static_cast<uintptr_t>(1));
    const auto second = reinterpret_cast<WGPUShaderModule>(static_cast<uintptr_t>(2));
    store->entries[first] = {"vertexFirst", "fragmentFirst"};
    store->entries[second] = {"vertexSecond", "fragmentSecond"};

    if (!store->release(first, &recordRelease) ||
        store->release(first, &recordRelease) ||
        store->entries.size() != 1 ||
        releasedModules != std::unordered_set<WGPUShaderModule>{first}) {
        std::cerr << "shader-module-metadata: wrapper release contract failed" << std::endl;
        return EXIT_FAILURE;
    }

    store->releaseAll(&recordRelease);
    if (!store->entries.empty() ||
        releasedModules != std::unordered_set<WGPUShaderModule>{first, second}) {
        std::cerr << "shader-module-metadata: teardown release contract failed" << std::endl;
        return EXIT_FAILURE;
    }

    store.reset();
    if (!weakStore.expired()) {
        std::cerr << "shader-module-metadata: store outlived its binding state" << std::endl;
        return EXIT_FAILURE;
    }

    std::cout << "shader-module-metadata: wrapper=erase+release-once teardown=release-survivors"
              << std::endl;
    return EXIT_SUCCESS;
}
