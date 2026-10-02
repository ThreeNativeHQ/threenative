import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlaytestScenario } from "../../packages/playtest/dist/index.js";
import { fogCaptureIsValid, fogCaptureScenario } from "../verify-volumetric-fog.js";

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
      const file = path.join(root, "fog.playtest.json");
      await writeFile(file, JSON.stringify(fogCaptureScenario("fog", "KeyF")));
      const scenario = await loadPlaytestScenario(root, file);
      expect(scenario.assert?.visual).toHaveLength(1);
      expect(scenario.artifacts?.screenshots).toBe("after");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("loads the committed repeated-lifecycle scenario", async () => {
    const scenario = await loadPlaytestScenario(
      process.cwd(),
      "examples/abyss-framework/playtests/vq-volumetric-fog.playtest.json",
    );
    expect(scenario.steps).toHaveLength(8);
  });
});

it("uses an inline favicon instead of the confirmed missing /favicon.ico", async () => {
  const html = await readFile("examples/abyss-framework/vq-fog/index.html", "utf8");
  expect(html).toMatch(/<link\s+rel="icon"\s+href="data:,"\s*\/?\s*>/);
});
