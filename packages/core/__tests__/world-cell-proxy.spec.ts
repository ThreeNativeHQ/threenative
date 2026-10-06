import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { CellProxySelection } from "../src/world-cell-proxy.js";

const camera = new PerspectiveCamera(60, 1, 0.1, 2000);
const proxy = { glb: "proxy.glb", error: 1, triangles: 20, materialGroups: 2 };
function input(depth = 400) {
  return {
    sourceReady: true,
    proxyReady: true,
    sourceCompatible: true,
    sourceTriangles: 100,
    replaceableSourceDraws: 2,
    views: [{ camera, depth, viewportHeight: 1080, degenerate: false }] as const,
  };
}

describe("cell proxy selection within the existing admission owner", () => {
  it("retains detail until the proxy is ready, and the last proxy until returning detail is ready", () => {
    const state = new CellProxySelection(proxy);
    expect(state.select({ ...input(), proxyReady: false })).toBe("detail");
    expect(state.select(input())).toBe("proxy");
    expect(state.select({ ...input(5), sourceReady: false })).toBe("proxy");
    expect(state.select(input(5))).toBe("detail");
    expect(state.select({ ...input(), sourceReady: false, proxyReady: false })).toBe("pending");
  });
  it("uses the existing projected-error hysteresis and respects full-quality views", () => {
    const state = new CellProxySelection(proxy);
    expect(state.select(input(260))).toBe("detail");
    expect(state.select(input(300))).toBe("proxy");
    expect(state.select(input(260))).toBe("proxy");
    expect(state.select(input(220))).toBe("detail");
    expect(
      state.select({
        ...input(),
        views: [
          {
            ...input().views[0],
            camera,
            depth: 400,
            viewportHeight: 1080,
            degenerate: false,
            finest: true,
          },
        ],
      }),
    ).toBe("detail");
    state.reset();
    expect(state.select(input(260))).toBe("detail");
  });
  it("rejects a proxy heavier than the active far LOD or adding draws to retained shared batches", () => {
    const state = new CellProxySelection(proxy);
    expect(state.select({ ...input(), sourceTriangles: 10 })).toBe("detail");
    expect(state.select({ ...input(), replaceableSourceDraws: 0 })).toBe("detail");
    expect(state.select({ ...input(), sourceCompatible: false })).toBe("detail");
    expect(state.select({ ...input(), sourceCompatible: false, sourceReady: false })).toBe(
      "pending",
    );
  });
  it("does not activate a fresh proxy while full-quality detail is pending", () => {
    const state = new CellProxySelection(proxy);
    expect(state.select({ ...input(), sourceReady: false, views: [] })).toBe("pending");
    expect(state.select({ ...input(5), sourceReady: false })).toBe("pending");
    expect(state.select({ ...input(), sourceReady: false, replaceableSourceDraws: 0 })).toBe(
      "pending",
    );
    expect(
      state.select({
        ...input(),
        sourceReady: false,
        views: [{ ...input().views[0], finest: true }],
      }),
    ).toBe("pending");
    expect(state.select({ ...input(), sourceReady: false })).toBe("proxy");
  });
  it("fails closed on missing views and invalid costs", () => {
    const state = new CellProxySelection(proxy);
    expect(state.select({ ...input(), views: [] })).toBe("detail");
    expect(() => state.select({ ...input(), sourceTriangles: Number.NaN })).toThrow();
    expect(() => new CellProxySelection({ ...proxy, error: -1 })).toThrow();
  });
});
