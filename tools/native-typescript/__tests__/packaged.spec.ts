import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { apkLibraries, resolveGradle, runPackaged } from "../packaged.mjs";

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
    const home = makeTempDirSync("tn-gradle-");
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
    const home = makeTempDirSync("tn-gradle-");
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
    const dir = makeTempDirSync("tn-apk-");
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

describe("runPackaged", () => {
  const request = { adb: "adb", serial: "S1", library: "/nonexistent/lib.so" };

  it("refuses a case name that is not a library name, before anything is built or pushed", async () => {
    await expect(runPackaged({ ...request, name: "../etc/passwd" })).rejects.toThrow(
      /TN_NATIVE_TS_USAGE.*not a library name/u,
    );
  });

  it("refuses alloc-loop, whose resident-set ceiling an app run cannot read", async () => {
    await expect(runPackaged({ ...request, name: "alloc-loop" })).rejects.toThrow(
      /TN_NATIVE_TS_USAGE: alloc-loop checks peak resident set/u,
    );
  });
});
