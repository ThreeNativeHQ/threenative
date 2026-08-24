/**
 * Refuse to build an APK whose assets the target cannot decode.
 *
 * ## Why this exists
 *
 * A game shipped 30 OGG files and three GLBs carrying WebP textures. Both are the correct choice
 * for the web, both are what the default asset pipeline produces — `create-threenative`'s workflow
 * emits OGG, and `gltf-transform optimize` emits WebP — and neither can be decoded by the Android
 * runtime as it is built today. The APK built, installed and launched to a **black screen**: no
 * crash, no tombstone, nothing in logcat but the present tick. It cost a day of bisection to find,
 * and every fact needed to catch it was sitting in the first twelve bytes of the files the
 * packager was already copying.
 *
 * So this reads them. It is the difference between a build that fails in one second naming the
 * file and the command that fixes it, and a build that succeeds and hands a person a black screen.
 *
 * ## What it does not do
 *
 * It does not transcode. Transcoding needs `ffmpeg` and `gltf-transform` on the build host, which
 * the packager cannot assume it has, and silently rewriting a game's assets is a bigger promise
 * than refusing to package them. The message carries the exact command instead — the same one that
 * produced the working APK by hand.
 *
 * `THREENATIVE_SKIP_ASSET_PREFLIGHT=1` turns the whole thing off, for the case where a runtime has
 * been built with decoders this file does not know about yet.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, extname } from 'node:path';

/**
 * What the runtime about to be packaged can decode, derived from the build rather than declared.
 *
 * The first version of this file refused every WebP texture for Android, saying "the android
 * runtime is built without libwebp". That had been false since `62fac4d5` added `webp-source` to
 * `androidDeps`: CMake builds libwebp from source under `MYSTRAL_HAS_WEBP` and the device logs
 * `[Mystral] WebP format support: YES`. The claim was hardcoded, so it went stale the moment the
 * build changed under it, and nothing could notice. Every capability here is therefore computed
 * from the same facts CMake reads.
 */

/** Mirrors the ANDROID branch of the libwebp block in CMakeLists.txt. */
export function deriveAndroidWebpSupport(runtimeSource) {
  if (!runtimeSource || !existsSync(join(runtimeSource, 'CMakeLists.txt'))) {
    return {
      supported: false,
      reason:
        `${runtimeSource || '(no runtime root)'} is not a runtime source checkout, and a prebuilt ` +
        'Android release does not declare which decoders it was built with',
    };
  }
  const sourceRoot = join(runtimeSource, 'third_party', 'webp-source');
  // CMake globs libwebp-* and takes the first candidate that has a CMakeLists.txt and no lib/ —
  // a lib/ means a prebuilt drop landed in the source destination, which builds nothing.
  let candidates = [];
  try {
    candidates = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('libwebp-'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    candidates = [];
  }
  const buildable = candidates.find(
    (name) =>
      existsSync(join(sourceRoot, name, 'CMakeLists.txt')) && !existsSync(join(sourceRoot, name, 'lib')),
  );
  if (buildable !== undefined) {
    return {
      supported: true,
      reason: `third_party/webp-source/${buildable} is provisioned, so CMake builds libwebp into the Android runtime under MYSTRAL_HAS_WEBP`,
    };
  }
  return {
    supported: false,
    reason:
      'third_party/webp-source carries no buildable libwebp-* source tree, so CMake prints ' +
      '"libwebp not found" and the runtime reports "WebP format support: NO". Provision it with ' +
      "'node scripts/download-deps.mjs --only webp-source'",
  };
}

/**
 * Fail closed: a caller that names no capabilities gets the most restrictive runtime, not the most
 * permissive one. `stageAndroidAssets` derives the real set from the runtime it is about to pack.
 */
export const NO_DECODERS = Object.freeze({
  webp: Object.freeze({ supported: false, reason: 'no runtime capabilities were derived' }),
});

/** Extensions the runtime will hand to `decodeAudioData`. */
const AUDIO_EXTENSIONS = new Set(['.ogg', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.opus']);
/** Containers worth naming back to the caller, so the message says what the file *is*. */
const AUDIO_SIGNATURES = [
  { name: 'Ogg', match: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53 },
  { name: 'MP3 (ID3)', match: (b) => b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 },
  { name: 'MP3', match: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0 },
  { name: 'FLAC', match: (b) => b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43 },
  { name: 'MP4/M4A', match: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
];

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON"

/**
 * A file is decodable audio for this target only if it is genuinely RIFF/WAVE.
 *
 * The decoder sniffs the header rather than the extension, which is why the hand-rolled workaround
 * for this — transcoding to WAV *content* while keeping the `.ogg` filenames — worked at all. So
 * the check is on the bytes too: a `.wav` carrying Ogg fails, and an `.ogg` carrying WAV passes.
 */
function audioProblem(relativePath, bytes) {
  if (bytes.length >= 12) {
    const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const wave = bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
    if (riff && wave) return undefined;
  }
  const detected = AUDIO_SIGNATURES.find((entry) => entry.match(bytes))?.name ?? 'an unknown format';
  return {
    file: relativePath,
    reason: `is ${detected}; the android target's decoder accepts RIFF/WAVE only`,
    fix: `ffmpeg -y -i "${relativePath}" -f wav -ar 44100 -ac 2 -c:a pcm_s16le "${relativePath}"`,
  };
}

/** The glTF JSON chunk of a `.glb`, or undefined when the file is not a GLB this can read. */
export function readGlbJson(bytes) {
  if (bytes.length < 20) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) return undefined;
    if (kind === GLB_CHUNK_JSON) {
      try {
        return JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
      } catch {
        return undefined;
      }
    }
    offset = start + length;
  }
  return undefined;
}

/**
 * Two things a GLB can carry that this target cannot draw.
 *
 * **WebP textures.** When the runtime carries no libwebp, the build says so (`libwebp not found`)
 * and the runtime says so (`WebP format support: NO`), and both were ignored, because the only
 * visible symptom is `THREE.GLTFLoader: Couldn't load texture blob:...` and two white models in an
 * otherwise perfect scene. The shape of that failure is worth knowing: a broken loader loses
 * *every* embedded texture, so "only two models are white" was already evidence the URLs were fine
 * and the decode was not. Whether this runtime carries it is derived, never assumed — see
 * `deriveAndroidWebpSupport`.
 *
 * **Interleaved vertex buffers.** `gltf-transform optimize` interleaves by default, and an
 * interleaved buffer makes `THREE.WebGPURenderer` fail `createRenderPipeline` on every mesh. The
 * fix is one flag, `--vertex-layout separate`, and it has been written down as folklore in more
 * than one game's agent notes. Folklore does not stop a build; this does.
 */
function glbProblems(relativePath, json, capabilities) {
  const problems = [];
  const webp = (json.images ?? []).filter((image) => image?.mimeType === 'image/webp').length;
  if (webp > 0 && capabilities.webp.supported !== true) {
    problems.push({
      file: relativePath,
      reason: `embeds ${webp} WebP texture${webp === 1 ? '' : 's'}, and ${capabilities.webp.reason}`,
      fix:
        `gltf-transform jpeg --formats '*' --quality 90 --vertex-layout separate "${relativePath}" "${relativePath}"` +
        ` && gltf-transform png --formats webp --vertex-layout separate "${relativePath}" "${relativePath}"`,
    });
  }

  // Interleaved means two or more attributes packed into the same buffer view, one vertex's worth
  // at a time. It does NOT mean `byteStride > element`: glTF requires accessor byte offsets and
  // strides to be 4-byte aligned, so a VEC3 of shorts is 6 bytes of data in an 8-byte slot in
  // every separate-layout file `gltf-transform` produces. Testing the stride flagged all three of
  // Bayview's rigged GLBs, which demonstrably render on WebGPU on both desktop and a Pixel 8 — a
  // gate that fails on working assets is worse than no gate. Counting accessors per view is the
  // thing interleaving actually is.
  const accessors = json.accessors ?? [];
  const attributesPerView = new Map();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const index of Object.values(primitive.attributes ?? {})) {
        const view = accessors[index]?.bufferView;
        if (view === undefined) continue;
        const seen = attributesPerView.get(view) ?? new Set();
        seen.add(index);
        attributesPerView.set(view, seen);
      }
    }
  }
  let interleaved = 0;
  for (const seen of attributesPerView.values()) if (seen.size > 1) interleaved += 1;
  if (interleaved > 0) {
    problems.push({
      file: relativePath,
      reason: `has ${interleaved} interleaved buffer view${interleaved === 1 ? '' : 's'}; WebGPU fails createRenderPipeline on every mesh that uses one`,
      fix: `gltf-transform cp --vertex-layout separate "${relativePath}" "${relativePath}"`,
    });
  }
  return problems;
}

