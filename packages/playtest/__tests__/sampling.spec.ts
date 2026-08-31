import { describe, expect, test } from "vitest";
import type { Page } from "playwright";

import type { IPlaytestObservationSnapshot, IPlaytestScenario } from "../src/index.js";
import {
  entityRotation,
  isRuntimeReadout,
  movementDuration,
  movementRate,
  normalizedRuntimeDiagnostics,
  observedMovementEntities,
  observedMovementSample,
  pairObservations,
  positiveFiniteDelta,
  readCaptureProvenance,
  resourceObservations,
  sampleHud,
} from "../src/runner/sampling.js";
import type { IMovementSampleInterval } from "../src/runner/shared.js";

function snapshot(
  position: [number, number, number] | undefined,
  clock: IPlaytestObservationSnapshot["clock"] = { mode: "fixed-step", tick: 0 },
  extra: Partial<IPlaytestObservationSnapshot> = {},
): IPlaytestObservationSnapshot {
  return {
    clock,
    entities: [{ id: "player", transform: position === undefined ? undefined : { position, rotation: [0, 0, 0, 1] }, visible: true }],
    ...extra,
  };
}

function interval(
  before: IPlaytestObservationSnapshot,
  after: IPlaytestObservationSnapshot,
  inputDriven: boolean,
): IMovementSampleInterval {
  return { after, before, inputDriven };
}

function installGlobal(name: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  return () => {
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name];
    else Object.defineProperty(globalThis, name, descriptor);
  };
}

