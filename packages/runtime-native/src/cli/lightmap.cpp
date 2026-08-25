#include "lightmap.h"

#include "mystral/runtime.h"

#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace mystral::cli {

/**
 * Bake lightmaps for a scene.
 * Generates a JavaScript wrapper that invokes the TypeScript lightmap baker.
 */
int bakeLightmaps(const LightmapOptions& opts) {
    namespace fs = std::filesystem;

    if (opts.scriptPath.empty()) {
        std::cerr << "Error: No input file specified for bake." << std::endl;
        std::cerr << "Usage: mystral bake <input.glb|input.js> --output <dir>" << std::endl;
        return 1;
    }

    fs::path inputPath = opts.scriptPath;
    if (!fs::exists(inputPath)) {
        std::cerr << "Error: Input file not found: " << inputPath << std::endl;
        return 1;
    }

    // Determine output directory
    std::string outputDir = opts.outputPath.empty() ? "./lightmaps" : opts.outputPath;

    if (!opts.quiet) {
        std::cout << "=== Mystral Lightmap Baker ===" << std::endl;
        std::cout << "Input: " << inputPath << std::endl;
        std::cout << "Output: " << outputDir << std::endl;
        std::cout << "Resolution: " << opts.bakeResolution << std::endl;
        std::cout << "Samples: " << opts.bakeSamples << std::endl;
        std::cout << "Bounces: " << opts.bakeBounces << std::endl;
        std::cout << std::endl;
    }

    // Generate a temporary JavaScript file that loads the scene and bakes
    std::string extension = inputPath.extension().string();
    bool isGLB = (extension == ".glb" || extension == ".GLB" ||
                  extension == ".gltf" || extension == ".GLTF");

    std::string bakerScript;
    if (isGLB) {
        // Generate script to load GLB and bake
        bakerScript = R"(
import { Engine } from 'mystral';
import { GLBLoader } from 'mystral/loaders/GLBLoader';
import { LightmapBaker } from 'mystral/tools/lightmap-baker';

async function main() {
    console.log('[Bake] Starting lightmap bake...');

    // Initialize engine in headless mode
    const engine = new Engine({ headless: true, width: 1, height: 1 });
    await engine.init();

    // Load GLB
    const loader = new GLBLoader(engine.device);
    const result = await loader.load(')" + inputPath.string() + R"(');

    console.log('[Bake] Scene loaded:', result.rootNode.name);

    // Create baker and bake
    const baker = new LightmapBaker(engine.device);
    const bakeResult = await baker.bake({
        scene: result.rootNode,
        resolution: )" + std::to_string(opts.bakeResolution) + R"(,
        samples: )" + std::to_string(opts.bakeSamples) + R"(,
        bounces: )" + std::to_string(opts.bakeBounces) + R"(,
        onProgress: (progress, message) => {
            console.log(`[Bake] ${Math.round(progress * 100)}% - ${message}`);
        },
    });

    // Save results
    await bakeResult.save(')" + outputDir + R"(');

    console.log('[Bake] Complete! Lightmaps saved to: )" + outputDir + R"(');
    console.log('[Bake] Manifest:', JSON.stringify(bakeResult.manifest, null, 2));

    process.exit(0);
}

main().catch(err => {
    console.error('[Bake] Error:', err);
    process.exit(1);
});
)";
    } else {
        // Input is a JS file - execute it directly but inject baker context
        std::ifstream inputFile(inputPath);
        if (!inputFile.is_open()) {
            std::cerr << "Error: Cannot read input file: " << inputPath << std::endl;
            return 1;
        }
        std::stringstream buffer;
        buffer << inputFile.rdbuf();
        std::string userScript = buffer.str();

        bakerScript = R"(
import { LightmapBaker } from 'mystral/tools/lightmap-baker';

// User's scene setup script
)" + userScript + R"(

// Bake function injected by CLI
async function __mystralBake(scene) {
    const baker = new LightmapBaker();
    const bakeResult = await baker.bake({
        scene: scene,
        resolution: )" + std::to_string(opts.bakeResolution) + R"(,
        samples: )" + std::to_string(opts.bakeSamples) + R"(,
        bounces: )" + std::to_string(opts.bakeBounces) + R"(,
        onProgress: (progress, message) => {
            console.log(`[Bake] ${Math.round(progress * 100)}% - ${message}`);
        },
    });

    await bakeResult.save(')" + outputDir + R"(');
    console.log('[Bake] Complete! Lightmaps saved to: )" + outputDir + R"(');
}

// Export for use by scene script
globalThis.__mystralBake = __mystralBake;
)";
    }

    // Write temporary script
    std::error_code ec;
    fs::path tempDir = fs::temp_directory_path(ec);
    if (ec) {
        std::cerr << "Error: Cannot get temp directory" << std::endl;
        return 1;
    }

    fs::path tempScript = tempDir / ("mystral-bake-" + std::to_string(std::time(nullptr)) + ".js");
    std::ofstream tempFile(tempScript);
    if (!tempFile.is_open()) {
        std::cerr << "Error: Cannot create temp script file" << std::endl;
        return 1;
    }
    tempFile << bakerScript;
    tempFile.close();

    if (!opts.quiet) {
        std::cout << "[Bake] Executing baker script..." << std::endl;
    }

    // Create runtime and execute the bake script
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.title = "Mystral Lightmap Baker";
    config.noSdl = true;  // No window needed for baking
    config.debug = opts.debug;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "Error: Failed to create runtime!" << std::endl;
        fs::remove(tempScript, ec);
        return 1;
    }

    // Load and execute the baker script
    if (!runtime->loadScript(tempScript.string())) {
        std::cerr << "Error: Failed to execute baker script!" << std::endl;
        fs::remove(tempScript, ec);
        return 1;
    }

    // Runtime::run() owns the event-loop pacing and exits after the no-SDL workload is idle.
    runtime->run();

    int exitCode = runtime->getExitCode();

    // Cleanup temp file
    fs::remove(tempScript, ec);

    if (!opts.quiet && exitCode == 0) {
        std::cout << "=== Bake complete ===" << std::endl;
    }

    return exitCode;
}


}  // namespace mystral::cli
