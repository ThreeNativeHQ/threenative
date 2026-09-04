import { describe, expect, it } from "vitest";
import {
  NATIVE_AUDIO_CONTAINERS,
  detectAudioContainer,
} from "../../runtime-native/scripts/asset-preflight.mjs";
import { DECODABLE_CONTAINERS, sniffAudioContainer } from "../src/passes/audio-pcm.js";

/**
 * The two halves that have to agree: what the audio pass reads and writes, and what the native
 * runtime decodes.
 *
 * `audio-pcm.ts` carries its own copy of the container sniff rather than importing the preflight,
 * because a published `@threenative/assets` tarball ships no runtime-native sources and the import
 * would break the package for every consumer. A copy is a thing that goes stale — the preflight's
 * own WebP claim went stale the moment the build changed under it and cost a day of bisection — so
 * what stands in for sharing the code is this: both are read side by side, and disagreeing fails.
 *
 * `runtime-native/tests/audio-decode-ogg.test.mjs` already pins the preflight's table against
 * `decodeAudioFile` itself. With this file the chain runs end to end: the decoder says what it
 * implements, the preflight agrees, and the pass that produces the bytes agrees with both.
 */

const SAMPLES: readonly (readonly [string, Buffer])[] = [
  ["RIFF/WAVE", riff()],
  ["Ogg Vorbis", ogg(0x01, "vorbis")],
  ["Ogg Opus", ogg(undefined, "OpusHead")],
  ["Ogg FLAC", ogg(0x7f, "FLAC")],
  ["MP3 (ID3)", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)])],
  ["MP3", Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(64)])],
  ["FLAC", Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(64)])],
  ["MP4/M4A", Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(64)])],
  ["an unknown format", Buffer.alloc(64, 0x5a)],
];

function riff(): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return bytes;
}

/** An Ogg page header with a codec identifier where the first packet's payload starts. */
function ogg(marker: number | undefined, identifier: string): Buffer {
  const bytes = Buffer.alloc(128);
  bytes.write("OggS", 0, "ascii");
  if (marker === undefined) {
    bytes.write(identifier, 28, "ascii");
    return bytes;
  }
  bytes[28] = marker;
  bytes.write(identifier, 29, "ascii");
  return bytes;
}

describe("the audio pass and the native decoder contract", () => {
  it("should sniff every container exactly as the native asset preflight does", () => {
    for (const [expected, bytes] of SAMPLES) {
      expect(sniffAudioContainer(bytes)).toBe(expected);
      // Not just "mine is right" — mine and the preflight's, on the same bytes.
      expect(sniffAudioContainer(bytes)).toBe(detectAudioContainer(bytes));
    }
  });

  it("should read exactly the containers every native target decodes, no more and no fewer", () => {
    // Reading one more than the runtime decodes would let the bake accept a source that ships
    // silent; reading one fewer would fail a build over an asset that works.
    expect([...DECODABLE_CONTAINERS].sort()).toEqual([...NATIVE_AUDIO_CONTAINERS].sort());
  });

  it("should leave MP3, FLAC, Opus and AAC honestly undecodable", () => {
    // Adding one of these is a decoder in the runtime, not an entry in a list here.
    for (const container of ["MP3", "MP3 (ID3)", "FLAC", "MP4/M4A", "Ogg Opus", "Ogg FLAC"]) {
      expect(DECODABLE_CONTAINERS).not.toContain(container);
      expect(NATIVE_AUDIO_CONTAINERS).not.toContain(container);
    }
  });
});
