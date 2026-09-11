import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync,  } from 'node:fs';

import { dirname, join } from 'node:path';
import { afterEach, test } from 'vitest';

import { packageAndroid } from '../scripts/package-android.mjs';

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
mkdir -p app/build/outputs/apk/debug
jar --create --file app/build/outputs/apk/debug/app-debug.apk \\
  -C app/src/main AndroidManifest.xml \\
  -C app/src/main/res values/strings.xml \\
  -C app/src/main/res values/themes.xml \\
  -C app/src/main/res values/branding.xml \\
  -C app build.gradle.kts \\
  -C app/build/generated/threenative/assets scripts/main.js
if [ -f app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ]; then
  jar --update --file app/build/outputs/apk/debug/app-debug.apk \\
    -C app/src/main/res mipmap-xxxhdpi/ic_launcher.png
fi
for resource in \
  mipmap-anydpi-v26/ic_launcher.xml \
  drawable-nodpi/ic_launcher_foreground.png \
  drawable-nodpi/ic_launcher_monochrome.png \
  drawable-nodpi/tn_boot_splash.png; do
  if [ -f "app/src/main/res/$resource" ]; then
    jar --update --file app/build/outputs/apk/debug/app-debug.apk \
      -C app/src/main/res "$resource"
  fi
done
if [ -f app/build/generated/threenative/assets/game/level.bin ]; then
  jar --update --file app/build/outputs/apk/debug/app-debug.apk \\
    -C app/build/generated/threenative/assets game/level.bin
fi
# A real Android app ships native libraries for both 64-bit ABIs, and PRD-221's census refuses to
# credit an artifact that contains none. These stand in for them so the gate has something to read.
mkdir -p app/build/fake-libs/lib/arm64-v8a app/build/fake-libs/lib/x86_64
printf 'runtime' > app/build/fake-libs/lib/arm64-v8a/libmystral-runtime.so
printf 'runtime' > app/build/fake-libs/lib/x86_64/libmystral-runtime.so
jar --update --file app/build/outputs/apk/debug/app-debug.apk \\
  -C app/build/fake-libs lib/arm64-v8a/libmystral-runtime.so \\
  -C app/build/fake-libs lib/x86_64/libmystral-runtime.so
