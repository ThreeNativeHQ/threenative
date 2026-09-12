import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync,  } from 'node:fs';

import { dirname, join } from 'node:path';
import { afterEach, test } from 'vitest';

import {
  ANDROID_RELEASE_SIGNING_PROPERTIES,
  packageAndroid,
  androidBuildRequest,
  androidArtifactCandidates,
  androidReleaseSigning,
  androidUnsignedReleaseApk,
  verifyAndroidReleaseArtifact,
} from '../scripts/package-android.mjs';

const roots = [];
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR4AaXBQRHEAAgEwclWHGDivIBckIWG3Hf/dD/frz9MdOK2BhedOHEkjsTRG524rcFFJ25rcOJIHImjd2tw0YnbGlx04sSROBJHb3TitgYXnbitwYkjcSSO/o/fGRJxtqYFAAAAAElFTkSuQmCC',
  'base64',
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('Android packaging allows AGP to strip native debug symbols', () => {
  const gradle = readFileSync(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
  assert.doesNotMatch(gradle, /keepDebugSymbols/u);
});

function copyRuntimeFile(runtime, relative) {
  const destination = join(runtime, relative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(new URL(`../${relative}`, import.meta.url), destination);
}

function createFakeAndroidRuntime() {
  const runtime = makeTempDirSync('threenative-android-package-');
  roots.push(runtime);
  for (const relative of [
    'android/app/build.gradle.kts',
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/res/values/strings.xml',
    'android/app/src/main/res/values/themes.xml',
  ]) {
    copyRuntimeFile(runtime, relative);
  }
  const wrapper = join(runtime, 'android', 'gradlew');
  writeFileSync(
    wrapper,
    `#!/bin/sh
set -eu
task="\${1:-assembleDebug}"
case "$task" in
  assembleDebug) out="app/build/outputs/apk/debug/app-debug.apk" ;;
  assembleRelease)
    if [ -n "\${ORG_GRADLE_PROJECT_threenativeKeystore:-}" ]; then
      out="app/build/outputs/apk/release/app-release.apk"
      printf '%s' "$ORG_GRADLE_PROJECT_threenativeKeystore" > app/build/last-keystore.txt
    else
      out="app/build/outputs/apk/release/app-release-unsigned.apk"
    fi ;;
  bundleRelease) out="app/build/outputs/bundle/release/app-release.aab" ;;
  *) echo "unexpected Gradle task: $task" >&2; exit 2 ;;
esac
mkdir -p "$(dirname "$out")" app/build
printf '%s' "$task" > app/build/last-task.txt
jar --create --file "$out" \\
  -C app/src/main AndroidManifest.xml \\
  -C app/src/main/res values/strings.xml \\
  -C app/src/main/res values/themes.xml \\
  -C app/src/main/res values/branding.xml \\
  -C app build.gradle.kts \\
  -C app/build/generated/threenative/assets scripts/main.js
if [ -f app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ]; then
  jar --update --file "$out" \\
    -C app/src/main/res mipmap-xxxhdpi/ic_launcher.png
fi
for resource in \\
  mipmap-anydpi-v26/ic_launcher.xml \\
  drawable-nodpi/ic_launcher_foreground.png \\
  drawable-nodpi/ic_launcher_monochrome.png \\
  drawable-nodpi/tn_boot_splash.png; do
  if [ -f "app/src/main/res/$resource" ]; then
    jar --update --file "$out" \\
      -C app/src/main/res "$resource"
  fi
done
if [ -f app/build/generated/threenative/assets/game/level.bin ]; then
  jar --update --file "$out" \\
    -C app/build/generated/threenative/assets game/level.bin
fi
`,

  );
  chmodSync(wrapper, 0o755);
  return runtime;
}

// A stand-in for the consumer's build environment: the four ORG_GRADLE_PROJECT_ properties the
// doctor predicts and the packager forwards. The keystore path is relative on purpose so a test can
// assert the packager resolves it against the consumer project, not the engine.
const SIGNING_ENV = Object.freeze({
  ORG_GRADLE_PROJECT_threenativeKeystore: 'release/my-release.keystore',
  ORG_GRADLE_PROJECT_threenativeKeystoreAlias: 'release',
  ORG_GRADLE_PROJECT_threenativeKeystorePassword: 'store-password-sentinel',
  ORG_GRADLE_PROJECT_threenativeKeyPassword: 'key-password-sentinel',
});

function releaseOptions(projectRoot, overrides = {}) {
  return {
    projectRoot,
    environment: { ...SIGNING_ENV },
    // The integration lane stands in for apksigner/jarsigner; the real verification path is a
    // separate test below. The seam is the only thing faked here.
    verifyReleaseSignature: () => ({ verified: true }),
    ...overrides,
  };
}

function artifactEntry(apk, entry) {
  return execFileSync('unzip', ['-p', apk, entry]);
}

// A wrapper that ignores the requested task and always produces the debug artifact. It is the
// exact failure mode PRD-212 phase 2 forbids: a release request answered with app-debug.apk.
function createDebugOnlyAndroidRuntime() {
  const runtime = createFakeAndroidRuntime();
  const wrapper = join(runtime, 'android', 'gradlew');
  writeFileSync(
    wrapper,
    `#!/bin/sh
set -eu
out="app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$(dirname "$out")" app/build
jar --create --file "$out" -C app/src/main AndroidManifest.xml
`,
  );
  chmodSync(wrapper, 0o755);
  return runtime;
}

function runActivityMetadataProbe() {
  const root = makeTempDirSync('threenative-android-metadata-');
  roots.push(root);
  const sources = {
    'android/os/Bundle.java': `package android.os;

import java.util.HashMap;
import java.util.Map;

public final class Bundle {
  private final Map<String, Object> values = new HashMap<>();

  public void putBoolean(String key, boolean value) { values.put(key, value); }
  public void putInt(String key, int value) { values.put(key, value); }
  public void putString(String key, String value) { values.put(key, value); }
  public boolean getBoolean(String key, boolean fallback) {
    Object value = values.get(key);
    return value instanceof Boolean ? (Boolean) value : fallback;
  }
  public String getString(String key, String fallback) {
    Object value = values.get(key);
    return value instanceof String ? (String) value : fallback;
  }
  public int getInt(String key, int fallback) {
    Object value = values.get(key);
    return value instanceof Integer ? (Integer) value : fallback;
  }
  // The one-argument overload. applyOrientation calls it, and without it here this whole probe
  // failed to compile, so the orientation fix shipped with no compiling test at all.
  public String getString(String key) { return getString(key, null); }
}
`,
    'android/content/pm/ApplicationInfo.java': `package android.content.pm;

import android.os.Bundle;

public final class ApplicationInfo {
  public Bundle metaData;
}
`,
    'android/content/pm/PackageManager.java': `package android.content.pm;

import android.os.Bundle;

public final class PackageManager {
  public static final int GET_META_DATA = 0x00000080;
  private final Bundle metadata;
  public int lastFlags;

  public PackageManager(Bundle metadata) { this.metadata = metadata; }

  public ApplicationInfo getApplicationInfo(String packageName, int flags) throws NameNotFoundException {
    lastFlags = flags;
    ApplicationInfo info = new ApplicationInfo();
    if ((flags & GET_META_DATA) != 0) info.metaData = metadata;
    return info;
  }

  public static final class NameNotFoundException extends Exception {
    private static final long serialVersionUID = 1L;
  }
}
`,
    'android/content/Intent.java': `package android.content;

public final class Intent {
  private final java.util.Map<String, String> extras = new java.util.HashMap<>();
  public String getStringExtra(String key) { return extras.get(key); }
  public Intent putExtra(String key, String value) { extras.put(key, value); return this; }
}
`,
    'android/view/WindowManager.java': `package android.view;

public interface WindowManager {
  final class LayoutParams {
    public static final int FLAG_KEEP_SCREEN_ON = 0x00000080;
  }
}
`,
    'android/os/Build.java': `package android.os;

public final class Build {
  public static final class VERSION { public static int SDK_INT = 35; }
  public static final class VERSION_CODES { public static final int R = 30; }
}
`,
    'android/util/Log.java': `package android.util;

public final class Log {
  public static int i(String tag, String message) { return 0; }
  public static int w(String tag, String message) { return 0; }
}
`,
    'android/view/Surface.java': `package android.view;

public final class Surface {
  public static final int FRAME_RATE_COMPATIBILITY_DEFAULT = 0;
  public float requestedFrameRate = -1.0f;
  public int requestCount = 0;
  public boolean isValid() { return true; }
  public void setFrameRate(float frameRate, int compatibility) {
    requestedFrameRate = frameRate;
    requestCount += 1;
  }
}
`,
    'android/view/SurfaceHolder.java': `package android.view;

public interface SurfaceHolder {
  Surface getSurface();
  void addCallback(Callback callback);
  interface Callback {
    void surfaceCreated(SurfaceHolder holder);
    void surfaceChanged(SurfaceHolder holder, int format, int width, int height);
    void surfaceDestroyed(SurfaceHolder holder);
  }
}
`,
    'android/view/Window.java': `package android.view;

public final class Window {
  private int flags;
  public void addFlags(int value) { flags |= value; }
  public void clearFlags(int value) { flags &= ~value; }
  public boolean hasFlag(int value) { return (flags & value) != 0; }
  public View getDecorView() { return new View(); }
}
`,
    'android/graphics/Insets.java': `package android.graphics;

public final class Insets {
  public final int top;
  public final int right;
  public final int bottom;
  public final int left;
  public Insets(int top, int right, int bottom, int left) {
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    this.left = left;
  }
}
`,
    'android/view/View.java': `package android.view;

public class View {
  public WindowInsets getRootWindowInsets() { return null; }
}
`,
    'android/view/WindowInsets.java': `package android.view;

import android.graphics.Insets;

public final class WindowInsets {
  public Insets getInsets(int types) { return new Insets(0, 0, 0, 0); }
  public static final class Type {
    public static int systemBars() { return 1; }
    public static int displayCutout() { return 2; }
  }
}
`,
    'android/content/pm/ActivityInfo.java': `package android.content.pm;

public final class ActivityInfo {
  public static final int SCREEN_ORIENTATION_UNSPECIFIED = -1;
  public static final int SCREEN_ORIENTATION_SENSOR_LANDSCAPE = 6;
  public static final int SCREEN_ORIENTATION_SENSOR_PORTRAIT = 7;
  public static final int SCREEN_ORIENTATION_FULL_USER = 13;
}
`,
    'org/libsdl/app/SDLSurface.java': `package org.libsdl.app;

import android.view.Surface;
import android.view.SurfaceHolder;

public final class SDLSurface {
  private final Surface surface = new Surface();
  private final SurfaceHolder holder = new SurfaceHolder() {
    public Surface getSurface() { return surface; }
    public void addCallback(SurfaceHolder.Callback callback) { callback.surfaceCreated(this); }
  };
  public SurfaceHolder getHolder() { return holder; }
}
`,
    'org/libsdl/app/SDLActivity.java': `package org.libsdl.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.Window;
import java.io.File;

public class SDLActivity {
  protected static SDLSurface mSurface = new SDLSurface();
  private PackageManager packageManager = new PackageManager(null);
  private final Intent intent = new Intent();
  private final Window window = new Window();

  protected void onCreate(Bundle state) {}
  protected void onResume() {}
  public void onTrimMemory(int level) {}
  protected String[] getLibraries() { return new String[0]; }
  protected String getMainFunction() { return ""; }
  protected String[] getArguments() { return new String[0]; }
  public PackageManager getPackageManager() { return packageManager; }
  public String getPackageName() { return "com.example.game"; }
  public Intent getIntent() { return intent; }
  public Window getWindow() { return window; }
  private int externalFilesDirCalls;
  public File getExternalFilesDir(String type) {
    externalFilesDirCalls += 1;
    File directory = new File(System.getProperty("java.io.tmpdir"), "tn-external-files");
    directory.mkdirs();
    return directory;
  }
  public int externalFilesDirCallCount() { return externalFilesDirCalls; }
  public File getFilesDir() { return new File(System.getProperty("java.io.tmpdir")); }
  public int requestedOrientation = Integer.MIN_VALUE;
  public void setRequestedOrientation(int orientation) { requestedOrientation = orientation; }
  public void setOrientationBis(int width, int height, boolean resizable, String hint) {
    requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
  }
  public void configureMetadata(Bundle metadata) { packageManager = new PackageManager(metadata); }
  public void runOnUiThread(Runnable action) { action.run(); }
  public float requestedFrameRate() { return mSurface.getHolder().getSurface().requestedFrameRate; }
  public int frameRateRequestCount() { return mSurface.getHolder().getSurface().requestCount; }
}
`,
    'com/threenative/runtime/TnUiOverlay.java': `package com.threenative.runtime;

// A stand-in for the real transparent WebView. The probe cares only about whether the activity
// decides to attach one, which is what ui.renderer controls and what acceptance criterion 5 of
// PRD-217 turns on: a game that did not opt in ships no overlay and no extra process.
public final class TnUiOverlay {
  public static int attachCount = 0;
  public static String lastPosted = null;

  public static TnUiOverlay attach(Object activity) {
    attachCount += 1;
    return new TnUiOverlay();
  }

  public void postToPage(String frame) { lastPosted = frame; }
}
`,
    'com/threenative/runtime/MetadataProbe.java': `package com.threenative.runtime;

import android.os.Bundle;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.view.WindowManager;

public final class MetadataProbe {
  private static final class ProbeActivity extends MystralActivity {
    public void create() { onCreate(null); }
    public void resume() { onResume(); }
    public String[] arguments() { return getArguments(); }
    public void applySdlOrientation() { setOrientationBis(1080, 2400, true, ""); }
  }

  private static void require(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }

  public static void main(String[] args) {
    Bundle metadata = new Bundle();
    metadata.putBoolean("TN_KEEP_SCREEN_ON", true);
    metadata.putString("TN_WINDOW_TITLE", "Fox \\\"Deluxe\\\"");
    metadata.putBoolean("TN_FULLSCREEN", false);
    metadata.putString("TN_ORIENTATION", "landscape");
    metadata.putInt("TN_MAX_FPS", 120);

    ProbeActivity activity = new ProbeActivity();
    activity.configureMetadata(metadata);
    activity.create();
    java.io.File mailbox = new java.io.File(
      System.getProperty("java.io.tmpdir"), "tn-mailbox-" + System.nanoTime());
    activity.getIntent().putExtra("TN_PLAYTEST_MAILBOX_ROOT", mailbox.getAbsolutePath());
    String[] arguments = activity.arguments();

    require((activity.getPackageManager().lastFlags & PackageManager.GET_META_DATA) != 0,
      "activity must request PackageManager.GET_META_DATA");
    require(activity.getWindow().hasFlag(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON),
      "keep-screen-on metadata was not applied");
    require("Fox \\\"Deluxe\\\"".equals(arguments[3]),
      "window title metadata was not retrieved");
    require("false".equals(arguments[4]), "fullscreen metadata was not retrieved");
    require("120".equals(arguments[6]), "max-fps metadata was not forwarded to native");
    require(mailbox.isDirectory(), "an explicit playtest mailbox must exist before native startup");
    require(mailbox.getAbsolutePath().equals(arguments[2]),
      "the created playtest mailbox must be forwarded to native");
    require(activity.externalFilesDirCallCount() == 1,
      "Android must initialize app external storage even when the runner supplies a mailbox path");
    require(activity.requestedFrameRate() == 120.0f,
      "max-fps metadata was not requested from the Android surface");
    int requestsBeforeResume = activity.frameRateRequestCount();
    activity.resume();
    require(activity.frameRateRequestCount() > requestsBeforeResume,
      "the Android surface frame-rate request was not reapplied on resume");
    // Android 16+ overrides a manifest orientation for apps it treats as non-adaptive, which is
    // how a landscape-declared game launched portrait on a Pixel 8. Re-requesting it in onCreate
    // is the belt to the manifest property's braces; this asserts that it happens.
    require(activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
      "declared landscape orientation was not re-requested in onCreate");
    activity.applySdlOrientation();
    require(activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
      "SDL window creation overwrote the declared landscape orientation");

    // PRD-217 acceptance criterion 5: a game that did not ask for the web UI renderer ships no
    // overlay at all. The metadata above never mentions TN_UI_RENDERER.
    require(TnUiOverlay.attachCount == 0,
      "a game with no ui.renderer must ship no overlay");

    metadata.putString("TN_UI_RENDERER", "web");
    ProbeActivity web = new ProbeActivity();
    web.configureMetadata(metadata);
    web.create();
    require(TnUiOverlay.attachCount == 1, "ui.renderer web must attach the overlay");
    web.postUiOverlayMessage("{\\"type\\":\\"tn:state\\"}");
    require("{\\"type\\":\\"tn:state\\"}".equals(TnUiOverlay.lastPosted),
      "the runtime's bridge frame must reach the overlay");

    // Anything the packager did not write is the native renderer, not a guess at the expensive one.
    metadata.putString("TN_UI_RENDERER", "webview");
    ProbeActivity typo = new ProbeActivity();
    typo.configureMetadata(metadata);
    typo.create();
    require(TnUiOverlay.attachCount == 1, "an unrecognised ui.renderer must not attach an overlay");
  }
}
`,
    'MystralActivity.java': readFileSync(
      new URL('../android/app/src/main/java/com/mystral/engine/MystralActivity.java', import.meta.url),
      'utf8',
    ),
  };
  const sourcePaths = [];
  for (const [relative, source] of Object.entries(sources)) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    sourcePaths.push(file);
  }
  const classes = join(root, 'classes');
  mkdirSync(classes);
  execFileSync('javac', ['-d', classes, ...sourcePaths], { stdio: 'pipe' });
  execFileSync('java', ['-cp', classes, 'com.threenative.runtime.MetadataProbe'], {
    stdio: 'pipe',
  });
}

test('Android activity retrieves config metadata through PackageManager', () => {
  runActivityMetadataProbe();
});

test('real Android packaging emits configured and no-config artifacts through the default path', async () => {
  const root = makeTempDirSync('threenative-android-package-project-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  const icon = join(root, 'icon.png');
  const foreground = join(root, 'foreground.png');
  const monochrome = join(root, 'monochrome.png');
  const splash = join(root, 'launch.png');
  const assets = join(root, 'public');
  const configuredOutput = join(root, 'dist', 'fox.apk');
  writeFileSync(bundle, 'export default { start() {} };\n');
  writeFileSync(icon, VALID_PNG);
  writeFileSync(foreground, VALID_PNG);
  writeFileSync(monochrome, VALID_PNG);
  writeFileSync(splash, VALID_PNG);
  mkdirSync(assets);
  writeFileSync(join(assets, 'level.bin'), 'level');

  const packageOptions = {
    runtimeRoot: runtime,
    ensureGradleWrapper: async () => undefined,
    prepareAndroidPrebuilts: async () => undefined,
  };
  const config = {
    app: {
      id: 'com.studio.foxgame',
      name: 'Fox',
      version: '1.2.3',
      build: 7,
      icon,
      icons: { android: { foreground, monochrome, background: '#111827' } },
    },
    bootSplash: { backgroundColor: '#0d1b2a', image: splash },
    display: { orientation: 'portrait', fullscreen: false, keepScreenOn: true, maxFps: 120 },
    window: { title: 'Fox Desktop', width: 1024, height: 576, resizable: false },
  };

  await packageAndroid(bundle, configuredOutput, assets, undefined, config, packageOptions);
  const manifest = artifactEntry(configuredOutput, 'AndroidManifest.xml').toString('utf8');
  const strings = artifactEntry(configuredOutput, 'values/strings.xml').toString('utf8');
  const theme = artifactEntry(configuredOutput, 'values/themes.xml').toString('utf8');
  const gradle = artifactEntry(configuredOutput, 'build.gradle.kts').toString('utf8');

  assert.match(manifest, /android:screenOrientation="portrait"/u);
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/u);
  const application = /<application\b[\s\S]*?<\/application>/u.exec(manifest)?.[0];
  const activity = /<activity\b[\s\S]*?<\/activity>/u.exec(manifest)?.[0];
  assert.ok(application);
  assert.ok(activity);
  assert.match(application, /TN_KEEP_SCREEN_ON" android:value="true"/u);
  assert.match(application, /TN_FULLSCREEN" android:value="false"/u);
  assert.match(application, /TN_MAX_FPS" android:value="120"/u);
  assert.match(application, /TN_WINDOW_TITLE" android:value="@string\/window_title"/u);
  assert.doesNotMatch(activity, /TN_KEEP_SCREEN_ON|TN_FULLSCREEN|TN_WINDOW_TITLE/u);
  assert.match(strings, /<string name="app_name">Fox<\/string>/u);
  assert.match(strings, /<string name="window_title">Fox Desktop<\/string>/u);
  assert.match(theme, /android:windowFullscreen">false</u);
  assert.match(theme, /android:windowSplashScreenBackground">@color\/tn_boot_splash_background</u);
  assert.match(theme, /android:windowSplashScreenAnimatedIcon">@drawable\/ic_launcher_foreground</u);
  assert.match(theme, /android:windowSplashScreenBrandingImage">@drawable\/tn_boot_splash</u);
  assert.match(gradle, /applicationId = "com\.studio\.foxgame"/u);
  assert.match(gradle, /versionCode = 7/u);
  assert.match(gradle, /versionName = "1\.2\.3"/u);
  assert.deepEqual(artifactEntry(configuredOutput, 'mipmap-xxxhdpi/ic_launcher.png'), VALID_PNG);
  assert.deepEqual(artifactEntry(configuredOutput, 'drawable-nodpi/ic_launcher_foreground.png'), VALID_PNG);
  assert.deepEqual(artifactEntry(configuredOutput, 'drawable-nodpi/ic_launcher_monochrome.png'), VALID_PNG);
  assert.deepEqual(artifactEntry(configuredOutput, 'drawable-nodpi/tn_boot_splash.png'), VALID_PNG);
  assert.match(
    artifactEntry(configuredOutput, 'mipmap-anydpi-v26/ic_launcher.xml').toString('utf8'),
    /android:drawable="@drawable\/ic_launcher_monochrome"/u,
  );
  assert.match(
    artifactEntry(configuredOutput, 'values/branding.xml').toString('utf8'),
    /tn_boot_splash_background.*#0d1b2a/u,
  );
  assert.equal(artifactEntry(configuredOutput, 'scripts/main.js').toString('utf8'), readFileSync(bundle, 'utf8'));
  assert.equal(artifactEntry(configuredOutput, 'game/level.bin').toString('utf8'), 'level');

  const defaultOutput = await packageAndroid(
    bundle,
    undefined,
    undefined,
    undefined,
    undefined,
    packageOptions,
  );
  const defaultManifest = artifactEntry(defaultOutput, 'AndroidManifest.xml').toString('utf8');
  const defaultStrings = artifactEntry(defaultOutput, 'values/strings.xml').toString('utf8');
  assert.match(defaultManifest, /android:screenOrientation="landscape"/u);
  assert.match(defaultManifest, /TN_KEEP_SCREEN_ON" android:value="false"/u);
  assert.match(defaultManifest, /TN_FULLSCREEN" android:value="true"/u);
  assert.match(defaultManifest, /TN_MAX_FPS" android:value="60"/u);
  assert.match(defaultStrings, /<string name="app_name">ThreeNative<\/string>/u);
});

/**
 * The consumer route out of a 404 that no consumer can fix.
 *
 * `install-prebuilt.mjs` builds a GitHub release URL from the package version. That release was
 * never published for 0.2.0, and the repository is private, so **every** published install fetching
 * it gets `HTTP 404` — the documented `pnpm build:android` cannot work for anybody. The mechanism
 * to sidestep it already existed as `options.runtimeRoot`; it was simply unreachable from a shell.
 */
test('THREENATIVE_RUNTIME_SOURCE points the packager at a runtime source checkout', async () => {
  const root = makeTempDirSync('threenative-android-runtime-source-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  const previous = process.env.THREENATIVE_RUNTIME_SOURCE;
  process.env.THREENATIVE_RUNTIME_SOURCE = runtime;
  try {
    // No `runtimeRoot` option at all: the env var alone has to be what selects this checkout.
    // If it is ignored, the packager looks at the real installed package and this rejects.
    const output = await packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
    });
    assert.ok(output.startsWith(runtime), `expected an artifact under ${runtime}, got ${output}`);
  } finally {
    if (previous === undefined) delete process.env.THREENATIVE_RUNTIME_SOURCE;
    else process.env.THREENATIVE_RUNTIME_SOURCE = previous;
  }
});

test('a failed prebuilt download names the cause and the environment variable that fixes it', async () => {
  const root = makeTempDirSync('threenative-android-prebuilt-404-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => {
        throw new Error("Prebuilt release manifest fetch failed for 'android-arm64-v8a-sdl3': HTTP 404.");
      },
    }),
    (error) => {
      // The original status is kept: it is still the fact that a fetch failed.
      assert.match(error.message, /HTTP 404/u);
      // And it now says why a published install can never satisfy it, and what to do instead.
      assert.match(error.message, /THREENATIVE_RUNTIME_SOURCE=/u);
      return true;
    },
  );
});

// PRD-212 phase 2: an explicit mode/format selects the Gradle task and the artifact it must
// produce. Every artifact below is built by the fake wrapper from the real shipped Gradle project.
test('an explicit release/aab request runs bundleRelease and returns the bundle', async () => {
  const root = makeTempDirSync('threenative-android-aab-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');
  const output = join(root, 'dist', 'fox.aab');

  const artifact = await packageAndroid(bundle, output, undefined, undefined, undefined, {
    runtimeRoot: runtime,
    ensureGradleWrapper: async () => undefined,
    prepareAndroidPrebuilts: async () => undefined,
    mode: 'release',
    format: 'aab',
    ...releaseOptions('/consumer/fox'),
  });

  assert.equal(artifact, output);
  assert.equal(readFileSync(join(runtime, 'android', 'app', 'build', 'last-task.txt'), 'utf8'), 'bundleRelease');
  assert.match(artifactEntry(output, 'AndroidManifest.xml').toString('utf8'), /<manifest\b/u);
});

test('an explicit release/apk request runs assembleRelease and returns the release APK', async () => {
  const root = makeTempDirSync('threenative-android-release-apk-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  const artifact = await packageAndroid(bundle, undefined, undefined, undefined, undefined, {
    runtimeRoot: runtime,
    ensureGradleWrapper: async () => undefined,
    prepareAndroidPrebuilts: async () => undefined,
    mode: 'release',
    format: 'apk',
    ...releaseOptions('/consumer/fox'),
  });

  assert.match(artifact, /app-release\.apk$/u);
  assert.equal(readFileSync(join(runtime, 'android', 'app', 'build', 'last-task.txt'), 'utf8'), 'assembleRelease');
  // The relative keystore from the environment was resolved against the consumer project, and the
  // password sentinels are never written into the artifact.
  assert.equal(
    readFileSync(join(runtime, 'android', 'app', 'build', 'last-keystore.txt'), 'utf8'),
    '/consumer/fox/release/my-release.keystore',
  );
  assert.doesNotMatch(
    artifactEntry(artifact, 'build.gradle.kts').toString('utf8'),
    /store-password-sentinel|key-password-sentinel/u,
  );
});

test('the omitted flags keep the debug APK path', async () => {
  const root = makeTempDirSync('threenative-android-default-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  const artifact = await packageAndroid(bundle, undefined, undefined, undefined, undefined, {
    runtimeRoot: runtime,
    ensureGradleWrapper: async () => undefined,
    prepareAndroidPrebuilts: async () => undefined,
  });

  assert.match(artifact, /app-debug\.apk$/u);
  assert.equal(readFileSync(join(runtime, 'android', 'app', 'build', 'last-task.txt'), 'utf8'), 'assembleDebug');
});

test('a release request never accepts a debug APK returned in its place', async () => {
  const root = makeTempDirSync('threenative-android-wrong-artifact-');
  roots.push(root);
  const runtime = createDebugOnlyAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
      ...releaseOptions('/consumer/fox'),
    }),
    /TN_ANDROID_ARTIFACT_MISSING/u,
  );
});

// A wrapper that ignores the signing environment and emits the unsigned release artifact, the shape
// AGP produces when a signing config does not apply. A release must refuse it by name.
function createUnsignedReleaseRuntime() {
  const runtime = createFakeAndroidRuntime();
  const wrapper = join(runtime, 'android', 'gradlew');
  writeFileSync(
    wrapper,
    `#!/bin/sh
set -eu
out="app/build/outputs/apk/release/app-release-unsigned.apk"
mkdir -p "$(dirname "$out")" app/build
jar --create --file "$out" -C app/src/main AndroidManifest.xml
`,
  );
  chmodSync(wrapper, 0o755);
  return runtime;
}

test('release signing inputs are required and named when incomplete', () => {
  const partial = androidReleaseSigning({
    ORG_GRADLE_PROJECT_threenativeKeystore: 'release.keystore',
  });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, [
    'ORG_GRADLE_PROJECT_threenativeKeystoreAlias',
    'ORG_GRADLE_PROJECT_threenativeKeystorePassword',
    'ORG_GRADLE_PROJECT_threenativeKeyPassword',
  ]);
});

test('a release request with no signing environment is refused before Gradle', async () => {
  const root = makeTempDirSync('threenative-android-no-signing-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
    }),
    /TN_ANDROID_SIGNING_INCOMPLETE/u,
  );
});

