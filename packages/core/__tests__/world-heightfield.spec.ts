import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Heightfield } from "../src/world.js";

function terrain(seed: number, x: number, z: number): number {
  const phase = seed * 0.013;
  const warpX = Math.sin(z * 0.021 + phase) * 19;
  const warpZ = Math.cos(x * 0.017 - phase) * 17;
  return (
    Math.sin((x + warpX) * 0.012 + phase) * 18 +
    Math.cos((z + warpZ) * 0.019 - phase) * 9 +
    Math.sin((x + z) * 0.047 + phase * 3) * 2
  );
}

function field(seed: number): Heightfield {
  return Heightfield.fromSampler({
    columns: 17,
    depth: 48,
    origin: { x: 32, z: -16 },
    rows: 13,
    sampleHeight: (x, z) => terrain(seed, x, z),
    width: 64,
  });
}

function hash(values: Float32Array): string {
  return createHash("sha256")
    .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
    .digest("hex");
}

describe("Heightfield", () => {
  it("should produce an identical field for an identical game seed", () => {
    expect(hash(field(1337).heights)).toBe(hash(field(1337).heights));
  });

  it("should produce a materially different field for a different game seed", () => {
    const first = field(1337).heights;
    const second = field(7331).heights;
    let squaredDistance = 0;
    for (let index = 0; index < first.length; index += 1) {
      const difference = (first[index] ?? Number.NaN) - (second[index] ?? Number.NaN);
      squaredDistance += difference * difference;
    }
    expect(Math.sqrt(squaredDistance / first.length)).toBeGreaterThan(1);
  });

  it("should agree between heightAt, rendered vertices, and Rapier collider columns", () => {
    const value = field(1337);
    const geometry = value.toGeometry();
    const positions = geometry.getAttribute("position");
    const collider = value.toColliderHeights();
    expect(collider).not.toBe(value.heights);

    let maximumError = 0;
    for (let row = 0; row < value.rows; row += 1) {
      for (let column = 0; column < value.columns; column += 1) {
        const renderIndex = row * value.columns + column;
        const colliderIndex = column * value.rows + row;
        const worldX = positions.getX(renderIndex) + value.origin.x;
        const worldZ = positions.getZ(renderIndex) + value.origin.z;
        maximumError = Math.max(
          maximumError,
          Math.abs(value.heightAt(worldX, worldZ) - positions.getY(renderIndex)),
          Math.abs((collider[colliderIndex] ?? Number.NaN) - positions.getY(renderIndex)),
        );
      }
    }
    geometry.dispose();

    expect(maximumError).toBeLessThanOrEqual(1e-6);
  });

  it("should reject a heights buffer whose length is not rows times columns", () => {
    expect(
      () =>
        new Heightfield({
          columns: 4,
          depth: 3,
          heights: new Float32Array(11),
          origin: { x: 0, z: 0 },
          rows: 3,
          width: 4,
        }),
    ).toThrow("expected 12 heights, received 11");
  });

  it("should keep render, query, and collider storage isolated from caller mutation", () => {
    const source = new Float32Array([0, 1, 2, 3, 4, 5]);
    const value = new Heightfield({
      columns: 3,
      depth: 1,
      heights: source,
      origin: { x: 0, z: 0 },
      rows: 2,
      width: 2,
    });
    source[0] = 99;
    value.heights[0] = 98;
    value.toColliderHeights()[0] = 97;

    expect(value.heightAt(-1, -0.5)).toBe(0);
    const geometry = value.toGeometry();
    expect(geometry.getAttribute("position").getY(0)).toBe(0);
    geometry.dispose();
    expect(value.toColliderHeights()[0]).toBe(0);
  });

  it("should fail closed outside its resident region", () => {
    const value = field(1337);
    expect(() => value.heightAt(-0.000_001, value.origin.z)).toThrow(/outside/u);
    expect(() => value.sample("missing", value.origin.x, value.origin.z)).toThrow(
      /unknown channel/u,
    );
  });

  it("should reject GPU generation until a GPU field can be canonical", () => {
    expect(
      () =>
        new Heightfield({
          columns: 3,
          depth: 2,
          heights: new Float32Array([3, 2, 1, 2, 1, 0, 1, 0, -1]),
          origin: { x: 0, z: 0 },
          rows: 3,
          width: 2,
          worldPasses: {
            dispatchBudget: 1,
            erosion: {
              depositionRate: 0.35,
              erosionRate: 0.22,
              evaporation: 0.04,
              iterations: 0,
              rainfall: 0.08,
              sedimentCapacity: 0.7,
              timeStep: 0.05,
            },
            gpu: true,
          },
        }),
    ).toThrow(/GPU generation cannot be canonical/u);
  });

  it("should keep an omitted GPU flag on the canonical CPU path", () => {
    const value = new Heightfield({
      columns: 3,
      depth: 2,
      heights: new Float32Array([3, 2, 1, 2, 1, 0, 1, 0, -1]),
      origin: { x: 0, z: 0 },
      rows: 3,
      width: 2,
      worldPasses: {
        dispatchBudget: 1,
        erosion: {
          depositionRate: 0.35,
          erosionRate: 0.22,
          evaporation: 0.04,
          iterations: 0,
          rainfall: 0.08,
          sedimentCapacity: 0.7,
          timeStep: 0.05,
        },
      },
    });

    expect(value.generationComplete).toBe(true);
    expect(value.debug()).toMatchObject({ complete: true, dispatched: 0 });
  });

  it("should construct no appearance under the world subpath", () => {
    const source = readFileSync(path.resolve("packages/core/src/world.ts"), "utf8");
    expect(source).not.toMatch(
      /new\s+\w*Material|new\s+Color|new\s+\w*Light|Texture\(|tonemapping|postprocessing/iu,
    );
  });
});
