import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { packageDesktopContainer } from "../scripts/desktop-distribution.mjs";

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

function archive(command, args, options) {
  assert.equal(command, "zip", `unexpected tool: ${command}`);
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

for (const existing of [false, true]) {
  test(`refuses a post-signing macOS resource change without ${existing ? "replacing an existing" : "publishing a new"} archive`, () => {
    const subject = fixture();
    let seal;
    let checks = 0;
    let archives = 0;
    if (existing) writeFileSync(subject.options.output, "previous good release");
    try {
      // Model the OS resource seal at the injected signing boundary. The production packager
      // performs every real filesystem operation, including the manifest write that breaks it.
      assert.throws(() => packageDesktopContainer({
        ...subject.options,
        platform: "darwin",
        signing: { identity: "test identity" },
        run(command, args, options) {
          if (command !== "codesign") {
            archives++;
            return archive(command, args, options);
          }
          const target = args.at(-1);
          if (args.includes("--sign")) {
            seal = files(target);
            return { status: 0, stdout: "", stderr: "" };
          }
          assert.ok(args.includes("--verify"));
          assert.ok(args.includes("--strict"));
          assert.ok(args.includes("--deep"));
          checks++;
          const valid = JSON.stringify(files(target)) === JSON.stringify(seal);
          return { status: valid ? 0 : 1, stderr: valid ? "" : "a sealed resource was added" };
        },
      }), /TN_DESKTOP_CODESIGN_FINAL_VERIFY_FAILED/u);
      assert.equal(checks, 2, "verify both the initial signature and the final staged bundle");
      assert.equal(archives, 0, "invalid signatures must be rejected before archiving/notarizing");
      if (existing) assert.equal(readFileSync(subject.options.output, "utf8"), "previous good release");
      else assert.equal(existsSync(subject.options.output), false);
    } finally {
      rmSync(subject.root, { force: true, recursive: true });
    }
  });
}

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
