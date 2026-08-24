/**
 * The four assets that produced a black screen on a Pixel 8, as fixtures.
 *
 * Each case here is a real failure that shipped: an OGG the WAV-only decoder rejected, a GLB with
 * WebP textures the runtime has no libwebp to read, and an interleaved vertex buffer WebGPU will
 * not build a pipeline for. All three were present in one APK, none of them failed the build, and
 * the only symptom on device was a black rectangle.
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';

import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import {
  assertAndroidAssetsDecodable,
  assertNativeAssetsDecodable,
  deriveAndroidWebpSupport,
  deriveDesktopWebpSupport,
  deriveIosWebpSupport,
  detectAudioContainer,
  findAndroidAssetProblems,
  findNativeAssetProblems,
  readGlbJson,
} from '../scripts/asset-preflight.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** A genuine Ogg Vorbis file, the same fixture the native decode proof runs on. */
const oggVorbis = () =>
  readFileSync(join(repoRoot, 'packages/runtime-native/tests/fixtures/pickup.ogg'));

/** A runtime source checkout, optionally with libwebp provisioned the way CMake wants it. */
function makeRuntime({ webpSource = 'absent', webpPrebuilt = false } = {}) {
  const root = makeTempDirSync('threenative-runtime-facts-');
  roots.push(root);
  writeFileSync(join(root, 'CMakeLists.txt'), 'project(mystral)\n');
  if (webpPrebuilt !== false) {
    // The desktop shape is the opposite of the Android one: a prebuilt drop with lib/ and
    // include/ is exactly what CMake links, and a source tree is what it ignores.
    const drop = join(root, 'third_party', 'webp', 'libwebp-1.5.0-linux-x86-64');
    mkdirSync(join(drop, 'include'), { recursive: true });
    if (webpPrebuilt === true) {
      mkdirSync(join(drop, 'lib'), { recursive: true });
      writeFileSync(join(drop, 'lib', 'libwebp.a'), '');
    }
  }
  if (webpSource === 'absent') return root;
  const tree = join(root, 'third_party', 'webp-source', 'libwebp-1.5.0');
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, 'CMakeLists.txt'), 'project(libwebp)\n');
  // CMake takes a candidate only when it has no lib/ — a prebuilt drop in the source destination
  // satisfies the glob and builds nothing.
  if (webpSource === 'prebuilt-drop') mkdirSync(join(tree, 'lib'), { recursive: true });
  return root;
}

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  delete process.env.THREENATIVE_SKIP_ASSET_PREFLIGHT;
});

function makeAssets() {
  const root = makeTempDirSync('threenative-asset-preflight-');
  roots.push(root);
  return root;
}

/** A RIFF/WAVE header with no samples: the only audio shape this target decodes. */
function wavBytes() {
  const bytes = Buffer.alloc(44);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  return bytes;
}

/** An Ogg page carrying Opus, which no native target decodes. */
function opusBytes() {
  const bytes = Buffer.alloc(64);
  bytes.write('OggS', 0, 'ascii');
  bytes.write('OpusHead', 28, 'ascii');
  return bytes;
}

/** An MP3 with an ID3 tag, which no native target decodes either. */
function mp3Bytes() {
  const bytes = Buffer.alloc(64);
  bytes.write('ID3', 0, 'ascii');
  return bytes;
}

