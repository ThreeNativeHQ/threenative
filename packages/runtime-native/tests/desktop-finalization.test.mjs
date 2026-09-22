import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { extractContainer, packageDesktopContainer, resolveContainer } from "../scripts/desktop-distribution.mjs";

function fixture() {
  const root = makeTempDirSync("tn-desktop-finalization-");
  const executable = join(root, "runtime");
  const bundle = join(root, "game.bundle");
  const icon = join(root, "icon.png");
  writeFileSync(executable, "bare runtime");
  writeFileSync(bundle, "prepared game");
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(0x49484452, 12);
  png.writeUInt32BE(32, 16);
  png.writeUInt32BE(32, 20);
  writeFileSync(icon, png);
  return {
    root,
    icon,
    options: {
      arch: "x64",
      bundle,
      config: { app: { id: "com.example.proof", name: "Proof Game", version: "1.0.0" } },
      executable,
      output: join(root, "release.zip"),
      platform: "win32",
    },
  };
}

function files(root) {
  const result = {};
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else result[relative(root, path)] = readFileSync(path).toString("base64");
    }
  }
  walk(root);
  return result;
}

/**
 * The real archiver boundary. `zip` is the first choice and is absent from stock Arch and from
 * Windows entirely, so this asserts the tool is one of the archivers the packager knows how to
 * drive rather than one specific name, and lets the fallback chain run for real.
 */
