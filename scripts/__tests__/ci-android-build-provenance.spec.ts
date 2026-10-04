import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";
const { inspectAndroidBuildProvenance } = await import(
  new URL("../ci-android-build-provenance.mjs", import.meta.url).href
);
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
describe("exact APK compiler-to-packaging provenance", () => {
  it.each(["out/lib", "mergeDebugNativeLibs/out/lib"])(
    "binds %s with an exact configured stripping proof and rejects mismatches",
    (layout) => {
      const root = makeTempDirSync("android-packaging-proof-");
      const put = (name: string, bytes: string) => {
        const file = path.join(root, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, bytes);
        return file;
      };
      try {
        put(
          `android/app/build/intermediates/merged_native_libs/debug/${layout}/x86_64/libmystral-runtime.so`,
          "compiled-with-symbols",
        );
        const library = put(
          "android/app/build/intermediates/cxx/Debug/current/obj/x86_64/libmystral-runtime.so",
          "compiled-with-symbols",
        );
        const strip = put(
          "ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip",
          "mock tool; never executed",
        );
        const compiler = put(
          "ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/clang++",
          "mock compiler; never executed",
        );
        const cache = put(
          "android/app/.cxx/Debug/current/x86_64/CMakeCache.txt",
          `CMAKE_STRIP:FILEPATH=${strip}\nCMAKE_CXX_COMPILER:FILEPATH=${compiler}\nCMAKE_ANDROID_NDK:PATH=${path.join(root, "ndk")}\n`,
        );
        const ninja = put("android/app/.cxx/Debug/current/x86_64/build.ninja", "FLAGS = -O2\n");
        const execute = (command: string, args: string[]) => {
          expect(command).toBe(strip);
          expect(args[0]).toBe("--strip-unneeded");
          expect(args[1]).toBe("-o");
          expect(args[3]).toBe(library);
          const output = args[2];
          if (!output) throw new Error("strip proof output is missing");
          writeFileSync(output, "packaged");
        };
        expect(
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute).artifactSha256,
        ).toBe(hash("packaged"));
        expect(() =>
          inspectAndroidBuildProvenance("x86_64", hash("wrong-apk"), root, execute),
        ).toThrow("PROVENANCE_MISSING");
        const metadata = put(
          "android/app/.cxx/Debug/current/x86_64/CMakeFiles/3.22.1/CMakeCXXCompiler.cmake",
          `set(CMAKE_CXX_COMPILER "${compiler}")\n`,
        );
        // Exact pinned NDK r28c normal-variable/CMake 3.22.1 producer shape:
        // compiler absent from cache, recorded in generated compiler metadata.
        writeFileSync(
          cache,
          `CMAKE_STRIP:FILEPATH=${strip}\nANDROID_NDK:UNINITIALIZED=${path.join(root, "ndk")}\n`,
        );
        expect(
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute).artifactSha256,
        ).toBe(hash("packaged"));
        writeFileSync(metadata, 'set(CMAKE_CXX_COMPILER "/different/toolchain/clang++")\n');
        expect(() =>
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute),
        ).toThrow("PROVENANCE_MISSING");
        writeFileSync(
          metadata,
          `set(CMAKE_CXX_COMPILER "${compiler}")\nset(CMAKE_CXX_COMPILER "/different/toolchain/clang++")\n`,
        );
        expect(() =>
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute),
        ).toThrow("PROVENANCE_MISSING");
        writeFileSync(metadata, `set(CMAKE_CXX_COMPILER "${compiler}")\n`);
        writeFileSync(ninja, "FLAGS = -O0\n");
        expect(() =>
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute),
        ).toThrow("PROVENANCE_AMBIGUOUS");
        writeFileSync(ninja, "FLAGS = -O2\n");
        writeFileSync(
          cache,
          `CMAKE_STRIP:FILEPATH=${strip}\nCMAKE_CXX_COMPILER:FILEPATH=/different/toolchain/clang++\n`,
        );
        expect(() =>
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute),
        ).toThrow("PROVENANCE_MISSING");
        writeFileSync(library, "stale-other-build");
        expect(() =>
          inspectAndroidBuildProvenance("x86_64", hash("packaged"), root, execute),
        ).toThrow("PROVENANCE_MISSING");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
