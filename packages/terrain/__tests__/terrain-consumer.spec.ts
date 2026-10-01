import { createHash } from "node:crypto";
import {
  Mask,
  Terrain,
  bakeMesh,
  bakeTerrain,
  decodeRAW16,
  encodeGLB,
  encodeRAW16,
  makeExport,
} from "@threenative/terrain";
import { toGeometry } from "@threenative/terrain/three";
import { BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

describe("public terrain consumer", () => {
  it("evaluates without DOM globals and replaces stable IDs deterministically", () => {
    expect(typeof document).toBe("undefined");
    const terrain = new Terrain({ size: 64, resolution: 33, seed: 123 })
      .noise({ id: "hills", amplitude: 12, scale: 30 })
      .flatten({ id: "pad", height: 3, mask: Mask.circle([0, 0], 8) });
    const first = terrain.evaluate();
    expect(first.height).toEqual(Terrain.fromJSON(terrain.toJSON()).evaluate().height);
    terrain.noise({ id: "hills", amplitude: 20, scale: 30 });
    expect(terrain.layers.map((layer) => layer.id)).toEqual(["hills", "pad"]);
    expect(terrain.evaluate().height).not.toEqual(first.height);
    first.height.fill(999);
    expect(terrain.evaluate().height.some((height) => height === 999)).toBe(false);
  });

  it("preserves the supplied noise and erosion output exactly", () => {
    const state = new Terrain({ size: 64, resolution: 33, seed: 123 })
      .noise({ id: "hills", amplitude: 12, scale: 30, warp: 7 })
      .erode({ id: "erode", method: "hydraulic", droplets: 90, maxSteps: 15 })
      .erode({ id: "talus", method: "thermal", iterations: 3, talus: 32 })
      .evaluate();
    // Generated from the supplied source, not from this port.
    expect(createHash("sha256").update(state.height).digest("hex")).toBe(
      "5c87602a09f53f566bed9326dc1fc5f51901e883ef0ef0d6519bf498d7587c65",
    );
  });

  it("rolls back a failed multi-command edit and invalid configuration", () => {
    const terrain = new Terrain({ resolution: 17 }).noise({ id: "base" });
    const before = terrain.toJSON();
    expect(() =>
      terrain.applyPatch([
        { op: "update", id: "base", patch: { params: { amplitude: 4 } } },
        { op: "update", id: "missing", patch: { enabled: false } },
      ]),
    ).toThrow("Unknown layer");
    expect(terrain.toJSON()).toEqual(before);
    expect(() => terrain.setConfig({ size: Number.NaN })).toThrow();
    expect(terrain.toJSON()).toEqual(before);
    terrain.update("base", { mask: Mask.circle([0, 0], 8) });
    terrain.update("base", { mask: null });
    expect(terrain.layer("base").mask).toBeUndefined();
    terrain.update("base", { params: { amplitude: 4 } });
    expect(terrain.evaluate().height.every(Number.isFinite)).toBe(true);
  });

  it("supports shared brush centres and matches caller-owned geometry/collision", () => {
    const terrain = new Terrain({ size: 16, resolution: 17 }).sculpt({
      at: [0, 0],
      radius: 4,
      strength: 5,
    });
    const state = terrain.evaluate();
    expect(state.height[8 * 17 + 8]).toBe(5);
    const mesh = bakeMesh(state);
    const geometry = toGeometry(mesh);
    expect(geometry).toBeInstanceOf(BufferGeometry);
    expect(geometry.getAttribute("color")).toBeUndefined();
    expect(geometry.getAttribute("position").count).toBe(17 * 17);
    expect(geometry.index?.count).toBe(16 * 16 * 6);
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
    const material = new MeshBasicMaterial({ color: "magenta" });
    const object = new Mesh(geometry, material);
    object.updateMatrixWorld(true);
    const hit = new Raycaster(new Vector3(0, 100, 0), new Vector3(0, -1, 0)).intersectObject(
      object,
    )[0];
    expect(hit?.point.y).toBeCloseTo(5, 5);
    expect(hit?.face?.normal.y).toBeGreaterThan(0);
    expect(bakeTerrain(state).collision.heights).toEqual(state.height);
    let disposed = false;
    geometry.addEventListener("dispose", () => {
      disposed = true;
    });
    expect(disposed).toBe(false);
    geometry.dispose();
    expect(disposed).toBe(true);
    expect(state.height[8 * 17 + 8]).toBe(5);
    material.dispose();
  });

  it("accepts explicit surface colours and rejects malformed palettes", () => {
    const state = new Terrain({ resolution: 17 }).evaluate();
    const palette = Array.from({ length: 8 }, () => [0.25, 0.5, 0.75] as const);
    const mesh = bakeMesh(state, { palette });
    expect(mesh.colors?.length).toBe(mesh.positions.length);
    expect(toGeometry(mesh).getAttribute("color").count).toBe(mesh.positions.length / 3);
    expect(() => bakeMesh(state, { palette: [] })).toThrow();
  });

  it("round-trips numerical exports and labels the legacy terrain-only GLB", async () => {
    const terrain = new Terrain({ resolution: 17 }).sculpt({ at: [0, 0], radius: 50, strength: 2 });
    const state = terrain.evaluate();
    const bytes = encodeRAW16(state.height, { min: 0, max: 3 });
    const decoded = decodeRAW16(bytes, { width: 17, height: 17, min: 0, max: 3 });
    expect(decoded.values[8 * 17 + 8]).toBeCloseTo(2, 4);
    expect(() =>
      decodeRAW16(bytes.subarray(1), { width: 17, height: 17, min: 0, max: 3 }),
    ).toThrow();
    const glb = await makeExport(state, terrain.toJSON(), "glb");
    expect(new DataView(glb.bytes.buffer).getUint32(0, true)).toBe(0x46546c67);
    expect(glb.name).toBe("terrain.glb");
  });
  it("rejects empty and malformed GLB mesh data before encoding", () => {
    const mesh = bakeMesh(new Terrain({ resolution: 17 }).evaluate());
    expect(() => encodeGLB([])).toThrow();
    const wrongArrays = { ...mesh };
    Reflect.set(wrongArrays, "positions", new Float64Array(mesh.positions));
    expect(() => encodeGLB(wrongArrays)).toThrow();
    mesh.positions[0] = Number.NaN;
    expect(() => encodeGLB(mesh)).toThrow();
    expect(() => toGeometry(mesh)).toThrow();
  });
});
