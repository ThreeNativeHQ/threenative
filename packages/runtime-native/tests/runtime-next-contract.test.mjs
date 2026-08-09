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
  assert.match(external, /DamagedHelmet\.gltf/);
  assert.match(external, /GLTFLoader/);

  const texture = read('conformance/scenes/shared/texture-blob-imagebitmap.js');
  for (const token of ['Blob', 'blob.stream', 'URL.createObjectURL', 'URL.revokeObjectURL', 'createImageBitmap']) {
    assert.match(texture, new RegExp(token.replace('.', '\\.')));
  }

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
  const smokePath = 'examples/native-smoke/src/main.ts';

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

  const activity = read('android/app/src/main/java/com/mystral/engine/MystralActivity.java');
  assert.match(activity, /TN_PLAYTEST_MAILBOX_ROOT/, 'Android activity must pass the host mailbox root to SDL_main');
  const androidMain = read('src/platform/android_main.cpp');
  assert.match(androidMain, /TN_PLAYTEST_MAILBOX_ROOT|tn-playtest-request\.json/, 'Android native entry must configure the mailbox bridge');
});

const generatedAndroidBundle = 'android/app/src/main/assets/scripts/main.js';
const generatedAndroidMeta = `${generatedAndroidBundle}.meta.json`;
test.skipIf(
  !existsSync(join(root, generatedAndroidBundle)) || !existsSync(join(root, generatedAndroidMeta)),
)('generated Android bundle provenance [requires the generated Android first-proof artifacts]', async () => {
  const smoke = read('../../examples/native-smoke/src/main.ts');
  const crypto = await import('node:crypto');
  const expectedHash = crypto.createHash('sha256').update(smoke).digest('hex');

  const generated = read(generatedAndroidBundle);
  assert.match(generated, new RegExp(`THREENATIVE_ANDROID_NATIVE_SMOKE_SOURCE_SHA256:${expectedHash}`));
  assert.match(generated, /THREENATIVE_ANDROID_NATIVE_SMOKE_ENTRY:examples\/native-smoke\/src\/main\.ts/);
  for (const marker of ['TN_NATIVE_SMOKE_THREE:0.185.1', 'TN_NATIVE_SMOKE_READY:webgpu', 'TN_NATIVE_SMOKE_FIRST_FRAME', 'TN_NATIVE_SMOKE_300_FRAMES:300']) {
    assert.match(generated, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const meta = JSON.parse(read(generatedAndroidMeta));
  const inputPaths = Object.keys(meta.inputs || {}).join('\n');
  assert.equal(meta.publicApiPackage, '@threenative/core');
  assert.equal(meta.catalogThree, '0.185.1');
  assert.equal(meta.installedThree, '0.185.1');
  assert.match(inputPaths, /examples\/native-smoke\/src\/main\.ts/);
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
  const nativeBuild = read('scripts/native-build.mjs');
  assert.match(nativeBuild, /VCPKG_INSTALLATION_ROOT[\s\S]*x64-windows-static/,
    'Windows builds must consume the static-CRT HTTP dependencies installed by the platform lane');
  assert.match(deps, /gradle-8\.5-wrapper\.jar[\s\S]*GRADLE_WRAPPER_SHA256/,
    'Android dependency reconstruction must restore and verify the excluded Gradle wrapper');
  assert.match(deps, /'wgpu-android':[\s\S]*version: 'v24\.0\.3\.1'/,
    'Android must use the first verified modern wgpu-native release that accepts Three.js WGSL on the emulator');
  assert.doesNotMatch(deps, /wgpu-android[\s\S]{0,800}v22\.1\.0\.5/,
    'Android must not regress to the wgpu-native release that rejects Three.js diagnostic directives');
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

  const v8 = read('src/js/v8_engine.cpp');
  assert.match(v8, /NativeFunctionRef[\s\S]*SetWeak\(functionRef/,
    'native callbacks retained by JavaScript must live until V8 garbage collection');
  assert.doesNotMatch(v8, /frameNativeFunctions_/, 'frame cleanup must not delete live native callbacks');
});
