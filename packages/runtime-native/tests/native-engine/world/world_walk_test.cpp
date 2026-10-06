#include "check.h"
#include "engine/player/world_walk.h"

#include <filesystem>
#include <fstream>
#include <iterator>

using namespace tn::engine;

namespace {
std::vector<uint8_t> read(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    CHECK(bool(in));
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}
void world_walk_fixture() {
    const std::filesystem::path root = TN_WORLD_WALK_FIXTURE;
    uint64_t total = 0;
    for (const auto& file : std::filesystem::directory_iterator(root))
        if (file.is_regular_file()) total += file.file_size();
    CHECK(total < 1024 * 1024);
    player::WorldWalk walk("world-walk", root); // the same manifest validation as the player
    CHECK(walk.snapshot().find("phase")->string() == "ready");
    CHECK(walk.game().renderEachTick);
    for (int cell = 0; cell < 4; ++cell) {
        const auto bytes = read(root / ("cell-" + std::to_string(cell) + ".tnpk"));
        assets::Package package;
        assets::PackageError failure;
        CHECK(assets::parsePackage(bytes, package, failure));
        CHECK(assets::verifyPackage(package, assets::targetDecoders(), failure));
        CHECK(package.entries.size() == 2);
        if (package.entries.size() != 2) continue;
        CHECK(package.entries[0].name == "positions" && package.entries[0].kind == 1 && package.entries[0].size == 72);
        CHECK(package.entries[1].name == "albedo" && package.entries[1].kind == 2 && package.entries[1].size == 16);
        CHECK(package.entries[0].uploadSize == 72 && package.entries[1].uploadSize == 4);
        const auto texture = package.data(package.entries[1]);
        CHECK(texture[0] == 1 && texture[4] == 1 && texture[8] == uint8_t(WGPUTextureFormat_RGBA8Unorm));
    }
    const auto corrupt = read(root / "cell-1-corrupt.tnpk");
    assets::Package package;
    assets::PackageError failure;
    CHECK(assets::parsePackage(corrupt, package, failure));
    CHECK(!assets::verifyPackage(package, assets::targetDecoders(), failure));
    CHECK(failure.code == "TN_PACKAGE_HASH");
    std::printf("world walk fixture: %llu bytes; four TNPK cells verified, corrupt cell refused as TN_PACKAGE_HASH\n",
                static_cast<unsigned long long>(total));
}
} // namespace

TN_TEST_MAIN({"world_walk_fixture", world_walk_fixture})
