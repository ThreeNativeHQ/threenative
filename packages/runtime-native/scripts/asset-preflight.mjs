/**
 * Refuse to package a build whose assets the target cannot decode.
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
 * than refusing to package them. The message carries the exact command instead.
 *
 * It is also not the fix for a container the runtime *should* read. The first version of this file
 * refused every Ogg Vorbis file and printed an ffmpeg line, and that advice was the bug wearing a
 * hat: `.ogg` is what `create-threenative`'s workflow emits and what the browser half of the same
 * source plays, so the answer was to teach the runtime Vorbis, not to teach every game a manual
 * transcode step. It now decodes Ogg Vorbis (`src/audio/vorbis_impl.c`), and this file no longer
 * has an opinion about it. What stays refused — MP3, AAC, FLAC, Opus — is refused because nothing
 * native decodes it, on any target, and the message says so instead of blaming Android.
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
 * Mirrors the non-Android, non-iOS branch of the same libwebp block: a prebuilt drop under
 * `third_party/webp/libwebp-*` with both a library and headers, which is what CMake's
 * `WEBP_LIBRARY AND WEBP_INCLUDE_DIR` requires before it defines `MYSTRAL_HAS_WEBP`.
 */
export function deriveDesktopWebpSupport(runtimeSource) {
  if (!runtimeSource || !existsSync(join(runtimeSource, 'CMakeLists.txt'))) {
    return {
      supported: false,
      reason:
        `${runtimeSource || '(no runtime root)'} is not a runtime source checkout, and a prebuilt ` +
        'desktop release does not declare which decoders it was built with',
    };
  }
  const prebuiltRoot = join(runtimeSource, 'third_party', 'webp');
  let candidates = [];
  try {
    candidates = readdirSync(prebuiltRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('libwebp-'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    candidates = [];
  }
  const usable = candidates.find((name) => {
    const root = join(prebuiltRoot, name);
    if (!existsSync(join(root, 'include'))) return false;
    return ['libwebp.a', 'webp.lib', 'libwebp.lib', 'libwebp.so', 'libwebp.dylib'].some((library) =>
      existsSync(join(root, 'lib', library)),
    );
  });
  if (usable !== undefined) {
    return {
      supported: true,
      reason: `third_party/webp/${usable} carries a library and headers, so CMake defines MYSTRAL_HAS_WEBP`,
    };
  }
  return {
    supported: false,
    reason:
      'third_party/webp carries no libwebp-* prebuilt with both lib/ and include/, so CMake ' +
      'warns "libwebp library or headers not found" and the runtime reports "WebP format ' +
      'support: NO". Provision it with \'node scripts/download-deps.mjs --only webp\'',
  };
}

/**
 * iOS has no libwebp on any path, and that is a property of the build rather than of a directory:
 * `CMakeLists.txt` excludes `IOS` from the prebuilt branch and the source branch is `ANDROID`-only.
 * There is nothing to derive from the filesystem, so this states the exclusion and the three-leg
 * sync test pins it against CMake — correcting the Android claim must not quietly make this one
 * wrong in the other direction.
 */
export function deriveIosWebpSupport() {
  return {
    supported: false,
    reason:
      'CMakeLists.txt excludes IOS from the libwebp prebuilt branch and builds libwebp from ' +
      'source for ANDROID only, so no iOS runtime carries a WebP decoder',
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

/**
 * What `decodeAudioFile` implements, and therefore what every native target decodes.
 *
 * This is one decoder in one file (`src/audio/audio_context.cpp`), compiled into desktop, Android
 * and iOS alike, so the answer does not vary by target the way libwebp does - there is no CMake
 * option to derive it from. What can still go stale is *this list*, so
 * `tests/audio-decode-ogg.test.mjs` fails when the containers named here and the containers
 * `decodeAudioFile` sniffs stop agreeing.
 */
export const NATIVE_AUDIO_CONTAINERS = Object.freeze(['RIFF/WAVE', 'Ogg Vorbis']);

/**
 * What the file *is*, read from its bytes.
 *
 * Ogg is a container, not a codec: the same `.ogg` extension and the same `OggS` magic carry
 * Vorbis, Opus and FLAC. The runtime decodes Vorbis and nothing else in that container, so a
 * magic-number match alone would wave an Opus file straight through to a failure at game start.
 * The codec identifier sits in the first page, after the 27-byte page header and its segment table.
 */
export function detectAudioContainer(bytes) {
  const ascii = (offset, text) => {
    if (bytes.length < offset + text.length) return false;
    for (let index = 0; index < text.length; index += 1)
      if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    return true;
  };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'RIFF/WAVE';
  if (ascii(0, 'OggS')) {
    if (bytes[28] === 0x01 && ascii(29, 'vorbis')) return 'Ogg Vorbis';
    if (ascii(28, 'OpusHead')) return 'Ogg Opus';
    if (bytes[28] === 0x7f && ascii(29, 'FLAC')) return 'Ogg FLAC';
    return 'Ogg (unknown codec)';
  }
  if (ascii(0, 'ID3')) return 'MP3 (ID3)';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'MP3';
  if (ascii(0, 'fLaC')) return 'FLAC';
  if (ascii(4, 'ftyp')) return 'MP4/M4A';
  return 'an unknown format';
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON"

/**
 * A file is decodable audio only if its bytes are a container `decodeAudioFile` implements.
 *
 * The decoder sniffs the header rather than the extension, which is why the hand-rolled workaround
 * for the missing Vorbis decoder — transcoding to WAV *content* while keeping the `.ogg`
 * filenames — worked at all. So the check is on the bytes too: a `.wav` carrying Opus fails, and
 * an `.ogg` carrying WAV passes.
 *
 * The refusal names no platform. Every native target shares this decoder, so "the android target
 * rejects it" was never the truth even when Android was the only target anyone had run — the same
 * file fails on desktop and on iOS, and saying otherwise sent people hunting an Android problem.
 */
function audioProblem(relativePath, bytes) {
  const detected = detectAudioContainer(bytes);
  if (NATIVE_AUDIO_CONTAINERS.includes(detected)) return undefined;
  return {
    file: relativePath,
    reason: `is ${detected}; no native target decodes this container (the runtime decodes ${NATIVE_AUDIO_CONTAINERS.join(' and ')})`,
    // Ogg Vorbis rather than WAV: roughly a tenth of the size, what the web build already ships,
    // and now decoded natively, so one file serves both halves of the same source.
    fix: `ffmpeg -y -i "${relativePath}" -c:a libvorbis -ar 44100 "${relativePath.replace(/\.[^.]*$/u, '')}.ogg"`,
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
 * Every asset in `directory` the named target cannot read, as a list of problems.
 *
 * Returns rather than throws, so a caller can warn instead of failing and so this is testable
 * without a filesystem full of broken fixtures.
 */
export function findNativeAssetProblems(directory, capabilities = NO_DECODERS) {
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
export function formatAssetProblems(problems, target = 'android') {
  const lines = [
    `TN_NATIVE_ASSET_UNSUPPORTED: ${problems.length} asset${problems.length === 1 ? '' : 's'} cannot be decoded by the ${target} target.`,
    '',
  ];
  for (const problem of problems) {
    lines.push(`  ${problem.file}`);
    lines.push(`    ${problem.reason}`);
    lines.push(`    fix: ${problem.fix}`);
    lines.push('');
  }
  lines.push(
    'Convert into a staging copy of the asset directory and package that, so the web build keeps',
    'shipping whatever it likes. Set THREENATIVE_SKIP_ASSET_PREFLIGHT=1 to package anyway.',
  );
  return lines.join('\n');
}

/**
 * Throw unless every asset in `directory` is decodable by `target`, or the caller opted out by env.
 *
 * Every packager calls this. Only the Android one did, which is how `package-desktop.mjs` and
 * `package-ios.mjs` shipped builds that failed at game start on assets the packager had already
 * read and copied — the same class of black screen, reached by a different door. The capability
 * set is the caller's, because it is the caller that knows which runtime it is about to pack.
 */
export function assertNativeAssetsDecodable(directory, { target, capabilities = NO_DECODERS } = {}) {
  if (!target) throw new Error('assertNativeAssetsDecodable requires the target it is gating.');
  if (process.env.THREENATIVE_SKIP_ASSET_PREFLIGHT === '1') return [];
  const problems = findNativeAssetProblems(directory, capabilities);
  if (problems.length > 0) throw new Error(formatAssetProblems(problems, target));
  return problems;
}

/**
 * The Android-shaped names the packager and the template gate already call, kept so a rename does
 * not travel further than this change needs to. They are the same gate with the target filled in.
 */
export function findAndroidAssetProblems(directory, capabilities = NO_DECODERS) {
  return findNativeAssetProblems(directory, capabilities);
}

export function assertAndroidAssetsDecodable(directory, capabilities = NO_DECODERS) {
  return assertNativeAssetsDecodable(directory, { target: 'android', capabilities });
}
