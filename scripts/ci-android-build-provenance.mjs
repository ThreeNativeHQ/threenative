import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateOptimizationProvenance } from "../packages/runtime-native/scripts/measure-android-js-engine.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// APK packaging may strip symbols. Prove the configured NDK transformation produces the
// exact executed APK bytes; a matching filename, build ID or unstripped digest is insufficient.
export function inspectAndroidBuildProvenance(abi, packagedSha256, root, execute = execFileSync) {
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
  const cxx = path.join(build, "cxx/Debug");
  const candidates = [];
  if (existsSync(cxx))
    for (const entry of readdirSync(cxx, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nativeLibrary = path.join(cxx, entry.name, "obj", abi, "libmystral-runtime.so");
      const buildNinja = path.join(root, "android/app/.cxx/Debug", entry.name, abi, "build.ninja");
      const cacheFile = path.join(path.dirname(buildNinja), "CMakeCache.txt");
      if (![nativeLibrary, buildNinja, cacheFile].every(existsSync)) continue;
      const rawHash = hash(readFileSync(nativeLibrary));
      if (!merged.includes(rawHash)) continue;
      let packagedHash = rawHash;
      if (rawHash !== packagedSha256) {
        const cache = readFileSync(cacheFile, "utf8");
        const strip = /^CMAKE_STRIP:[^=\n]+=([^\r\n]+)$/mu.exec(cache)?.[1];
        const compiler = /^CMAKE_CXX_COMPILER:[^=\n]+=([^\r\n]+)$/mu.exec(cache)?.[1];
        const ndkRoots = [
          ...cache.matchAll(/^(?:CMAKE_ANDROID_NDK|ANDROID_NDK):[^=\n]+=([^\r\n]+)$/gmu),
        ].map((match) => path.resolve(match[1]));
        const ndk = ndkRoots[0];
        if (
          !strip ||
          !compiler ||
          !ndk ||
          new Set(ndkRoots).size !== 1 ||
          !path.isAbsolute(strip) ||
          path.basename(strip) !== "llvm-strip" ||
          !/^clang\+\+(?:-\d+)?$/u.test(path.basename(compiler)) ||
          path.dirname(strip) !== path.dirname(compiler) ||
          ![strip, compiler].every(existsSync) ||
          !/^toolchains\/llvm\/prebuilt\/[^/]+\/bin$/u.test(path.relative(ndk, path.dirname(strip)))
        )
          continue;
        const temporary = mkdtempSync(path.join(tmpdir(), "tn-ci-strip-proof-"));
        try {
          const output = path.join(temporary, "libmystral-runtime.so");
          execute(strip, ["--strip-unneeded", "-o", output, nativeLibrary], {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          });
          packagedHash = hash(readFileSync(output));
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
  return validateOptimizationProvenance(packagedSha256, candidates);
}
