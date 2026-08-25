#include "tool_dispatch.h"
#include "mystral/vfs/embedded_bundle.h"

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <process.h>
#else
#include <cerrno>
#include <cstring>
#include <unistd.h>
#endif

namespace mystral::cli {
namespace {

std::filesystem::path toolsPath(int argc, char** argv) {
    if (const char* configured = std::getenv("THREENATIVE_CLI_TOOLS"); configured && *configured) {
        return std::filesystem::absolute(configured);
    }

    if (argc == 0 || !argv || !argv[0]) return {};
    std::error_code error;
    const auto executable = std::filesystem::absolute(argv[0], error);
    if (error) return {};

#ifdef _WIN32
    return executable.parent_path() / "mystral-tools.exe";
#else
    return executable.parent_path() / "mystral-tools";
#endif
}

}  // namespace

int dispatchBuildTool(int argc, char** argv) {
    const auto tool = toolsPath(argc, argv);
    if (tool.empty() || !std::filesystem::is_regular_file(tool)) {
        std::cerr << "Error: build tool helper is missing: " << tool << std::endl;
        std::cerr << "Build the mystral-tools target or set THREENATIVE_CLI_TOOLS." << std::endl;
        return 127;
    }

    std::vector<char*> childArguments(argv, argv + argc + 1);
    const std::string toolString = tool.string();
    childArguments[0] = const_cast<char*>(toolString.c_str());
    if (argc > 0 && argv && argv[0]) {
        std::string runtime = mystral::vfs::getExecutablePath();
        if (runtime.empty()) runtime = argv[0];
#ifdef _WIN32
        _putenv_s("THREENATIVE_RUNTIME_EXECUTABLE", runtime.c_str());
#else
        setenv("THREENATIVE_RUNTIME_EXECUTABLE", runtime.c_str(), 1);
#endif
    }

#ifdef _WIN32
    const int result = _spawnv(_P_WAIT, toolString.c_str(), childArguments.data());
    if (result == -1) {
        std::cerr << "Error: failed to start build tool helper: " << std::strerror(errno) << std::endl;
        return 127;
    }
    return result;
#else
    execv(toolString.c_str(), childArguments.data());
    std::cerr << "Error: failed to start build tool helper: " << std::strerror(errno) << std::endl;
    return 127;
#endif
}

}  // namespace mystral::cli
