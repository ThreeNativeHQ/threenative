/**
 * The four assets that produced a black screen on a Pixel 8, as fixtures.
 *
 * Each case here is a real failure that shipped: an OGG the WAV-only decoder rejected, a GLB with
 * WebP textures the runtime has no libwebp to read, and an interleaved vertex buffer WebGPU will
 * not build a pipeline for. All three were present in one APK, none of them failed the build, and
 * the only symptom on device was a black rectangle.
 */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';

import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import {
  assertAndroidAssetsDecodable,
  findAndroidAssetProblems,
  readGlbJson,
} from '../scripts/asset-preflight.mjs';

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

/** An Ogg page header. This is what `create-threenative`'s asset workflow actually emits. */
function oggBytes() {
  const bytes = Buffer.alloc(64);
  bytes.write('OggS', 0, 'ascii');
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

test('an Ogg Vorbis asset is reported, named, and given the ffmpeg command', () => {
  const root = makeAssets();
  mkdirSync(join(root, 'audio'), { recursive: true });
  writeFileSync(join(root, 'audio', 'ui-click.ogg'), oggBytes());
  const problems = findAndroidAssetProblems(root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'audio/ui-click.ogg');
  assert.match(problems[0].reason, /is Ogg;/);
  assert.match(problems[0].fix, /^ffmpeg .*pcm_s16le/);
});

test('a GLB with WebP textures is reported', () => {
  const root = makeAssets();
  writeFileSync(join(root, 'enemy.glb'), meshGlb({ images: [{ mimeType: 'image/webp' }, { mimeType: 'image/jpeg' }] }));
  const problems = findAndroidAssetProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /1 WebP texture/);
  assert.match(problems[0].fix, /gltf-transform jpeg/);
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
  writeFileSync(join(root, 'audio', 'a.ogg'), oggBytes());
  writeFileSync(join(root, 'audio', 'b.ogg'), oggBytes());
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
  writeFileSync(join(root, 'audio', 'a.ogg'), oggBytes());
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
