import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhysicsProof as createNativePhysicsProof } from "../src/native/proof.js";
import { createPhysicsProof } from "../src/proof.js";

afterEach(() => {
  globalThis.__THREENATIVE_NATIVE__ = undefined;
});

describe("physics proof backend selection", () => {
  it("selects the native backend from the normal package entry", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.exports["."]["threenative-native"]).toBe("./dist/native/index.js");
  });

  it("drops the web cube onto the plane through the bulk contract", async () => {
    const proof = await createPhysicsProof();
    for (let step = 0; step < 180; step += 1) proof.step(1 / 60);
    const transforms = new Float32Array(16);
    expect(proof.readVisibleTransforms(transforms)).toBe(2);
    expect(transforms[10]).toBeCloseTo(0.5, 2);
    const events = new Uint32Array(16);
    expect(proof.drainCollisionEvents(events)).toBeGreaterThan(0);
    expect([...events.slice(0, 4)]).toEqual([0, 1, 1, 1]);
    proof.dispose();
  });

  it("fails closed when the native host is absent", async () => {
    await expect(createNativePhysicsProof()).rejects.toThrow("TN_NATIVE_PHYSICS_MISSING");
  });

  it("selects the runtime host without importing a native type", async () => {
    const step = vi.fn();
    const readVisibleTransforms = vi.fn(() => 2);
    const drainCollisionEvents = vi.fn(() => 1);
    const dispose = vi.fn();
    globalThis.__THREENATIVE_NATIVE__ = {
      physics: {
        version: "0.30.0",
        createProofSimulation: vi.fn(() => ({
          configureCharacter: vi.fn(),
          createBody: vi.fn(),
          dispose,
          drainCollisionEvents,
          readAreaIntersections: vi.fn(() => 0),
          readCharacterStates: vi.fn(() => 0),
          readVisibleTransforms,
          removeBody: vi.fn(),
          step,
        })),
        createSimulation: vi.fn(),
      },
    };

    const proof = await createNativePhysicsProof();
    proof.step(1 / 60);
    expect(proof.version).toBe("0.30.0");
    expect(step).toHaveBeenCalledOnce();
    proof.dispose();
  });

  it("rejects a malformed native simulation", async () => {
    globalThis.__THREENATIVE_NATIVE__ = {
      physics: {
        version: "0.30.0",
        createProofSimulation: vi.fn(() => ({}) as never),
        createSimulation: vi.fn(),
      },
    };
    await expect(createNativePhysicsProof()).rejects.toThrow("simulation is missing step");
  });
});
