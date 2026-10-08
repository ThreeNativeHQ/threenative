import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { findTarget, pickNdkVersion } from "../android.mjs";

describe("pickNdkVersion", () => {
  it("takes the newest allowed major and reads each part as a number, not a string", () => {
    const installed = ["27.0.12077973", "27.1.12297006", "28.2.13676358", "29.0.14206865"];
    expect(pickNdkVersion(installed, [28, 27])).toBe("28.2.13676358");
    expect(pickNdkVersion(installed, [29])).toBe("29.0.14206865");
    expect(pickNdkVersion(["9.0.0"], [28, 27])).toBeUndefined();
  });

  it("orders by each component, so 27.10 is newer than 27.9", () => {
    expect(pickNdkVersion(["27.9.12345", "27.10.1"], [27])).toBe("27.10.1");
  });
});

describe("findTarget", () => {
  it("matches the file whose triple names the target, so --target carries no file name", () => {
    const found = findTarget("aarch64-linux-android");
    expect(found?.file).toBe(path.join(import.meta.dirname, "..", "targets", "android-arm64.json"));
    expect(found?.target.abi).toBe("arm64-v8a");
    expect(found?.target.maxPageSize).toBe(16384);
  });

  it("returns nothing for a triple no target file pins", () => {
    expect(findTarget("riscv64-linux-android")).toBeUndefined();
  });

  it("returns nothing rather than throwing when there is no targets directory", () => {
    const missing = path.join(makeTempDirSync("tn-targets-"), "gone");
    expect(findTarget("aarch64-linux-android", missing)).toBeUndefined();
  });
});
