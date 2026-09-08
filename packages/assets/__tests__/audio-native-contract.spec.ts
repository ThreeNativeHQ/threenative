import { describe, expect, it } from "vitest";
import {
  NATIVE_AUDIO_CONTAINERS,
  detectAudioContainer,
} from "../../runtime-native/scripts/asset-preflight.mjs";
import {
  DECODABLE_CONTAINERS,
  decodeAudioBytes,
  encodeVorbis,
  sniffAudioContainer,
} from "../src/passes/audio-pcm.js";

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

interface IWaveOptions {
  readonly bitsPerSample?: number;
  readonly channels?: number;
  readonly data?: Buffer;
  readonly declaredDataSize?: number;
  readonly extraChunks?: readonly { bytes: Buffer; declaredSize?: number; id: string }[];
  readonly format?: number;
  readonly fmtSize?: number;
  readonly includeData?: boolean;
  readonly includeFmt?: boolean;
  readonly sampleRate?: number;
  readonly subFormat?: number;
}

function wave(options: IWaveOptions = {}): Buffer {
  const chunks = waveChunks(options, waveFormat(options));
  const result = Buffer.alloc(12 + chunks.reduce((size, chunk) => size + chunk.length, 0));
  result.write("RIFF", 0, "ascii");
  result.writeUInt32LE(result.length - 8, 4);
  result.write("WAVE", 8, "ascii");
  let offset = 12;
  for (const chunk of chunks) {
    chunk.copy(result, offset);
    offset += chunk.length;
  }
  return result;
}

function waveFormat(options: IWaveOptions): Buffer {
  const format = options.format ?? 1;
  const fmtSize = options.fmtSize ?? 16;
  const fmt = Buffer.alloc(fmtSize);
  if (fmtSize >= 2) fmt.writeUInt16LE(format, 0);
  if (fmtSize >= 4) fmt.writeUInt16LE(options.channels ?? 1, 2);
  if (fmtSize >= 8) fmt.writeUInt32LE(options.sampleRate ?? 44_100, 4);
  if (fmtSize >= 16) fmt.writeUInt16LE(options.bitsPerSample ?? 16, 14);
  if (format === 0xfffe && fmtSize >= 40) fmt.writeUInt16LE(options.subFormat ?? 1, 24);
  return fmt;
}

function waveChunks(options: IWaveOptions, fmt: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  if (options.includeFmt !== false) chunks.push(waveChunk("fmt ", fmt));
  for (const extra of options.extraChunks ?? []) {
    chunks.push(waveChunk(extra.id, extra.bytes, extra.declaredSize));
  }
  if (options.includeData !== false) {
    const data = options.data ?? Buffer.from([0, 0]);
    chunks.push(waveChunk("data", data, options.declaredDataSize));
  }
  return chunks;
}

function waveChunk(id: string, bytes: Buffer, declaredSize = bytes.length): Buffer {
  const chunk = Buffer.alloc(8 + bytes.length + (bytes.length % 2));
  chunk.write(id, 0, "ascii");
  chunk.writeUInt32LE(declaredSize, 4);
  bytes.copy(chunk, 8);
  return chunk;
}

function expectMalformed(bytes: Buffer, reason: string): Promise<void> {
  return expect(decodeAudioBytes(bytes, "broken.wav")).rejects.toThrow(
    `TN_ASSETS_AUDIO_MALFORMED: 'broken.wav' is not a readable WAV: ${reason}`,
  );
}

function audioChannel(channels: readonly Float32Array[], index: number): Float32Array {
  const channel = channels[index];
  if (channel === undefined) throw new Error(`expected audio channel ${index}`);
  return channel;
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

  it("should reject short MP3 probes and identify an Ogg stream with no supported codec", () => {
    expect(sniffAudioContainer(Buffer.from([0xff]))).toBe("an unknown format");
    expect(sniffAudioContainer(ogg(0, ""))).toBe("Ogg (unknown codec)");
    expect(sniffAudioContainer(Buffer.from("OggS"))).toBe("Ogg (unknown codec)");
  });
});

