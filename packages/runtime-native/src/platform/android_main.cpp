/**
 * Android entry point for Mystral Runtime
 *
 * This provides the SDL_main entry point that SDL3 calls on Android.
 * The script path is passed via command line arguments from MystralActivity.
 */

#ifdef __ANDROID__

#include "mystral/runtime.h"
#include <SDL3/SDL.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdio>
#include <android/log.h>
#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>

#define LOG_TAG "MystralRuntime"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

/**
 * Read a script file from Android assets using SDL3's IOStream.
 * Asset paths are relative to the assets directory.
 */
static std::string readAsset(const std::string& assetPath) {
    LOGI("Loading asset: %s", assetPath.c_str());

    // Use SDL's IO stream to read from Android assets
    SDL_IOStream* io = SDL_IOFromFile(assetPath.c_str(), "r");
    if (!io) {
        LOGE("Failed to open asset: %s - %s", assetPath.c_str(), SDL_GetError());
        return "";
    }

    // Get file size
    Sint64 size = SDL_GetIOSize(io);
    if (size < 0) {
        LOGE("Failed to get asset size: %s", SDL_GetError());
        SDL_CloseIO(io);
        return "";
    }

    LOGI("Asset size: %lld bytes", (long long)size);

    // Read content
    std::string content;
    content.resize(static_cast<size_t>(size));

    size_t bytesRead = SDL_ReadIO(io, content.data(), static_cast<size_t>(size));
    SDL_CloseIO(io);

    if (bytesRead != static_cast<size_t>(size)) {
        LOGE("Failed to read asset: expected %lld, got %zu", (long long)size, bytesRead);
        return "";
    }

    LOGI("Asset loaded successfully: %zu bytes", bytesRead);
    return content;
}

/**
 * SDL_main - Entry point called by SDL on Android.
 *
 * Arguments come from MystralActivity.getArguments().
 * Must be visible and use C linkage for SDL to find it via dlsym.
 */
extern "C" __attribute__((visibility("default"))) int SDL_main(int argc, char* argv[]) {
    // Android does not reliably route Rust/C stderr through logcat. Preserve
    // backend panic diagnostics in app-private storage for the runtime gate.
    std::freopen("/data/user/0/com.mystral.engine/files/native-stderr.log", "w", stderr);
    LOGI("SDL_main called with %d arguments", argc);
    for (int i = 0; i < argc; i++) {
        LOGI("  arg[%d] = %s", i, argv[i]);
    }

    // Get script path from arguments (set by MystralActivity.getArguments())
    std::string scriptPath = "asset://scripts/main.js";
    if (argc > 1 && argv[1]) {
        scriptPath = argv[1];
    }

    LOGI("Script path: %s", scriptPath.c_str());

    // Read script content
    std::string scriptContent;
    if (scriptPath.find("asset://") == 0) {
        // Load from Android assets
        std::string assetPath = scriptPath.substr(8);  // Remove "asset://"
        scriptContent = readAsset(assetPath);
    } else {
        // Load from file system
        std::ifstream file(scriptPath);
        if (!file.is_open()) {
            LOGE("Failed to open script file: %s", scriptPath.c_str());
            return 1;
        }
        std::stringstream buffer;
        buffer << file.rdbuf();
        scriptContent = buffer.str();
    }

    LOGI("Script loaded, %zu bytes", scriptContent.size());

    // Create runtime config
    mystral::RuntimeConfig config;
    config.width = 0;   // Use full screen width (0 = auto)
    config.height = 0;  // Use full screen height (0 = auto)
    config.title = "Mystral Engine";
    config.fullscreen = true;  // Android is always fullscreen

    LOGI("Creating Mystral runtime...");

    // Create runtime
    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        LOGE("Failed to create Mystral runtime!");
        return 1;
    }

    LOGI("Runtime created successfully");

    if (argc > 2 && argv[2] && argv[2][0] != '\0') {
        std::string endpoint = argv[2];
        std::string escaped;
        escaped.reserve(endpoint.size());
        for (char value : endpoint) {
            if (value == '\\' || value == '\'') escaped.push_back('\\');
            escaped.push_back(value);
        }
        runtime->evalScript(
            "globalThis.TN_PLAYTEST_ENDPOINT='" + escaped + "';",
            "threenative-playtest-endpoint.js"
        );
        LOGI("Device playtest endpoint configured");
    }
    if (argc > 3 && argv[3] && argv[3][0] != '\0') {
        std::string root = argv[3];
        runtime->evalScript(
            "globalThis.TN_PLAYTEST_MAILBOX={request:'" + root +
                "/tn-playtest-request.json',response:'" + root +
                "/tn-playtest-response.json'};",
            "threenative-playtest-mailbox.js"
        );
        LOGI("Device playtest mailbox configured");
    }
    // Execute the script
    LOGI("About to call evalScript...");
    bool success = runtime->evalScript(scriptContent, scriptPath);
    LOGI("evalScript returned: %s", success ? "true" : "false");
    if (!success) {
        LOGE("Failed to execute script!");
        // Don't return, let the runtime run anyway for debugging
    } else {
        LOGI("Script executed successfully");
    }

    // Run the main loop
    LOGI("About to call run()...");
    runtime->run();
    LOGI("run() returned");

    LOGI("Main loop exited");
    return 0;
}

#endif // __ANDROID__