function glbBytes(json) {
  const chunk = Buffer.from(JSON.stringify(json), 'utf8');
  const padded = Buffer.concat([chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + padded.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(padded.length, 0);
  chunkHeader.write('JSON', 4, 'ascii');
  return Buffer.concat([header, chunkHeader, padded]);
}

/**
 * `shared` puts POSITION and NORMAL in the same buffer view, which is what interleaving is.
 * Separate layout gives each attribute its own view, and its stride is padded to a 4-byte
 * boundary — 8 bytes for a VEC3 of shorts — which glTF requires and which is not interleaving.
 */
function meshGlb({ shared = false, padded = false, images = [] } = {}) {
  const short = { componentType: 5122, type: 'VEC3', count: 3 };
  return glbBytes({
    asset: { version: '2.0' },
    images,
    accessors: [
      { bufferView: 0, ...short },
      { bufferView: shared ? 0 : 1, ...short },
    ],
    bufferViews: [
      { buffer: 0, byteLength: 96, ...(padded ? { byteStride: 8 } : {}) },
      { buffer: 0, byteLength: 96, ...(padded ? { byteStride: 8 } : {}) },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
  });
}

test('a WAV-content asset passes whatever its extension says', () => {
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  // The decoder sniffs the header, not the name, which is why transcoding to WAV content under
  // an .ogg filename was a working workaround. The check has to agree with the decoder.
  writeFileSync(join(root, 'audio', 'ui-click.ogg'), wavBytes());
  writeFileSync(join(root, 'audio', 'shot.wav'), wavBytes());
  assert.deepEqual(findAndroidAssetProblems(root), []);
});

test('a genuine Ogg Vorbis asset passes, because the runtime decodes it', () => {
  // This test used to assert the opposite, and the assertion was the bug: `.ogg` is what
  // `create-threenative`'s workflow emits and what the web half of the same source plays, so
  // refusing it and printing an ffmpeg line made every game carry a manual transcode step. The
  // runtime decodes Ogg Vorbis now (`src/audio/vorbis_impl.c`), proved by
  // `tests/audio_decode_ogg_test.cpp` on this same file.
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  writeFileSync(join(root, 'audio', 'ui-click.ogg'), oggVorbis());
  assert.deepEqual(findAndroidAssetProblems(root), []);
});

test('the refusal blames no platform, because every native target shares one decoder', () => {
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  writeFileSync(join(root, 'audio', 'voice.ogg'), opusBytes());
  const problems = findAndroidAssetProblems(root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'audio/voice.ogg');
  // Opus in an Ogg container: the magic number matches Vorbis and the codec does not.
  assert.match(problems[0].reason, /is Ogg Opus;/);
  assert.match(problems[0].reason, /no native target decodes this container/);
  assert.doesNotMatch(problems[0].reason, /android/);
  // MP3, AAC, FLAC and Opus stay honestly undecodable, so they keep their conversion command.
  assert.match(problems[0].fix, /^ffmpeg .*libvorbis/);
});

test('an Ogg container is read down to its codec, never just its magic number', () => {
  const vorbis = oggVorbis();
  assert.equal(detectAudioContainer(vorbis), 'Ogg Vorbis');
  assert.equal(detectAudioContainer(opusBytes()), 'Ogg Opus');
  assert.equal(detectAudioContainer(mp3Bytes()), 'MP3 (ID3)');
  assert.equal(detectAudioContainer(wavBytes()), 'RIFF/WAVE');
  const flacInOgg = Buffer.alloc(64);
  flacInOgg.write('OggS', 0, 'ascii');
  flacInOgg[28] = 0x7f;
  flacInOgg.write('FLAC', 29, 'ascii');
  assert.equal(detectAudioContainer(flacInOgg), 'Ogg FLAC');
  const bareOgg = Buffer.alloc(64);
  bareOgg.write('OggS', 0, 'ascii');
  assert.equal(detectAudioContainer(bareOgg), 'Ogg (unknown codec)');
});

test('MP3 is still refused, and the message says so without naming a platform', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'theme.mp3'), mp3Bytes());
  const problems = findAndroidAssetProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /is MP3 \(ID3\); no native target decodes this container/);
});

test('desktop and iOS run the same gate with their own derived capabilities', () => {
  // Both packagers ran no preflight at all, so an undecodable asset reached the same rejected
  // `decodeAudioData` an APK died on — the same black screen through a different door.
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  writeFileSync(join(root, 'audio', 'voice.ogg'), opusBytes());
  for (const target of ['desktop', 'ios']) {
    assert.throws(
      () => assertNativeAssetsDecodable(root, { target }),
      (error) => {
        assert.match(error.message, new RegExp(`cannot be decoded by the ${target} target`));
        return true;
      },
    );
  }
  // A gate that does not know what it is gating is a gate that reports the wrong platform.
  assert.throws(() => assertNativeAssetsDecodable(root, {}), /requires the target it is gating/);
});

test('iOS refuses a WebP texture that Android accepts, because iOS builds no libwebp', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'enemy.glb'), meshGlb({ images: [{ mimeType: 'image/webp' }] }));
  assert.deepEqual(
    findNativeAssetProblems(root, { webp: deriveAndroidWebpSupport(makeRuntime({ webpSource: 'source' })) }),
    [],
  );
  const ios = findNativeAssetProblems(root, { webp: deriveIosWebpSupport() });
  assert.equal(ios.length, 1);
  assert.match(ios[0].reason, /excludes IOS/);
});

test('desktop WebP support is derived from the prebuilt drop CMake actually links', () => {
  const provisioned = deriveDesktopWebpSupport(makeRuntime({ webpPrebuilt: true }));
  assert.equal(provisioned.supported, true);
  assert.match(provisioned.reason, /third_party\/webp\/libwebp-1\.5\.0-linux-x86-64/);

  const headersOnly = deriveDesktopWebpSupport(makeRuntime({ webpPrebuilt: 'headers-only' }));
  assert.equal(headersOnly.supported, false, 'CMake requires WEBP_LIBRARY *and* WEBP_INCLUDE_DIR');

  const bare = deriveDesktopWebpSupport(makeRuntime());
  assert.equal(bare.supported, false);
  assert.match(bare.reason, /download-deps\.mjs --only webp/);

  const install = deriveDesktopWebpSupport(makeAssets());
  assert.equal(install.supported, false);
  assert.match(install.reason, /not a runtime source checkout/);
});

