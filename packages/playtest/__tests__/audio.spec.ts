import { describe, expect, it } from "vitest";

import {
  analyseSamples,
  AUDIO_BANDS,
  audioExitCode,
  checkClip,
  formatAudioReport,
  parseAudioArgs,
  parseAudioManifest,
  spectrogramPng,
  type IAudioClipExpectation,
} from "../src/runner/audio.js";
import { parseWav } from "../src/runner/audioRun.js";

const RATE = 44_100;

/** A pure tone, so a band check has a known right answer. */
function tone(hz: number, seconds = 0.5, amplitude = 0.5): Float64Array[] {
  const samples = new Float64Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / RATE);
  }
  return [samples];
}

/** Noise from a fixed generator: a seam test needs a signal with real interior steps. */
function noise(seconds = 0.5, amplitude = 0.3, seed = 12_345): Float64Array[] {
  const samples = new Float64Array(Math.round(seconds * RATE));
  let state = seed;
  for (let index = 0; index < samples.length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    samples[index] = ((state / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return [samples];
}

function expectation(overrides: Partial<IAudioClipExpectation> = {}): IAudioClipExpectation {
  return { loop: false, path: "audio/clip.ogg", ...overrides };
}

function manifest(clips: unknown): string {
  return JSON.stringify({ clips, version: 1 });
}

describe("audio inspection arguments", () => {
  it("should require an expectation manifest", () => {
    expect(() => parseAudioArgs([])).toThrow(/--expect/u);
  });

  it("should default the spectrogram directory under artifacts", () => {
    const args = parseAudioArgs(["--expect", "audio.expect.json"]);
    expect(args.expect).toBe("audio.expect.json");
    expect(args.out).toMatch(/artifacts[/\\]audio$/u);
    expect(args.text).toBe(false);
    expect(args.spectrograms).toBe(true);
  });

  it("should reject an unknown flag rather than ignore it", () => {
    expect(() => parseAudioArgs(["--expect", "a.json", "--loud"])).toThrow(/--loud/u);
  });

  it("should parse every supported switch and require values for value-taking flags", () => {
    const args = parseAudioArgs([
      "--expect", "audio.expect.json",
      "--dir", "public/audio",
      "--out", "artifacts/spectrograms",
      "--root", ".",
      "--text",
      "--no-spectrograms",
    ]);
    expect(args).toMatchObject({
      dir: "public/audio",
      expect: "audio.expect.json",
      spectrograms: false,
      text: true,
    });
    expect(args.out).toMatch(/artifacts[/\\]spectrograms$/u);
    expect(() => parseAudioArgs(["--expect"])).toThrow(/needs a value/u);
    expect(() => parseAudioArgs(["--dir", "--text", "--expect", "a.json"])).toThrow(/needs a value/u);
  });
});

describe("audio expectation manifest", () => {
  it("should read a well-formed manifest", () => {
    const parsed = parseAudioManifest(
      manifest([{ bands: { high: { min: 30 } }, loop: true, path: "audio/bed.ogg" }]),
      "audio.expect.json",
    );
    expect(parsed.clips).toHaveLength(1);
    expect(parsed.clips[0]?.bands?.high).toEqual({ min: 30 });
  });

  it("should fail closed on an empty clip list", () => {
    // An audio gate that asserts nothing is the harness this project already got burned by.
    expect(() => parseAudioManifest(manifest([]), "a.json")).toThrow(/at least one clip/u);
  });

  it("should fail closed on a malformed clip rather than skip it", () => {
    expect(() => parseAudioManifest(manifest([{ path: "a.ogg" }]), "a.json")).toThrow(/loop/u);
    expect(() => parseAudioManifest(manifest([{ loop: false }]), "a.json")).toThrow(/path/u);
    expect(() => parseAudioManifest(manifest([{ loop: "yes", path: "a.ogg" }]), "a.json")).toThrow(
      /loop/u,
    );
  });

  it("should fail closed on an unknown key, which is how a typo silently disables a check", () => {
    expect(() =>
      parseAudioManifest(manifest([{ loop: false, path: "a.ogg", peakMx: 0.9 }]), "a.json"),
    ).toThrow(/peakMx/u);
    expect(() => parseAudioManifest('{"clips":[],"verison":1}', "a.json")).toThrow(/verison/u);
  });

  it("should fail closed on a band nobody measures", () => {
    expect(() =>
      parseAudioManifest(manifest([{ bands: { treble: { min: 5 } }, loop: false, path: "a.ogg" }]), "a.json"),
    ).toThrow(/treble/u);
  });

  it("should reject a band bound that can never hold", () => {
    expect(() =>
      parseAudioManifest(manifest([{ bands: { mid: { max: 10, min: 40 } }, loop: false, path: "a.ogg" }]), "a.json"),
    ).toThrow(/min/u);
    expect(() =>
      parseAudioManifest(manifest([{ bands: { mid: {} }, loop: false, path: "a.ogg" }]), "a.json"),
    ).toThrow(/min.*max|max.*min/u);
  });

  it("should reject a seam bound on a clip that never wraps", () => {
    expect(() =>
      parseAudioManifest(manifest([{ loop: false, path: "a.ogg", seamMaxRatio: 1 }]), "a.json"),
    ).toThrow(/seamMaxRatio/u);
  });

  it("should reject a duplicate path, so the later one cannot shadow the earlier", () => {
    expect(() =>
      parseAudioManifest(manifest([{ loop: false, path: "a.ogg" }, { loop: true, path: "a.ogg" }]), "a.json"),
    ).toThrow(/a\.ogg/u);
  });

  it("should name the file when the manifest is not JSON", () => {
    expect(() => parseAudioManifest("{not json", "audio.expect.json")).toThrow(
      /audio\.expect\.json/u,
    );
  });

  it("should reject a version it does not implement", () => {
    expect(() => parseAudioManifest('{"clips":[{"loop":false,"path":"a.ogg"}],"version":2}', "a.json")).toThrow(
      /version/u,
    );
  });

  it("should reject non-objects, missing clip arrays, and non-object clip entries", () => {
    expect(() => parseAudioManifest("[]", "a.json")).toThrow(/JSON object/u);
    expect(() => parseAudioManifest(JSON.stringify({ clips: "clip", version: 1 }), "a.json")).toThrow(
      /clips.*array/u,
    );
    expect(() => parseAudioManifest(JSON.stringify({ clips: [null], version: 1 }), "a.json")).toThrow(
      /clips\[0\].*object/u,
    );
  });

  it("should validate optional bounds and every measured band shape", () => {
    const parsed = parseAudioManifest(
      manifest([{
        bands: { air: { max: 80 }, low: { min: 10, max: 90 } },
        loop: false,
        path: "a.ogg",
        peakMax: 0.9,
        silenceRms: 0.01,
      }]),
      "a.json",
    );
    expect(parsed.clips[0]).toMatchObject({
      bands: { air: { max: 80 }, low: { max: 90, min: 10 } },
      peakMax: 0.9,
      silenceRms: 0.01,
    });
    expect(() => parseAudioManifest(manifest([{ bands: { mid: null }, loop: false, path: "a.ogg" }]), "a.json"))
      .toThrow(/band.*object/u);
    expect(() => parseAudioManifest(manifest([{ bands: {}, loop: false, path: "a.ogg" }]), "a.json"))
      .toThrow(/bands.*empty/u);
    for (const key of ["peakMax", "seamMaxRatio", "silenceRms"] as const) {
      expect(() => parseAudioManifest(manifest([{ [key]: 0, loop: true, path: "a.ogg" }]), "a.json"))
        .toThrow(new RegExp(`${key}.*positive`, "u"));
    }
    expect(() => parseAudioManifest(manifest([{ bands: { low: { min: -1 } }, loop: false, path: "a.ogg" }]), "a.json"))
      .toThrow(/percentage/u);
    expect(() => parseAudioManifest(manifest([{ bands: { low: { max: 101 } }, loop: false, path: "a.ogg" }]), "a.json"))
      .toThrow(/percentage/u);
  });
});

describe("audio analysis", () => {
  it("should put a tone in the band that contains it", () => {
    const analysis = analyseSamples(tone(4_000), RATE);
    expect(analysis.bands.high).toBeGreaterThan(90);
    expect(analysis.bands.sub).toBeLessThan(1);
    expect(analysis.peak).toBeCloseTo(0.5, 2);
    expect(analysis.seconds).toBeCloseTo(0.5, 3);
  });

  it("should put a low tone in the low band, which is the hum this exists to catch", () => {
    const analysis = analyseSamples(tone(220), RATE);
    expect(analysis.bands.low).toBeGreaterThan(90);
    expect(analysis.bands.high).toBeLessThan(1);
  });

  it("should measure a DC offset", () => {
    const [samples] = tone(1_000);
    if (samples === undefined) throw new Error("tone produced no channel.");
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = (samples[index] ?? 0) + 0.2;
    expect(analyseSamples([samples], RATE).dc).toBeCloseTo(0.2, 2);
  });

  it("should report silence as silence rather than as a clip with no problems", () => {
    const analysis = analyseSamples([new Float64Array(RATE)], RATE);
    expect(analysis.rms).toBe(0);
    expect(analysis.peak).toBe(0);
  });

  it("should measure the wrap against the steps beside it, not the whole clip", () => {
    // 200 cycles in exactly one second, so the wrap is continuous. Its join lands on the sine's
    // steepest point, which is also the largest step in the neighbourhood — so a flawless loop
    // measures exactly 1.0 here, and that is why the default limit is not 1.0.
    const continuous = analyseSamples(tone(200, 1), RATE);
    expect(continuous.seam?.ratio ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1.001);
    expect(
      checkClip("bed.ogg", continuous, expectation({ loop: true })).find(
        ({ name }) => name === "seam",
      )?.status,
    ).toBe("ok");

    // A half-cycle offset at the join is the click this check is for.
    const [broken] = tone(200, 1);
    if (broken === undefined) throw new Error("tone produced no channel.");
    broken[broken.length - 1] = 0.5;
    broken[0] = -0.5;
    const analysis = analyseSamples([broken], RATE);
    expect(analysis.seam?.ratio ?? 0).toBeGreaterThan(5);
    expect(
      checkClip("bed.ogg", analysis, expectation({ loop: true })).find(
        ({ name }) => name === "seam",
      )?.status,
    ).toBe("fail");
  });

  it("should not let a quiet clip's silent stretches excuse a seam", () => {
    // Noise for 50 ms at each end, near-silence between: a whole-clip percentile would call the
    // join ordinary because most of the clip has no steps at all.
    const [loud] = noise(0.5);
    if (loud === undefined) throw new Error("noise produced no channel.");
    const samples = new Float64Array(RATE * 3);
    samples.set(loud.subarray(0, RATE / 20), 0);
    samples.set(loud.subarray(0, RATE / 20), samples.length - RATE / 20);
    const analysis = analyseSamples([samples], RATE);
    expect(analysis.seam?.nearP99 ?? 0).toBeGreaterThan(0);
  });

  it("should reject empty decodes and handle uneven channels and a silent seam neighborhood", () => {
    expect(() => analyseSamples([], RATE)).toThrow(/no samples/u);
    expect(() => analyseSamples([new Float64Array()], RATE)).toThrow(/no samples/u);

    const uneven = analyseSamples([
      new Float64Array([0, 1, 0, -1]),
      new Float64Array([0]),
    ], RATE);
    expect(uneven.channels).toBe(2);
    expect(uneven.seam).toBeDefined();

    const silentJoin = analyseSamples([new Float64Array([1, 1, 1, 1, 0, 0, 0, 0])], RATE);
    expect(silentJoin.seam?.ratio).toBe(Number.POSITIVE_INFINITY);
    expect(checkClip("loop.wav", silentJoin, expectation({ loop: true })).find(({ name }) => name === "seam"))
      .toMatchObject({ status: "fail" });
  });
});

describe("audio checks", () => {
  const clean = analyseSamples(tone(4_000), RATE);

  it("should pass a clip that meets everything declared", () => {
    const checks = checkClip("audio/clip.ogg", clean, expectation({ bands: { high: { min: 50 } } }));
    expect(checks.every(({ status }) => status !== "fail")).toBe(true);
  });

  it("should fail a silent clip, which every other check calls fine", () => {
    const silent = analyseSamples([new Float64Array(RATE)], RATE);
    const checks = checkClip("audio/clip.ogg", silent, expectation());
    expect(checks.find(({ name }) => name === "silence")?.status).toBe("fail");
  });

  it("should fail a clip that clips", () => {
    const hot = analyseSamples(tone(1_000, 0.5, 1), RATE);
    const checks = checkClip("audio/clip.ogg", hot, expectation());
    expect(checks.find(({ name }) => name === "headroom")?.status).toBe("fail");
  });

  it("should fail a chime that has no brightness, naming the band and both numbers", () => {
    const hum = analyseSamples(tone(300), RATE);
    const checks = checkClip(
      "audio/landmark-found.ogg",
      hum,
      expectation({ bands: { high: { min: 20 } }, path: "audio/landmark-found.ogg" }),
    );
    const band = checks.find(({ name }) => name === "band high");
    expect(band?.status).toBe("fail");
    expect(band?.detail).toMatch(/20/u);
  });

  it("should check a seam only on a clip that declares itself a loop", () => {
    const oneShot = checkClip("audio/step.ogg", clean, expectation({ loop: false }));
    expect(oneShot.some(({ name }) => name === "seam")).toBe(false);
    const looped = checkClip("audio/bed.ogg", clean, expectation({ loop: true }));
    expect(looped.some(({ name }) => name === "seam")).toBe(true);
  });

  it("should warn rather than fail on a DC offset", () => {
    const [samples] = tone(4_000);
    if (samples === undefined) throw new Error("tone produced no channel.");
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = (samples[index] ?? 0) + 0.05;
    const checks = checkClip("audio/clip.ogg", analyseSamples([samples], RATE), expectation());
    expect(checks.find(({ name }) => name === "dc")?.status).toBe("warn");
  });

  it("should warn on a quiet peak, reject a short loop, and report both band-bound failures", () => {
    const quiet = checkClip("quiet.ogg", analyseSamples(tone(4_000, 0.1, 0.05), RATE), expectation());
    expect(quiet.find(({ name }) => name === "headroom")).toMatchObject({ status: "warn" });

    const shortLoop = checkClip(
      "short.ogg",
      analyseSamples([new Float64Array([0, 0, 0])], RATE),
      expectation({ loop: true }),
    );
    expect(shortLoop.find(({ name }) => name === "seam")).toMatchObject({ status: "fail" });

    const bounded = checkClip(
      "bounded.ogg",
      clean,
      expectation({ bands: { high: { max: 1, min: 101 } } }),
    );
    expect(bounded.find(({ name }) => name === "band high")).toMatchObject({
      status: "fail",
    });
    expect(bounded.find(({ name }) => name === "band high")?.detail).toMatch(/below.*above/su);
  });
});

describe("audio report", () => {
  const analysis = analyseSamples(tone(4_000), RATE);

  it("should exit 0 when every check passed and 1 when one failed", () => {
    const ok = { checks: checkClip("a.ogg", analysis, expectation()), clips: [], pass: true };
    expect(audioExitCode(ok)).toBe(0);
    const bad = {
      checks: [{ detail: "d", name: "silence", status: "fail" as const }],
      clips: [],
      pass: false,
    };
    expect(audioExitCode(bad)).toBe(1);
    expect(audioExitCode({ checks: [], pass: true })).toBe(1);
  });

  it("should name every spectrogram it wrote, because the picture is what a person looks at", () => {
    const text = formatAudioReport({
      checks: [{ detail: "peak 0.500", name: "headroom", status: "ok" }],
      clips: [{ analysis, path: "audio/clip.ogg", spectrogram: "artifacts/audio/clip.png" }],
      pass: true,
    });
    expect(text).toContain("artifacts/audio/clip.png");
    expect(text).toContain("✓");
  });

  it("should say plainly that nothing was checked when nothing was", () => {
    const text = formatAudioReport({ checks: [], clips: [], pass: false });
    expect(text).toMatch(/no checks/iu);
  });

  it("should print fixes and a failed summary when a check fails", () => {
    const text = formatAudioReport({
      checks: [
        { detail: "too loud", fix: "lower it", name: "headroom", status: "fail" },
        { detail: "quiet", name: "dc", status: "warn" },
      ],
      clips: [],
      pass: false,
    });
    expect(text).toContain("fix: lower it");
    expect(text).toContain("1 of 2 checks failed");
  });
});

describe("spectrogram", () => {
  it("should write a real PNG a viewer can open", () => {
    const analysis = analyseSamples(noise(1), RATE);
    const png = spectrogramPng(analysis.columns);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR immediately follows the signature and carries the dimensions.
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    const width =
      ((png[16] ?? 0) << 24) | ((png[17] ?? 0) << 16) | ((png[18] ?? 0) << 8) | (png[19] ?? 0);
    expect(width).toBeGreaterThan(0);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  });

  it("should refuse to invent a picture from nothing", () => {
    expect(() => spectrogramPng([])).toThrow(/no spectrum/iu);
    expect(() => spectrogramPng([new Float64Array()])).toThrow(/no spectrum/iu);
  });

  it("should treat missing bins in a shorter column as zero", () => {
    const png = spectrogramPng([new Float64Array([1, 0]), new Float64Array([0])]);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
  });
});

describe("band definitions", () => {
  it("should cover the spectrum without a gap or an overlap", () => {
    const edges = Object.values(AUDIO_BANDS);
    for (let index = 1; index < edges.length; index += 1) {
      expect(edges[index]?.[0]).toBe(edges[index - 1]?.[1]);
    }
    expect(edges[0]?.[0]).toBe(0);
  });
});

describe("ffmpeg WAV parsing", () => {
  function stream(options: { data?: Buffer; dataSize?: number; fmt?: Buffer; extra?: Buffer } = {}): Buffer {
    const fmt = options.fmt ?? (() => {
      const value = Buffer.alloc(18);
      value.writeUInt16LE(3, 0);
      value.writeUInt16LE(1, 2);
      value.writeUInt32LE(RATE, 4);
      value.writeUInt16LE(32, 14);
      return value;
    })();
    const data = options.data ?? Buffer.alloc(4);
    const chunk = (id: string, bytes: Buffer, declared = bytes.length): Buffer => {
      const result = Buffer.alloc(8 + bytes.length + (bytes.length % 2));
      result.write(id, 0, "ascii");
      result.writeUInt32LE(declared, 4);
      bytes.copy(result, 8);
      return result;
    };
    const chunks = [
      chunk("fmt ", fmt),
      ...(options.extra === undefined ? [] : [chunk("LIST", options.extra)]),
      chunk("data", data, options.dataSize),
    ];
    return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), ...chunks]);
  }

  it("reads a 32-bit float stream with metadata padding and placeholder sizes", () => {
    const data = Buffer.alloc(8);
    data.writeFloatLE(0.25, 0);
    data.writeFloatLE(-0.5, 4);
    const metadata = Buffer.from([0x49, 0x4e, 0x46]);
    const parsed = parseWav(stream({ data, dataSize: 0, extra: metadata }));
    expect(parsed).toEqual({ channels: [new Float64Array([0.25, -0.5])], sampleRate: RATE });
    expect(parseWav(stream({ data, dataSize: 0xffffffff, extra: metadata })).channels[0]).toEqual(
      new Float64Array([0.25, -0.5]),
    );
  });

  it("rejects invalid headers, ordering, widths, and empty data", () => {
    expect(() => parseWav(Buffer.alloc(11))).toThrow(/RIFF\/WAVE/u);
    expect(() => parseWav(Buffer.from("RIFFxxxxxxxxWAVE"))).toThrow(/RIFF\/WAVE/u);
    const dataBeforeFormat = Buffer.concat([
      Buffer.from("RIFF\0\0\0\0WAVE", "binary"),
      Buffer.from("data\x04\0\0\0\0\0\0\0", "binary"),
      stream().subarray(12, 36),
    ]);
    expect(() => parseWav(dataBeforeFormat)).toThrow(/data before its format/u);
    const wrongBits = Buffer.alloc(16);
    wrongBits.writeUInt16LE(1, 0);
    wrongBits.writeUInt16LE(1, 2);
    wrongBits.writeUInt32LE(RATE, 4);
    wrongBits.writeUInt16LE(16, 14);
    expect(() => parseWav(stream({ fmt: wrongBits }))).toThrow(/expected 32-bit/u);
    expect(() => parseWav(stream({ data: Buffer.alloc(0) }))).toThrow(/no samples/u);
    expect(() => parseWav(stream().subarray(0, 36))).toThrow(/no data chunk/u);
  });
});