`,
  );
  chmodSync(wrapper, 0o755);
  return runtime;
}

function artifactEntry(apk, entry) {
  return execFileSync('unzip', ['-p', apk, entry]);
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
    // The fixture's stand-in libraries are not compiled objects, so the ELF reader is injected.
    // Everything else in the 16 KB census — the archive parse, the per-ABI roll call — runs real.
    artifact16Kb: { runObjdump: () => ALIGNED_LOAD, zipalign: false },
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
      artifact16Kb: { runObjdump: () => ALIGNED_LOAD, zipalign: false },
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

/**
 * PRD-221 phase 2 — the final-artifact 16 KB census.
 *
 * These build archives byte by byte rather than shelling out to `jar` or `zip`, because the number
 * under test is the *data offset of each entry inside the archive*, and no packaging tool lets a
 * caller choose it. The ELF reader is injected; producing genuinely 16 KB-aligned arm64 objects
 * would make the unit lane depend on an NDK toolchain it does not have.
 */
import { crc32, deflateRawSync } from 'node:zlib';

import {
  ANDROID_16KB_ALIGNMENT,
  androidArtifactLibraryCensus,
  assertAndroidArtifact16KbAlignment,
  readZipEntries,
} from '../scripts/check-android-16kb-alignment.mjs';

const ALIGNED_LOAD = [
  '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**14',
  '    LOAD off 0x4000 vaddr 0x4000 paddr 0x4000 align 2**14',
].join('\n');
const FOUR_KB_LOAD = [
  '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**12',
  '    LOAD off 0x1000 vaddr 0x1000 paddr 0x1000 align 2**12',
].join('\n');

/** Minimal ZIP writer with explicit control over storage and entry alignment. */
function writeArchive(path, entries) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data);
    const stored = entry.stored === true;
    const payload = stored ? raw : deflateRawSync(raw);
    let extra = 0;
    if (stored && entry.align) {
      const start = offset + 30 + name.length;
      extra = (entry.align - (start % entry.align)) % entry.align;
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(extra, 28);
    const block = Buffer.concat([header, name, Buffer.alloc(extra), payload]);
    locals.push(block);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(Buffer.concat([central, name]));
    offset += block.length;
  }
  const centralBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...locals, centralBytes, end]));
  return path;
}

function archiveRoot() {
  const root = makeTempDirSync('threenative-android-census-');
  roots.push(root);
  return root;
}

/** A complete, compliant artifact: both ABIs, stored and 16 KB aligned inside the archive. */
function compliantEntries() {
  return [
    { data: 'manifest', name: 'AndroidManifest.xml' },
    { align: ANDROID_16KB_ALIGNMENT, data: 'arm64-runtime', name: 'lib/arm64-v8a/libmystral-runtime.so', stored: true },
    { align: ANDROID_16KB_ALIGNMENT, data: 'arm64-v8', name: 'lib/arm64-v8a/libv8android.so', stored: true },
    { align: ANDROID_16KB_ALIGNMENT, data: 'x86-runtime', name: 'lib/x86_64/libmystral-runtime.so', stored: true },
    { align: ANDROID_16KB_ALIGNMENT, data: 'x86-v8', name: 'lib/x86_64/libv8android.so', stored: true },
  ];
}

const alignedOptions = { runObjdump: () => ALIGNED_LOAD, zipalign: false };

test('the artifact census inspects every packaged library on every ABI, not a build directory', () => {
  const apk = writeArchive(join(archiveRoot(), 'app.apk'), compliantEntries());
  const inspected = [];
  const census = assertAndroidArtifact16KbAlignment(apk, {
    runObjdump: (path) => {
      inspected.push(path);
      return ALIGNED_LOAD;
    },
    zipalign: false,
  });
  // Four libraries, four objdump invocations: nothing was credited without being read.
  assert.equal(inspected.length, 4);
  assert.deepEqual(
    census.libraries.map((library) => library.entry).sort(),
    [
      'lib/arm64-v8a/libmystral-runtime.so',
      'lib/arm64-v8a/libv8android.so',
      'lib/x86_64/libmystral-runtime.so',
      'lib/x86_64/libv8android.so',
    ],
  );
  for (const library of census.libraries) {
    assert.equal(library.compression, 'stored');
    assert.equal(library.dataOffset % ANDROID_16KB_ALIGNMENT, 0);
  }
});

test('the artifact census rejects a 4 KB library packaged beside compliant ones', () => {
  const apk = writeArchive(join(archiveRoot(), 'app.apk'), compliantEntries());
  assert.throws(
    () =>
      assertAndroidArtifact16KbAlignment(apk, {
        // One transitive dependency out of four, which is exactly how this ships unnoticed.
        runObjdump: (path) => (path.includes('libv8android') ? FOUR_KB_LOAD : ALIGNED_LOAD),
        zipalign: false,
      }),
    (error) => error.code === 'ANDROID_16KB_MISALIGNED' && /0x1000/u.test(error.message),
  );
});

test('the artifact census rejects an uncompressed library stored at a 4 KB archive offset', () => {
  // The ELF is perfect here. Only the archive offset is wrong, and a 16 KB device still cannot
  // map it — which is why an ELF-only check is not final-app proof.
  const entries = compliantEntries().map((entry) =>
    entry.name === 'lib/x86_64/libv8android.so' ? { ...entry, align: 4096 } : entry,
  );
  const apk = writeArchive(join(archiveRoot(), 'app.apk'), entries);
  const { entries: written } = readZipEntries(apk);
  const offending = written.find((entry) => entry.name === 'lib/x86_64/libv8android.so');
  assert.notEqual(offending.dataOffset % ANDROID_16KB_ALIGNMENT, 0);
  assert.throws(
    () => assertAndroidArtifact16KbAlignment(apk, alignedOptions),
    (error) =>
      error.code === 'ANDROID_16KB_MISALIGNED' &&
      /uncompressed library stored at archive offset/u.test(error.message),
  );
});

test('the artifact census rejects an omitted ABI and an artifact with no libraries at all', () => {
  const omitted = writeArchive(
    join(archiveRoot(), 'omitted.apk'),
    compliantEntries().filter((entry) => !entry.name.startsWith('lib/x86_64/')),
  );
  assert.throws(
    () => assertAndroidArtifact16KbAlignment(omitted, alignedOptions),
    /no native libraries for x86_64/u,
  );

  const empty = writeArchive(join(archiveRoot(), 'empty.apk'), [{ data: 'manifest', name: 'AndroidManifest.xml' }]);
  assert.throws(
    () => assertAndroidArtifact16KbAlignment(empty, alignedOptions),
    /no native libraries for arm64-v8a, x86_64/u,
  );
});

test('the artifact census refuses an undeclared ABI rather than ignoring it', () => {
  const apk = writeArchive(join(archiveRoot(), 'app.apk'), [
    ...compliantEntries(),
    { align: ANDROID_16KB_ALIGNMENT, data: 'armv7', name: 'lib/armeabi-v7a/libv8android.so', stored: true },
  ]);
  assert.throws(
    () => assertAndroidArtifact16KbAlignment(apk, alignedOptions),
    /undeclared ABIs.*armeabi-v7a/u,
  );
});

test('the census is a function of the census input, not of an empty list silently passing', () => {
  assert.throws(
    () => androidArtifactLibraryCensus([], { artifactPath: 'app.apk' }),
    /no native libraries for arm64-v8a, x86_64/u,
  );
  assert.throws(
    () => assertAndroidArtifact16KbAlignment(join(archiveRoot(), 'absent.apk'), alignedOptions),
    /cannot read/u,
  );
});

test('the packager runs the census on the artifact it produced and refuses a misaligned one', async () => {
  const root = archiveRoot();
  const runtime = createFakeAndroidRuntime();
  const bundle = join(root, 'game.js');
  writeFileSync(bundle, 'export default { start() {} };\n');
  const apkPath = join(runtime, 'android/app/build/outputs/apk/debug/app-debug.apk');
  const build = (entries) => ({
    ensureGradleWrapper: async () => undefined,
    prepareAndroidPrebuilts: async () => undefined,
    runtimeRoot: runtime,
    spawnSync: () => {
      mkdirSync(dirname(apkPath), { recursive: true });
      writeArchive(apkPath, entries);
      return { status: 0, stdout: '' };
    },
  });

  // No injected alignment options at all: the packager's own default gate has to be the real one.
  // A stored library at a 4 KB offset needs no objdump to reject, so this exercises the shipped
  // path end to end on any host.
  await assert.rejects(
    packageAndroid(bundle, join(root, 'bad.apk'), undefined, undefined, undefined, {
      ...build(compliantEntries().map((entry) =>
        entry.name === 'lib/arm64-v8a/libv8android.so' ? { ...entry, align: 4096 } : entry,
      )),
    }),
    (error) => error.code === 'ANDROID_16KB_MISALIGNED',
  );

  const output = await packageAndroid(bundle, join(root, 'good.apk'), undefined, undefined, undefined, {
    ...build(compliantEntries()),
    artifact16Kb: alignedOptions,
  });
  assert.equal(output, join(root, 'good.apk'));
});
