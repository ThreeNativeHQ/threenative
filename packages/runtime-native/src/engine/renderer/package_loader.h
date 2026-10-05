#pragma once

#include <string>
#include <vector>

#include "engine/assets/package.h"
#include "engine/renderer/gpu_resources.h"

namespace tn::engine {

/** One verified package entry made resident on the GPU. */
struct LoadedEntry {
    std::string name;
    Handle resource;
};

/**
 * Uploads a package that already passed verifyPackage (PRD-515 phase 2): Buffer entries become
 * GPU buffers, Texture entries GPU textures. Other kinds are left to their owners (scene, mesh,
 * material loaders). Fails closed: a malformed texture header or an upload refusal stops the load.
 */
bool loadPackage(const assets::Package& package, GpuResources& gpu, std::vector<LoadedEntry>& out, assets::PackageError& error);

}  // namespace tn::engine
