import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apkLibraries, resolveGradle } from "../packaged.mjs";

const pinned = /gradle-([\d.]+)-bin\.zip/u.exec(
  fs.readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "runtime-native",
      "android",
      "gradle",
      "wrapper",
      "gradle-wrapper.properties",
    ),
    "utf8",
  ),
)?.[1];

describe("resolveGradle", () => {
  it("finds the distribution the host's wrapper pins, by version, in the Gradle user home", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tn-gradle-"));
    const bin = path.join(
      home,
      "wrapper",
      "dists",
      `gradle-${pinned}-bin`,
      "abc123",
      `gradle-${pinned}`,
      "bin",
    );
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "gradle"), "#!/bin/sh\n");
    expect(resolveGradle({ GRADLE_USER_HOME: home })).toBe(path.join(bin, "gradle"));
  });

  it("names the missing distribution instead of falling back to some other Gradle", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tn-gradle-"));
    expect(() => resolveGradle({ GRADLE_USER_HOME: home })).toThrow(
      new RegExp(
        `TN_NATIVE_TS_PACKAGE: gradle ${pinned?.replaceAll(".", "\\.")} is not unpacked`,
        "u",
      ),
    );
  });
});

describe.runIf(spawnSync("unzip", ["-v"]).status === 0)("apkLibraries", () => {
  it("lists the arm64 libraries an APK carries and nothing else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-apk-"));
    for (const entry of ["lib/arm64-v8a/libcase.so", "lib/x86_64/libother.so", "classes.dex"]) {
      fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
      fs.writeFileSync(path.join(dir, entry), "x");
    }
    const apk = path.join(dir, "app.apk");
    // python's zipfile CLI writes the archive, so the test needs no `zip` binary.
    spawnSync("python3", ["-m", "zipfile", "-c", apk, "lib", "classes.dex"], { cwd: dir });
    expect(apkLibraries(apk)).toEqual(["lib/arm64-v8a/libcase.so"]);
  });
});
