import { afterEach, describe, expect, it, vi } from "vitest";

import { RigEvaluator } from "../src/index.js";
import type { INativeMetaHumanHost } from "../src/native/host.js";
import { NativeRigEvaluator } from "../src/native/native-evaluator.js";

/**
 * The default entry picks its backend at runtime: a native host that installed the MetaHuman
 * resident gets the C++ evaluator, and the WASM payload is never fetched. A stand-in resident,
 * not a rig — the numbers are proven by the WASM and native contract lanes.
 */
function fakeHost(): { host: INativeMetaHumanHost; created: Uint8Array[] } {
  const created: Uint8Array[] = [];
  let live = 0;
  const empty = (): Float32Array => new Float32Array(0);
  const host: INativeMetaHumanHost = {
    version: "tn_metahuman/1 OpenRigLogic 7b9e7a88898f51f29aa308acb4877276f27e1507",
    create: (dna) => {
      created.push(new Uint8Array(dna));
      live += 1;
      return live;
    },
    count: () => 0,
    name: () => "",
    setLod: () => undefined,
    setGui: () => undefined,
    setRaw: () => undefined,
    evaluate: () => undefined,
    jointOutputs: empty,
    blendShapeOutputs: empty,
    animatedMapOutputs: empty,
    neutralJoints: empty,
    destroy: () => {
      live -= 1;
    },
    lastError: () => "",
    liveCount: () => live,
  };
  return { host, created };
}

const globals = globalThis as { __THREENATIVE_NATIVE__?: unknown };

afterEach(() => {
  globals.__THREENATIVE_NATIVE__ = undefined;
  vi.restoreAllMocks();
});

describe("default entry backend selection", () => {
  it("should hand a native host's resident the rig and never fetch the WASM payload", async () => {
    const { host, created } = fakeHost();
    globals.__THREENATIVE_NATIVE__ = { metahuman: host };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(RigEvaluator.backend()).toBe("native");
    const rig = await RigEvaluator.create(new Uint8Array([1, 2, 3]));
    expect(rig).toBeInstanceOf(NativeRigEvaluator);
    expect(created).toEqual([new Uint8Array([1, 2, 3])]);
    expect(RigEvaluator.liveHandleCount()).toBe(1);
    await expect(RigEvaluator.upstreamCommit()).resolves.toBe(host.version);
    rig.dispose();
    expect(RigEvaluator.liveHandleCount()).toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("should select the WASM build where no resident is installed", () => {
    expect(RigEvaluator.backend()).toBe("wasm");
    // A resident missing its entry points is not a resident: no half-installed host is used.
    globals.__THREENATIVE_NATIVE__ = { metahuman: { version: "tn_metahuman/1" } };
    expect(RigEvaluator.backend()).toBe("wasm");
  });
});
