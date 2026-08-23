import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from "three";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { installThreePlaytestBridge } from "../src/three/bridge.js";
import {
  loadPlaytestScenario,
  requiredPlaytestCapabilities,
} from "../src/index.js";
import { yawPitchToQuaternion } from "../src/scenario/orientation.js";

async function writeScenario(setup: unknown, extra: Record<string, unknown> = {}) {
  const directory = await makeTempDir("playtest-setup-");
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    name: "setup-vocabulary",
    schemaVersion: 1,
    subject: "player",
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 1,
    setup,
    steps: [{ release: true, waitTicks: 1 }],
    ...extra,
  }));
  return loadPlaytestScenario(directory, "scenario.json");
}

const renderer = {
  getDrawingBufferSize(target: { set(x: number, y: number): unknown }) {
    return target.set(1280, 720);
  },
} as unknown as WebGLRenderer;

describe("setup.spawn / setup.aim / setup.place schema", () => {
  test("accepts spawn, aim, and place with a declared subject", async () => {
    const parsed = await writeScenario({
      aim: { pitch: 0.1, yaw: -1.5 },
      entities: [{ entity: "player", position: [0, 0, 0] }],
      place: [
        { at: { x: 4, y: 0, z: -2 }, entity: "sentry", facing: { yaw: 1.2 }, frozen: true },
      ],
      spawn: { x: 12, z: -8 },
    });
    expect(parsed.setup?.spawn).toEqual({ x: 12, z: -8 });
    expect(parsed.setup?.aim).toEqual({ pitch: 0.1, yaw: -1.5 });
    expect(parsed.setup?.place).toEqual([
      { at: { x: 4, y: 0, z: -2 }, entity: "sentry", facing: { yaw: 1.2 }, frozen: true },
    ]);
  });

  test("spawn accepts an explicit y and preserves nothing silently", async () => {
    const parsed = await writeScenario({ spawn: { x: 1, y: 2.5, z: 3 } });
    expect(parsed.setup?.spawn).toEqual({ x: 1, y: 2.5, z: 3 });
  });

  test("rejects spawn or aim when the scenario declares no subject", async () => {
    await expect(writeScenario({ spawn: { x: 1, z: 2 } }, { subject: undefined }))
      .rejects.toThrow(/setup\.spawn.*subject/u);
    await expect(writeScenario({ aim: { pitch: 0, yaw: 0 } }, { subject: undefined }))
      .rejects.toThrow(/setup\.aim.*subject/u);
  });

  test("rejects spawn without finite x or z", async () => {
    await expect(writeScenario({ spawn: { x: 1 } })).rejects.toThrow(/setup\.spawn/u);
    await expect(writeScenario({ spawn: { x: "1", z: 2 } })).rejects.toThrow(/setup\.spawn/u);
  });

  test("rejects aim with a wrong-typed component instead of dropping it", async () => {
    await expect(writeScenario({ aim: { pitch: 0.1 } })).rejects.toThrow(/setup\.aim/u);
    await expect(writeScenario({ aim: { pitch: "high", yaw: 0 } })).rejects.toThrow(/setup\.aim/u);
    await expect(writeScenario({ aim: { pitch: 0.1, yaw: Number.NaN } })).rejects.toThrow(/setup\.aim/u);
  });

  test("rejects a place entry without a named entity or without at", async () => {
    await expect(writeScenario({ place: [{ at: { x: 0, y: 0, z: 0 } }] }))
      .rejects.toThrow(/setup\.place\[0\].*entity/u);
    await expect(writeScenario({ place: [{ entity: "sentry" }] }))
      .rejects.toThrow(/setup\.place\[0\].*at/u);
  });

  test("rejects a place entry with both facing and lookAt", async () => {
    await expect(writeScenario({
      place: [{ at: { x: 0, y: 0, z: 0 }, entity: "sentry", facing: { yaw: 0 }, lookAt: { x: 1, y: 0, z: 1 } }],
    })).rejects.toThrow(/setup\.place\[0\].*(facing|lookAt)/u);
  });

  test("rejects an empty place array as vacuous", async () => {
    await expect(writeScenario({ place: [] })).rejects.toThrow(/setup\.place/u);
  });

  test("rejects one entity claimed by both setup.entities and setup.place", async () => {
    await expect(writeScenario({
      entities: [{ entity: "sentry", position: [0, 0, 0] }],
      place: [{ at: { x: 1, y: 0, z: 1 }, entity: "sentry" }],
    })).rejects.toThrow(/sentry/u);
  });

  test("rejects unknown keys anywhere in the new setup vocabulary", async () => {
    await expect(writeScenario({ spawn: { x: 1, z: 2, heading: 0 } })).rejects.toThrow(/heading/u);
    await expect(writeScenario({ place: [{ at: { x: 0, y: 0, z: 0 }, entity: "sentry", spin: true }] }))
      .rejects.toThrow(/spin/u);
  });

  test("spawn and aim require the entity.setup capability and reach the bridge-required path", async () => {
    const parsed = await writeScenario({ aim: { pitch: 0, yaw: 0 }, spawn: { x: 1, z: 2 } });
    const capabilities = requiredPlaytestCapabilities(parsed);
    expect(capabilities).toContain("entity.setup");
  });
});

