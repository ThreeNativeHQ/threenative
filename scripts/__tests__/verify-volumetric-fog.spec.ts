import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlaytestScenario } from "../../packages/playtest/dist/index.js";
import {
  fogCaptureIsValid,
  fogCaptureScenario,
  fogCaptureScenarios,
  fogLightPixelMetrics,
  fogTextureBaselineMatches,
} from "../verify-volumetric-fog.js";

describe("volumetric fog runtime evidence", () => {
  it("rejects software device loss even when the runner reports a pass", () => {
    const good = {
      pass: true,
      capture: {
        rendererKind: "webgpu",
        adapter: { description: "SwiftShader" },
        viewport: { width: 640, height: 400 },
      },
      diagnostics: [],
    };
    expect(fogCaptureIsValid(good)).toBe(true);
    expect(
      fogCaptureIsValid({
        ...good,
        diagnostics: [{ code: "TN_PLAYTEST_SOFTWARE_DEVICE_LOST", severity: "warning" }],
      }),
    ).toBe(false);
    expect(
      fogCaptureIsValid({ ...good, diagnostics: [{ code: "UNRELATED_ERROR", severity: "error" }] }),
    ).toBe(false);
    expect(fogCaptureIsValid({ ...good, capture: undefined })).toBe(false);
    expect(fogCaptureIsValid({ ...good, capture: { rendererKind: "webgl2" } })).toBe(false);
    expect(fogCaptureIsValid({ ...good, capture: { ...good.capture, adapter: {} } })).toBe(false);
    expect(
      fogCaptureIsValid({
        ...good,
        capture: { ...good.capture, viewport: { width: 1, height: 1 } },
      }),
    ).toBe(false);
    expect(fogCaptureIsValid({ ...good, pass: false })).toBe(false);
  });
  it("loads the generated pixel-bearing scenario with the public validator", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vq07-scenario-"));
    try {
      for (const { mode, scenario: authored } of await fogCaptureScenarios()) {
        const file = path.join(root, `${mode}.playtest.json`);
        await writeFile(file, JSON.stringify(authored));
        const scenario = await loadPlaytestScenario(root, file);
        expect(scenario.assert?.visual).toHaveLength(mode === "blackOff" ? 2 : 1);
        expect(scenario.artifacts?.screenshots).toBe("after");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("loads the committed repeated-lifecycle scenario", async () => {
    const scenario = await loadPlaytestScenario(
      process.cwd(),
      "examples/abyss-framework/playtests/vq-volumetric-fog.playtest.json",
    );
    expect(scenario.steps).toHaveLength(11);
  });
});

it("uses an inline favicon instead of the confirmed missing /favicon.ico", async () => {
  const html = await readFile("examples/abyss-framework/vq-fog/index.html", "utf8");
  expect(html).toMatch(/<link\s+rel="icon"\s+href="data:,"\s*\/?\s*>/);
});

it("requires a black no-fog control without weakening the positive-arm visual guard", () => {
  expect(fogCaptureScenario("blackOff", "KeyN").assert?.visual?.[1]?.region).toMatchObject({
    maxLuminance: 0,
    minDarkPixelRatio: 1,
  });
  expect(
    fogCaptureScenario("scatter", "KeyL").assert?.visual?.[0]?.region?.minNonblankPixelRatio,
  ).toBe(0.05);
});

it("qualifies both lights in a fixed scattering ROI and rejects stray-pixel evidence", () => {
  // Synthetic buffers exercise the verifier only; they are never runtime screenshot evidence.
  const frame = () => ({ width: 640, height: 400, data: Buffer.alloc(640 * 400 * 4) });
  const black = frame();
  const both = frame();
  const sunOff = frame();
  const pointOff = frame();
  for (const image of [black, both, sunOff, pointOff])
    for (let y = 25; y < 135; y += 1)
      for (let x = 515; x < 625; x += 1)
        for (let c = 0; c < 3; c += 1) image.data[(y * 640 + x) * 4 + c] = 128;
  for (let y = 155; y < 245; y += 1)
    for (let x = 260; x < 410; x += 1) {
      const i = (y * 640 + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        both.data[i + c] = 30;
        sunOff.data[i + c] = 20;
        pointOff.data[i + c] = 10;
      }
    }
  expect(fogLightPixelMetrics(black, both, sunOff, pointOff).pass).toBe(true);
  expect(fogLightPixelMetrics(black, both, both, pointOff).pass).toBe(false);
  const stray = { ...black, data: Buffer.from(black.data) };
  stray.data[(180 * 640 + 300) * 4] = 255;
  expect(fogLightPixelMetrics(black, stray, black, black).pass).toBe(false);
  const outside = { ...black, data: Buffer.from(black.data) };
  outside.data[(10 * 640 + 10) * 4] = 255;
  expect(fogLightPixelMetrics(black, outside, black, black).pass).toBe(false);
  both.data[(224 * 640 + 193) * 4] = 1;
  expect(fogLightPixelMetrics(black, both, sunOff, pointOff).pass).toBe(false);
  both.data[(224 * 640 + 193) * 4] = 0;
  both.data[(30 * 640 + 520) * 4] = 127;
  expect(fogLightPixelMetrics(black, both, sunOff, pointOff).pass).toBe(false);
  both.data[(30 * 640 + 520) * 4] = 128;
  black.data[0] = 1;
  expect(fogLightPixelMetrics(black, both, sunOff, pointOff).pass).toBe(false);
  expect(() => fogLightPixelMetrics({ ...black, width: 1 }, both, sunOff, pointOff)).toThrow(/640/);
});

it("runs the committed lifecycle and return-to-off scenarios, with actual release counts", async () => {
  const scenarios = await fogCaptureScenarios();
  const lifecycle = scenarios.find(({ mode }) => mode === "lifecycle")?.scenario;
  const off = scenarios.find(({ mode }) => mode === "lifecycleOff")?.scenario;
  expect(lifecycle?.steps).toHaveLength(11);
  expect(lifecycle?.steps[0]?.press).toEqual(["KeyF"]);
  expect(off?.steps).toHaveLength(14);
  expect(lifecycle?.assert?.components).toEqual(
    expect.arrayContaining([expect.objectContaining({ component: "releasedTargets", equals: 3 })]),
  );
  expect(off?.assert?.components).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ component: "releasedTargets", equals: 4 }),
      expect.objectContaining({ component: "liveTargets", equals: 0 }),
    ]),
  );
});

