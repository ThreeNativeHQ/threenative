#pragma once

#include <string>
#include <vector>

namespace mystral::cli {

struct BundlerOptions {
    std::string scriptPath;
    std::vector<std::string> assetDirs;
    std::string outputPath;
    std::string rootDir;
    bool bundleOnly = false;
    bool quiet = false;
};

int compileBundle(const BundlerOptions& options);

}  // namespace mystral::cli