test('an unsigned release artifact is refused, never reported as a release', async () => {
  const root = makeTempDirSync('threenative-android-unsigned-');
  roots.push(root);
  const runtime = createUnsignedReleaseRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
      ...releaseOptions('/consumer/fox'),
    }),
    /TN_ANDROID_RELEASE_UNSIGNED/u,
  );
});

test('a release whose verifier rejects it is refused and the unsigned path is named', async () => {
  const root = makeTempDirSync('threenative-android-tampered-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
      ...releaseOptions('/consumer/fox', {
        verifyReleaseSignature: () => {
          throw new Error('TN_ANDROID_SIGNATURE_INVALID: tampered');
        },
      }),
    }),
    /TN_ANDROID_SIGNATURE_INVALID/u,
  );
});

test('a missing signature verifier is a blocker, not a silent pass', () => {
  assert.throws(
    () =>
      verifyAndroidReleaseArtifact('/tmp/candidate.apk', androidBuildRequest('release', 'apk'), {
        findBuildTool: () => undefined,
      }),
    /TN_ANDROID_SIGNATURE_TOOL_MISSING/u,
  );
});

test('the unsigned release APK path is the AGP default the packager refuses', () => {
  assert.match(
    androidUnsignedReleaseApk('/runtime'),
    /android\/app\/build\/outputs\/apk\/release\/app-release-unsigned\.apk$/u,
  );
});

