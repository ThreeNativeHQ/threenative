#include "bundler.h"
#include "lightmap.h"

#include <iostream>
#include <string>
#include <cstdlib>

namespace {

void printUsage() {
    std::cerr << "Usage: mystral-tools compile <entry.js> [options]\n"
              << "       mystral-tools bake <input.glb|input.js> [options]\n";
}

bool takeValue(int& index, int argc, char** argv, std::string& value) {
    if (index + 1 >= argc) return false;
    value = argv[++index];
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        printUsage();
        return 1;
    }

    std::string command;
    mystral::cli::BundlerOptions bundler;
    mystral::cli::LightmapOptions lightmap;
    if (const char* runtime = std::getenv("THREENATIVE_RUNTIME_EXECUTABLE"); runtime && *runtime) {
        bundler.runtimePath = runtime;
    }

    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if ((arg == "compile" || arg == "--compile" || arg == "bake") && command.empty()) {
            command = arg == "bake" ? "bake" : "compile";
        } else if ((arg == "--include" || arg == "--assets") && index + 1 < argc) {
            std::string value;
            takeValue(index, argc, argv, value);
            bundler.assetDirs.push_back(value);
        } else if ((arg == "--output" || arg == "--out" || arg == "-o") && index + 1 < argc) {
            std::string value;
            takeValue(index, argc, argv, value);
            bundler.outputPath = value;
            lightmap.outputPath = value;
        } else if (arg == "--root" && index + 1 < argc) {
            takeValue(index, argc, argv, bundler.rootDir);
        } else if (arg == "--resolution" && index + 1 < argc) {
            lightmap.bakeResolution = std::stoi(argv[++index]);
        } else if (arg == "--samples" && index + 1 < argc) {
            lightmap.bakeSamples = std::stoi(argv[++index]);
        } else if (arg == "--bounces" && index + 1 < argc) {
            lightmap.bakeBounces = std::stoi(argv[++index]);
        } else if (arg == "--bundle-only") {
            bundler.bundleOnly = true;
        } else if (arg == "--quiet" || arg == "-q") {
            bundler.quiet = true;
            lightmap.quiet = true;
        } else if (arg == "--debug") {
            lightmap.debug = true;
        } else if (arg == "--help" || arg == "-h") {
            printUsage();
            return 0;
        } else if (!arg.empty() && arg.front() != '-') {
            if (bundler.scriptPath.empty()) bundler.scriptPath = arg;
            if (lightmap.scriptPath.empty()) lightmap.scriptPath = arg;
        } else {
            std::cerr << "Warning: Unknown option '" << arg << "'" << std::endl;
        }
    }

    if (command == "compile") {
        if (bundler.scriptPath.empty()) {
            std::cerr << "Error: No input file specified for compile." << std::endl;
            printUsage();
            return 1;
        }
        return mystral::cli::compileBundle(bundler);
    }
    if (command == "bake") {
        if (lightmap.scriptPath.empty()) {
            std::cerr << "Error: No input file specified for bake." << std::endl;
            printUsage();
            return 1;
        }
        return mystral::cli::bakeLightmaps(lightmap);
    }

    printUsage();
    return 1;
}
