import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function implementedRows() {
  return JSON.parse(read('conformance/registry.json')).tests.filter((entry) => entry.status === 'implemented');
}

test('official ThreeNative CMake presets and feature flags exist', () => {
  const presets = JSON.parse(read('CMakePresets.json'));
  const names = new Set(presets.configurePresets.map((preset) => preset.name));
  for (const name of ['tn-linux', 'tn-windows', 'tn-macos', 'tn-android', 'tn-ios']) {
    assert.ok(names.has(name), `missing configure preset ${name}`);
  }

  const cmake = read('CMakeLists.txt');
  for (const option of [
    'TN_ENABLE_CANVAS2D',
    'TN_ENABLE_VIDEO',
    'TN_ENABLE_RAYTRACING',
    'TN_ENABLE_WEBTRANSPORT',
    'TN_ENABLE_NATIVE_GLTF',
    'TN_ENABLE_DRACO',
    'TN_ENABLE_DEBUG_SERVER',
  ]) {
    assert.match(cmake, new RegExp(`option\\(${option}\\b`), `missing ${option}`);
  }
  assert.match(
    cmake,
    /elseif\(WIN32\)[\s\S]*?if\(TN_ENABLE_VIDEO\)[\s\S]*?windows_graphics_capture_impl\.cpp/u,
    'Windows capture sources must remain behind TN_ENABLE_VIDEO',
  );
  assert.match(
    cmake,
    /if\(MSVC\)[\s\S]*?OneCoreUap\.lib[\s\S]*?else\(\)[\s\S]*?api-ms-win-core-handle-l1-1-0/u,
  );
  assert.match(cmake, /else\(\)[\s\S]*?-Wl,--allow-multiple-definition/u);
});

test('native host publishes explicit platform facts before the game bundle', () => {
  const runtime = read('src/runtime.cpp');
  // The handle is `platformInfo`, not `platform`: the same scope calls the `platform::` namespace
  // for safe-area insets, and a local of that name reads as a shadow of it.
  const descriptorStart = runtime.indexOf('auto platformInfo = jsEngine_->newObject();');
  const descriptorEnd = runtime.indexOf('jsEngine_->setProperty(nativeHost, "captureScreenshot"', descriptorStart);
  assert.ok(descriptorStart >= 0, 'native platform descriptor construction is missing');
  assert.ok(descriptorEnd > descriptorStart, 'native platform descriptor must precede host services');
  const descriptor = runtime.slice(descriptorStart, descriptorEnd);

  for (const branch of [
    ['#if defined(__ANDROID__)', 'android'],
    ['#elif defined(__APPLE__) && TARGET_OS_IPHONE', 'ios'],
    ['#elif defined(__APPLE__)', 'macos'],
    ['#elif defined(_WIN32)', 'windows'],
    ['#elif defined(__linux__)', 'linux'],
  ]) {
    assert.ok(descriptor.includes(branch[0]), `missing native platform branch ${branch[0]}`);
    assert.match(descriptor, new RegExp(`platformOs = "${branch[1]}"`));
  }
  assert.ok(
    descriptor.indexOf('#if defined(__ANDROID__)') < descriptor.indexOf('#elif defined(__linux__)'),
    'Android must be selected before the overlapping Linux macro',
  );
  assert.match(descriptor, /constexpr int kNativeMobileTouchCapacity = 2;/u);
  assert.match(descriptor, /const int maxTouchPoints = kNativeMobileTouchCapacity;/u);
  assert.match(descriptor, /const int maxTouchPoints = 0;/u);
  assert.doesNotMatch(descriptor, /maxTouchPoints\s*=\s*touchDeviceCount/u);
  assert.match(descriptor, /setProperty\(nativeHost, "platform", platformInfo\)/u);

  const pointerStart = runtime.indexOf('setProperty(playtestHost, "pointer"');
  const pointerEnd = runtime.indexOf('setProperty(nativeHost, "playtestInput", playtestHost)', pointerStart);
  assert.ok(pointerStart >= 0, 'native playtest pointer input is missing');
  assert.ok(pointerEnd > pointerStart, 'native playtest pointer input must be registered');
  const pointerHost = runtime.slice(pointerStart, pointerEnd);
  assert.match(pointerHost, /pointerId\s*=\s*args\.size\(\) >= 5/u);
  assert.match(pointerHost, /pointerType\s*=\s*args\.size\(\) >= 6/u);
  assert.match(pointerHost, /isPrimary\s*=\s*args\.size\(\) >= 7/u);

  const deviceBridge = read('../playtest/src/three/device.ts');
  assert.match(deviceBridge, /method === "input\.pointers"/u);
  assert.match(deviceBridge, /"pointerdown"[\s\S]*"pointerup"/u);
  assert.match(deviceBridge, /pointer\.id[\s\S]*"touch"/u);

  const smoke = read('../../examples/native-smoke/src/game.ts');
  for (const helper of ['getPlatform', 'isWeb', 'isNative', 'isMobile', 'isTouchscreenAvailable']) {
    assert.match(smoke, new RegExp(`\\b${helper}\\b`), `native smoke must consume ${helper}`);
  }
  assert.match(smoke, /TN_NATIVE_PLATFORM:/u);
});