test('unsupported mode/format pairs fail before any work', () => {
  assert.throws(() => androidBuildRequest('debug', 'aab'), /TN_ANDROID_BUILD_UNSUPPORTED/u);
  assert.throws(() => androidBuildRequest('staging', 'apk'), /TN_ANDROID_BUILD_MODE_INVALID/u);
  assert.throws(() => androidBuildRequest('release', 'zip'), /TN_ANDROID_BUILD_FORMAT_INVALID/u);
  assert.equal(androidBuildRequest('release', 'aab').task, 'bundleRelease');
  assert.equal(androidBuildRequest('release', 'apk').task, 'assembleRelease');
  assert.deepEqual(
    androidArtifactCandidates('/runtime', androidBuildRequest('debug', 'apk')),
    ['/runtime/android/app/build/outputs/apk/debug/app-debug.apk'],
  );
});

// PRD-212 phase 3: release signing is the developer's, never a debug fallback, and the final
// artifact must prove it is signed and not debuggable.
test('release signing inputs must be complete, and the error names only the missing properties', async () => {
  const root = makeTempDirSync('threenative-android-signing-incomplete-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
      projectRoot: '/consumer/fox',
      environment: { ORG_GRADLE_PROJECT_threenativeKeystore: 'release/my.keystore' },
    }),
    (error) => {
      assert.match(error.message, /TN_ANDROID_SIGNING_INCOMPLETE/u);
      assert.match(error.message, /ORG_GRADLE_PROJECT_threenativeKeystoreAlias/u);
      assert.match(error.message, /ORG_GRADLE_PROJECT_threenativeKeystorePassword/u);
      assert.match(error.message, /ORG_GRADLE_PROJECT_threenativeKeyPassword/u);
      // The one value that was supplied is not echoed back.
      assert.doesNotMatch(error.message, /release\/my\.keystore/u);
      return true;
    },
  );
});

