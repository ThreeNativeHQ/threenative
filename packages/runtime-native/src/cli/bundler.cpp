#include "bundler.h"

#include "mystral/js/module_resolver.h"
#include "mystral/js/ts_transpiler.h"
#include "mystral/vfs/embedded_bundle.h"

#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <queue>
#include <regex>
#include <sstream>
#include <unordered_set>
#include <vector>

namespace mystral::cli {

struct BundleFile {
    std::filesystem::path sourcePath;
    std::string bundlePath;
    uint64_t size = 0;
    uint64_t offset = 0;
};

static bool isSafeRelative(const std::filesystem::path& relPath) {
    if (relPath.empty() || relPath.is_absolute()) {
        return false;
    }
    for (const auto& part : relPath) {
        if (part == "..") {
            return false;
        }
    }
    return true;
}

static bool makeBundlePath(const std::filesystem::path& filePath,
                           const std::filesystem::path& rootDir,
                           std::string* outPath) {
    std::error_code ec;
    std::filesystem::path absRoot = std::filesystem::absolute(rootDir, ec).lexically_normal();
    if (ec) {
        return false;
    }
    std::filesystem::path absFile = std::filesystem::absolute(filePath, ec).lexically_normal();
    if (ec) {
        return false;
    }

    std::filesystem::path rel = std::filesystem::relative(absFile, absRoot, ec);
    if (ec || !isSafeRelative(rel)) {
        return false;
    }

    std::string normalized = mystral::vfs::normalizeBundlePath(rel.generic_string());
    if (normalized.empty()) {
        return false;
    }
    *outPath = normalized;
    return true;
}

static void appendU32(std::vector<uint8_t>& out, uint32_t value) {
    out.push_back(static_cast<uint8_t>(value & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 24) & 0xFF));
}

static void appendU64(std::vector<uint8_t>& out, uint64_t value) {
    out.push_back(static_cast<uint8_t>(value & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 24) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 32) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 40) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 48) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 56) & 0xFF));
}

static bool copyStream(std::ifstream& in, std::ofstream& out) {
    std::vector<char> buffer(64 * 1024);
    while (in.good()) {
        in.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        std::streamsize readCount = in.gcount();
        if (readCount > 0) {
            out.write(buffer.data(), readCount);
            if (!out.good()) {
                return false;
            }
        }
    }
    return in.eof() && out.good();
}

static bool writeFileToStream(const std::filesystem::path& path, std::ofstream& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in.is_open()) {
        return false;
    }
    return copyStream(in, out);
}

