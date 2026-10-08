import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crossEnv } from "../build-cross-runtime.mjs";
import {
  installBuiltCross,
  loadLock,
  provisionBuiltCross,
  provisionCross,
  readRuntimeStamp,
} from "../provision.mjs";
import { ndkTools } from "../three-bridge.mjs";

const TRIPLE = "aarch64-linux-android";
const BUILD_ID = `src:${"a".repeat(64)}`;

function lock(buildId = BUILD_ID) {
  return {
    tag: "v0.0-test",
    crossArtifacts: {},
    crossBuilds: { [TRIPLE]: { version: "0.0.1", buildId } },
  };
}

function stamp(build: string) {
  return `noise\0PERRY_RUNTIME_BUILD_STAMP_V1|version=0.0.1|build=${build}\0trailer`;
}

/** A staged cross tree: three archives and the Perry-style manifest that lists them. */
function stagedTree(runtimeStamp: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cross-"));
  const files = ["libperry_runtime.a", "libperry_stdlib.a", "libperry_ui_android.a"].map((name) => {
    const bytes = Buffer.from(name === "libperry_runtime.a" ? runtimeStamp : `${name} bytes`);
    fs.writeFileSync(path.join(dir, name), bytes);
    return {
      path: name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    };
  });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ perry_version: "0.0.1", target_triple: TRIPLE, files }),
  );
  return dir;
}

describe("the pinned lock", () => {
  it("names a source-stamped Android runtime build and keeps the shipped pair for the record", () => {
    const pinned = loadLock();
    expect(pinned.crossBuilds[TRIPLE].buildId).toMatch(/^src:[0-9a-f]{64}$/u);
    expect(pinned.crossBuilds[TRIPLE].version).toBe(pinned.tag.slice(1));
    expect(pinned.crossArtifacts[TRIPLE].url).toContain(pinned.tag);
  });
});

describe("readRuntimeStamp", () => {
  it("reads the version and build id from inside an archive", () => {
    const file = path.join(stagedTree(stamp(BUILD_ID)), "libperry_runtime.a");
    expect(readRuntimeStamp(file)).toEqual({ version: "0.0.1", build: BUILD_ID });
  });

  it("returns nothing for an archive with no stamp, instead of guessing one", () => {
    const file = path.join(stagedTree("no stamp here"), "libperry_runtime.a");
    expect(readRuntimeStamp(file)).toBeUndefined();
  });
});

describe("a runtime built from the pinned source", () => {
  it("installs a staged tree whose stamp equals the pin, and provisionCross serves it", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cross-cache-"));
    installBuiltCross(TRIPLE, stagedTree(stamp(BUILD_ID)), { lock: lock(), cacheDir });
    const found = await provisionCross(TRIPLE, {
      lock: lock(),
      cacheDir,
      fetchImpl: () => {
        throw new Error("a built runtime must not download the release archive");
      },
    });
    expect(found.dir).toBe(path.join(cacheDir, "toolchain"));
    expect(fs.existsSync(found.manifestPath)).toBe(true);
  });

  it("refuses a tree stamped with another build, the skew Perry itself refuses at link time", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cross-cache-"));
    const shipped = stagedTree(stamp(`git:${"b".repeat(40)}`));
    expect(() => installBuiltCross(TRIPLE, shipped, { lock: lock(), cacheDir })).toThrow(
      /stamped git:b+, compiler\.lock\.json pins src:a+/u,
    );
    expect(fs.existsSync(path.join(cacheDir, "toolchain"))).toBe(false);
  });

  it("refuses a staged tree whose archive no longer matches its manifest", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cross-cache-"));
    const tree = stagedTree(stamp(BUILD_ID));
    fs.appendFileSync(path.join(tree, "libperry_stdlib.a"), "truncated or grown");
    expect(() => installBuiltCross(TRIPLE, tree, { lock: lock(), cacheDir })).toThrow(
      /libperry_stdlib\.a is \d+ bytes, its manifest says \d+/u,
    );
  });

  it("names the build command when the cache holds nothing, and never downloads", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cross-cache-"));
    const error = await provisionCross(TRIPLE, { lock: lock(), cacheDir }).catch((e) => e);
    expect(error.code).toBe("TN_NATIVE_TS_CROSS_BUILD");
    expect(error.message).toContain("build-cross-runtime.mjs --target aarch64-linux-android");
  });

  it("rejects a cached tree after its runtime is replaced by one with another stamp", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-cross-cache-"));
    installBuiltCross(TRIPLE, stagedTree(stamp(BUILD_ID)), { lock: lock(), cacheDir });
    expect(() =>
      provisionBuiltCross(TRIPLE, { lock: lock(`src:${"c".repeat(64)}`), cacheDir }),
    ).toThrow(/TN_NATIVE_TS_CROSS_BUILD/u);
  });
});

describe("the NDK build environment", () => {
  const ndk = { dir: "/ndk", version: "28", bin: "/ndk/toolchains/llvm/prebuilt/linux-x86_64" };

  it("sets the cargo linker and the cc-rs variables the way Perry's release workflow does", () => {
    const env = crossEnv(TRIPLE, ndk, 24, {});
    const clang = `${ndk.bin}/bin/${TRIPLE}24-clang`;
    expect(env.CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER).toBe(clang);
    expect(env.CC_aarch64_linux_android).toBe(clang);
    expect(env.CXX_aarch64_linux_android).toBe(`${clang}++`);
    expect(env.AR_aarch64_linux_android).toBe(`${ndk.bin}/bin/llvm-ar`);
    expect(env.ANDROID_API_LEVEL).toBe("24");
  });

  it("points bindgen at the NDK's libclang and sysroot, which libsqlite3-sys needs to build", () => {
    const env = crossEnv(TRIPLE, ndk, 24, {});
    expect(env.LIBCLANG_PATH).toBe(`${ndk.bin}/lib`);
    expect(env.BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android).toBe(`--sysroot=${ndk.bin}/sysroot`);
  });

  it("compiles the engine bridge with the same NDK clang", () => {
    expect(ndkTools(ndk, { triple: TRIPLE, apiLevel: 24 })).toEqual({
      cc: `${ndk.bin}/bin/${TRIPLE}24-clang`,
      cxx: `${ndk.bin}/bin/${TRIPLE}24-clang++`,
      ar: `${ndk.bin}/bin/llvm-ar`,
    });
  });
});
