import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateOptimizationProvenance } from "../packages/runtime-native/scripts/measure-android-js-engine.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// APK packaging may strip symbols. Prove the configured NDK transformation produces the
// exact executed APK bytes; a matching filename, build ID or unstripped digest is insufficient.
export function inspectAndroidBuildProvenance(
  abi,
  packagedSha256,
  root,
  execute = execFileSync,
  report = () => {},
) {
  const diagnostic = (reason, fields = {}) => report({ abi, packagedSha256, reason, ...fields });
  const build = path.join(root, "android/app/build/intermediates");
  const merged = [
    path.join(build, "merged_native_libs/debug/out/lib", abi, "libmystral-runtime.so"),
    path.join(
      build,
      "merged_native_libs/debug/mergeDebugNativeLibs/out/lib",
      abi,
      "libmystral-runtime.so",
    ),
  ]
    .filter(existsSync)
    .map((file) => hash(readFileSync(file)));
  diagnostic("merged-inputs", { mergedSha256: merged });
  const cxx = path.join(build, "cxx/Debug");
  if (!existsSync(cxx)) diagnostic("cxx-directory-missing", { cxx });
  const candidates = [];
  if (existsSync(cxx))
    for (const entry of readdirSync(cxx, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nativeLibrary = path.join(cxx, entry.name, "obj", abi, "libmystral-runtime.so");
      const buildNinja = path.join(root, "android/app/.cxx/Debug", entry.name, abi, "build.ninja");
      const cacheFile = path.join(path.dirname(buildNinja), "CMakeCache.txt");
      const missing = [nativeLibrary, buildNinja, cacheFile].filter((file) => !existsSync(file));
      if (missing.length) {
        diagnostic("compiler-input-missing", { nativeLibrary, buildNinja, cacheFile, missing });
        continue;
      }
      const rawHash = hash(readFileSync(nativeLibrary));
      diagnostic("compiler-input", { nativeLibrary, buildNinja, cacheFile, rawSha256: rawHash });
      if (!merged.includes(rawHash)) {
        diagnostic("raw-merged-mismatch", { rawSha256: rawHash });
        continue;
      }
      let packagedHash = rawHash;
      if (rawHash !== packagedSha256) {
        const cache = readFileSync(cacheFile, "utf8");
        const strip = /^CMAKE_STRIP:[^=\n]+=([^\r\n]+)$/mu.exec(cache)?.[1];
        const cachedCompiler = /^CMAKE_CXX_COMPILER:[^=\n]+=([^\r\n]+)$/mu.exec(cache)?.[1];
        // NDK r28c defines the compiler as a normal CMake variable, so CMake 3.22.1
        // records it in generated compiler metadata without necessarily caching it.
        const compilerMetadata = path.join(path.dirname(buildNinja), "CMakeFiles");
        const generatedCompilers = existsSync(compilerMetadata)
          ? readdirSync(compilerMetadata, { withFileTypes: true })
              .filter((entry) => entry.isDirectory() && /^\d+\.\d+(?:\.\d+)?$/u.test(entry.name))
              .map((entry) => path.join(compilerMetadata, entry.name, "CMakeCXXCompiler.cmake"))
              .filter(existsSync)
              .map((file) => {
                const declarations = [
                  ...readFileSync(file, "utf8").matchAll(
                    /^set\(CMAKE_CXX_COMPILER "([^"\r\n]+)"\)$/gmu,
                  ),
                ];
                return {
                  file,
                  compiler: declarations.length === 1 ? declarations[0][1] : undefined,
                };
              })
          : [];
        const compilerPaths = [
          cachedCompiler,
          ...generatedCompilers.map((row) => row.compiler),
        ].filter(Boolean);
        const compiler = compilerPaths[0];
        const compilerMetadataValid =
          generatedCompilers.every((row) => row.compiler) && new Set(compilerPaths).size === 1;
        diagnostic("configured-compiler", {
          cachedCompiler,
          generatedCompilers,
          compilerMetadataValid,
        });
        const ndkRoots = [
          ...cache.matchAll(/^(?:CMAKE_ANDROID_NDK|ANDROID_NDK):[^=\n]+=([^\r\n]+)$/gmu),
        ].map((match) => path.resolve(match[1]));
        const ndk = ndkRoots[0];
        if (
          !strip ||
          !compiler ||
          !compilerMetadataValid ||
          !ndk ||
          new Set(ndkRoots).size !== 1 ||
          !path.isAbsolute(strip) ||
          path.basename(strip) !== "llvm-strip" ||
          !/^clang\+\+(?:-\d+)?$/u.test(path.basename(compiler)) ||
          path.dirname(strip) !== path.dirname(compiler) ||
          ![strip, compiler].every(existsSync) ||
          !/^toolchains\/llvm\/prebuilt\/[^/]+\/bin$/u.test(path.relative(ndk, path.dirname(strip)))
        ) {
          diagnostic("configured-toolchain-rejected", { strip, compiler, ndkRoots });
          continue;
        }
        const temporary = mkdtempSync(path.join(tmpdir(), "tn-ci-strip-proof-"));
        try {
          const output = path.join(temporary, "libmystral-runtime.so");
          execute(strip, ["--strip-unneeded", "-o", output, nativeLibrary], {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          });
          packagedHash = hash(readFileSync(output));
          diagnostic("strip-result", {
            strip,
            nativeLibrary,
            transformedSha256: packagedHash,
            matchesApk: packagedHash === packagedSha256,
          });
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      }
      candidates.push({
        nativeLibrary,
        buildNinja,
        sha256: packagedHash,
        optimization: /(?:^|\s)-O2(?:\s|$)/mu.test(readFileSync(buildNinja, "utf8"))
          ? "-O2"
          : "other",
      });
    }
  diagnostic("candidate-summary", { candidates });
  return validateOptimizationProvenance(packagedSha256, candidates);
}