test('a release that Gradle leaves unsigned is refused, never shipped as signed', async () => {
  const root = makeTempDirSync('threenative-android-release-unsigned-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  // A wrapper that ignores the signing environment, which is what a misconfigured Gradle project
  // looks like from the packager's side.
  const wrapper = join(runtime, 'android', 'gradlew');
  writeFileSync(
    wrapper,
    `#!/bin/sh
set -eu
out="app/build/outputs/apk/release/app-release-unsigned.apk"
mkdir -p "$(dirname "$out")" app/build
jar --create --file "$out" -C app/src/main AndroidManifest.xml
`,
  );
  chmodSync(wrapper, 0o755);
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
      ...releaseOptions('/consumer/fox'),
    }),
    /TN_ANDROID_RELEASE_UNSIGNED/u,
  );
});

test('a release whose signature verifier rejects is refused', async () => {
  const root = makeTempDirSync('threenative-android-signature-tamper-');
  roots.push(root);
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');

  await assert.rejects(
    packageAndroid(bundle, undefined, undefined, undefined, undefined, {
      runtimeRoot: runtime,
      ensureGradleWrapper: async () => undefined,
      prepareAndroidPrebuilts: async () => undefined,
      mode: 'release',
      format: 'apk',
      ...releaseOptions('/consumer/fox', {
        verifyReleaseSignature: () => {
          throw new Error('TN_ANDROID_SIGNATURE_INVALID: apksigner rejected the tampered artifact');
        },
      }),
    }),
    /TN_ANDROID_SIGNATURE_INVALID/u,
  );
});

