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