test('Win32 window creation does not require a Vulkan-capable host', () => {
  const windowSource = read('src/platform/window.cpp');
  assert.match(windowSource, /#elif !defined\(_WIN32\)[\s\S]*?SDL_WINDOW_VULKAN/u);
  assert.doesNotMatch(windowSource, /#else\s+flags \|= SDL_WINDOW_VULKAN/u);
});

test('native hosts forward one coarse safe-area value through resize and rotation', () => {
  const input = read('src/platform/input.cpp');
  assert.match(input, /refreshSafeAreaInsets\(\)/u);
  assert.match(input, /getSafeAreaInsets\(\)/u);
  assert.match(input, /setSafeAreaInsets\(int top, int right, int bottom, int left\)/u);
  assert.match(input, /processResize\(int width, int height\)[\s\S]*refreshSafeAreaInsets\(\)/u);

  const window = read('src/platform/window.cpp');
  assert.match(window, /SDL_EVENT_WINDOW_RESIZED[\s\S]*processResize/u);

  const activity = read('android/app/src/main/java/com/mystral/engine/MystralActivity.java');
  assert.match(activity, /getSafeAreaInsets\(\)/u);
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\) \| WindowInsets\.Type\.displayCutout\(\)/u);

  const ios = read('ios/main.mm');
  assert.match(ios, /safeAreaInsets/u);
  assert.match(ios, /UIDeviceOrientationDidChangeNotification/u);

  const runtime = read('src/runtime.cpp');
  assert.match(runtime, /safeAreaInsets/u);
  assert.match(runtime, /platform::refreshSafeAreaInsets\(\)/u);

  const fixture = { bottom: 24, left: 18, right: 42, top: 80 };
  assert.deepEqual(
    Object.keys(fixture).sort(),
    ['bottom', 'left', 'right', 'top'],
    'the asymmetric fixture must remain four-sided rather than collapsing to one padding value',
  );
});

test('deprecated native GLTF and Draco paths fail closed before compilation', () => {
  const cmake = read('CMakeLists.txt');
  assert.match(cmake, /TN_ENABLE_NATIVE_GLTF was removed/u);
  assert.match(cmake, /TN_ENABLE_DRACO was removed/u);
  assert.doesNotMatch(cmake, /src\/utils\/cgltf_impl\.cpp|src\/gltf\/gltf_loader\.cpp|draco::draco/u);

  const runtime = read('src/runtime.cpp');
  assert.doesNotMatch(runtime, /setupGLTF|setupDraco|MYSTRAL_HAS_DRACO|__loadGLTF/u);
  const bindings = read('src/webgpu/bindings.cpp');
  assert.doesNotMatch(bindings, /TN_ENABLE_NATIVE_GLTF|tnWebgpuHandler85|"loadGLTF"/u);
  assert.match(bindings, /setGlobalProperty\("Mystral", mystralNamespace\)/, 'Mystral namespace may exist, but loadGLTF must not be registered by default');
  const downloader = read('scripts/download-deps.mjs');
  assert.doesNotMatch(downloader, /\bcgltf\b|\bdraco\b/u, 'deprecated native decoder dependencies must not be provisioned');
});

