// The executable proof of this contract is `tests/audio_decode_ogg_test.cpp`, which decodes a
// genuine Ogg Vorbis file through the installed JavaScript host and only runs in the native lane.
// These assertions keep the shape it proves from being undone in the default gate, and keep the
// two halves that have to agree — what `decodeAudioFile` decodes and what `asset-preflight.mjs`
// says it decodes — from drifting apart.
//
// That second job is the point. The preflight's WebP claim went stale the moment the build
// changed under it and nothing noticed, which cost a day of bisection; a hardcoded audio table
// is the same disease waiting for the same trigger. There is no CMake option to derive the audio
// answer from — one decoder, compiled into every target — so what stands in for derivation is
// this: the list and the decoder are read side by side, and disagreeing fails.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { NATIVE_AUDIO_CONTAINERS, detectAudioContainer } from "../scripts/asset-preflight.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("the runtime decodes Ogg Vorbis by sniffing the bytes, not by trusting the extension", () => {
  const decoder = read("src/audio/audio_context.cpp");
  assert.match(
    decoder,
    /std::memcmp\(data, "OggS", 4\) == 0\) return decodeOggVorbis\(/u,
    "decodeAudioFile must dispatch on the container magic",
  );
  assert.match(
    decoder,
    /stb_vorbis_decode_memory\(data, static_cast<int>\(length\)/u,
    "the Ogg arm must decode through stb_vorbis rather than hand back silence",
  );
  // Fail closed: every stb_vorbis failure has to reach the same rejected promise a WAV failure
  // does. A decoder that returns an empty buffer on a corrupt file is worse than one that refuses.
  assert.match(decoder, /if \(frames < 0 \|\| samples == nullptr\)/u);
  assert.match(decoder, /if \(frames == 0 \|\| numChannels <= 0 \|\| sourceRate <= 0\)/u);
});

test("decodeAudioFile reads the targetSampleRate it is handed", () => {
  // The parameter was accepted and never used. `AudioBufferSourceNode::process` advances one
  // buffer frame per output frame with no rate conversion anywhere, so a buffer left at its own
  // rate plays at the wrong pitch — and Vorbis makes that common, because 48 kHz is an ordinary
  // Ogg rate against a 44.1 kHz context.
  const decoder = read("src/audio/audio_context.cpp");
  assert.match(decoder, /std::vector<float> resampleInterleaved\(/u);
  assert.match(
    decoder,
    /if \(targetSampleRate > 0\.0f && std::fabs\(targetSampleRate - sourceRate\) > 0\.5f\)/u,
    "the decoded buffer must be resampled to the context rate",
  );
  assert.doesNotMatch(
    decoder,
    /std::make_shared<AudioBuffer>\(static_cast<float>\(spec\.freq\)/u,
    "the WAV arm must go through the same rate conversion, not straight to the file's own rate",
  );
});

test("stb_vorbis is provisioned by the only supported dependency path", () => {
  assert.match(
    read("scripts/download-deps.mjs"),
    /'stb_vorbis\.c',/u,
    "the header set download-deps.mjs provisions must carry it",
  );
  // Testing the directory instead of the header meant an added header provisioned nothing on any
  // checkout that already had the others, and reported success while doing it.
  assert.match(
    read("scripts/download-deps.mjs"),
    /const missing = dep\.headers\.filter\(\(header\) => !existsSync\(join\(destDir, header\)\)\);/u,
  );
  assert.match(
    read("CMakeLists.txt"),
    /^ {4}src\/audio\/vorbis_impl\.c$/mu,
    "the single translation unit that compiles it must be in the runtime sources",
  );
});

test("the Ogg decode proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-audio-decode-ogg-test EXCLUDE_FROM_ALL\s*tests\/audio_decode_ogg_test\.cpp\)/u,
  );
  assert.match(
    read("CMakeLists.txt"),
    /THREENATIVE_OGG_FIXTURE="\$\{CMAKE_CURRENT_SOURCE_DIR\}\/tests\/fixtures\/pickup\.ogg"/u,
  );
  const verify = read("scripts/verify-desktop-audio.mjs");
  assert.match(verify, /target: "threenative-audio-decode-ogg-test",/u);
  assert.match(verify, /native Ogg Vorbis decode contract passed/u);
  assert.match(
    JSON.parse(read("package.json")).scripts["native:verify:desktop"],
    /verify-desktop-audio\.mjs/u,
  );
});

test("the fixture the proof runs on is a real Ogg Vorbis file", () => {
  // An `OggS` header a test writes by hand proves nothing about a decoder; the executable proof
  // fails closed on a missing or tiny fixture for the same reason.
  const fixture = readFileSync(join(root, "tests/fixtures/pickup.ogg"));
  assert.equal(detectAudioContainer(fixture), "Ogg Vorbis");
  assert.ok(fixture.length > 1024, `the fixture is ${fixture.length} bytes`);
});

test("the preflight's container table and the decoder agree", () => {
  // The leg that stops this file going stale the way the WebP claim did.
  const decoder = read("src/audio/audio_context.cpp");
  const implemented = [
    ["RIFF/WAVE", /return decodeRiffWave\(data, length, targetSampleRate\);/u],
    ["Ogg Vorbis", /return decodeOggVorbis\(data, length, targetSampleRate\);/u],
  ];
  for (const [container, dispatch] of implemented) {
    assert.match(decoder, dispatch, `${container} must still be dispatched`);
    assert.ok(
      NATIVE_AUDIO_CONTAINERS.includes(container),
      `asset-preflight.mjs must list ${container} as decodable`,
    );
  }
  assert.equal(
    NATIVE_AUDIO_CONTAINERS.length,
    implemented.length,
    "asset-preflight.mjs claims a container decodeAudioFile does not dispatch",
  );
  // MP3, AAC, FLAC and Opus stay honestly undecodable. Adding one is a decoder, not a table edit.
  for (const container of ["MP3", "MP3 (ID3)", "FLAC", "MP4/M4A", "Ogg Opus", "Ogg FLAC"])
    assert.ok(!NATIVE_AUDIO_CONTAINERS.includes(container), `${container} is not implemented`);
});

test("every packager runs the gate, and each names its own target", () => {
  // `package-desktop.mjs` and `package-ios.mjs` skipped the preflight entirely, so the assets an
  // APK was refused for shipped in a .app and a desktop binary and failed at game start instead.
  assert.match(
    read("scripts/package-android.mjs"),
    /assertAndroidAssetsDecodable\(assets, \{ webp: deriveAndroidWebpSupport\(runtimeSource\) \}\)/u,
  );
  assert.match(
    read("scripts/package-desktop.mjs"),
    /assertNativeAssetsDecodable\(assets, \{\s*target: 'desktop',\s*capabilities: \{ webp: deriveDesktopWebpSupport\(runtimeSource\) \},\s*\}\);/u,
  );
  assert.match(
    read("scripts/package-ios.mjs"),
    /assertNativeAssetsDecodable\(assets, \{\s*target: 'ios',\s*capabilities: \{ webp: deriveIosWebpSupport\(\) \},\s*\}\);/u,
  );
});