function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const path = relative ? posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(directory, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

/**
 * Every asset in `directory` the android target cannot read, as a list of problems.
 *
 * Returns rather than throws, so a caller can warn instead of failing and so this is testable
 * without a filesystem full of broken fixtures.
 */
export function findAndroidAssetProblems(directory, capabilities = NO_DECODERS) {
  if (!directory) return [];
  let entries;
  try {
    if (!statSync(directory).isDirectory()) return [];
    entries = listFiles(directory);
  } catch {
    return [];
  }
  const problems = [];
  for (const file of entries) {
    const extension = extname(file).toLowerCase();
    const isAudio = AUDIO_EXTENSIONS.has(extension);
    const isGlb = extension === '.glb';
    if (!isAudio && !isGlb) continue;
    let bytes;
    try {
      bytes = readFileSync(join(directory, file));
    } catch {
      continue;
    }
    if (isAudio) {
      const problem = audioProblem(file, bytes);
      if (problem !== undefined) problems.push(problem);
      continue;
    }
    const json = readGlbJson(bytes);
    if (json !== undefined) problems.push(...glbProblems(file, json, capabilities));
  }
  return problems;
}

/** The message a person reads when the build stops: what, why, and the command that fixes it. */
export function formatAssetProblems(problems) {
  const lines = [
    `TN_NATIVE_ASSET_UNSUPPORTED: ${problems.length} asset${problems.length === 1 ? '' : 's'} cannot be decoded by the android target.`,
    '',
  ];
  for (const problem of problems) {
    lines.push(`  ${problem.file}`);
    lines.push(`    ${problem.reason}`);
    lines.push(`    fix: ${problem.fix}`);
    lines.push('');
  }
  lines.push(
    'Transcode into a staging copy of the asset directory and package that, so the web build keeps',
    'shipping OGG and WebP. Set THREENATIVE_SKIP_ASSET_PREFLIGHT=1 to package anyway.',
  );
  return lines.join('\n');
}

/** Throw unless every asset in `directory` is decodable, or the caller opted out by env. */
export function assertAndroidAssetsDecodable(directory, capabilities = NO_DECODERS) {
  if (process.env.THREENATIVE_SKIP_ASSET_PREFLIGHT === '1') return [];
  const problems = findAndroidAssetProblems(directory, capabilities);
  if (problems.length > 0) throw new Error(formatAssetProblems(problems));
  return problems;
}
