#pragma once

#include <string>

namespace mystral::cli {

struct LightmapOptions {
    std::string scriptPath;
    std::string outputPath;
    int bakeResolution = 2048;
    int bakeSamples = 64;
    int bakeBounces = 2;
    bool quiet = false;
    bool debug = false;
};

int bakeLightmaps(const LightmapOptions& options);

}  // namespace mystral::cli