test('WebP support is derived from the runtime the build ships with, not declared', () => {
  // The claim this replaces — "the android runtime is built without libwebp" — had been false
  // since 62fac4d5 added webp-source to androidDeps. A hardcoded capability goes stale the moment
  // the build changes under it, and nothing can notice.
  const provisioned = deriveAndroidWebpSupport(makeRuntime({ webpSource: 'source' }));
  assert.equal(provisioned.supported, true);
  assert.match(provisioned.reason, /libwebp-1\.5\.0 is provisioned/);

  const bare = deriveAndroidWebpSupport(makeRuntime());
  assert.equal(bare.supported, false);
  assert.match(bare.reason, /download-deps\.mjs --only webp-source/);

  const dropped = deriveAndroidWebpSupport(makeRuntime({ webpSource: 'prebuilt-drop' }));
  assert.equal(dropped.supported, false, 'a lib/ in the source destination builds nothing');

  const install = deriveAndroidWebpSupport(makeAssets());
  assert.equal(install.supported, false);
  assert.match(install.reason, /not a runtime source checkout/);
});

test('a GLB with WebP textures is reported when the runtime carries no libwebp', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'enemy.glb'), meshGlb({ images: [{ mimeType: 'image/webp' }, { mimeType: 'image/jpeg' }] }));
  const problems = findAndroidAssetProblems(root, {
    webp: deriveAndroidWebpSupport(makeRuntime()),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /1 WebP texture/);
  // The refusal names the missing provisioning rather than a stale rumour about the runtime.
  assert.match(problems[0].reason, /download-deps\.mjs --only webp-source/);
  assert.match(problems[0].fix, /gltf-transform jpeg/);
});

test('a GLB with WebP textures passes when the runtime genuinely carries libwebp', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'enemy.glb'), meshGlb({ images: [{ mimeType: 'image/webp' }] }));
  assert.deepEqual(
    findAndroidAssetProblems(root, { webp: deriveAndroidWebpSupport(makeRuntime({ webpSource: 'source' })) }),
    [],
  );
});

test('a caller that derives nothing gets the most restrictive runtime, not the most permissive', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'enemy.glb'), meshGlb({ images: [{ mimeType: 'image/webp' }] }));
  assert.equal(findAndroidAssetProblems(root).length, 1);
});

test('a GLB whose textures are all JPEG passes', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'barrel.glb'), meshGlb({ images: [{ mimeType: 'image/jpeg' }] }));
  assert.deepEqual(findAndroidAssetProblems(root), []);
});

test('two attributes sharing one buffer view is reported as interleaved', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'town.glb'), meshGlb({ shared: true }));
  const problems = findAndroidAssetProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /interleaved buffer view/);
  assert.match(problems[0].fix, /--vertex-layout separate/);
});

test("glTF's mandatory 4-byte stride padding is not interleaving", () => {
  // Regression guard. Testing `byteStride > elementSize` flagged all three of Bayview's rigged
  // GLBs — a VEC3 of shorts is 6 bytes in an 8-byte slot in every separate-layout file — and all
  // three render correctly on WebGPU on desktop and on a Pixel 8.
  const root = makeAssets();
  writeFileSync(join(root, 'town.glb'), meshGlb({ padded: true }));
  assert.deepEqual(findAndroidAssetProblems(root), []);
});

test('the failure names every offending file at once, not just the first', () => {
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  writeFileSync(join(root, 'audio', 'a.ogg'), opusBytes());
  writeFileSync(join(root, 'audio', 'b.ogg'), opusBytes());
  writeFileSync(join(root, 'enemy.glb'), meshGlb({ shared: true, images: [{ mimeType: 'image/webp' }] }));
  assert.throws(
    () => assertAndroidAssetsDecodable(root),
    (error) => {
      assert.match(error.message, /TN_NATIVE_ASSET_UNSUPPORTED: 4 assets/);
      assert.match(error.message, /audio\/a\.ogg/);
      assert.match(error.message, /audio\/b\.ogg/);
      assert.match(error.message, /enemy\.glb/);
      return true;
    },
  );
});

test('THREENATIVE_SKIP_ASSET_PREFLIGHT=1 packages anyway', () => {
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  writeFileSync(join(root, 'audio', 'a.ogg'), opusBytes());
  process.env.THREENATIVE_SKIP_ASSET_PREFLIGHT = '1';
  assert.deepEqual(assertAndroidAssetsDecodable(root), []);
});

test('a non-GLB and a missing directory are both quietly fine', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'notes.txt'), 'not an asset');
  writeFileSync(join(root, 'broken.glb'), Buffer.from('not a glb at all'));
  assert.deepEqual(findAndroidAssetProblems(root), []);
  assert.deepEqual(findAndroidAssetProblems(join(root, 'does-not-exist')), []);
  assert.equal(readGlbJson(Buffer.from('short')), undefined);
});
