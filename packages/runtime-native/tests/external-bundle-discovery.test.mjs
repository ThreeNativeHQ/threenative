import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

// Exercise the production C++ loader, not a JavaScript imitation of its search paths. Each
// observation starts a fresh process so sharedBundle()'s one-time cache cannot hide a broken
// lookup. This Node-driven contract does not change the CTest coverage population or its digest.
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const timeout = 60_000;
let root;
let probe;
let sequence = 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout, ...options });
  assert.equal(result.error, undefined, `${command}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${command} terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

beforeAll(() => {
  root = makeTempDirSync("tn-external-bundle-");
  writeFileSync(join(root, "probe.cpp"), `
#include "mystral/vfs/embedded_bundle.h"
#include <iostream>
#include <string>
#include <vector>
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const std::string expected = argv[1];
    const bool found = mystral::vfs::hasEmbeddedBundle();
    std::vector<uint8_t> bytes;
    if (expected == "absent") {
        if (found || !mystral::vfs::getEmbeddedEntryPath().empty() ||
            mystral::vfs::readEmbeddedFile("proof.txt", bytes)) return 3;
    } else {
        if (!found || mystral::vfs::getEmbeddedEntryPath() != expected + ".js") return 4;
        if (!mystral::vfs::readEmbeddedFile("proof.txt", bytes) ||
            std::string(bytes.begin(), bytes.end()) != expected) return 5;
    }
    std::cout << "TN_EXTERNAL_BUNDLE_PROBE:" << expected << std::endl;
    return 0;
}
`);
  const cmakePath = (path) => path.replaceAll("\\", "/");
  writeFileSync(join(root, "CMakeLists.txt"), [
    "cmake_minimum_required(VERSION 3.20)",
    "project(tn_external_bundle_probe LANGUAGES CXX)",
    `add_executable(bundle-probe probe.cpp "${cmakePath(join(runtimeRoot, "src/vfs/embedded_bundle.cpp"))}")`,
    `target_include_directories(bundle-probe PRIVATE "${cmakePath(join(runtimeRoot, "include"))}")`,
    "target_compile_features(bundle-probe PRIVATE cxx_std_17)",
    "",
  ].join("\n"));
  const build = join(root, "build");
  run("cmake", ["-S", root, "-B", build, "-DCMAKE_BUILD_TYPE=Release"]);
  run("cmake", ["--build", build, "--config", "Release"]);
  probe = process.platform === "win32"
    ? join(build, "Release", "bundle-probe.exe")
    : join(build, "bundle-probe");
  // With a single-configuration Windows generator the executable is not under Release/.
  if (process.platform === "win32" && !existsSync(probe)) {
    probe = join(build, "bundle-probe.exe");
  }
  assert.ok(existsSync(probe), `native probe was not built: ${probe}`);
}, timeout * 3);

afterAll(() => {
  if (root) rmSync(root, { force: true, recursive: true });
});

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function bundle(marker) {
  const entry = Buffer.from(`${marker}.js`);
  const path = Buffer.from("proof.txt");
  const data = Buffer.from(marker);
  const index = Buffer.concat([
    u32(1), u32(1), u32(entry.length), u32(0), entry,
    u32(path.length), u32(0), u64(0), u64(data.length), path,
  ]);
  return Buffer.concat([data, index, Buffer.from("MYSBNDL1"), u32(1), u32(0), u64(index.length)]);
}

function fixture() {
  const directory = join(root, `case ${++sequence}`);
  const executableDirectory = join(directory, "Test Game.app", "Contents", "MacOS");
  const resources = join(directory, "Test Game.app", "Contents", "Resources");
  const cwd = join(directory, "unrelated working directory");
  for (const path of [executableDirectory, resources, cwd]) mkdirSync(path, { recursive: true });
  const executable = join(executableDirectory, process.platform === "win32" ? "game.exe" : "game");
  copyFileSync(probe, executable);
  // A valid decoy must never satisfy an executable-relative or Resources-relative lookup.
  writeFileSync(join(cwd, "game.bundle"), bundle("cwd-decoy"));
  return { cwd, directory, executable, executableDirectory, resources };
}

function observe(subject, marker, override) {
  const env = { ...process.env };
  delete env.MYSTRAL_BUNDLE;
  if (override !== undefined) env.MYSTRAL_BUNDLE = override;
  const result = run(subject.executable, [marker], { cwd: subject.cwd, env });
  assert.ok(result.stdout.includes(`TN_EXTERNAL_BUNDLE_PROBE:${marker}`), result.stdout);
}

test("a bare runtime does not load a bundle from the working directory", () => {
  observe(fixture(), "absent");
});

test("a bare runtime loads game.bundle beside its executable, not from cwd", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), bundle("sidecar"));
  observe(subject, "sidecar");
});

test("a relocated executable and sidecar still load from a path containing spaces", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), bundle("relocated"));
  const destination = `${subject.directory} relocated`;
  renameSync(subject.directory, destination);
  subject.executable = subject.executable.replace(subject.directory, destination);
  subject.cwd = subject.cwd.replace(subject.directory, destination);
  observe(subject, "relocated");
});

test("a corrupt sidecar cannot make a bare runtime report an embedded game", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), "corrupt bundle");
  observe(subject, "absent");
});

test("MYSTRAL_BUNDLE takes priority over an executable-adjacent game", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), bundle("sidecar"));
  const override = join(subject.directory, "override.bundle");
  writeFileSync(override, bundle("override"));
  observe(subject, "override", override);
});

test("a missing or corrupt override retains the existing sidecar fallback", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), bundle("fallback"));
  const override = join(subject.directory, "override.bundle");
  observe(subject, "fallback", override);
  writeFileSync(override, "not a bundle");
  observe(subject, "fallback", override);
});

test("Resources discovery is macOS-only and is relative to the executable", () => {
  const subject = fixture();
  writeFileSync(join(subject.resources, "game.bundle"), bundle("resources"));
  observe(subject, process.platform === "darwin" ? "resources" : "absent");
});

test("the executable-adjacent bundle takes priority over macOS Resources", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), bundle("sidecar"));
  writeFileSync(join(subject.resources, "game.bundle"), bundle("resources"));
  observe(subject, "sidecar");
});

test("an invalid adjacent bundle falls through to Resources only on macOS", () => {
  const subject = fixture();
  writeFileSync(join(subject.executableDirectory, "game.bundle"), "broken sidecar");
  writeFileSync(join(subject.resources, "game.bundle"), bundle("resources"));
  observe(subject, process.platform === "darwin" ? "resources" : "absent");
});