test('a missing signature verifier is a blocker, not a silent pass', () => {
  assert.throws(
    () =>
      verifyAndroidReleaseArtifact('/tmp/candidate.apk', androidBuildRequest('release', 'apk'), {
        findBuildTool: () => undefined,
        environment: {},
      }),
    /TN_ANDROID_SIGNATURE_TOOL_MISSING/u,
  );
});

test('the signing properties the packager consumes are the four doctor predicts', () => {
  const expected = [
    'threenativeKeystore',
    'threenativeKeystoreAlias',
    'threenativeKeystorePassword',
    'threenativeKeyPassword',
  ];
  assert.deepEqual(Object.values(ANDROID_RELEASE_SIGNING_PROPERTIES).sort(), [...expected].sort());
  const signing = androidReleaseSigning(
    {
      ORG_GRADLE_PROJECT_threenativeKeystore: 'k.jks',
      ORG_GRADLE_PROJECT_threenativeKeystoreAlias: 'a',
    },
    '/consumer',
  );
  assert.equal(signing.complete, false);
  assert.match(signing.missing.join(' '), /ORG_GRADLE_PROJECT_threenativeKeystorePassword/u);
  assert.equal(signing.keystore, '/consumer/k.jks');
});

// The real (non-injected) verification path: the signature tool and aapt are stubbed, but the
// function's own parsing, refusal and fail-closed behaviour is what runs.
function fakeToolRun(responses) {
  return (executable, args) => {
    const key = `${executable} ${args[0]}`;
    const match = Object.keys(responses).find((name) => executable.includes(name));
    if (match === undefined) return { status: 1, stdout: '', stderr: `unexpected tool ${executable}` };
    return { status: 0, stdout: '', stderr: '', ...responses[match] };
  };
}