const ARCHIVERS = ["bsdtar", "tar", "zip"];
function archive(command, args, options) {
  assert.ok(ARCHIVERS.includes(command), `unexpected tool: ${command}`);
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

for (const outcome of ["success", "invalid seal", "missing tool"]) {
  test(`macOS seals the complete manifest and signed dependencies: ${outcome}`, () => {
    const subject = fixture();
    const dependency = join(subject.root, "helper.dylib");
    const uiDirectory = join(subject.root, "ui");
    writeFileSync(dependency, "dependency before signing");
    mkdirSync(uiDirectory);
    writeFileSync(join(uiDirectory, "index.html"), "<main>React HUD</main>");
    writeFileSync(subject.options.output, "previous good release");
    let seal;
    let archives = 0;
    let outerSignatures = 0;
    const run = (command, args, options) => {
      if (command !== "codesign") {
        archives++;
        return archive(command, args, options);
      }
      if (outcome === "missing tool") return { error: new Error("codesign missing") };
      const target = args.at(-1);
      if (args.includes("--sign")) {
        assert.equal(args.includes("--deep"), false, "sign nested code explicitly before sealing the app");
        if (statSync(target).isFile()) {
          writeFileSync(target, "signed dependency");
        } else {
          outerSignatures++;
          const entitlementIndex = args.indexOf("--entitlements");
          assert.ok(entitlementIndex >= 0, "the hardened JavaScript host must allow JIT memory");
          const entitlements = readFileSync(args[entitlementIndex + 1], "utf8");
          assert.match(entitlements, /<key>com.apple.security.cs.allow-jit<\/key>\s*<true\/>/u);
          assert.equal(entitlements.includes("allow-unsigned-executable-memory"), false);
          const manifest = JSON.parse(readFileSync(join(target, "Contents/Resources/threenative-container.json")));
          assert.deepEqual(manifest.resources[manifest.executable], { signature: "codesign" });
          assert.equal(readFileSync(join(target, manifest.dependencies[0].path), "utf8"), "signed dependency");
          writeFileSync(join(target, manifest.executable), "runtime including embedded signature");
          seal = files(target);
        }
        return { status: 0 };
      }
      assert.ok(args.includes("--verify") && args.includes("--strict") && args.includes("--deep"));
      const valid = statSync(target).isFile()
        ? readFileSync(target, "utf8") === "signed dependency"
        : outcome !== "invalid seal" && JSON.stringify(files(target)) === JSON.stringify(seal);
      return { status: valid ? 0 : 1, stderr: "invalid signature fixture" };
    };
    try {
      const build = () => packageDesktopContainer({
        ...subject.options, platform: "darwin", signing: { identity: "test identity" },
        dependencies: [{ name: "helper.dylib", source: dependency }],
        uiDirectory, uiRenderer: "web", run,
      });
      if (outcome !== "success") {
        assert.throws(build, /TN_DESKTOP_CODESIGN.*(?:FAILED|TOOL_MISSING)/u);
        assert.equal(archives, 0);
        assert.equal(readFileSync(subject.options.output, "utf8"), "previous good release");
        return;
      }
      const built = build();
      assert.equal(outerSignatures, 1);
      const root = extractContainer(built.archive, join(subject.root, "moved app"), { platform: "darwin" });
      assert.deepEqual(resolveContainer(root, { platform: "darwin", run }), built.manifest);
      assert.throws(() => resolveContainer(root, { platform: "linux", run }), /TN_DESKTOP_CODESIGN_HOST_REQUIRED/u);
      for (const path of [built.manifest.executable, built.manifest.dependencies[0].path, built.manifest.ui.entry, "Contents/Resources/threenative-container.json"]) {
        const target = join(root, path);
        const original = readFileSync(target);
        writeFileSync(target, `${original}tampered`);
        assert.throws(() => resolveContainer(root, { platform: "darwin", run }), /TN_DESKTOP_(?:CONTAINER|CODESIGN)/u);
        writeFileSync(target, original);
      }
      assert.deepEqual(resolveContainer(root, { platform: "darwin", run }), built.manifest);
      const manifestPath = join(root, "Contents/Resources/threenative-container.json");
      const originalManifest = readFileSync(manifestPath);
      for (const mutate of [
        (manifest) => { manifest.resources[manifest.executable] = { signature: "unknown" }; },
        (manifest) => { manifest.resources[manifest.ui.entry] = { signature: "codesign" }; },
        (manifest) => { manifest.signed = false; },
        (manifest) => { manifest.platform = "linux-x64"; },
      ]) {
        const changed = JSON.parse(originalManifest);
        mutate(changed);
        writeFileSync(manifestPath, JSON.stringify(changed));
        assert.throws(() => resolveContainer(root, { platform: "darwin", run }), /TN_DESKTOP_CONTAINER_MANIFEST_INVALID/u);
      }
      writeFileSync(manifestPath, originalManifest);
      assert.throws(() => resolveContainer(root, { platform: "darwin", run: () => ({ error: new Error("ENOENT") }) }), /TN_DESKTOP_CODESIGN_VERIFY_TOOL_MISSING/u);
    } finally {
      rmSync(subject.root, { force: true, recursive: true });
    }
  });
}

test.skipIf(process.platform !== "darwin")("real macOS code signing survives extraction and refuses changed payloads", () => {
  const subject = fixture();
  const source = join(subject.root, "main.c");
  const dependency = join(subject.root, "helper.dylib");
  const uiDirectory = join(subject.root, "ui");
  writeFileSync(source, "#include <sys/mman.h>\nint main(void) { void *p = mmap(0, 16384, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANON | MAP_JIT, -1, 0); if (p == MAP_FAILED) return 1; return munmap(p, 16384); }\n");
  mkdirSync(uiDirectory);
  writeFileSync(join(uiDirectory, "index.html"), "<main>UI payload</main>");
  try {
    for (const args of [["clang", source, "-o", subject.options.executable], ["clang", "-dynamiclib", source, "-o", dependency]]) {
      const result = spawnSync("xcrun", args, { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
    }
    const built = packageDesktopContainer({
      ...subject.options, platform: "darwin", arch: process.arch,
      dependencies: [{ name: "helper.dylib", source: dependency }],
      uiDirectory, uiRenderer: "web", signing: { identity: "-" },
    });
    const root = extractContainer(built.archive, join(subject.root, "relocated signed app"));
    const manifest = resolveContainer(root);
    assert.equal(spawnSync(join(root, manifest.executable)).status, 0);
    for (const path of [manifest.executable, manifest.dependencies[0].path, manifest.ui.entry, "Contents/Resources/threenative-container.json"]) {
      const target = join(root, path);
      const original = readFileSync(target);
      writeFileSync(target, Buffer.concat([original, Buffer.from("tampered")]));
      assert.throws(() => resolveContainer(root), /TN_DESKTOP_(?:CONTAINER|CODESIGN)/u);
      writeFileSync(target, original);
    }
    assert.deepEqual(resolveContainer(root), manifest);
  } finally {
    rmSync(subject.root, { force: true, recursive: true });
  }
});

test("unsigned macOS preparation still archives without invoking codesign", () => {
  const subject = fixture();
  try {
    const result = packageDesktopContainer({ ...subject.options, platform: "darwin", run: archive });
    assert.equal(result.signed, false);
    assert.equal(existsSync(result.archive), true);
  } finally {
    rmSync(subject.root, { force: true, recursive: true });
  }
});

for (const outcome of ["success", "nonzero", "missing", "throws"]) {
  test(`removes the temporary Windows icon after rcedit ${outcome}`, () => {
    const subject = fixture();
    let temporaryIcon;
    try {
      const build = () => packageDesktopContainer({
        ...subject.options,
        icon: subject.icon,
        run(command, args, options) {
          if (command !== "rcedit") return archive(command, args, options);
          temporaryIcon = args[args.indexOf("--set-icon") + 1];
          assert.ok(existsSync(temporaryIcon), "rcedit receives the prepared ICO");
          if (outcome === "throws") throw new Error("transport failed");
          if (outcome === "missing") return { error: new Error("ENOENT") };
          return { status: outcome === "nonzero" ? 1 : 0, stdout: "", stderr: "" };
        },
      });
      if (outcome === "success") assert.ok(existsSync(build().archive));
      else assert.throws(build, /TN_DESKTOP_RESOURCE|transport failed/u);
      assert.ok(temporaryIcon, "the resource-editor boundary was exercised");
      assert.equal(existsSync(dirname(temporaryIcon)), false, "temporary ICO directory leaked");
      assert.equal(existsSync(subject.icon), true, "the authored icon must survive cleanup");
    } finally {
      if (temporaryIcon) rmSync(dirname(temporaryIcon), { force: true, recursive: true });
      rmSync(subject.root, { force: true, recursive: true });
    }
  });
}

test("cleanup preserves a caller-owned ICO and its directory", () => {
  const subject = fixture();
  const icon = join(subject.root, "authored.ico");
  writeFileSync(icon, "authored icon");
  try {
    packageDesktopContainer({
      ...subject.options,
      icon,
      run(command, args, options) {
        if (command === "rcedit") {
          assert.equal(args[args.indexOf("--set-icon") + 1], icon);
          return { status: 0 };
        }
        return archive(command, args, options);
      },
    });
    assert.equal(readFileSync(icon, "utf8"), "authored icon");
  } finally {
    rmSync(subject.root, { force: true, recursive: true });
  }
});