it("requires observed rendered-frame stability before claiming the texture baseline restored", () => {
  const baseline = { textures: 2, settledRenderFrames: 3, stableTextureFrames: 3 };
  expect(fogTextureBaselineMatches(baseline, baseline)).toBe(true);
  expect(fogTextureBaselineMatches(baseline, { ...baseline, textures: 3 })).toBe(false);
  expect(fogTextureBaselineMatches(baseline, { ...baseline, settledRenderFrames: 0 })).toBe(false);
  expect(fogTextureBaselineMatches(baseline, { ...baseline, stableTextureFrames: 2 })).toBe(false);
  expect(fogTextureBaselineMatches({}, baseline)).toBe(false);
});
it("captures the live target at both sizes without replacing the fog controller", async () => {
  const cases = await fogCaptureScenarios();
  for (const [mode, width, height] of [
    ["resizeSmall", 320, 240],
    ["resizeRestore", 640, 400],
  ] as const) {
    const scenario = cases.find((entry) => entry.mode === mode)?.scenario;
    expect(scenario?.assert?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: "targetWidth", equals: width }),
        expect.objectContaining({ component: "targetHeight", equals: height }),
        expect.objectContaining({ component: "createdTargets", equals: 1 }),
        expect.objectContaining({ component: "releasedTargets", equals: 0 }),
      ]),
    );
  }
});

it("waits for measured render stability instead of treating fixed ticks as rendered frames", async () => {
  for (const { scenario } of await fogCaptureScenarios()) {
    expect(scenario.steps.at(-1)).toMatchObject({
      waitForResource: { id: "state", path: "stableTextureFrames", gte: 3 },
      timeoutMs: 30000,
    });
  }
  const restore = (await fogCaptureScenarios()).find(
    ({ mode }) => mode === "resizeRestore",
  )?.scenario;
  const steps = restore?.steps ?? [];
  const restoreAt = steps.findIndex(
    (step) => Array.isArray(step.press) && step.press.includes("KeyT"),
  );
  expect(steps[restoreAt - 1]?.waitForResource).toMatchObject({
    id: "state",
    path: "stableTextureFrames",
    gte: 3,
  });
});
