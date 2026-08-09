import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector2, type WebGLRenderer } from "three";

import { installThreePlaytestBridge } from "./bridge.js";
import { ThreePlaytestEntityRegistry } from "./entities.js";

const renderer = {
  getDrawingBufferSize(target: Vector2) {
    return target.set(1280, 720);
  },
} as WebGLRenderer;

test("bridge samples registered transforms and projected bounds without owning a render loop", async () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.z = 5;
  const player = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  player.name = "Player";
  scene.add(player);
  const installation = installThreePlaytestBridge({
    camera,
    entities: [{ id: "player", object: player }],
    renderer,
    scene,
  });

  const snapshot = await installation.bridge.sample({ entities: ["player"] });

  assert.deepEqual(snapshot.entities?.[0]?.transform?.position, [0, 0, 0]);
  assert.ok((snapshot.entities?.[0]?.bounds?.width ?? 0) > 0);
  assert.equal(snapshot.entities?.[0]?.visible, true);
  assert.equal((await installation.bridge.describe()).capabilities.includes("runtime.fixedStep"), false);
  installation.dispose();
});

test("duplicate ids fail with both conflicting object paths", () => {
  const scene = new Scene();
  scene.name = "World";
  const first = new Mesh();
  first.name = "First";
  const second = new Mesh();
  second.name = "Second";
  scene.add(first, second);
  const registry = new ThreePlaytestEntityRegistry();
  registry.register({ id: "player", object: first });

  assert.throws(
    () => registry.register({ id: "player", object: second }),
    /World\/First.*World\/Second/,
  );
});

test("fixed-step and resource providers advertise only installed capabilities", async () => {
  const state = { score: 0 };
  let tick = 0;
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    fixedStep: (ticks) => {
      state.score += ticks;
      tick += ticks;
    },
    renderer,
    resources: {
      read: () => ({ GameState: { score: state.score } }),
      write: (_id, _path, value) => {
        state.score = Number(value);
        return true;
      },
    },
    scene: new Scene(),
    tick: () => tick,
  });

  await installation.bridge.advance?.(3);
  assert.equal(state.score, 3);
  assert.deepEqual((await installation.bridge.sample({})).resources, { GameState: { score: 3 } });
  const capabilities = (await installation.bridge.describe()).capabilities;
  assert.equal(capabilities.includes("runtime.fixedStep"), true);
  assert.equal(capabilities.includes("runtime.resources"), true);
  installation.dispose();
});
