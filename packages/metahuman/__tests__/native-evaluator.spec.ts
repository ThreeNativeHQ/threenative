import { describe, expect, it } from "vitest";

import type { INativeMetaHumanHost } from "../src/native/host.js";
import { nativeMetaHumanHost } from "../src/native/host.js";
import { NativeRigEvaluator } from "../src/native/native-evaluator.js";
import type { RigEvaluatorKind } from "../src/wasm-evaluator.js";

/**
 * A stand-in for the C++ resident.
 *
 * It records every crossing so the assertions are about the adapter's own behaviour — arity,
 * widths, finiteness, copies, handle lifetime — and not about a rig. The rig's numbers are
 * proven by the browser WASM lane and by the native contract executable
 * (`threenative-metahuman-bindings-test`); a fake here must never be mistaken for one of them.
 */
interface ICall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** The ABI kind selectors, in the order `cpp/tn_riglogic.h` declares them. */
const KIND_ORDER: readonly RigEvaluatorKind[] = [
  "gui",
  "raw",
  "joint",
  "blendShape",
  "animatedMap",
  "lod",
];

const NAMES: Readonly<Record<Exclude<RigEvaluatorKind, "lod">, readonly string[]>> = {
  gui: ["jawOpen", "smile"],
  raw: ["raw_jawOpen", "raw_smile", "raw_brow"],
  joint: ["face_root", "jaw", "brow_center", "tongue"],
  blendShape: ["syn_jawOpen", "syn_smile_L", "syn_smile_R", "syn_browRaise", "syn_neutral"],
  animatedMap: ["map_smile", "map_brow", "map_jaw", "map_cheek", "map_eye", "map_wrinkle"],
};

const COUNTS: readonly number[] = KIND_ORDER.map((kind) =>
  kind === "lod" ? 2 : NAMES[kind].length,
);

function fakeHost() {
  const calls: ICall[] = [];
  let nextId = 1;
  const live = new Set<number>();
  let lastError = "";
  const record = (name: string, ...args: unknown[]) => {
    calls.push({ args, name });
  };
  const handle = (id: number) => {
    if (!live.has(id)) {
      lastError = "stale handle";
      throw new Error(`TN_NATIVE_METAHUMAN_ABI: stale handle: ${id}`);
    }
  };
  const kindName = (kind: number) => KIND_ORDER[kind] as RigEvaluatorKind;
  const host: INativeMetaHumanHost = {
    blendShapeOutputs: (id) => {
      handle(id);
      record("blendShapeOutputs", id);
      return Float32Array.from({ length: COUNTS[3] as number }, (_, index) => index / 10);
    },
    count: (id, kind) => {
      handle(id);
      record("count", id, kind);
      return COUNTS[kind] as number;
    },
    create: (dna) => {
      record("create", dna.byteLength);
      const id = nextId++;
      live.add(id);
      return id;
    },
    destroy: (id) => {
      record("destroy", id);
      live.delete(id);
    },
    evaluate: (id, useGui) => {
      handle(id);
      record("evaluate", id, useGui);
    },
    animatedMapOutputs: (id) => {
      handle(id);
      record("animatedMapOutputs", id);
      return Float32Array.from({ length: COUNTS[4] as number }, (_, index) => index / 4);
    },
    jointOutputs: (id) => {
      handle(id);
      record("jointOutputs", id);
      return Float32Array.from({ length: (COUNTS[2] as number) * 10 }, (_, index) => index);
    },
    lastError: () => lastError,
    name: (id, kind, index) => {
      handle(id);
      record("name", id, kind, index);
      const name = NAMES[kindName(kind) as Exclude<RigEvaluatorKind, "lod">][index];
      return name ?? "";
    },
    neutralJoints: (id) => {
      handle(id);
      record("neutralJoints", id);
      return Float32Array.from({ length: (COUNTS[2] as number) * 10 }, () => 0);
    },
    setGui: (id, values) => {
      handle(id);
      record("setGui", id, values);
    },
    setLod: (id, lod) => {
      handle(id);
      record("setLod", id, lod);
      if (lod < 0 || lod >= (COUNTS[5] as number)) throw new Error("lod out of range");
    },
    setRaw: (id, values) => {
      handle(id);
      record("setRaw", id, values);
    },
    version: "tn_metahuman/1 OpenRigLogic 7b9e7a88898f51f29aa308acb4877276f27e1507",
  };
  return { calls, host };
}

const DNA = new Uint8Array([1, 2, 3, 4]);

