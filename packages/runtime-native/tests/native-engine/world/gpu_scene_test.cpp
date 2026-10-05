// PRD-521: every recorded `cullAndSelect`, `cullAndSelectShadow` and `liveKeyInstances` result
// reproduces over the native GPU-scene CPU oracle. The table is generated from
// packages/core/src/world-gpu-scene.ts (packages/runtime-native/tests/native-engine/world/
// gpu-scene-reference.ts): each scene is a placement buffer, a slot/region table and a list of
// camera (and shadow) steps, and the reference's own result for each. Every f32 word is stored as
// its 32-bit pattern and every double as its 64-bit pattern and compares bit for bit, except that
// any two NaNs are equal.
#include "check.h"
#include "engine/renderer/lod/model_lod.h"
#include "engine/world/gpu_scene/gpu_scene.h"

#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <iterator>
#include <string>
#include <string_view>
#include <vector>

using namespace tn::engine::world;

namespace {

struct RefLevel {
    uint32_t firstKey;
    uint32_t parts;
};
struct RefSlot {
    const uint64_t* distances;
    std::size_t distanceCount;
    bool hasCull;
    uint64_t cull;
    const RefLevel* levels;
    std::size_t levelCount;
    bool impostor;
};
struct RefRegion {
    uint32_t start;
    uint32_t capacity;
    uint32_t argsIndex;
    uint32_t local[16];
    uint32_t indexCount;
};
struct RefPlacement {
    uint32_t matrix[16];
    uint32_t centre[4];
    int32_t slot;
    uint64_t scale;
};
struct RefCamera {
    uint32_t planes[24];
    uint64_t x, y, z;
};
struct RefShadow {
    uint32_t planes[24];
    uint64_t centreX, centreZ, gate;
    int32_t base;
};
struct RefRun {
    uint32_t count;
    const uint32_t* words;
};
struct RefStep {
    RefCamera camera;
    bool shadow;
    RefShadow shadowLevel;
    const uint32_t* args;
    const uint32_t* counts;
    const RefRun* runs;
    uint64_t bias;
};
struct RefScene {
    const RefPlacement* placements;
    std::size_t placementCount;
    uint32_t count;
    const RefSlot* slots;
    std::size_t slotCount;
    const RefRegion* regions;
    std::size_t regionCount;
    const RefStep* steps;
    std::size_t stepCount;
};
struct RefLiveLevel {
    const uint32_t* words;
    std::size_t partCount;
};
struct RefLiveAsset {
    const char* id;
    const uint64_t* distances;
    std::size_t distanceCount;
    bool hasCull;
    uint64_t cull;
    bool impostor;
    const RefLiveLevel* levels;
    std::size_t levelCount;
};
struct RefLiveRun {
    const char* key;
    const uint32_t* words;
    std::size_t wordCount;
};
struct RefLiveCase {
    const RefPlacement* placements;
    std::size_t placementCount;
    const RefLiveAsset* assets;
    std::size_t assetCount;
    RefCamera camera;
    const RefLiveRun* runs;
    std::size_t runCount;
};

#include "gpu_scene_reference.inc"

constexpr double doubleFromBits(uint64_t bits) { return std::bit_cast<double>(bits); }
constexpr float floatFromBits(uint32_t bits) { return std::bit_cast<float>(bits); }

// Bit-exact, except that every NaN is the same value: the reference is JavaScript, whose NaN
// payloads are not distinguishable, and an arithmetic NaN's sign bit is the hardware's.
bool sameFloat(float got, float want) {
    return std::bit_cast<uint32_t>(got) == std::bit_cast<uint32_t>(want) ||
           (std::isnan(got) && std::isnan(want));
}

GpuSceneSlot buildSlot(const RefSlot& ref) {
    GpuSceneSlot slot;
    slot.distances.reserve(ref.distanceCount);
    for (std::size_t i = 0; i < ref.distanceCount; ++i)
        slot.distances.push_back(doubleFromBits(ref.distances[i]));
    slot.hasCull = ref.hasCull;
    slot.cull = doubleFromBits(ref.cull);
    slot.levels.reserve(ref.levelCount);
    for (std::size_t i = 0; i < ref.levelCount; ++i)
        slot.levels.push_back(GpuSceneLevel{ref.levels[i].firstKey, ref.levels[i].parts});
    slot.impostor = ref.impostor;
    return slot;
}

GpuSceneRegion buildRegion(const RefRegion& ref) {
    GpuSceneRegion region;
    region.start = ref.start;
    region.capacity = ref.capacity;
    region.argsIndex = ref.argsIndex;
    for (std::size_t i = 0; i < 16; ++i)
        region.local[i] = floatFromBits(ref.local[i]);
    region.indexCount = ref.indexCount;
    return region;
}

GpuScenePlacement buildPlacement(const RefPlacement& ref) {
    GpuScenePlacement placement;
    for (std::size_t i = 0; i < 16; ++i)
        placement.matrix[i] = floatFromBits(ref.matrix[i]);
    for (std::size_t i = 0; i < 4; ++i)
        placement.centre[i] = floatFromBits(ref.centre[i]);
    placement.slot = ref.slot;
    placement.scale = doubleFromBits(ref.scale);
    return placement;
}

GpuSceneCamera buildCamera(const RefCamera& ref) {
    GpuSceneCamera camera;
    for (std::size_t i = 0; i < 24; ++i)
        camera.planes[i] = floatFromBits(ref.planes[i]);
    camera.x = doubleFromBits(ref.x);
    camera.y = doubleFromBits(ref.y);
    camera.z = doubleFromBits(ref.z);
    return camera;
}

GpuSceneShadowLevel buildShadow(const RefShadow& ref) {
    GpuSceneShadowLevel level;
    for (std::size_t i = 0; i < 24; ++i)
        level.planes[i] = floatFromBits(ref.planes[i]);
    level.centreX = doubleFromBits(ref.centreX);
    level.centreZ = doubleFromBits(ref.centreZ);
    level.gate = doubleFromBits(ref.gate);
    level.base = ref.base;
    return level;
}

void gpuScene() {
    std::size_t compared = 0;
    std::size_t mismatched = 0;

    for (std::size_t sceneIndex = 0; sceneIndex < std::size(kGpuSceneScenes); ++sceneIndex) {
        const RefScene& ref = kGpuSceneScenes[sceneIndex];
        GpuSceneInput input;
        input.placements.reserve(ref.placementCount);
        for (std::size_t i = 0; i < ref.placementCount; ++i)
            input.placements.push_back(buildPlacement(ref.placements[i]));
        input.count = ref.count;
        input.slots.reserve(ref.slotCount);
        for (std::size_t i = 0; i < ref.slotCount; ++i)
            input.slots.push_back(buildSlot(ref.slots[i]));
        input.regions.reserve(ref.regionCount);
        for (std::size_t i = 0; i < ref.regionCount; ++i)
            input.regions.push_back(buildRegion(ref.regions[i]));
        input.regionCount = static_cast<uint32_t>(ref.regionCount);

        for (std::size_t stepIndex = 0; stepIndex < ref.stepCount; ++stepIndex) {
            const RefStep& step = ref.steps[stepIndex];
            input.camera = buildCamera(step.camera);
            tn::engine::lod::setLodBias(doubleFromBits(step.bias));
            const GpuSceneResult got =
                step.shadow ? cullAndSelectShadow(input, buildShadow(step.shadowLevel))
                            : cullAndSelect(input);
            tn::engine::lod::setLodBias(1);
            ++compared;

            bool ok = true;
            for (std::size_t i = 0; i < ref.regionCount * kGpuSceneDrawArgsWords && ok; ++i)
                ok = got.args[i] == step.args[i];
            for (std::size_t regionIndex = 0; regionIndex < ref.regionCount && ok; ++regionIndex) {
                const RefRun& run = step.runs[regionIndex];
                if (got.counts[regionIndex] != step.counts[regionIndex] || got.counts[regionIndex] != run.count) {
                    ok = false;
                    break;
                }
                for (uint32_t taken = 0; taken < run.count && ok; ++taken) {
                    const std::size_t at = (static_cast<std::size_t>(ref.regions[regionIndex].start) + taken) * 16;
                    for (std::size_t word = 0; word < 16 && ok; ++word)
                        ok = sameFloat(got.drawn[at + word], floatFromBits(run.words[taken * 16 + word]));
                }
            }
            if (!ok) {
                ++mismatched;
                std::fprintf(stderr, "scene %zu step %zu differed\n", sceneIndex, stepIndex);
            }
        }
    }

    {
        const RefLiveCase& ref = kGpuSceneLive;
        std::vector<GpuScenePlacement> placements;
        placements.reserve(ref.placementCount);
        for (std::size_t i = 0; i < ref.placementCount; ++i)
            placements.push_back(buildPlacement(ref.placements[i]));
        std::vector<GpuSceneLiveAsset> assets;
        assets.reserve(ref.assetCount);
        for (std::size_t i = 0; i < ref.assetCount; ++i) {
            const RefLiveAsset& source = ref.assets[i];
            GpuSceneLiveAsset asset;
            asset.id = std::string_view(source.id);
            asset.distances.reserve(source.distanceCount);
            for (std::size_t d = 0; d < source.distanceCount; ++d)
                asset.distances.push_back(doubleFromBits(source.distances[d]));
            asset.hasCull = source.hasCull;
            asset.cull = doubleFromBits(source.cull);
            asset.impostor = source.impostor;
            for (std::size_t level = 0; level < source.levelCount; ++level) {
                const RefLiveLevel& parts = source.levels[level];
                std::vector<std::array<float, kGpuSceneLocalWords>> locals;
                locals.reserve(parts.partCount);
                for (std::size_t part = 0; part < parts.partCount; ++part) {
                    std::array<float, kGpuSceneLocalWords> local{};
                    for (std::size_t word = 0; word < 16; ++word)
                        local[word] = floatFromBits(parts.words[part * 16 + word]);
                    locals.push_back(local);
                }
                asset.locals.push_back(std::move(locals));
            }
            assets.push_back(std::move(asset));
        }
        const std::vector<GpuSceneLiveRun> got =
            liveKeyInstances(placements, assets, buildCamera(ref.camera));
        ++compared;
        bool ok = got.size() == ref.runCount;
        if (ok)
            for (std::size_t i = 0; i < ref.runCount; ++i) {
                if (got[i].key != ref.runs[i].key || got[i].words.size() != ref.runs[i].wordCount) {
                    ok = false;
                    break;
                }
                for (std::size_t word = 0; word < ref.runs[i].wordCount; ++word)
                    if (!sameFloat(got[i].words[word], floatFromBits(ref.runs[i].words[word]))) {
                        ok = false;
                        break;
                    }
            }
        if (!ok) {
            ++mismatched;
            std::fprintf(stderr, "live case differed\n");
        }
    }

    std::printf("gpu scene: %zu steps, %zu differ\n", compared, mismatched);
    CHECK(compared > 0 && mismatched == 0);
}

} // namespace

TN_TEST_MAIN({"gpu_scene", gpuScene})