describe("the WAV decoder", () => {
  it("reads unsigned 8-bit and signed 16-bit PCM, preserving channels and rate", async () => {
    const mono = await decodeAudioBytes(
      wave({ bitsPerSample: 8, data: Buffer.from([0, 128, 255]), sampleRate: 22_050 }),
      "mono.wav",
    );
    expect(mono).toMatchObject({ container: "RIFF/WAVE", frames: 3, sampleRate: 22_050 });
    expect(Array.from(audioChannel(mono.channels, 0))).toEqual([-1, 0, 127 / 128]);

    const stereoData = Buffer.alloc(8);
    stereoData.writeInt16LE(-32_768, 0);
    stereoData.writeInt16LE(32_767, 2);
    stereoData.writeInt16LE(16_384, 4);
    stereoData.writeInt16LE(-16_384, 6);
    const stereo = await decodeAudioBytes(
      wave({ bitsPerSample: 16, channels: 2, data: stereoData }),
      "stereo.wav",
    );
    expect(stereo.channels).toHaveLength(2);
    expect(Array.from(audioChannel(stereo.channels, 0))).toEqual([-1, 0.5]);
    expect(Array.from(audioChannel(stereo.channels, 1))).toEqual([32_767 / 32_768, -0.5]);
  });

  it("reads 24-bit and 32-bit PCM sample widths", async () => {
    const pcm24 = Buffer.alloc(6);
    pcm24.writeIntLE(-8_388_608, 0, 3);
    pcm24.writeIntLE(8_388_607, 3, 3);
    const decoded24 = await decodeAudioBytes(wave({ bitsPerSample: 24, data: pcm24 }), "24.wav");
    expect(Array.from(audioChannel(decoded24.channels, 0))).toEqual(
      Array.from(new Float32Array([-1, 8_388_607 / 8_388_608])),
    );

    const pcm32 = Buffer.alloc(8);
    pcm32.writeInt32LE(-2_147_483_648, 0);
    pcm32.writeInt32LE(2_147_483_647, 4);
    const decoded32 = await decodeAudioBytes(wave({ bitsPerSample: 32, data: pcm32 }), "32.wav");
    expect(Array.from(audioChannel(decoded32.channels, 0))).toEqual(
      Array.from(new Float32Array([-1, 2_147_483_647 / 2_147_483_648])),
    );
  });

  it("reads 32-bit and 64-bit IEEE float WAV files", async () => {
    const float32 = Buffer.alloc(8);
    float32.writeFloatLE(-0.25, 0);
    float32.writeFloatLE(0.75, 4);
    const decoded32 = await decodeAudioBytes(
      wave({ bitsPerSample: 32, data: float32, format: 3 }),
      "float32.wav",
    );
    expect(Array.from(audioChannel(decoded32.channels, 0))).toEqual([-0.25, 0.75]);

    const float64 = Buffer.alloc(16);
    float64.writeDoubleLE(-0.125, 0);
    float64.writeDoubleLE(0.625, 8);
    const decoded64 = await decodeAudioBytes(
      wave({ bitsPerSample: 64, data: float64, format: 3 }),
      "float64.wav",
    );
    expect(Array.from(audioChannel(decoded64.channels, 0))).toEqual([-0.125, 0.625]);
  });

  it("walks padded metadata chunks, keeps the first format, and unwraps extensible PCM", async () => {
    const first = await decodeAudioBytes(
      wave({
        data: Buffer.from([0, 0]),
        extraChunks: [
          { bytes: Buffer.from([1, 2, 3]), id: "LIST" },
          { bytes: Buffer.alloc(16), id: "fmt " },
        ],
        sampleRate: 22_050,
      }),
      "metadata.wav",
    );
    expect(first.sampleRate).toBe(22_050);

    const extensible = await decodeAudioBytes(
      wave({ bitsPerSample: 16, data: Buffer.from([0, 0]), fmtSize: 40, format: 0xfffe }),
      "extensible.wav",
    );
    expect(extensible.container).toBe("RIFF/WAVE");
    expect(Array.from(audioChannel(extensible.channels, 0))).toEqual([0]);
  });

  it("treats streamed and over-declared data chunks as the bytes actually present", async () => {
    for (const declaredDataSize of [0, 999]) {
      const decoded = await decodeAudioBytes(
        wave({ data: Buffer.from([0, 0, 0, 0]), declaredDataSize }),
        `stream-${declaredDataSize}.wav`,
      );
      expect(decoded.frames).toBe(2);
    }
  });

  it("fails closed for malformed WAV tables and unsupported sample descriptions", async () => {
    await expectMalformed(wave({ includeFmt: false }), "it has no fmt chunk");
    await expectMalformed(wave({ includeData: false }), "it has no data chunk");
    await expectMalformed(wave({ fmtSize: 12 }), "the fmt chunk is shorter than 16 bytes");
    await expectMalformed(
      wave({ extraChunks: [{ bytes: Buffer.alloc(1), declaredSize: 99, id: "LIST" }] }),
      "chunk 'LIST' is truncated",
    );
    await expectMalformed(wave({ channels: 0 }), "the fmt chunk declares no channels");
    await expectMalformed(
      wave({ data: Buffer.alloc(0), sampleRate: 0 }),
      "the fmt chunk declares no sample rate",
    );
    await expectMalformed(
      wave({ bitsPerSample: 16, data: Buffer.from([0]), sampleRate: 44_100 }),
      "the data chunk holds no whole frames",
    );
    await expectMalformed(
      wave({ format: 6 }),
      "format 6 at 16 bits is not PCM or IEEE float this pass reads",
    );
    await expectMalformed(
      wave({ bitsPerSample: 20 }),
      "format 1 at 20 bits is not PCM or IEEE float this pass reads",
    );
    await expect(decodeAudioBytes(Buffer.from("not audio"), "voice.mp3")).rejects.toThrow(
      /TN_ASSETS_AUDIO_UNDECODABLE.*voice\.mp3/su,
    );
  });

  it("rejects encoder channel layouts the native Vorbis contract cannot represent", async () => {
    await expect(encodeVorbis([], 44_100, 0, "surround.wav")).rejects.toThrow(
      /TN_ASSETS_AUDIO_CHANNELS.*0 channel/su,
    );
    await expect(
      encodeVorbis(
        [new Float32Array(1), new Float32Array(1), new Float32Array(1)],
        44_100,
        0,
        "surround.wav",
      ),
    ).rejects.toThrow(/TN_ASSETS_AUDIO_CHANNELS.*3 channel/su);
  });
});
