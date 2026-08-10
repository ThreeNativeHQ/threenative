import assert from 'node:assert/strict';
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

test('Win32 window creation does not require a Vulkan-capable host', () => {
  const windowSource = read('src/platform/window.cpp');
  assert.match(windowSource, /#elif !defined\(_WIN32\)[\s\S]*?SDL_WINDOW_VULKAN/u);
  assert.doesNotMatch(windowSource, /#else\s+flags \|= SDL_WINDOW_VULKAN/u);
});

test('default builds do not compile/register deprecated native GLTF path', () => {
  const cmake = read('CMakeLists.txt');
  const nativeBlock = cmake.match(/if\(TN_ENABLE_NATIVE_GLTF\)([\s\S]*?)endif\(\)/);
  assert.ok(nativeBlock, 'deprecated native GLTF sources must be behind explicit TN_ENABLE_NATIVE_GLTF block');
  const defaultSourceList = cmake.replace(nativeBlock[0], '');
  assert.doesNotMatch(defaultSourceList, /src\/utils\/cgltf_impl\.cpp|src\/gltf\/gltf_loader\.cpp/, 'deprecated native GLTF/cgltf files must not be in default MYSTRAL_SOURCES');

  const runtime = read('src/runtime.cpp');
  assert.match(runtime, /#if TN_ENABLE_NATIVE_GLTF[\s\S]*setupGLTF\(\);[\s\S]*#endif/, 'runtime setupGLTF registration must be gated');
  const bindings = read('src/webgpu/bindings.cpp');
  assert.match(bindings, /#if TN_ENABLE_NATIVE_GLTF[\s\S]*"loadGLTF"[\s\S]*#endif/, 'Mystral.loadGLTF binding must be gated');
  assert.match(bindings, /setGlobalProperty\("Mystral", mystralNamespace\)/, 'Mystral namespace may exist, but loadGLTF must not be registered by default');
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
  assert.match(deps, /const androidDeps = \['sdl3', 'wgpu-android', 'sdl3-android', 'quiche-android'\]/,
    'a clean Android build must download the SDL Java glue as well as the Android AAR');
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
  assert.match(bindings, /g_currentSurfaceTextureId[\s\S]*wgpuTextureRelease\(g_currentTexture\)/,
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
  const runtime = read('src/runtime.cpp');
  assert.match(runtime,
    /document\.createElementNS = function\(_namespace, tagName\) \{\s*return document\.createElement\(tagName\);/,
    'Three.js createElementNS calls must reach the native canvas override');
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