describe("playtest sampling", () => {
  test("samples HUD values by id and selector without dropping absent nodes", async () => {
    const score = { getAttribute: () => "7", textContent: " Score " };
    const button = { getAttribute: () => "not numeric", textContent: " Start " };
    const restore = installGlobal("document", {
      getElementById: (id: string) => id === "score" ? score : null,
      querySelector: (selector: string) => selector === ".start" ? button : null,
    });
    try {
      const page = {
        evaluate: async (callback: (assertions: unknown) => unknown, assertions: unknown) => callback(assertions),
      } as unknown as Page;
      await expect(sampleHud(page, [])).resolves.toEqual({});
      await expect(sampleHud(page, [{ id: "score" }, { id: "start", path: ".start" }, { id: "missing" }])).resolves.toEqual({
        score: 7,
        start: { ".start": "not numeric" },
      });
    } finally {
      restore();
    }
  });

  test("samples a HUD node only when its rendered box is on top of the page", async () => {
    const error = {
      contains: () => false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ bottom: 720, height: 720, left: 0, right: 1280, top: 0, width: 1280 }),
      parentElement: null,
      textContent: " TN_TEST: boot failed ",
    };
    const restore = installGlobal("document", {
      elementFromPoint: () => error,
      getElementById: () => error,
    });
    const restoreWindow = installGlobal("window", {
      getComputedStyle: () => ({ display: "block", opacity: "1", visibility: "visible" }),
      innerHeight: 720,
      innerWidth: 1280,
    });
    try {
      const page = {
        evaluate: async (callback: (assertions: unknown) => unknown, assertions: unknown) => callback(assertions),
      } as unknown as Page;
      await expect(sampleHud(page, [{ id: "error", textIncludes: "TN_TEST", visible: true }])).resolves.toEqual({
        error: { text: "TN_TEST: boot failed", visible: true },
      });
    } finally {
      restoreWindow();
      restore();
    }
  });

  test("rejects a HUD node with zero computed opacity even when its box is topmost", async () => {
    const error = {
      contains: () => false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ bottom: 80, height: 80, left: 0, right: 200, top: 0, width: 200 }),
      textContent: " TN_TEST: transparent ",
    };
    const restore = installGlobal("document", {
      elementFromPoint: () => error,
      getElementById: () => error,
    });
    const restoreWindow = installGlobal("window", {
      getComputedStyle: () => ({ display: "block", opacity: "0", visibility: "visible" }),
      innerHeight: 720,
      innerWidth: 1280,
    });
    try {
      const page = {
        evaluate: async (callback: (assertions: unknown) => unknown, assertions: unknown) => callback(assertions),
      } as unknown as Page;
      await expect(sampleHud(page, [{ id: "error", visible: true }])).resolves.toEqual({
        error: { text: "TN_TEST: transparent", visible: false },
      });
    } finally {
      restoreWindow();
      restore();
    }
  });

  test("rejects a HUD node whose rendered ancestry is display none", async () => {
    const parent = { parentElement: null };
    const error = {
      contains: () => false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ bottom: 80, height: 80, left: 0, right: 200, top: 0, width: 200 }),
      parentElement: parent,
      textContent: " TN_TEST: hidden ",
    };
    const restore = installGlobal("document", {
      elementFromPoint: () => error,
      getElementById: () => error,
    });
    const restoreWindow = installGlobal("window", {
      getComputedStyle: (element: unknown) => element === parent
        ? { display: "none", opacity: "1", visibility: "visible" }
        : { display: "block", opacity: "1", visibility: "visible" },
      innerHeight: 720,
      innerWidth: 1280,
    });
    try {
      const page = {
        evaluate: async (callback: (assertions: unknown) => unknown, assertions: unknown) => callback(assertions),
      } as unknown as Page;
      await expect(sampleHud(page, [{ id: "error", visible: true }])).resolves.toEqual({
        error: { text: "TN_TEST: hidden", visible: false },
      });
    } finally {
      restoreWindow();
      restore();
    }
  });

  test("pairs observations and retains only movement with a stationary input-off baseline", () => {
    expect(pairObservations({ score: 1, beforeOnly: true }, { score: 2, afterOnly: true })).toEqual({
      score: { after: 2, before: 1 },
      beforeOnly: { before: true },
      afterOnly: { after: true },
    });

    const stationary = interval(
      snapshot([0, 0, 0], { mode: "fixed-step", tick: 0 }),
      snapshot([0, 0, 0], { mode: "fixed-step", tick: 1 }),
      false,
    );
    const moved = interval(
      snapshot([0, 0, 0], { mode: "fixed-step", tick: 1 }),
      snapshot([2, 0, 0], { mode: "fixed-step", tick: 3 }),
      true,
    );
    expect(observedMovementSample([stationary, moved])).toMatchObject({ distance: 2, entity: "player", contrast: 1 });
    expect(observedMovementSample([moved])).toBeUndefined();
    expect(observedMovementSample([
      interval(snapshot(undefined), snapshot([1, 0, 0]), true),
      stationary,
    ])).toBeUndefined();
  });

  test("filters entity movement and computes rates across clock modes", () => {
    const before = snapshot([0, 0, 0], { mode: "fixed-step", tick: 0 }, {
      entities: [
        { id: "player", transform: { position: [0, 0, 0] }, visible: true },
        { id: "hidden", transform: { position: [0, 0, 0] }, visible: false },
        { id: "missing", visible: true },
      ],
    });
    const after = snapshot([1, 0, 0], { mode: "fixed-step", tick: 2 }, {
      entities: [
        { id: "player", transform: { position: [1, 0, 0] }, visible: true },
        { id: "hidden", transform: { position: [1, 0, 0] }, visible: false },
        { id: "new", transform: { position: [1, 0, 0] }, visible: true },
      ],
    });
    expect(observedMovementEntities(before, after)).toEqual([{ distance: 1, id: "player" }]);
    expect(movementRate(interval(before, after, true), "player")).toBe(0.5);
    expect(movementRate(interval(before, after, true), "new")).toBeUndefined();
    expect(movementDuration(interval(before, after, true))).toBe(2);
    expect(movementDuration(interval(
      snapshot([0, 0, 0], { mode: "render-frame", timeMs: 10 }),
      snapshot([0, 0, 0], { mode: "render-frame", timeMs: 30 }),
      true,
    ))).toBe(20);
    expect(movementDuration(interval(
      snapshot([0, 0, 0], { mode: "wall-clock", timeMs: 10 }),
      snapshot([0, 0, 0], { mode: "wall-clock", timeMs: 30 }),
      true,
    ))).toBe(20);
    expect(movementDuration(interval(
      snapshot([0, 0, 0], { mode: "fixed-step", tick: 0 }),
      snapshot([0, 0, 0], { mode: "render-frame", timeMs: 1 }),
      true,
    ))).toBeUndefined();
    expect(positiveFiniteDelta(undefined, 1)).toBeUndefined();
    expect(positiveFiniteDelta(Number.NaN, 1)).toBeUndefined();
    expect(positiveFiniteDelta(1, 1)).toBeUndefined();
    expect(positiveFiniteDelta(1, 2)).toBe(1);
    expect(entityRotation(after, "ghost")).toBeUndefined();
    expect(entityRotation({ ...after, entities: [{ id: "player", transform: { rotation: [0, 1, 0, 0] } }] }, "player")).toEqual([0, 1, 0, 0]);
  });

  test("pairs resource snapshots and classifies only unambiguous runtime readouts", () => {
    expect(resourceObservations(snapshot(undefined, undefined, { resources: { state: { score: 1 } } }), snapshot(undefined, undefined, { resources: { other: 2 } }))).toEqual({
      state: { after: undefined, before: { score: 1 } },
      other: { after: 2, before: undefined },
    });
    expect(isRuntimeReadout(null)).toBe(false);
    expect(isRuntimeReadout([])).toBe(false);
    expect(isRuntimeReadout({ label: "fps", value: 60 })).toBe(true);
    expect(isRuntimeReadout({ label: "ready", value: false })).toBe(true);
    expect(isRuntimeReadout({ label: "state", value: { name: "run" } })).toBe(false);
    expect(isRuntimeReadout({ label: "error", value: 1, severity: "error" })).toBe(false);
    expect(isRuntimeReadout({ label: "error", value: 1, error: "bad" })).toBe(false);
    expect(isRuntimeReadout({ label: "error", value: 1, type: "assert" })).toBe(false);
    expect(isRuntimeReadout({ value: 1 })).toBe(false);
  });

  test("normalizes diagnostics and converts entity pixel bounds into scene evidence", () => {
    const scenario = { viewport: { height: 100, width: 200 } } as IPlaytestScenario;
    const normalized = normalizedRuntimeDiagnostics(
      {
        ...snapshot([0, 0, 0], undefined, {
          diagnostics: [{ label: "fps", value: 60 }, { message: "bad" }],
          entities: [
            { bounds: { height: 20, width: 30, x: 5, y: 10 }, id: "player", visible: true },
            { id: "empty", visible: false },
          ],
        }),
      },
      scenario,
      [
        { source: "browser-console", text: "ignored", type: "error" },
        { source: "page-error", text: "page failed", type: "error" },
        { source: "unhandled-rejection", text: "rejected", type: "unhandledrejection" },
      ],
    );
    expect(normalized.runtimeReadouts).toEqual([{ label: "fps", value: 60 }]);
    expect(normalized.recentRuntimeErrors).toEqual([
      { message: "bad" },
      { source: "page-error", text: "page failed", type: "error" },
    ]);
    expect(normalized.scene.renderedEntities).toEqual([
      { id: "player", projectedBounds: { max: [-0.65, 0.8], min: [-0.95, 0.4] }, visible: true },
      { id: "empty", projectedBounds: undefined, visible: false },
    ]);
  });

  test("reads WebGPU and WebGL capture provenance, including missing metadata failures", async () => {
    const canvas = {
      getAttribute: (name: string) => name === "data-engine" ? "webgpu" : null,
      getContext: () => null,
    };
    const restoreDocument = installGlobal("document", { querySelector: () => canvas });
    const restoreNavigator = installGlobal("navigator", {
      gpu: {
        requestAdapter: async () => ({
          features: new Set(["texture-compression-bc"]),
          info: { architecture: "arch", description: "GPU", device: "dev", vendor: "vendor" },
          limits: { maxBindGroups: 4, maxStorageBufferBindingSize: Number.NaN, maxTextureDimension2D: 8192 },
        }),
      },
    });
    try {
      const page = { evaluate: async (callback: () => unknown) => callback() } as unknown as Page;
      const provenance = await readCaptureProvenance(page, { browserArgs: ["--headless"] } as never, {
        target: "web",
        viewport: { height: 720, width: 1280 },
      } as never);
      expect(provenance).toMatchObject({
        adapter: {
          architecture: "arch",
          "limit.maxBindGroups": "4",
          "limit.maxTextureDimension2D": "8192",
          vendor: "vendor",
        },
        rendererKind: "webgpu",
        target: "web",
      });
      expect(provenance.browserArgs).toEqual(["--headless"]);
    } finally {
      restoreNavigator();
      restoreDocument();
    }

    const restoreEmptyDocument = installGlobal("document", { querySelector: () => null });
    const restoreNoNavigator = installGlobal("navigator", {});
    try {
      const page = { evaluate: async (callback: () => unknown) => callback() } as unknown as Page;
      await expect(readCaptureProvenance(page, {} as never, { target: "web", viewport: { height: 100, width: 200 } } as never)).rejects.toMatchObject({
        diagnostic: { code: "TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING" },
      });
    } finally {
      restoreNoNavigator();
      restoreEmptyDocument();
    }
  });

  test("uses legacy WebGPU adapter info and WebGL debug renderer metadata", async () => {
    const restoreDocument = installGlobal("document", {
      querySelector: () => ({
        getAttribute: () => "",
        getContext: (kind: string) => kind === "webgpu" ? null : {
          RENDERER: 1,
          VENDOR: 2,
          getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 3, UNMASKED_VENDOR_WEBGL: 4 }),
          getParameter: (key: number) => key === 3 ? "Renderer" : key === 4 ? "Vendor" : "fallback",
        },
      }),
    });
    const restoreNavigator = installGlobal("navigator", {
      gpu: {
        requestAdapter: async () => ({
          info: {},
          requestAdapterInfo: async () => ({ description: "legacy" }),
        }),
      },
    });
    try {
      const page = { evaluate: async (callback: () => unknown) => callback() } as unknown as Page;
      const provenance = await readCaptureProvenance(page, {} as never, { target: "web", viewport: { height: 100, width: 200 } } as never);
      expect(provenance).toMatchObject({ adapter: { renderer: "Renderer", vendor: "Vendor" }, rendererKind: "webgl" });
    } finally {
      restoreNavigator();
      restoreDocument();
    }
  });
});
