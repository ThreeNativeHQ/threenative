import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import {
  DAWN_ANDROID_ARCHIVE_NAME,
  assertDawnAndroidArchive,
  dawnAndroidArchivePath,
  normalizeWebgpuBackend,
} from "../scripts/download-deps.mjs";

const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const temporary = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
});

test("Android Dawn is an explicit arm64 spike and refuses a missing archive", () => {
  const cmake = readFileSync(join(runtimeRoot, "CMakeLists.txt"), "utf8");
  const matrix = JSON.parse(readFileSync(join(runtimeRoot, "build-matrix.json"), "utf8"));
  assert.match(cmake, /MYSTRAL_WEBGPU_BACKEND/u);
  assert.match(cmake, /MYSTRAL_WEBGPU_BACKEND STREQUAL "dawn"/u);
  assert.match(cmake, /TN_DAWN_ANDROID_ARCHIVE_MISSING/u);
  assert.match(cmake, /ANDROID_ABI STREQUAL "arm64-v8a"/u);
  assert.deepEqual(
    matrix.configurations.find(({ directory }) => directory === "tn-android-dawn"),
    {
      cacheVariables: { ANDROID_ABI: "arm64-v8a", MYSTRAL_WEBGPU_BACKEND: "dawn" },
      directory: "tn-android-dawn",
      owner: "PRD-329 Phase 2 Dawn-on-Android spike — arm64 only; no product default change",
      preset: "tn-android",
      runs: [],
    },
  );

  assert.equal(normalizeWebgpuBackend("auto"), "auto");
  assert.equal(normalizeWebgpuBackend("dawn"), "dawn");
  assert.throws(() => normalizeWebgpuBackend("metal"), /TN_WEBGPU_BACKEND_INVALID/u);

  const thirdParty = makeTempDirSync("threenative-dawn-android-");
  temporary.push(thirdParty);
  const archive = dawnAndroidArchivePath(thirdParty);
  assert.equal(archive, join(thirdParty, "dawn-android", DAWN_ANDROID_ARCHIVE_NAME));
  assert.throws(
    () => assertDawnAndroidArchive(thirdParty),
    /TN_DAWN_ANDROID_ARCHIVE_MISSING/u,
  );
  mkdirSync(join(thirdParty, "dawn-android"), { recursive: true });
  writeFileSync(archive, "Dawn arm64 fixture");
  assert.equal(assertDawnAndroidArchive(thirdParty), archive);
});