// Extract import/require specifiers from source code
static std::vector<std::string> extractImportSpecifiers(const std::string& source) {
    std::vector<std::string> specifiers;

    // ES6 import patterns
    std::regex importDefault(R"(import\s+[A-Za-z_$][\w$]*\s+from\s+['"]([^'"]+)['"])");
    std::regex importAll(R"(import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+['"]([^'"]+)['"])");
    std::regex importNamed(R"(import\s+\{[^}]+\}\s+from\s+['"]([^'"]+)['"])");
    std::regex importMixed(R"(import\s+[A-Za-z_$][\w$]*\s*,\s*\{[^}]+\}\s+from\s+['"]([^'"]+)['"])");
    std::regex importMixedAll(R"(import\s+[A-Za-z_$][\w$]*\s*,\s*\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+['"]([^'"]+)['"])");
    std::regex importSideEffect(R"(import\s+['"]([^'"]+)['"])");

    // CommonJS require patterns
    std::regex requireCall(R"(require\s*\(\s*['"]([^'"]+)['"]\s*\))");

    // Re-export patterns
    std::regex exportFrom(R"(export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"])");

    auto extractMatches = [&](const std::regex& re) {
        std::sregex_iterator it(source.begin(), source.end(), re);
        std::sregex_iterator end;
        while (it != end) {
            std::smatch match = *it;
            if (match.size() > 1) {
                specifiers.push_back(match[1].str());
            }
            ++it;
        }
    };

    extractMatches(importMixed);
    extractMatches(importMixedAll);
    extractMatches(importDefault);
    extractMatches(importAll);
    extractMatches(importNamed);
    extractMatches(importSideEffect);
    extractMatches(requireCall);
    extractMatches(exportFrom);

    return specifiers;
}

// Check if a path is a TypeScript file
static bool isTypeScriptFile(const std::string& path) {
    size_t dot = path.find_last_of('.');
    if (dot == std::string::npos) {
        return false;
    }
    std::string ext = path.substr(dot);
    return ext == ".ts" || ext == ".tsx" || ext == ".mts" || ext == ".cts";
}

// Collect all dependencies starting from entry file
static bool collectDependencies(
    const std::filesystem::path& entryPath,
    const std::filesystem::path& rootDir,
    std::vector<std::filesystem::path>& outFiles,
    std::unordered_set<std::string>& seen,
    bool quiet) {

    namespace fs = std::filesystem;
    mystral::js::ModuleResolver resolver(rootDir.string());

    std::queue<std::string> toProcess;
    std::string entryAbs = fs::absolute(entryPath).lexically_normal().generic_string();
    toProcess.push(entryAbs);
    seen.insert(entryAbs);
    outFiles.push_back(entryPath);

    while (!toProcess.empty()) {
        std::string currentPath = toProcess.front();
        toProcess.pop();

        // Read the file
        std::ifstream file(currentPath);
        if (!file.is_open()) {
            std::cerr << "Warning: Could not read file for dependency scanning: " << currentPath << std::endl;
            continue;
        }
        std::stringstream buffer;
        buffer << file.rdbuf();
        std::string source = buffer.str();

        // If it's TypeScript, transpile it first to get accurate import parsing
        if (isTypeScriptFile(currentPath) && mystral::js::isTypeScriptTranspilerAvailable()) {
            std::string outJs, outError;
            if (mystral::js::transpileTypeScript(source, currentPath, outJs, outError)) {
                source = outJs;
            }
        }

        // Extract import specifiers
        std::vector<std::string> specifiers = extractImportSpecifiers(source);

        for (const std::string& spec : specifiers) {
            // Skip bare specifiers (npm packages) - only resolve relative/absolute imports
            if (!spec.empty() && spec[0] != '.' && spec[0] != '/') {
                // Check if it's a Windows absolute path (e.g., "C:/...")
                bool isWindowsAbs = spec.size() > 2 &&
                    std::isalpha(static_cast<unsigned char>(spec[0])) && spec[1] == ':';
                if (!isWindowsAbs) {
                    continue;  // Skip npm packages for now
                }
            }

            mystral::js::ResolvedModule resolved;
            std::string error;
            if (!resolver.resolve(spec, currentPath, mystral::js::ResolveMode::Import, resolved, error)) {
                // Try require mode as fallback
                if (!resolver.resolve(spec, currentPath, mystral::js::ResolveMode::Require, resolved, error)) {
                    if (!quiet) {
                        std::cerr << "Warning: Could not resolve import '" << spec << "' from " << currentPath << std::endl;
                    }
                    continue;
                }
            }

            std::string resolvedPath = resolved.resolved.path;
            if (seen.count(resolvedPath) > 0) {
                continue;  // Already processed
            }

            // Check if the resolved file exists
            std::error_code ec;
            if (!fs::exists(resolvedPath, ec) || !fs::is_regular_file(resolvedPath, ec)) {
                if (!quiet) {
                    std::cerr << "Warning: Resolved path does not exist: " << resolvedPath << std::endl;
                }
                continue;
            }

            seen.insert(resolvedPath);
            outFiles.push_back(fs::path(resolvedPath));
            toProcess.push(resolvedPath);
        }
    }

    return true;
}

int compileBundle(const BundlerOptions& opts) {
    namespace fs = std::filesystem;

    if (opts.scriptPath.empty()) {
        std::cerr << "Error: No entry file specified for compile." << std::endl;
        return 1;
    }

    fs::path entryPath = opts.scriptPath;
    if (!fs::exists(entryPath) || !fs::is_regular_file(entryPath)) {
        std::cerr << "Error: Entry file not found: " << entryPath << std::endl;
        return 1;
    }

    fs::path rootDir = opts.rootDir.empty() ? fs::current_path() : fs::path(opts.rootDir);
    if (!fs::exists(rootDir) || !fs::is_directory(rootDir)) {
        std::cerr << "Error: Root directory not found: " << rootDir << std::endl;
        return 1;
    }

    std::string entryBundlePath;
    if (!makeBundlePath(entryPath, rootDir, &entryBundlePath)) {
        std::cerr << "Error: Entry path is outside bundle root: " << entryPath << std::endl;
        return 1;
    }

    std::vector<BundleFile> files;
    std::unordered_set<std::string> seen;
    std::unordered_set<std::string> seenBundlePaths;

    auto addFile = [&](const fs::path& filePath) -> bool {
        std::string bundlePath;
        if (!makeBundlePath(filePath, rootDir, &bundlePath)) {
            std::cerr << "Error: Asset path is outside bundle root: " << filePath << std::endl;
            return false;
        }
        if (!seenBundlePaths.insert(bundlePath).second) {
            return true;
        }
        std::error_code ec;
        uint64_t size = static_cast<uint64_t>(fs::file_size(filePath, ec));
        if (ec) {
            std::cerr << "Error: Failed to read file size: " << filePath << std::endl;
            return false;
        }
        files.push_back({ filePath, bundlePath, size, 0 });
        return true;
    };

    // Collect all dependencies starting from entry file
    std::vector<fs::path> dependencyFiles;
    if (!collectDependencies(entryPath, rootDir, dependencyFiles, seen, opts.quiet)) {
        std::cerr << "Error: Failed to collect dependencies" << std::endl;
        return 1;
    }

    // Add all discovered dependencies
    for (const auto& depPath : dependencyFiles) {
        if (!addFile(depPath)) {
            return 1;
        }
    }

    // Also check for package.json in the entry directory (needed for module format detection)
    fs::path entryDir = entryPath.parent_path();
    fs::path packageJsonPath = entryDir / "package.json";
    if (fs::exists(packageJsonPath) && fs::is_regular_file(packageJsonPath)) {
        addFile(packageJsonPath);
    }

    for (const auto& assetDir : opts.assetDirs) {
        fs::path dirPath = assetDir;
        if (!fs::exists(dirPath) || !fs::is_directory(dirPath)) {
            std::cerr << "Error: Asset directory not found: " << dirPath << std::endl;
            return 1;
        }
        for (const auto& entry : fs::recursive_directory_iterator(dirPath)) {
            if (!entry.is_regular_file()) {
                continue;
            }
            if (!addFile(entry.path())) {
                return 1;
            }
        }
    }

    fs::path outputPath = opts.outputPath.empty()
        ? fs::current_path() / fs::path(entryPath).stem()
        : fs::path(opts.outputPath);
    if (outputPath.is_relative()) {
        outputPath = fs::absolute(outputPath);
    }

    if (opts.bundleOnly) {
        // Bundle-only mode: add .bundle extension if no extension specified
        if (outputPath.extension().empty()) {
            outputPath += ".bundle";
        }
    } else {
#ifdef _WIN32
        if (outputPath.extension() != ".exe") {
            outputPath += ".exe";
        }
#endif
    }

    std::error_code ec;
    fs::path outputDir = outputPath.parent_path();
    if (!outputDir.empty() && !fs::exists(outputDir)) {
        fs::create_directories(outputDir, ec);
        if (ec) {
            std::cerr << "Error: Failed to create output directory: " << outputDir << std::endl;
            return 1;
        }
    }

    std::ofstream out(outputPath, std::ios::binary | std::ios::trunc);
    if (!out.is_open()) {
        std::cerr << "Error: Failed to create output file: " << outputPath << std::endl;
        return 1;
    }

    if (!opts.bundleOnly) {
        // Copy the runtime executable as the base of the compiled binary
        std::string exePath = opts.runtimePath.empty() ? mystral::vfs::getExecutablePath() : opts.runtimePath;
        if (exePath.empty()) {
            std::cerr << "Error: Could not resolve current executable path." << std::endl;
            return 1;
        }

        if (fs::exists(outputPath, ec) && fs::equivalent(outputPath, exePath, ec)) {
            std::cerr << "Error: Output path must be different from the current executable." << std::endl;
            return 1;
        }

        std::ifstream in(exePath, std::ios::binary);
        if (!in.is_open()) {
            std::cerr << "Error: Failed to open runtime binary: " << exePath << std::endl;
            return 1;
        }

        if (!copyStream(in, out)) {
            std::cerr << "Error: Failed to copy runtime binary." << std::endl;
            return 1;
        }
    }

    uint64_t bundleStart = static_cast<uint64_t>(out.tellp());
    for (auto& file : files) {
        file.offset = static_cast<uint64_t>(out.tellp()) - bundleStart;
        if (!writeFileToStream(file.sourcePath, out)) {
            std::cerr << "Error: Failed to write file: " << file.sourcePath << std::endl;
            return 1;
        }
    }

    std::vector<uint8_t> index;
    appendU32(index, mystral::vfs::kBundleVersion);
    appendU32(index, static_cast<uint32_t>(files.size()));
    appendU32(index, static_cast<uint32_t>(entryBundlePath.size()));
    appendU32(index, 0);
    index.insert(index.end(), entryBundlePath.begin(), entryBundlePath.end());

    for (const auto& file : files) {
        appendU32(index, static_cast<uint32_t>(file.bundlePath.size()));
        appendU32(index, 0);
        appendU64(index, file.offset);
        appendU64(index, file.size);
        index.insert(index.end(), file.bundlePath.begin(), file.bundlePath.end());
    }

    out.write(reinterpret_cast<const char*>(index.data()), static_cast<std::streamsize>(index.size()));
    if (!out.good()) {
        std::cerr << "Error: Failed to write bundle index." << std::endl;
        return 1;
    }

    std::vector<uint8_t> footer;
    footer.insert(footer.end(),
                  mystral::vfs::kBundleMagic,
                  mystral::vfs::kBundleMagic + mystral::vfs::kBundleMagicSize);
    appendU32(footer, mystral::vfs::kBundleVersion);
    appendU32(footer, 0);
    appendU64(footer, static_cast<uint64_t>(index.size()));

    out.write(reinterpret_cast<const char*>(footer.data()), static_cast<std::streamsize>(footer.size()));
    out.flush();
    if (!out.good()) {
        std::cerr << "Error: Failed to finalize bundle." << std::endl;
        return 1;
    }

    if (!opts.bundleOnly) {
        // Copy executable permissions (only for compiled binaries, not standalone bundles)
        std::string exePath = opts.runtimePath.empty() ? mystral::vfs::getExecutablePath() : opts.runtimePath;
        auto perms = fs::status(exePath, ec).permissions();
        if (!ec) {
            fs::permissions(outputPath, perms, ec);
        }
#ifndef _WIN32
        if (!ec) {
            fs::permissions(outputPath,
                            perms | fs::perms::owner_exec | fs::perms::group_exec | fs::perms::others_exec,
                            ec);
        }
#endif
    }

    if (!opts.quiet) {
        std::cout << "Bundle complete!" << std::endl;
        std::cout << "Entry: " << entryBundlePath << std::endl;
        std::cout << "Files bundled: " << files.size() << std::endl;
        std::cout << "Output: " << outputPath << std::endl;
        if (opts.bundleOnly) {
            std::cout << "Mode: standalone bundle (place as game.bundle next to mystral binary)" << std::endl;
        }
    }

    return 0;
}


}  // namespace mystral::cli