describe("the aimAt step kind", () => {
  test("accepts an xz-literal or entity target with optional pitch override", async () => {
    const literal = await writeScenario({}, {
      steps: [{ kind: "aimAt", label: "aim-east", target: { x: 3, z: 0 } }],
    });
    expect(literal.steps[0]).toMatchObject({ kind: "aimAt", target: { x: 3, z: 0 } });
    const entityTarget = await writeScenario({}, {
      steps: [{
        kind: "aimAt",
        pitch: 0.25,
        screenshot: "vantage",
        target: { entity: "beacon" },
        waitTicks: 4,
      }],
    });
    expect(entityTarget.steps[0]).toMatchObject({ kind: "aimAt", target: { entity: "beacon" }, pitch: 0.25 });
  });

  test("rejects an aimAt step without a target", async () => {
    await expect(writeScenario({}, { steps: [{ kind: "aimAt" }] }))
      .rejects.toThrow(/step 0.*target/u);
  });

  test("rejects a target that mixes the literal and entity forms", async () => {
    await expect(writeScenario({}, {
      steps: [{ kind: "aimAt", target: { entity: "beacon", x: 1, z: 2 } }],
    })).rejects.toThrow(/steps\[0\].*target/u);
  });

  test("rejects aimAt combined with input delivery or ignored holds", async () => {
    await expect(writeScenario({}, {
      steps: [{ kind: "aimAt", press: "KeyW", target: { x: 1, z: 2 } }],
    })).rejects.toThrow(/step 0.*press/u);
    await expect(writeScenario({}, {
      steps: [{ holdTicks: 5, kind: "aimAt", target: { x: 1, z: 2 } }],
    })).rejects.toThrow(/step 0.*holdTicks/u);
    await expect(writeScenario({}, {
      steps: [{ kind: "aimAt", pointerPosition: { x: 0.5, y: 0.5 }, target: { x: 1, z: 2 } }],
    })).rejects.toThrow(/step 0.*pointerPosition/u);
  });

  test("rejects target or pitch on a step that is not aimAt", async () => {
    await expect(writeScenario({}, { steps: [{ release: true, waitTicks: 1, target: { x: 1, z: 2 } }] }))
      .rejects.toThrow(/target/u);
    await expect(writeScenario({}, { steps: [{ pitch: 0.2, release: true, waitTicks: 1 }] }))
      .rejects.toThrow(/pitch/u);
  });

  test("aimAt requires the entity.setup capability", async () => {
    const parsed = await writeScenario({}, {
      steps: [{ kind: "aimAt", target: { x: 1, z: 2 } }],
    });
    expect(requiredPlaytestCapabilities(parsed)).toContain("entity.setup");
  });
});

describe("placement presence semantics at apply time (real bridge)", () => {
  function bridgeWithScene() {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const player = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    player.name = "Player";
    scene.add(player);
    const installation = installThreePlaytestBridge({
      camera,
      entities: [{ id: "player", object: player }],
      renderer,
      scene,
    });
    return { installation, player };
  }

  test("a placed entity absent from the registry is a named error, never a skip", async () => {
    const { installation } = bridgeWithScene();
    await expect(installation.bridge.applySetup?.({
      entities: [{ entity: "ghost-sentry", transform: { position: [1, 0, 1] } }],
    })).rejects.toThrow(/ghost-sentry/u);
    installation.dispose();
  });

  test("spawning exactly at the origin applies instead of being filtered as empty", async () => {
    // Regression: a sentinel hack parked an entity at y=-1000 because an origin-spawn
    // failed a game-side lengthSq() > 0 emptiness check. Placement at [0,0,0] is data.
    const { installation, player } = bridgeWithScene();
    await installation.bridge.applySetup?.({
      entities: [{ entity: "player", transform: { position: [0, 0, 0] } }],
    });
    expect(player.position.toArray()).toEqual([0, 0, 0]);
    installation.dispose();
  });

  test("frozen delivers a readable placed-entity marker, not runner-side teleports", async () => {
    const { installation, player } = bridgeWithScene();
    await installation.bridge.applySetup?.({
      entities: [{ entity: "player", frozen: true, transform: { position: [2, 0, 2] } }],
    });
    expect(player.position.toArray()).toEqual([2, 0, 2]);
    expect(player.userData.__threenativeFrozen).toBe(true);
    installation.dispose();
  });

  test("lookAt derives a quaternion whose forward (-Z) points at the target", async () => {
    const { installation, player } = bridgeWithScene();
    // Place at origin, look at due east: forward must map to +X, i.e. yaw = -PI/2.
    const yawPitchToQuaternionEast = yawPitchToQuaternion(-Math.PI / 2, 0);
    await installation.bridge.applySetup?.({
      entities: [{
        entity: "player",
        transform: {
          position: [0, 0, 0],
          rotation: yawPitchToQuaternionEast,
        },
      }],
    });
    const forward = new Vector3(0, 0, -1).applyQuaternion(player.quaternion);
    expect(forward.x).toBeCloseTo(1, 5);
    expect(forward.z).toBeCloseTo(0, 5);
    installation.dispose();
  });
});