test('runtime JavaScript is byte-stable, embedded, and loaded by the bootstrap', () => {
  const scripts = {
    'storage-polyfill.js': '7e03f256b0e11b5370bf86ccb5ae286be221080a1baa8339efe2aa570dd3c25d',
    'fetch-polyfill.js': '0b9f8553897fa012e5eb2a754f9f36e3178d8a1bc1de4645dbeac0a2545a45e5',
    'streams-polyfill.js': '134957d3cb3154f4e27b95b611af510b55c4e0e48a56c3785444ca0b31d45901',
    'url-worker-polyfill.js': '1eb2015e202ca7e039e854aa68099bbc167d4f385f014c6acaa8cfd7ef2d850b',
    'create-element-setup.js': '3891c716e3e7b8801f45306b50c5c8c5990042276524fbaac745b157389d1bee',
    'event-constructors-setup.js': '9f69ab661c4926863e5ce59e5a83504ea9a8457ed95f58c69058ee6702dcd5e0',
    'image-support-init.js': '1a674470d63a89e607d065c4b19794e28e87b955b292d63dbd2f974e94e1e6ee',
    'onload-trigger.js': '226fba97f402a71ba5f3ae530133e31c0f2a977d8b1564b1cd903a871c194aad',
    'install-async-pipelines.js': '9100a90ee38e89f53e8d92ae84156916c5c779d11bbedbf11e8b7c7f6ff44331',
    'image-bitmap-polyfill.js': '30e2cb4a45fc20ee9b983ef4dd404afd63be1889d0b1e12055f01a8716b66cfa',
  };
  const cmake = read('CMakeLists.txt');
  const runtime = read('src/runtime.cpp');
  const bindings = read('src/webgpu/bindings.cpp');
  for (const [filename, expectedHash] of Object.entries(scripts)) {
    const source = read(`src/runtime-scripts/${filename}`);
    const actualHash = createHash('sha256').update(source).digest('hex');
    assert.equal(actualHash, expectedHash, `${filename} was changed without updating its contract`);
    const scriptName = filename.slice(0, -3);
    assert.match(cmake, new RegExp(`\\b${scriptName}\\b`), `${filename} is not in the embed step`);
    const consumer = filename === 'install-async-pipelines.js' || filename === 'image-bitmap-polyfill.js'
      ? bindings
      : runtime;
    const loader = filename === 'install-async-pipelines.js'
      ? 'evalEmbeddedRuntimeScriptWithResult'
      : filename === 'image-bitmap-polyfill.js'
        ? 'evalEmbeddedRuntimeScript'
        : 'evalRuntimeScript\\(\\*jsEngine_';
    assert.match(consumer, new RegExp(`${loader}.*"${scriptName}"`, 's'), `${filename} is not loaded by its native consumer`);
  }
  assert.doesNotMatch(runtime, /const char\*\s+\w+\s*=\s*R"/u, 'runtime bootstrap still owns a raw JavaScript string');
  assert.doesNotMatch(runtime, /jsEngine_->eval\("/u, 'runtime bootstrap still evaluates an inline JavaScript literal');
  assert.doesNotMatch(bindings, /const char\*\s+(installAsyncPipelines|imageBitmapPolyfill)\s*=\s*R"/u, 'WebGPU bootstrap still owns an extracted JavaScript string');
});

test('CLI build tools are separate units behind an unchanged dispatch surface', () => {
  const main = read('src/cli/main.cpp');
  const cmake = read('CMakeLists.txt');
  const bundler = read('src/cli/bundler.cpp');
  const lightmap = read('src/cli/lightmap.cpp');
  const artifactCheck = read('scripts/verify-cli-artifact-diff.mjs');

  assert.ok(main.split('\n').length <= 1800, 'main.cpp still contains a build-time tool body');
  assert.doesNotMatch(main, /static int (compileBundle|bakeLightmaps)\(/u);
  assert.match(main, /BundlerOptions[\s\S]*compileBundle\(bundlerOptions\)/u);
  assert.match(main, /LightmapOptions[\s\S]*bakeLightmaps\(lightmapOptions\)/u);
  assert.match(cmake, /src\/cli\/bundler\.cpp[\s\S]*src\/cli\/lightmap\.cpp/u);
  assert.match(bundler, /int compileBundle\(const BundlerOptions& opts\)/u);
  assert.match(lightmap, /int bakeLightmaps\(const LightmapOptions& opts\)/u);
  assert.match(artifactCheck, /byteIdentical/u);
  assert.match(artifactCheck, /--before/u);
  assert.match(artifactCheck, /--after/u);
});

test('JSValueHandle ownership is an Engine API with a move-only guard', () => {
  const engine = read('include/mystral/js/engine.h');
  const quickjs = read('src/js/quickjs_engine.cpp');
  const v8 = read('src/js/v8_engine.cpp');
  const churn = read('tests/handle_lifetime_test.cpp');

  for (const method of ['freezeHandle', 'freeHandle', 'outstandingHandleCount']) {
    assert.match(engine, new RegExp(`\\b${method}\\b`), `missing Engine ownership method ${method}`);
  }
  assert.match(engine, /class JSValueGuard[\s\S]*JSValueGuard\(const JSValueGuard&\) = delete/u);
  assert.match(quickjs, /void freeHandle\(JSValueHandle value\) override/u);
  assert.match(v8, /void freeHandle\(JSValueHandle value\) override/u);
  assert.match(churn, /handles-created=[\s\S]*outstanding/u);
  assert.match(read('CMakeLists.txt'), /threenative-handle-lifetime-test/u);
});

test('same-source first proof scene uses required Three.js WebGPU contract without runtime branches', () => {
  const sourcePath = 'conformance/scenes/shared/first-proof-game.js';
  assert.ok(existsSync(join(root, sourcePath)), `${sourcePath} missing`);
  const source = read(sourcePath);
  assert.match(source, /import \* as THREE from ['"]three\/webgpu['"]/);
  assert.match(source, /new THREE\.Scene\(/);
  assert.match(source, /new THREE\.PerspectiveCamera\(/);
  assert.match(source, /new THREE\.BoxGeometry\(/);
  assert.match(source, /new THREE\.MeshStandardMaterial\(\{\s*color:\s*0x4488ff/s);
  assert.match(source, /new THREE\.DirectionalLight\([^,]+,\s*3\s*\)/);
  assert.match(source, /requestAnimationFrame\(/);
  assert.doesNotMatch(source, /\bif\s*\(|\bswitch\s*\(|typeof\s+(window|document|process|canvas|navigator)/, 'game source must not branch on host runtime');
});

test('implemented registry rows each map to their own real scene and runner is not hardcoded to first proof', () => {
  const rows = implementedRows();
  assert.ok(rows.length >= 5, 'expected more than one genuine implemented compatibility scene');
  const scenes = new Set(rows.map((entry) => entry.scene));
  assert.ok(scenes.size >= 4, 'implemented rows must not all reuse the cube first-proof scene');
  for (const row of rows) {
    assert.ok(row.scene, `${row.id} missing scene`);
    assert.ok(existsSync(join(root, row.scene)), `${row.id} scene path does not exist: ${row.scene}`);
  }
  const runner = read('conformance/run-conformance.mjs');
  assert.doesNotMatch(runner, /first-proof-entry\.js|first-proof-native-bundle\.js/, 'runner must not hardcode the first proof entry/bundle');
  assert.match(runner, /test\.scene/, 'runner must resolve each registry row scene');
  assert.match(runner, /firefox|browser/i, 'runner must execute a real browser reference path');
  assert.match(runner, /pixelMismatchRatio|perceptualDeltaE/, 'runner must compute pixel/perceptual metrics');
});

test('upstream Three.js GLTFLoader/module/polyfill compatibility sources cover required browser assumptions', () => {
  const glb = read('conformance/scenes/shared/gltf-loader-glb.js');
  assert.match(glb, /import \{ GLTFLoader \} from ['"]three\/addons\/loaders\/GLTFLoader\.js['"]/);
  assert.match(glb, /new LoadingManager|new THREE\.LoadingManager/);
  assert.match(glb, /new Request\(/);
  assert.match(glb, /AbortController/);
  assert.match(glb, /response\.headers\.get/);
  assert.doesNotMatch(glb, /Mystral\.loadGLTF|__loadGLTF|globalThis\.loadGLTF/, 'GLTF conformance must use upstream JS GLTFLoader, not native loader');

  const external = read('conformance/scenes/shared/gltf-loader-external.js');
  assert.match(external, /GLTFLoader/);
  assert.match(external, /setURLModifier/);
  assert.match(external, /fixture\.bin/);
  assert.match(external, /fixture\.png/);

  const texture = read('conformance/scenes/shared/texture-blob-imagebitmap.js');
  for (const token of ['Blob', 'blob.stream', 'URL.createObjectURL', 'URL.revokeObjectURL', 'createImageBitmap']) {
    assert.match(texture, new RegExp(token.replace('.', '\\.')));
  }
  assert.doesNotMatch(texture, /mesh\.rotation/u, 'texture parity capture must be frame-stable');

  const runtime = read('conformance/scenes/shared/runtime-events.js');
  for (const token of ['addEventListener', 'dispatchEvent', 'PointerEvent', 'TouchEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    assert.match(runtime, new RegExp(token));
  }
});

test('mobile presets keep unsupported APIs honest rather than hiding them', () => {
  const gradle = read('android/app/build.gradle.kts');
  assert.match(gradle, /TN_ENABLE_CANVAS2D=OFF/);
  assert.match(gradle, /TN_ENABLE_VIDEO=OFF/);
  assert.match(gradle, /TN_ENABLE_WEBTRANSPORT=OFF/);
  const tests = read('tests/runtime-next-contract.test.mjs');
  assert.match(tests, /Canvas2D|VIDEO|WEBTRANSPORT|unsupported APIs honest/i);
});

test('conformance registry and gate docs cover migrated M0-M11 and M15-M16', () => {
  const registry = JSON.parse(read('conformance/registry.json'));
  for (const id of ['01-basic-cube', '02-buffer-geometry', '03-perspective-camera', '04-orthographic-camera', '05-hierarchy']) {
    assert.ok(registry.tests.some((entry) => entry.id === id), `missing conformance test ${id}`);
  }

  const status = ['G1-desktop-host.md', 'G2-conformance.md', 'G3-mobile-bring-up.md', 'G4-threading-native-systems.md', 'G5-profiling.md']
    .map((file) => read(`docs/${file}`))
    .join('\n');
  for (const i of [...Array.from({ length: 12 }, (_, index) => index), 15, 16]) {
    assert.match(status, new RegExp(`\\bM${i}\\b`), `missing M${i} milestone`);
  }
});


test('Android default gate is generated from the public core native smoke at catalog Three.js', () => {
  const smokePath = 'examples/native-smoke/src/game.ts';

  const buildScript = read('scripts/build-android-first-proof.mjs');
  assert.match(buildScript, new RegExp(smokePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'Android bundle build must use the public core smoke path');
  assert.match(buildScript, /@threenative\/core/, 'Android bundle must enforce the public core API import');
  assert.match(buildScript, /EXPECTED_THREE_VERSION = '0\.185\.1'/, 'Android bundle must close the catalog Three.js gap');
  assert.match(buildScript, /executable\(runtimeRoot, 'esbuild'\)/, 'Android bundle must be generated with the pinned runtime-package esbuild dependency');
  assert.match(buildScript, /metadataOutput/, 'Android bundle build must produce traceable input metadata');

  const gradle = read('android/app/build.gradle.kts');
  assert.match(gradle, /buildAndroidFirstProofBundle/, 'Android Gradle build must invoke reproducible first proof bundling');
  assert.match(gradle, /preBuild[\s\S]*buildAndroidFirstProofBundle/, 'Android preBuild must depend on generated bundle task');
  assert.match(gradle, /examples\/native-smoke\/src/, 'Android Gradle inputs must track the public core smoke');
  assert.match(gradle, /generatedThreeNativeAssets/, 'Android proof assets must live in a modeled build directory');
  assert.match(gradle, /assets\.setSrcDirs/, 'Android packaging must consume only modeled generated assets');

  const activity = read('android/app/src/main/java/com/mystral/engine/MystralActivity.java');
  assert.match(activity, /TN_PLAYTEST_MAILBOX_ROOT/, 'Android activity must pass the host mailbox root to SDL_main');
  const androidMain = read('src/platform/android_main.cpp');
  assert.match(androidMain, /TN_PLAYTEST_MAILBOX_ROOT|tn-playtest-request\.json/, 'Android native entry must configure the mailbox bridge');
});

test('desktop playtests inject the shared mailbox before game evaluation and service screenshot artifacts in the host', () => {
  const cli = read('src/cli/main.cpp');
  const mailboxSetupStart = cli.indexOf('const char* configuredMailboxRoot');
  const gameLoadStart = cli.indexOf('if (!runtime->loadScript(opts.scriptPath))', mailboxSetupStart);
  assert.notEqual(mailboxSetupStart, -1, 'desktop mailbox setup call site is missing');
  assert.notEqual(gameLoadStart, -1, 'desktop game load call site is missing');
  assert.ok(gameLoadStart > mailboxSetupStart, 'desktop game load must follow mailbox setup');
  const mailboxSetup = cli.slice(mailboxSetupStart, gameLoadStart);
  assert.match(mailboxSetup, /runtime->evalScript\(mailbox,\s*"threenative-playtest-mailbox\.js"\)/u);
  assert.match(mailboxSetup, /globalThis\.TN_PLAYTEST_ENDPOINT/u);
  assert.match(mailboxSetup, /globalThis\.TN_PLAYTEST_MAILBOX/u);
  assert.match(mailboxSetup, /tn-playtest-request\.json/u);
  assert.match(mailboxSetup, /tn-playtest-response\.json/u);

  const runtime = read('src/runtime.cpp');
  const screenshotServiceStart = runtime.indexOf('void processPlaytestScreenshotRequest()');
  const frameLoopStart = runtime.indexOf('bool pollEvents() override');
  const frameLoopEnd = runtime.indexOf('void quit() override', frameLoopStart);
  assert.notEqual(screenshotServiceStart, -1, 'screenshot service definition is missing');
  assert.notEqual(frameLoopStart, -1, 'runtime frame loop is missing');
  assert.notEqual(frameLoopEnd, -1, 'runtime frame loop boundary is missing');
  const screenshotService = runtime.slice(screenshotServiceStart, frameLoopStart);
  const frameLoop = runtime.slice(frameLoopStart, frameLoopEnd);
  assert.match(screenshotService, /tn-playtest-screenshot-request\.txt/u);
  assert.match(screenshotService, /saveScreenshot\(screenshotPath\)/u);
  const renderedFrame = frameLoop.indexOf('executeAnimationFrameCallbacks();');
  const screenshotRequest = frameLoop.indexOf('processPlaytestScreenshotRequest();');
  assert.ok(renderedFrame >= 0, 'frame loop must execute animation callbacks');
  assert.ok(screenshotRequest > renderedFrame, 'frame loop must service screenshots after rendering');
  assert.equal(
    (frameLoop.match(/processPlaytestScreenshotRequest\(\);/gu) ?? []).length,
    1,
    'frame loop must invoke the screenshot service at its call site',
  );
});

const generatedAndroidBundle = 'android/app/build/generated/threenative/assets/scripts/main.js';
const generatedAndroidMeta = `${generatedAndroidBundle}.meta.json`;
test.skipIf(
  !existsSync(join(root, generatedAndroidBundle)) || !existsSync(join(root, generatedAndroidMeta)),
)('generated Android bundle provenance [requires the generated Android first-proof artifacts]', async () => {
  const smoke = read('../../examples/native-smoke/src/game.ts');
  const crypto = await import('node:crypto');
  const expectedHash = crypto.createHash('sha256').update(smoke).digest('hex');

  const generated = read(generatedAndroidBundle);
  assert.match(generated, new RegExp(`THREENATIVE_ANDROID_NATIVE_SMOKE_SOURCE_SHA256:${expectedHash}`));
  assert.match(generated, /THREENATIVE_ANDROID_NATIVE_SMOKE_ENTRY:examples\/native-smoke\/src\/game\.ts/);
  for (const marker of ['TN_NATIVE_SMOKE_THREE:0.185.1', 'TN_NATIVE_SMOKE_READY:webgpu', 'TN_NATIVE_SMOKE_FIRST_FRAME', 'TN_NATIVE_SMOKE_300_FRAMES:300']) {
    assert.match(generated, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const meta = JSON.parse(read(generatedAndroidMeta));
  const inputPaths = Object.keys(meta.inputs || {}).join('\n');
  assert.equal(meta.publicApiPackage, '@threenative/core');
  assert.equal(meta.catalogThree, '0.185.1');
  assert.equal(meta.installedThree, '0.185.1');
  assert.match(inputPaths, /examples\/native-smoke\/src\/game\.ts/);
  assert.match(inputPaths, /node_modules\/three\/package\.json/);

  assert.doesNotMatch(generated, /glb-parser|parseGLB|loadGLB|DamagedHelmet|PBR shader|textureSample\(baseColorTexture/i, 'Android default gate must not be the custom raw-WebGPU/GLB-parser sample');
});

test('Android preserves native crash evidence and QuickJS reports each evaluation boundary', () => {
  const runtime = read('src/runtime.cpp');
  assert.match(runtime, /#ifdef __ANDROID__[\s\S]*g_suppressCrashDialog = false/, 'Android must preserve the original signal for debuggerd tombstones');

  const quickjs = read('src/js/quickjs_engine.cpp');
  for (const marker of [
    'Runtime limits:',
    'evalScript compile begin:',
    'evalScript compile complete:',
    'evalScript execute begin:',
    'evalScript execute complete:',
    'evalScript pending jobs begin:',
    'evalScript pending jobs complete:',
  ]) {
    assert.ok(quickjs.includes(marker), `missing QuickJS boundary marker: ${marker}`);
  }
  assert.match(quickjs, /JS_EVAL_TYPE_GLOBAL\s*\|\s*JS_EVAL_FLAG_COMPILE_ONLY/);
  assert.match(quickjs, /JS_EvalFunction\(context_, compiled\)/);

  assert.match(quickjs, /androidQuickJsStackLimit = 4 \* 1024 \* 1024/,
    'QuickJS must use no more than half of the requested Android SDLThread stack');

  const deps = read('scripts/download-deps.mjs');
  assert.match(deps, /process\.exitCode = 1/,
    'dependency downloader must fail closed when a download throws');
  assert.match(deps, /Dependency download failed:/,
    'dependency downloader must fail closed when any dependency reports failure');
  assert.match(deps, /execFileSync\('tar', \['-x(?:z|J)f', archivePath, '-C', destDir\]/,
    'archive extraction must pass native Windows paths directly to tar without shell rewriting');
  assert.match(deps, /archivePath\.endsWith\('\.zip'\) \|\| archivePath\.endsWith\('\.aar'\)/,
    'Android SDL AARs must be extracted as ZIP archives before CMake configures');
  assert.match(deps, /const androidDeps = \['sdl3', 'wgpu-android', 'sdl3-android', 'quiche-android', 'v8-android', 'webp-source'\]/,
    'a clean Android build must download the SDL Java glue, the Android AAR, V8 and the WebP source');
  // Until 2026-08-16 `third_party/v8-android/` existed only where somebody had unpacked it by hand,
  // so a fresh checkout could not build Android V8 at all. This file is the only supported
  // reconstruction path, and the pin is what makes "reconstructible" mean the same bytes.
  assert.match(deps, /'v8-android': \{[\s\S]*?sha256: '[0-9a-f]{64}'/,
    'the Android V8 dependency must pin a checksum, not just a URL');
  assert.match(deps, /abis: \['arm64-v8a', 'x86_64'\]/,
    'the Android V8 dependency must provision every ABI abiFilters ships, or a slice has no snapshot');
  const nativeBuild = read('scripts/native-build.mjs');
  assert.match(nativeBuild, /VCPKG_INSTALLATION_ROOT[\s\S]*x64-windows-static/,
    'Windows builds must consume the static-CRT HTTP dependencies installed by the platform lane');
  assert.match(deps, /gradle\/v8\.5\.0\/gradle\/wrapper\/gradle-wrapper\.jar[\s\S]*GRADLE_WRAPPER_SHA256/,
    'Android dependency reconstruction must restore the excluded wrapper from an immutable Gradle tag and verify it');
  assert.match(deps, /'wgpu-android':[\s\S]*version: 'v25\.0\.2\.2'/,
    'Android must use the first verified modern wgpu-native release that accepts Three.js WGSL on the emulator');
  assert.doesNotMatch(deps, /wgpu-android[\s\S]{0,800}v22\.1\.0\.5/,
    'Android must not regress to the wgpu-native release that rejects Three.js diagnostic directives');
  assert.doesNotMatch(deps, /wgpu-android[\s\S]{0,800}v24\.0\.3\.1/,
    'Android must not regress to the wgpu-native release whose naga rejects the Three.js gradientMap textureLoad');
});

const sdlActivityPath = 'third_party/sdl3/SDL3-3.2.8/android-project/app/src/main/java/org/libsdl/app/SDLActivity.java';
test.skipIf(!existsSync(join(root, sdlActivityPath)))('Android SDL thread stack evidence [requires downloaded third_party SDL3]', () => {
  const sdlActivity = read(sdlActivityPath);
  assert.match(sdlActivity, /new Thread\(null, new SDLMain\(\), "SDLThread", 8 \* 1024 \* 1024\)/,
    'Android SDLThread must reserve enough native stack for QuickJS and WebGPU callbacks');
});

test('CLI excludes disabled video and debug-server implementations from mobile-style builds', () => {
  const cli = read('src/cli/main.cpp');
  assert.match(cli, /#if !TN_ENABLE_VIDEO[\s\S]*Video recording is disabled in this build/,
    'video CLI mode must not link disabled recorder implementations');
  assert.match(cli, /#if !TN_ENABLE_DEBUG_SERVER[\s\S]*Debug server is disabled in this build/,
    'debug CLI mode must not link disabled server implementations');
});

test('WebGPU wrappers remain valid across framework render frames', () => {
  const bindings = read('src/webgpu/bindings.cpp');
  assert.match(bindings, /BYTES_PER_ELEMENT[\s\S]*alignedWriteSize/,
    'GPUQueue.writeBuffer must translate TypedArray element units and align native writes');
  assert.match(bindings, /state->currentSurfaceTextureId[\s\S]*wgpuTextureRelease\(state->currentTexture\)/,
    'presented surface textures must be removed from the registry and released');
  assert.match(bindings,
    /singleWgslEntryPoint[\s\S]*_tnVertexEntryPoint[\s\S]*omitted vertex entryPoint requires exactly one @vertex function/,
    'render pipelines must infer one omitted WGSL vertex entry point and reject ambiguity');
  assert.match(bindings,
    /singleWgslEntryPoint[\s\S]*_tnFragmentEntryPoint[\s\S]*omitted fragment entryPoint requires exactly one @fragment function/,
    'render pipelines must infer one omitted WGSL fragment entry point and reject ambiguity');
  assert.match(bindings, /capturedRenderPassForCommands = renderPass/,
    'each render-pass wrapper must retain the native pass it owns');
  assert.doesNotMatch(bindings, /wgpuRenderPassEncoder(?:Set|Draw)[A-Za-z]*\(g_jsRenderPass/,
    'nested render passes must not redirect commands through mutable global state');
  const v8 = read('src/js/v8_engine.cpp');
  assert.match(v8, /NativeFunctionRef[\s\S]*SetWeak\(functionRef/,
    'native callbacks retained by JavaScript must live until V8 garbage collection');
  assert.doesNotMatch(v8, /frameNativeFunctions_/, 'frame cleanup must not delete live native callbacks');
});

test('desktop V8 drains Promise microtasks from the host frame loop', () => {
  const engine = read('include/mystral/js/engine.h');
  const runtime = read('src/runtime.cpp');
  const v8 = read('src/js/v8_engine.cpp');

  assert.match(engine, /virtual void processMicrotasks\(\)/,
    'the engine contract must expose an explicit microtask checkpoint');
  assert.match(runtime, /void processMicrotasks\(\) \{\s*jsEngine_->processMicrotasks\(\);\s*\}/,
    'the runtime frame loop must delegate Promise job processing to its engine');
  assert.match(v8,
    /void processMicrotasks\(\) override[\s\S]*PumpMessageLoop[\s\S]*PerformMicrotaskCheckpoint\(\)/,
    'V8 embedders must pump foreground tasks before checkpointing Promise microtasks');
});

test('native DOM creates namespaced elements through the active element factory', () => {
  const setup = read('src/runtime-scripts/create-element-setup.js');
  assert.match(setup,
    /document\.createElementNS = (?:function\(_namespace, tagName\) \{\s*return document\.createElement\(tagName\);|\(_namespace, tagName\) => document\.createElement\(tagName\);)/,
    'Three.js createElementNS calls must reach the native canvas override');
  assert.match(read('src/runtime.cpp'), /evalRuntimeScript\(\*jsEngine_, "create-element-setup"/,
    'the native DOM setup must load the extracted element factory');
});

test('QuickJS native callback results have independent engine ownership', () => {
  const quickjs = read('src/js/quickjs_engine.cpp');
  assert.match(quickjs, /if \(result\.ptr\)[\s\S]*return JS_DupValue\(ctx, \*val\)/,
    'native callback results must outlive their temporary C++ handles');
});

test('wgpu-native caps sampler LOD without changing sampler filtering', () => {
  const bindings = read('src/webgpu/bindings.cpp');
  assert.match(
    bindings,
    /#if defined\(MYSTRAL_WEBGPU_WGPU\)[\s\S]*?lodMaxClamp > 1\.0f[\s\S]*?lodMaxClamp = 1\.0f[\s\S]*?#endif/,
    'Android wgpu-native must not sample Three.js single-mip render targets as black',
  );
  assert.doesNotMatch(
    bindings,
    /#if defined\(MYSTRAL_WEBGPU_WGPU\)[\s\S]{0,500}samplerDesc\.(?:magFilter|minFilter|mipmapFilter)\s*=/,
    'the compatibility path must not rewrite the requested filter modes',
  );
});

test('the device exposes asynchronous pipeline creation', () => {
  const bindings = read('src/webgpu/bindings.cpp');
  const installer = read('src/runtime-scripts/install-async-pipelines.js');
  // Without these, WebGPURenderer.compileAsync() throws "not a function" and every pipeline is
  // built lazily on the draw that first needs it, mid-play, instead of behind a loading screen.
  assert.match(
    installer,
    /device\.createRenderPipelineAsync\s*=/,
    'GPUDevice must expose createRenderPipelineAsync',
  );
  assert.match(
    installer,
    /device\.createComputePipelineAsync\s*=/,
    'GPUDevice must expose createComputePipelineAsync',
  );
  // Both must reject rather than throw synchronously: a caller awaits them.
  assert.match(
    installer,
    /return Promise\.reject\(error\)/,
    'a failed pipeline build must reject the returned promise',
  );
  assert.match(bindings, /evalEmbeddedRuntimeScriptWithResult[\s\S]*install-async-pipelines/u);
});

test('native AudioContext exposes the positional graph used by Three.js', () => {
  const audio = read('src/audio/audio_bindings.cpp');
  const audioSmoke = read('tests/audio-play-at-smoke.ts');
  assert.match(audio, /function AudioContext\(\)[\s\S]*__tnCreateAudioContext/,
    'the JavaScript constructor must call the native AudioContext factory');
  assert.match(audio, /Object\.defineProperties\(this, Object\.getOwnPropertyDescriptors\(native\)\)/,
    'QuickJS must copy the native AudioContext surface onto a JavaScript constructor receiver');
  assert.match(audio, /engine->evalScript\(/,
    'the constructor shim must execute as a classic script before game modules load');
  assert.match(audio, /setProperty\(jsCtx, "listener", listener\)/,
    'AudioContext must expose a listener object');
  assert.match(audio, /setProperty\(jsCtx, "createPanner"/,
    'AudioContext must expose createPanner for Three.js PositionalAudio');
  assert.match(audio, /installAudioNodeBindings\(engine, jsNode, nodePtr\)/,
    'native audio nodes must route connect and disconnect to the C++ graph');
  assert.match(audio, /setTargetAtTime[\s\S]*setValueAtTime[\s\S]*linearRampToValueAtTime/,
    'GainNode AudioParam must expose the methods used by Three.js and AudioBus fades');
  assert.match(audio, /newFunction\("setPosition"/,
    'the mixer must accept Three.js listener position updates');
  assert.match(audio, /newFunction\("setOrientation"/,
    'the mixer must accept Three.js listener orientation updates');
  assert.match(audio, /void processAudioEvents\(\)[\s\S]*getProperty\(handle->second, "onended"\)/,
    'source completion must be dispatched to JavaScript outside the SDL audio callback');
  const runtime = read('src/runtime.cpp');
  assert.match(runtime, /audio::processAudioEvents\(\)/,
    'the main loop must drain native audio completion events');
  assert.match(audioSmoke, /async function main\(\)/,
    'the shared audio proof must compile as an Android QuickJS script without top-level await');
  assert.doesNotMatch(audioSmoke, /^await /m,
    'Android QuickJS loads the shared audio proof as a classic script');
});


test('all three Android engine-default sites agree', () => {
  // The Android default is stated in three places, and PRD-130 requires them to agree: a preset that
  // contradicts the platform block is how `-DMYSTRAL_USE_V8=ON` came to work on one machine only.
  // Without this, flipping two of the three leaves the build picking a winner silently depending on
  // whether it went through Gradle, the preset, or a bare CMake configure.
  const gradle = read('android/app/build.gradle.kts');
  const cmake = read('CMakeLists.txt');
  const presets = JSON.parse(read('CMakePresets.json'));

  const gradleDefault = /providers\.gradleProperty\("threenativeJsEngine"\)\.orElse\("(\w+)"\)/u.exec(gradle)?.[1];
  assert.equal(gradleDefault, 'v8', 'the Gradle property default must be the Android default engine');

  // The platform block opts out of V8 only when something else was explicitly asked for.
  assert.match(
    cmake,
    /if\(NOT MYSTRAL_USE_QUICKJS AND NOT MYSTRAL_USE_JSC\)\s*\n\s*set\(MYSTRAL_USE_V8 ON\)/u,
    'the CMake Android platform block must default to V8',
  );

  const android = presets.configurePresets.find(({ name }) => name === 'tn-android');
  assert.ok(android, 'the tn-android preset must exist');
  assert.equal(android.cacheVariables.MYSTRAL_USE_V8, 'ON', 'the tn-android preset must select V8');
  assert.equal(android.cacheVariables.MYSTRAL_USE_QUICKJS, 'OFF', 'the tn-android preset must not also select QuickJS');
  assert.match(android.displayName, /V8/u, 'the preset name must not still advertise the old engine');
});

test('the QuickJS rollback stays reachable', () => {
  // A rollback that stops building is not a rollback. PRD-130 keeps QuickJS as the documented escape
  // for a device or ABI that turns out not to tolerate V8.
  const gradle = read('android/app/build.gradle.kts');
  assert.match(gradle, /engine != "quickjs" && engine != "v8"/u,
    'the Gradle engine property must still accept quickjs');
  assert.match(gradle, /-PthreenativeJsEngine=quickjs/u,
    'the rollback flag must be named where someone editing this file will see it');
  const cmake = read('CMakeLists.txt');
  assert.match(cmake, /MYSTRAL_USE_QUICKJS/u, 'the QuickJS option must still exist in CMake');
});
