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
  public void putString(String key, String value) { values.put(key, value); }
  public boolean getBoolean(String key, boolean fallback) {
    Object value = values.get(key);
    return value instanceof Boolean ? (Boolean) value : fallback;
  }
  public String getString(String key, String fallback) {
    Object value = values.get(key);
    return value instanceof String ? (String) value : fallback;
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
  public String getStringExtra(String key) { return null; }
}
`,
    'android/view/WindowManager.java': `package android.view;

public interface WindowManager {
  final class LayoutParams {
    public static final int FLAG_KEEP_SCREEN_ON = 0x00000080;
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
    'org/libsdl/app/SDLActivity.java': `package org.libsdl.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.Window;
import java.io.File;

public class SDLActivity {
  private PackageManager packageManager = new PackageManager(null);
  private final Intent intent = new Intent();
  private final Window window = new Window();

  protected void onCreate(Bundle state) {}
  protected String[] getLibraries() { return new String[0]; }
  protected String getMainFunction() { return ""; }
  protected String[] getArguments() { return new String[0]; }
  public PackageManager getPackageManager() { return packageManager; }
  public String getPackageName() { return "com.example.game"; }
  public Intent getIntent() { return intent; }
  public Window getWindow() { return window; }
  public File getExternalFilesDir(String type) { return null; }
  public File getFilesDir() { return new File(System.getProperty("java.io.tmpdir")); }
  public int requestedOrientation = Integer.MIN_VALUE;
  public void setRequestedOrientation(int orientation) { requestedOrientation = orientation; }
  public void setOrientationBis(int width, int height, boolean resizable, String hint) {
    requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
  }
  public void configureMetadata(Bundle metadata) { packageManager = new PackageManager(metadata); }
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

    ProbeActivity activity = new ProbeActivity();
    activity.configureMetadata(metadata);
    activity.create();
    String[] arguments = activity.arguments();

    require((activity.getPackageManager().lastFlags & PackageManager.GET_META_DATA) != 0,
      "activity must request PackageManager.GET_META_DATA");
    require(activity.getWindow().hasFlag(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON),
      "keep-screen-on metadata was not applied");
    require("Fox \\\"Deluxe\\\"".equals(arguments[3]),
      "window title metadata was not retrieved");
    require("false".equals(arguments[4]), "fullscreen metadata was not retrieved");
    // Android 16+ overrides a manifest orientation for apps it treats as non-adaptive, which is
    // how a landscape-declared game launched portrait on a Pixel 8. Re-requesting it in onCreate
    // is the belt to the manifest property's braces; this asserts that it happens.
    require(activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
      "declared landscape orientation was not re-requested in onCreate");
    activity.applySdlOrientation();
    require(activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
      "SDL window creation overwrote the declared landscape orientation");
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
    display: { orientation: 'portrait', fullscreen: false, keepScreenOn: true },
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
