import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { test } from "vitest";
import { absoluteErrorRatio } from "../conformance/metrics.mjs";
import { isMultitouchProofSatisfied } from "../conformance/multitouch-proof.mjs";
import {
  compareCaptures,
  compareScreenSpaceGlyphs,
  inspectCapture,
  inspectScreenSpaceGlyphs,
} from "../conformance/metrics.mjs";
import {
  androidMultitouchArgs,
  shouldRunAndroidMultitouch,
} from "../conformance/parity-extras.mjs";
import {
  createProjectRegistry,
  projectId,
  resolveParityProject,
} from "../conformance/project-mode.mjs";
import {
  androidDeviceKind,
  androidDeathExcerpt,
  androidDependencyBlocker,
  ANDROID_CAPTURE_SIZE,
  androidDisplayRestoreTarget,
  androidDisplaySize,
  androidForegroundBlocker,
  androidWindowDump,
  androidFocusedWindowOwner,
  androidSystemDialog,
  buildProvenance,
  validateRegistry,
  validateReport,
} from "../conformance/run-conformance.mjs";
import {
  buildAndroidConformanceAsset,
  parseConformanceBundleArgs,
} from "../scripts/build-android-conformance.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runner = join(root, "conformance/run-conformance.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      // A runner spawned by a test is a nested lane, never the outermost one: it must not
      // register its own parity lease, or it collides with the live lease the suite wrapper
      // (run-test-suite.sh) already holds and every package-test run fails TN_WORKTREE_OWNED.
      TN_GATE_NESTED: "1",
      ...process.env,
      ...env,
    },
    timeout: 120_000,
  });
}

test("the workspace test lane stays runtime-free and runs the native contract suite", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const testScript = manifest.scripts?.test ?? "";

  assert.match(testScript, /vitest/, "package test must run the imported contract suite");
  assert.doesNotMatch(
    testScript,
    /cmake|gradle|xcodebuild|native:build/,
    "default package tests must not require a native toolchain",
  );
});

test("Android supplemental proof forwards the device without a literal option separator", () => {
  assert.deepEqual(androidMultitouchArgs("/runtime", "emulator-5556"), [
    "--dir",
    "/runtime",
    "native:verify:android:multitouch",
    "--device",
    "emulator-5556",
  ]);
});

test("dry run validates and bundles implemented rows without a browser or native runtime", () => {
  const dir = makeTempDirSync("threenative-conformance-");
  try {
    const out = join(dir, "dry-report.json");
    const proc = run(["--dry-run", "--out", out], {
      FIREFOX_BIN: join(dir, "missing-firefox"),
      TN_RUNTIME: join(dir, "missing-runtime"),
      MYSTRAL_BIN: "",
    });

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, "utf8"));
    const registry = JSON.parse(readFileSync(join(root, "conformance/registry.json"), "utf8"));
    const implemented = registry.tests.filter((entry) => entry.status === "implemented").length;
    assert.equal(report.mode, "dry-run");
    assert.equal(report.summary.validated, implemented);
    assert.equal(report.summary.pass, 0, "dry run must not claim runtime conformance passes");
    assert.equal(report.host.browser, null);
    assert.equal(report.host.runtime, null);
    assert.deepEqual(
      report.results.map((result) => result.id),
      registry.tests.map((entry) => entry.id),
      "non-project reports must retain every registry row in exact order",
    );
    assert.ok(
      report.results
        .filter((result) => result.status === "validated")
        .every((result) => result.browserBundle && result.nativeBundle),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

test("project mode resolves the configured native entry and dry-bundles only that project", () => {
  const dir = makeTempDirSync("threenative-parity-project-");
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ threenative: { nativeEntry: "src/portable.ts" } }),
    );
    writeFileSync(
      join(dir, "src/portable.ts"),
      "const isDev = import.meta.env?.DEV === true; export default { ctx: null, async start() { this.ctx = { renderer: { isDev }, scene: {}, camera: {} }; } };\n",
    );
    const out = join(dir, "dry-report.json");
    const proc = run(["--dry-run", "--project", dir, "--out", out]);

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.project.root, dir);
    assert.equal(report.project.nativeEntry, "src/portable.ts");
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0].status, "validated");
    assert.match(report.results[0].id, /^project-[a-f0-9]{12}$/u);
    assert.ok(report.results[0].browserBundle);
    assert.ok(report.results[0].nativeBundle);
    const nativeBundle = readFileSync(join(root, report.results[0].nativeBundle), "utf8");
    assert.doesNotThrow(
      () => Function(nativeBundle),
      "native project bundles must compile in the runtime's plain-script mode",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project mode fails closed for a missing or escaping native entry", () => {
  const dir = makeTempDirSync("threenative-parity-project-");
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ threenative: { nativeEntry: "../outside.ts" } }),
    );
    assert.throws(() => resolveParityProject(dir), /TN_PARITY_NATIVE_ENTRY_OUTSIDE_PROJECT/u);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ threenative: { nativeEntry: "src/missing.ts" } }),
    );
    assert.throws(() => resolveParityProject(dir), /TN_PARITY_NATIVE_ENTRY_MISSING/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent project lanes use project-specific generated scene identities", () => {
  assert.notEqual(projectId({ root: "/project/minimal" }), projectId({ root: "/project/starter" }));
  const source = readFileSync(runner, "utf8");
  assert.match(source, /project-scene.*projectId\(project\)/u);
});