test('the real signature path rejects an artifact the signer refuses', () => {
  assert.throws(
    () =>
      verifyAndroidReleaseArtifact('/tmp/candidate.apk', androidBuildRequest('release', 'apk'), {
        findBuildTool: (name) => `/sdk/${name}`,
        spawnSync: fakeToolRun({ apksigner: { status: 1, stderr: 'no signature found' } }),
      }),
    /TN_ANDROID_SIGNATURE_INVALID/u,
  );
});

test('the real path needs aapt and fails closed without it', () => {
  assert.throws(
    () =>
      verifyAndroidReleaseArtifact('/tmp/candidate.apk', androidBuildRequest('release', 'apk'), {
        findBuildTool: (name) => (name === 'aapt' ? undefined : `/sdk/${name}`),
        spawnSync: fakeToolRun({ apksigner: { status: 0, stdout: 'Verified' } }),
      }),
    /TN_ANDROID_BADGING_TOOL_MISSING/u,
  );
});

test('the packaged APK targetSdk is checked on the artifact, not the Gradle source', () => {
  const badging = (target) => ({
    status: 0,
    stdout: `package: name='com.x' versionCode='1'\ntargetSdkVersion:'${target}'\n`,
  });
  assert.throws(
    () =>
      verifyAndroidReleaseArtifact('/tmp/candidate.apk', androidBuildRequest('release', 'apk'), {
        findBuildTool: (name) => `/sdk/${name}`,
        spawnSync: (executable, args) =>
          executable.endsWith('apksigner')
            ? { status: 0, stdout: 'Verified' }
            : badging(35),
      }),
    /TN_ANDROID_TARGET_SDK_BELOW_SUBMISSION/u,
  );
  const ok = verifyAndroidReleaseArtifact(
    '/tmp/candidate.apk',
    androidBuildRequest('release', 'apk'),
    {
      findBuildTool: (name) => `/sdk/${name}`,
      spawnSync: (executable) =>
        executable.endsWith('apksigner') ? { status: 0, stdout: 'Verified' } : badging(36),
    },
  );
  assert.equal(ok.targetSdk, 36);
});

test('a debuggable packaged APK is refused', () => {
  assert.throws(
    () =>
      verifyAndroidReleaseArtifact('/tmp/candidate.apk', androidBuildRequest('release', 'apk'), {
        findBuildTool: (name) => `/sdk/${name}`,
        spawnSync: (executable) =>
          executable.endsWith('apksigner')
            ? { status: 0, stdout: 'Verified' }
            : { status: 0, stdout: "targetSdkVersion:'36'\napplication-debuggable\n" },
      }),
    /TN_ANDROID_ARTIFACT_DEBUGGABLE/u,
  );
});