describe("NativeRigEvaluator over the installed C++ resident", () => {
  it("reports the backend and the pinned OpenRigLogic revision it was built from", () => {
    const { host } = fakeHost();
    expect(NativeRigEvaluator.create(DNA, host).backend()).toBe(host.version);
  });

  it("reads counts and names through the ABI kind selectors", () => {
    const { calls, host } = fakeHost();
    const rig = NativeRigEvaluator.create(DNA, host);
    expect(rig.counts()).toEqual({
      animatedMaps: 6,
      blendShapes: 5,
      gui: 2,
      joints: 4,
      lodCount: 2,
      raw: 3,
    });
    expect(rig.names("joint")).toEqual([...NAMES.joint]);
    expect(rig.names("blendShape")).toEqual([...NAMES.blendShape]);
    // 0..5 in the order of `cpp/tn_riglogic.h`, so a drifting selector is visible here. The
    // two trailing entries are the per-kind count each `names()` reads to know when to stop.
    expect(calls.filter((call) => call.name === "count").map((call) => call.args[1])).toEqual([
      0, 1, 2, 3, 4, 5, 2, 3,
    ]);
    expect(calls.filter((call) => call.name === "name").map((call) => call.args[1])).toEqual([
      2, 2, 2, 2, 3, 3, 3, 3, 3,
    ]);
  });

  it("drives GUI and raw controls the way the interface names them", () => {
    const { calls, host } = fakeHost();
    const rig = NativeRigEvaluator.create(DNA, host);
    const gui = Float32Array.from([0.25, 0.5]);
    rig.setLod(1);
    rig.setGuiControls(gui);
    rig.evaluate(true);
    rig.setRawControls(Float32Array.from([0.1, 0.2, 0.3]));
    rig.evaluate(false);
    expect(calls.map((call) => call.name)).toEqual([
      "create",
      "count",
      "setLod",
      "count",
      "setGui",
      "evaluate",
      "count",
      "setRaw",
      "evaluate",
    ]);
    expect(calls.find((call) => call.name === "setLod")?.args).toEqual([1, 1]);
    expect(calls.find((call) => call.name === "setGui")?.args[1]).toBe(gui);
    expect(calls.find((call) => call.name === "evaluate")?.args).toEqual([1, true]);
    expect(calls.filter((call) => call.name === "evaluate").at(-1)?.args).toEqual([1, false]);
  });

  it("refuses a wrong-width or non-finite control buffer before it crosses", () => {
    const { calls, host } = fakeHost();
    const rig = NativeRigEvaluator.create(DNA, host);
    expect(() => rig.setGuiControls(new Float32Array(3))).toThrowError(/TN_MH_LENGTH/u);
    expect(() => rig.setGuiControls(new Float32Array(1))).toThrowError(/TN_MH_LENGTH/u);
    const nonFinite = Float32Array.from([Number.NaN, 0]);
    expect(() => rig.setGuiControls(nonFinite)).toThrowError(/TN_MH_NON_FINITE/u);
    const infinite = Float32Array.from([0, Number.POSITIVE_INFINITY, 0]);
    expect(() => rig.setRawControls(infinite)).toThrowError(/TN_MH_NON_FINITE/u);
    expect(() => rig.setLod(2)).toThrowError(/TN_MH_INDEX_RANGE/u);
    expect(() => rig.setLod(-1)).toThrowError(/TN_MH_INDEX_RANGE/u);
    // Not one of the refusals above reached the host.
    expect(calls.filter((call) => call.name.startsWith("set"))).toEqual([]);
  });

  it("returns one output array per read, never a shared buffer", () => {
    const { host } = fakeHost();
    const rig = NativeRigEvaluator.create(DNA, host);
    const first = rig.jointOutputs();
    const second = rig.jointOutputs();
    expect(first).not.toBe(second);
    expect([...first]).toEqual([...second]);
    first[0] = 999;
    expect(rig.jointOutputs()[0]).toBe(0);
    expect(rig.blendShapeOutputs().length).toBe(5);
    expect(rig.animatedMapOutputs().length).toBe(6);
    expect(rig.neutralJoints().length).toBe(40);
  });

  it("destroys the handle once and fails closed afterwards", () => {
    const { calls, host } = fakeHost();
    const rig = NativeRigEvaluator.create(DNA, host);
    rig.dispose();
    rig.dispose();
    expect(calls.filter((call) => call.name === "destroy")).toHaveLength(1);
    expect(() => rig.counts()).toThrowError(/TN_MH_DISPOSED/u);
    expect(() => rig.jointOutputs()).toThrowError(/TN_MH_DISPOSED/u);
    expect(() => rig.dispose()).not.toThrow();
  });

  it("refuses an empty DNA buffer", () => {
    const { host } = fakeHost();
    expect(() => NativeRigEvaluator.create(new Uint8Array(0), host)).toThrowError(/TN_MH_LENGTH/u);
    expect(() => NativeRigEvaluator.create(new ArrayBuffer(0), host)).toThrowError(/TN_MH_LENGTH/u);
  });
});

describe("nativeMetaHumanHost", () => {
  it("fails closed with TN_NATIVE_METAHUMAN_MISSING when the resident is absent", () => {
    expect(() => nativeMetaHumanHost()).toThrowError(/TN_NATIVE_METAHUMAN_MISSING/u);
  });

  it("refuses a resident that is not a metahuman host", () => {
    const globals = globalThis as { __THREENATIVE_NATIVE__?: unknown };
    globals.__THREENATIVE_NATIVE__ = { metahuman: { version: "tn_metahuman/1" } };
    try {
      expect(() => nativeMetaHumanHost()).toThrowError(/TN_NATIVE_METAHUMAN_MISSING/u);
    } finally {
      globals.__THREENATIVE_NATIVE__ = undefined;
    }
  });

  it("returns the installed resident when it is complete", () => {
    const { host } = fakeHost();
    const globals = globalThis as { __THREENATIVE_NATIVE__?: unknown };
    globals.__THREENATIVE_NATIVE__ = { metahuman: host };
    try {
      expect(nativeMetaHumanHost()).toBe(host);
    } finally {
      globals.__THREENATIVE_NATIVE__ = undefined;
    }
  });
});