test("project browser captures wait for asynchronous WebGPU pipelines to render", () => {
  const registry = createProjectRegistry(
    { schemaVersion: 1, threeVersion: "test", exclusions: [] },
    "scene.js",
    { root: "/project", nativeEntry: "src/game.ts" },
  );
  assert.equal(registry.tests[0].captureFrames, 60);
  assert.deepEqual(registry.tests[0].tolerance, {
    pixelMismatchRatio: 0.03,
    perceptualDeltaE: 6,
  });
  const source = readFileSync(runner, "utf8");
  assert.match(source, /test\.captureFrames \?\? 2/u);
});

test("browser capture resolves scaffold public assets from the server root", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(source, /<base href="\/">/u);
});

test("physical Android target distinguishes emulators and requires an explicit device", () => {
  assert.equal(androidDeviceKind({ qemu: "1", hardware: "ranchu" }), "emulator");
  assert.equal(androidDeviceKind({ qemu: "0", hardware: "qcom" }), "physical");
  const dir = makeTempDirSync("threenative-physical-report-");
  try {
    const out = join(dir, "report.json");
    const proc = run(["--target", "android-hardware", "--out", out]);
    assert.equal(proc.status, 2, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.target, "android-hardware");
    assert.ok(report.results.every((result) => result.status === "blocked"));
    assert.match(
      report.results.find((result) => result.blockedReason)?.blockedReason ?? "",
      /TN_PARITY_PHYSICAL_DEVICE_REQUIRED/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Android capture rejects system ANR and error overlays", () => {
  assert.equal(
    androidSystemDialog(
      "Window #6 Window{c387534 u0 Application Not Responding: com.android.systemui}:\n",
    ),
    "Application Not Responding: com.android.systemui",
  );
  assert.equal(
    androidSystemDialog("Window{123 u0 Application Error: com.example.game}\n"),
    "Application Error: com.example.game",
  );
  assert.equal(androidSystemDialog("mCurrentFocus=Window{123 u0 com.threenative.game}"), null);
});

test("Android capture waits for the pinned landscape size instead of reporting a rotation as a pixel mismatch", () => {
  assert.equal(ANDROID_CAPTURE_SIZE, "1280x720");
  assert.equal(
    androidDisplaySize("Physical size: 1080x2400\nOverride size: 1280x720"),
    "1280x720",
  );
  // Mid-rotation the override still reads the portrait panel; that is the state that produced a
  // 720x1280 capture and a red row blaming the pixels.
  assert.equal(androidDisplaySize("Physical size: 1080x2400"), "1080x2400");
  assert.equal(androidDisplaySize("wm: command not found"), null);

  const source = readFileSync(runner, "utf8");
  assert.match(source, /await waitForAndroidDisplaySize\(common, ANDROID_CAPTURE_SIZE\)/u);
  assert.match(source, /TN_ANDROID_DISPLAY_ORIENTATION: captured \$\{capture\.width\}/u);
});

test("the foreground guard reads a window dump that actually carries mCurrentFocus", () => {
  // 2026-08-19: the emulator lane reported 66 rows of TN_ANDROID_FOCUS_UNKNOWN and stopped before
  // any pixel comparison. Nothing was wrong with the guard or the renderer. Android 15 (API 35)
  // stopped printing `mCurrentFocus` under the `windows` subcommand, and the lane was asking for
  // exactly that dump. A guard fed a dump the field was never in fails closed forever, which reads
  // as a lane that cannot be run rather than as a lane asking the wrong question.
  //
  // Both strings below are real `adb -s emulator-5554` output from
  // sdk_gphone64_x86_64, ro.build.version.sdk=35, on 2026-08-19.
  const apiThirtyFiveWindowsSubcommand = [
    "WINDOW MANAGER WINDOWS (dumpsys window windows)",
    "  Window #0 Window{52ed8e5 u0 ScreenDecorOverlayBottom}:",
    "    mDisplayId=0 rootTaskId=1 mSession=Session{9a1cfb6 829:u0a10181}",
    "    mOwnerUid=10181 showForAllUsers=true package=com.android.systemui appop=NONE",
  ].join("\n");
  const apiThirtyFiveFullDump = [
    "  mLayoutSeq=4948",
    "  mCurrentFocus=Window{2528440 u0 com.threenative.game/com.threenative.runtime.MystralActivity}",
    "  mFocusedApp=ActivityRecord{585e449 u0 com.threenative.game/com.threenative.runtime.MystralActivity t296}",
  ].join("\n");

  // The field is genuinely absent from the subcommand the lane used, so the guard was right to
  // refuse. This row is the defect, recorded rather than argued.
  assert.equal(androidFocusedWindowOwner(apiThirtyFiveWindowsSubcommand), null);
  assert.match(
    androidForegroundBlocker(apiThirtyFiveWindowsSubcommand),
    /TN_ANDROID_FOCUS_UNKNOWN/u,
  );

  const asked = [];
  const common = (...args) => {
    asked.push(args.join(" "));
    return {
      stdout: args.at(-1) === "windows" ? apiThirtyFiveWindowsSubcommand : apiThirtyFiveFullDump,
    };
  };
  // The dump the lane takes must be one the field is in, on this API level.
  assert.equal(androidForegroundBlocker(androidWindowDump(common)), null);
  assert.deepEqual(asked, ["shell dumpsys window"]);

  // And the call sites take it through that helper, so a revert to the `windows` subcommand turns
  // this test red instead of turning 66 conformance rows red.
  const source = readFileSync(runner, "utf8");
  assert.match(source, /androidForegroundBlocker\(androidWindowDump\(common\)\)/u);
  assert.doesNotMatch(source, /common\("shell", "dumpsys", "window", "windows"\)/u);
});

test("a capture is refused when any window but the app owns focus", () => {
  // 2026-08-17: a physical Pixel 8 sat behind Android's "app which is currently being tested"
  // prompt with the notification shade above it. That dialog is neither an ANR nor an Application
  // Error, so the old check saw nothing, and the lane photographed the home screen 67 times and
  // reported 67 rows of pixelMismatchRatio 1.000.
  const blocked = "  mCurrentFocus=Window{f453d09 u0 android}";
  assert.match(androidForegroundBlocker(blocked), /TN_ANDROID_FOREGROUND_WINDOW: 'android' owns focus/u);
  assert.equal(androidFocusedWindowOwner(blocked), "android");

  const ours = "  mCurrentFocus=Window{a1 u0 com.threenative.game/com.threenative.runtime.MystralActivity}";
  assert.equal(androidForegroundBlocker(ours), null);

  // A dump with no focus line is not a pass. Fail closed.
  assert.match(androidForegroundBlocker("nothing here"), /TN_ANDROID_FOCUS_UNKNOWN/u);

  // The two strings the old check knew about still fail, by their own code.
  assert.match(
    androidForegroundBlocker("Window{1 u0 Application Error: com.threenative.game}"),
    /TN_ANDROID_SYSTEM_DIALOG/u,
  );

  const source = readFileSync(runner, "utf8");
  assert.match(source, /const beforeCaptureBlocker = androidForegroundBlocker\(/u);
  assert.match(source, /const afterCaptureBlocker = androidForegroundBlocker\(/u);
});

test("a leaked capture-size override is reset rather than restored back onto the device", () => {
  // The 2026-08-17 defect, as a unit. A previous run left `Override size: 1280x720` on a physical
  // Pixel 8; every later row read that as the operator's setting and put it back, so the phone
  // stayed letterboxed while every restore reported success.
  assert.equal(
    androidDisplayRestoreTarget("Physical size: 1080x2400\nOverride size: 1280x720"),
    "reset",
  );
  // No override to begin with is the ordinary case and still resets.
  assert.equal(androidDisplayRestoreTarget("Physical size: 1080x2400"), "reset");
  // An override the operator set for their own reasons is preserved.
  assert.equal(
    androidDisplayRestoreTarget("Physical size: 1080x2400\nOverride size: 800x600"),
    "800x600",
  );

  const source = readFileSync(runner, "utf8");
  // The restore is read back, because exit status is what the command claims and this is what the
  // device is.
  assert.match(source, /TN_ANDROID_DISPLAY_LEAKED/u);
  // A per-row finally cannot survive a signal, and this lane mutates hardware.
  assert.match(source, /armAndroidDisplayGuard\(tools\.adb, serial\)/u);
  assert.match(source, /process\.once\("exit", reset\)/u);
});

test("Android rows uninstall the test package before each large debug APK install", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(source, /androidArgs\(serial, "uninstall", APP_ID\)/u);
  assert.match(source, /await wait\(2_000\);\s+const install/u);
  assert.match(source, /freshInstall: true/u);
});

test("Android parity owns the standalone multitouch proof without contaminating project mode", () => {
  assert.equal(
    shouldRunAndroidMultitouch({ dryRun: false, project: null, target: "android" }),
    true,
  );
  assert.equal(
    shouldRunAndroidMultitouch({ dryRun: false, project: { root: "/project" }, target: "android" }),
    false,
  );
  assert.equal(
    shouldRunAndroidMultitouch({ dryRun: true, project: null, target: "android" }),
    false,
  );
  const source = readFileSync(runner, "utf8");
  assert.match(source, /report\.supplemental[\s\S]*androidMultitouch/u);
  assert.match(source, /androidMultitouch\?\.status === "fail" \? 1 : reportExitCode/u);
});

test("Android reports fail closed when multitouch supplemental evidence is missing", () => {
  const registry = JSON.parse(readFileSync(join(root, "conformance/registry.json"), "utf8"));
  const report = {
    schemaVersion: "0.3.0",
    registrySchemaVersion: registry.schemaVersion,
    threeVersion: registry.threeVersion,
    mode: "execution",
    target: "android",
    project: null,
    provenance: buildProvenance(),
    summary: { pass: 0, fail: 0, blocked: registry.tests.length, planned: 0, validated: 0 },
    results: registry.tests.map(({ id }) => ({ id, status: "blocked" })),
  };
  assert.match(validateReport(report, registry).join("\n"), /androidMultitouch pass or fail/u);
  report.supplemental = { androidMultitouch: { status: "fail", exitCode: 1 } };
  assert.deepEqual(validateReport(report, registry), []);
});

test("report validation rejects a pass with null metrics or incomplete browser execution", () => {
  const dir = makeTempDirSync("threenative-conformance-");
  try {
    const registry = JSON.parse(readFileSync(join(root, "conformance/registry.json"), "utf8"));
    const results = registry.tests.map((entry) => ({
      id: entry.id,
      status: entry.status === "implemented" ? "pass" : "planned",
      browser: entry.status === "implemented" ? { completed: false, screenshot: null } : null,
      native: entry.status === "implemented" ? { completed: true, screenshot: "native.png" } : null,
      metrics: { pixelMismatchRatio: null, perceptualDeltaE: null },
      gpuValidationErrors: [],
    }));
    const report = {
      schemaVersion: "0.2.0",
      registrySchemaVersion: registry.schemaVersion,
      threeVersion: registry.threeVersion,
      mode: "execution",
      summary: {
        pass: results.filter((entry) => entry.status === "pass").length,
        fail: 0,
        blocked: 0,
        planned: results.filter((entry) => entry.status === "planned").length,
        validated: 0,
      },
      results,
    };
    const reportPath = join(dir, "invalid-report.json");
    writeFileSync(reportPath, JSON.stringify(report));

    const proc = run(["--validate-report", reportPath]);
    assert.notEqual(proc.status, 0);
    assert.match(
      proc.stderr,
      /completed browser execution|finite pixelMismatchRatio|finite perceptualDeltaE/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ImageMagick Q16 HDRI absolute error is normalized to a pixel ratio", () => {
  assert.equal(absoluteErrorRatio("65535", 100, "ImageMagick 7.1.2-10 Q16-HDRI"), 0.01);
  assert.equal(absoluteErrorRatio("1", 100, "ImageMagick 7.1.2-10 Q16-HDRI"), 0.01);
  assert.ok(Number.isNaN(absoluteErrorRatio("65535", 100, "unknown quantum depth")));
});

test("bounded execution rejects unknown conformance ids before claiming a report", () => {
  const proc = run(["--dry-run", "--only-tests", "not-a-row"]);
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /Unknown --only-tests/u);
});

test("registry exclusions fail closed without an owner, reason, or explicit excluded status", () => {
  const registry = JSON.parse(readFileSync(join(root, "conformance/registry.json"), "utf8"));
  assert.deepEqual(validateRegistry(registry), []);

  const malformed = structuredClone(registry);
  malformed.exclusions[0].owner = "";
  malformed.exclusions[1].reason = "";
  malformed.exclusions[2].status = "planned";
  const errors = validateRegistry(malformed).join("\n");
  assert.match(errors, /owner must be a non-empty string/u);
  assert.match(errors, /reason must be a non-empty string/u);
  assert.match(errors, /status must be excluded/u);
});

test("help exits without starting any parity lane", () => {
  const proc = run(["--help"]);
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  assert.match(proc.stdout, /--target web\|desktop\|android\|all/u);
  assert.doesNotMatch(proc.stdout, /"wrote"/u);
});

test("execution reports use only pass, fail, or blocked and blocked exits 2", () => {
  const dir = makeTempDirSync("threenative-conformance-");
  try {
    const out = join(dir, "desktop-report.json");
    const proc = run(
      [
        "--target",
        "desktop",
        "--only-tests",
        "15-mesh-toon-material-gradientmap",
        "--reference",
        join(dir, "missing-reference"),
        "--out",
        out,
      ],
      { THREENATIVE_RUNTIME_BINARY: join(dir, "missing-runtime") },
    );
    assert.equal(proc.status, 2, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.mode, "execution");
    assert.ok(report.results.every(({ status }) => ["pass", "fail", "blocked"].includes(status)));
    assert.ok(report.summary.blocked > 0);
    assert.match(
      report.results.find((result) => result.id === "15-mesh-toon-material-gradientmap")
        ?.blockedReason ?? "",
      /TN_PARITY_DESKTOP_RUNTIME_MISSING/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uniform captures fail closed even when reference and candidate bytes match", () => {
  const uniform = new PNG({ width: 2, height: 1 });
  uniform.data.set([12, 34, 56, 255, 12, 34, 56, 255]);
  const uniformPng = PNG.sync.write(uniform);
  assert.throws(() => inspectCapture(uniformPng), /uniform/u);
  assert.throws(() => compareCaptures(uniformPng, uniformPng), /uniform/u);

  uniform.data.set([12, 34, 56, 255, 13, 34, 56, 255]);
  const visiblePng = PNG.sync.write(uniform);
  assert.deepEqual(compareCaptures(visiblePng, visiblePng), {
    pixelMismatchRatio: 0,
    perceptualDeltaE: 0,
    width: 2,
    height: 1,
  });
});

test("screen-space glyph raster fails closed on missing pixels and drifting bounds", () => {
  const glyphCapture = (offsetX, count = 1_000) => {
    const png = new PNG({ width: 64, height: 32 });
    png.data.fill(255);
    for (let index = 0; index < png.data.length; index += 4) {
      png.data[index] = 20;
      png.data[index + 1] = 24;
      png.data[index + 2] = 32;
    }
    for (let pixel = 0; pixel < count; pixel += 1) {
      const x = offsetX + (pixel % 40);
      const y = 3 + Math.floor(pixel / 40);
      const index = (y * png.width + x) * 4;
      png.data.set([246, 224, 94, 255], index);
    }
    return PNG.sync.write(png);
  };
  assert.equal(inspectScreenSpaceGlyphs(glyphCapture(4)).brightPixels, 1_000);
  assert.deepEqual(compareScreenSpaceGlyphs(glyphCapture(4), glyphCapture(5)).boundsDelta, [
    1, 0, 1, 0,
  ]);
  assert.throws(() => inspectScreenSpaceGlyphs(glyphCapture(4, 999)), /expected at least 1000/u);
  assert.throws(
    () => compareScreenSpaceGlyphs(glyphCapture(4), glyphCapture(6)),
    /bounds drift/u,
  );
});

test("Android conformance override requires an explicit matching bundle hash", () => {
  const dir = makeTempDirSync("threenative-android-conformance-");
  try {
    const bundle = join(dir, "row.js");
    const output = join(dir, "assets/scripts/main.js");
    writeFileSync(bundle, 'console.info("TN_CONFORMANCE_READY:test");\n');
    const hash = createHash("sha256").update(readFileSync(bundle)).digest("hex");
    assert.throws(() => parseConformanceBundleArgs(["--bundle", bundle]), /requires both/u);
    assert.throws(
      () => buildAndroidConformanceAsset({ bundle, expectedSha256: "0".repeat(64), output }),
      /hash mismatch/u,
    );
    const metadata = buildAndroidConformanceAsset({ bundle, expectedSha256: hash, output });
    assert.equal(metadata.outputSha256, hash);
    assert.deepEqual(readFileSync(output), readFileSync(bundle));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Android parity blocks before Gradle when the pinned SDL3 AAR is absent", () => {
  const dir = makeTempDirSync("threenative-android-deps-");
  try {
    const reason = androidDependencyBlocker(dir);
    assert.match(reason ?? "", /^TN_PARITY_ANDROID_DEPS_BLOCKED:/u);
    assert.match(reason ?? "", /SDL3-3\.2\.8\.aar does not exist/u);
    assert.match(reason ?? "", /checked source and packaged Android dependency layouts/u);
    assert.match(reason ?? "", /libmystral-runtime\.so/u);
    assert.match(reason ?? "", /pnpm native:build/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Android parity blocks a partial packaged layout even when the source AAR exists", () => {
  const dir = makeTempDirSync("threenative-android-partial-prebuilt-");
  try {
    mkdirSync(join(dir, "third_party/sdl3-android"), { recursive: true });
    writeFileSync(join(dir, "third_party/sdl3-android/SDL3-3.2.8.aar"), "fixture");
    mkdirSync(join(dir, "android/prebuilt"), { recursive: true });
    writeFileSync(join(dir, "android/prebuilt/SDL3-3.2.8.aar"), "fixture");

    assert.ok(androidDependencyBlocker(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Android parity accepts a source-only SDL3 dependency layout", () => {
  const dir = makeTempDirSync("threenative-android-source-only-");
  try {
    mkdirSync(join(dir, "third_party/sdl3-android"), { recursive: true });
    writeFileSync(join(dir, "third_party/sdl3-android/SDL3-3.2.8.aar"), "fixture");

    assert.equal(androidDependencyBlocker(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Android parity accepts a complete packaged dependency layout", () => {
  const dir = makeTempDirSync("threenative-android-prebuilt-");
  try {
    const files = [
      "android/prebuilt/SDL3-3.2.8.aar",
      "android/prebuilt/jniLibs/arm64-v8a/libSDL3.so",
      "android/prebuilt/jniLibs/arm64-v8a/libmystral-runtime.so",
      "android/prebuilt/jniLibs/x86_64/libSDL3.so",
      "android/prebuilt/jniLibs/x86_64/libmystral-runtime.so",
    ];
    for (const file of files) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "fixture");
    }
    assert.equal(androidDependencyBlocker(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("root parity command and Gradle lane use an explicit checksum-locked override", () => {
  const rootManifest = JSON.parse(readFileSync(join(root, "../../package.json"), "utf8"));
  assert.match(rootManifest.scripts?.parity ?? "", /run-conformance\.mjs/u);
  const gradle = readFileSync(join(root, "android/app/build.gradle.kts"), "utf8");
  assert.match(gradle, /threenativeConformanceBundleSha256/u);
  assert.match(gradle, /buildAndroidConformanceBundle/u);
  assert.match(gradle, /else dependsOn\("buildAndroidFirstProofBundle"\)/u);
});

test("native workflow runs the complete checksum-locked Android emulator parity lane", () => {
  const workflow = readFileSync(join(root, "../../.github/workflows/native-platforms.yml"), "utf8");
  assert.match(workflow, /packages\/runtime-native\/\*\*/u);
  assert.match(workflow, /android-actions\/setup-android@v4/u);
  assert.match(workflow, /download-deps\.mjs --android/u);
  assert.match(workflow, /--target android --device emulator-5554/u);
  assert.doesNotMatch(workflow, /implemented-only/u);
});

test("the parity registry binds the simultaneous stick-and-jump proof to Android injection", () => {
  const registry = JSON.parse(readFileSync(join(root, "conformance/registry.json"), "utf8"));
  const proof = registry.tests.find((entry) => entry.id === "90-multitouch-input");
  assert.deepEqual(proof, {
    category: "input",
    desktopGate: false,
    id: "90-multitouch-input",
    inputProof: "multitouch",
    required: true,
    scene: "conformance/scenes/shared/multitouch-input.js",
    status: "implemented",
    title: "simultaneous stick and jump input",
    tolerance: { perceptualDeltaE: 3, pixelMismatchRatio: 0.01 },
  });
  const runner = readFileSync(join(root, "conformance/run-conformance.mjs"), "utf8");
  assert.match(runner, /androidMultitouchScript/u);
  assert.match(runner, /isMultitouchProofSatisfied\(proof\)/u);
  assert.match(runner, /TN_MULTITOUCH_PROOF_PASS/u);
});

test("the browser multitouch control can drop one pointer and remains fail-closed", () => {
  const runner = readFileSync(join(root, "conformance/run-conformance.mjs"), "utf8");
  assert.match(runner, /TN_MULTITOUCH_DROP_POINTER/u);
  assert.match(runner, /MULTITOUCH_PROOF_POINTS\.slice\(0, 1\)/u);
  assert.match(runner, /TN_MULTITOUCH_TIMEOUT_MS/u);
});

test("multitouch proof rejects sequential contacts and accepts overlapping contacts", () => {
  const sequential = [
    { leftGround: false, moved: true, pointers: 1, simultaneous: false },
    { leftGround: true, moved: true, pointers: 1, simultaneous: false },
  ];
  const overlapping = [
    { leftGround: false, moved: true, pointers: 2, simultaneous: false },
    { leftGround: true, moved: true, pointers: 2, simultaneous: true },
  ];

  assert.equal(sequential.some(isMultitouchProofSatisfied), false);
  assert.equal(overlapping.some(isMultitouchProofSatisfied), true);
});

test("multitouch proof rejects two pointers that never overlapped the stick and jump halves", () => {
  assert.equal(
    isMultitouchProofSatisfied({
      leftGround: true,
      moved: true,
      pointers: 2,
      simultaneous: false,
    }),
    false,
  );
});

test("Android screenshot capture preserves PNG bytes", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(
    source,
    /androidArgs\(serial, "exec-out", "screencap", "-p"\),[\s\S]*?binary: true/u,
    "adb screencap must not decode binary PNG output as UTF-8 text",
  );
});

test("Android capture uses reference dimensions and restores the prior display override", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(source, /common\("shell", "wm", "size", ANDROID_CAPTURE_SIZE\)/u);
  // Was `displayRestore = /^Override size:` inline, which echoed a leaked override straight back
  // onto the device. The decision now lives in `androidDisplayRestoreTarget`, which is tested
  // against the leak case directly rather than by matching the source line that caused it.
  assert.match(source, /displayRestore = androidDisplayRestoreTarget\(originalSize\)/u);
  assert.match(source, /finally \{[\s\S]*?displayRestore/u);
  assert.match(
    source,
    /androidArgs\(serial, "shell", "wm", "size", displayRestore\)[\s\S]*?allowFailure: true/u,
  );
});

test("Android checks liveness after its marker, settle window, and screenshot", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(
    source,
    /conformance marker[\s\S]*?await wait\(settleMs\)[\s\S]*?settle window[\s\S]*?screencap[\s\S]*?after screenshot capture/u,
  );
});

test("Linux desktop parity selects SDL X11 because the native surface does not support Wayland", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(source, /process\.platform === "linux"[\s\S]*SDL_VIDEODRIVER: "x11"/u);
});

test("a pre-marker death excerpt carries the app's own diagnostic lines, not death chatter", () => {
  // PRD-166 phase 3: the full-lane rerun's row error appended a raw 400-char tail that was
  // Window Manager lines merely naming the app, crowding out the scene trace that names the
  // stage the process reached. The excerpt must prefer the app's TN_* diagnostics and fall back
  // to the bare message when the log has none.
  const log = [
    "08-22 15:14:15.900  8101  8120 I MystralJS: [info] TN_PRD166_TRACE:{\"stage\":\"viewport-begin\",\"index\":1,\"width\":1024,\"height\":768}",
    "08-22 15:14:15.901  8101  8120 I MystralJS: [info] TN_PRD166_TRACE:{\"stage\":\"set-size-returned\",\"index\":1,\"width\":1024,\"height\":768}",
    "08-22 15:14:16.156   588  1949 W ActivityTaskManager: Unable to send transaction to client proc com.threenative.game: no app thread",
  ].join("\n");

  const excerpt = androidDeathExcerpt("Android process exited before the conformance marker.", log);
  assert.match(excerpt, /Android process exited before the conformance marker\./u);
  assert.match(excerpt, /set-size-returned/u, "the app's last diagnostic line must survive");
  assert.doesNotMatch(excerpt, /no app thread/u, "death chatter must not crowd out diagnostics");
  assert.equal(
    androidDeathExcerpt("Android process exited before the conformance marker.", ""),
    "Android process exited before the conformance marker.",
  );
});
