import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, type Vector2, type WebGLRenderer } from "three";
import { expect, test } from "vitest";

import { installThreePlaytestBridge } from "../src/three/bridge.js";
import { ThreePlaytestEntityRegistry } from "../src/three/entities.js";

// Ported from src/three/bridge.test.ts, which was written in node:test format and
// therefore matched no pattern in vitest.config.ts — the three.js adapter, the one
// piece every real application installs, had zero executing coverage.
//
// A stub for the renderer size and optional `info.render` counters is enough and
// keeps the suite off the GPU.
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

  expect(snapshot.entities?.[0]?.transform?.position).toEqual([0, 0, 0]);
  expect(snapshot.entities?.[0]?.bounds?.width ?? 0).toBeGreaterThan(0);
  expect(snapshot.entities?.[0]?.visible).toBe(true);
  expect((await installation.bridge.describe()).capabilities).not.toContain("runtime.fixedStep");
  installation.dispose();
});

test("bridge exposes WebGPU render.drawCalls and finite triangles", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer: {
      ...renderer,
      info: { render: { calls: 99, drawCalls: 17, triangles: 42 } },
    } as unknown as WebGLRenderer,
    scene: new Scene(),
  });

  expect((await installation.bridge.sample({})).performance).toEqual({ drawCalls: 17, triangles: 42 });
  installation.dispose();
});

test("bridge does not treat WebGL render.calls as a drawCalls counter", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer: {
      ...renderer,
      info: { render: { calls: 17, triangles: 42 } },
    } as unknown as WebGLRenderer,
    scene: new Scene(),
  });

  expect((await installation.bridge.sample({})).performance).toEqual({ triangles: 42 });
  installation.dispose();
});

test("bridge omits unavailable and non-finite renderer counters", async () => {
  const missing = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer: {
      ...renderer,
      info: { render: { calls: Number.POSITIVE_INFINITY, drawCalls: Number.NaN, triangles: "unavailable" } },
    } as unknown as WebGLRenderer,
    scene: new Scene(),
  });

  expect((await missing.bridge.sample({})).performance).toBeUndefined();
  missing.dispose();
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

  expect(() => registry.register({ id: "player", object: second })).toThrow(/World\/First.*World\/Second/u);
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

  expect(state.score).toBe(3);
  expect((await installation.bridge.sample({})).resources).toEqual({ GameState: { score: 3 } });
  const capabilities = (await installation.bridge.describe()).capabilities;
  expect(capabilities).toContain("runtime.fixedStep");
  expect(capabilities).toContain("runtime.resources");
  installation.dispose();
});

test("reports the bounded runtime diagnostics series through the bridge", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer,
    runtimeDiagnosticsSeries: () => [
      { drawCalls: 4, frameMs: 16.7, triangles: 96 },
      { frameMs: 17.2 },
    ],
    scene: new Scene(),
  });

  const description = await installation.bridge.describe();
  const snapshot = await installation.bridge.sample({});

  expect(description.capabilities).toContain("runtime.performance");
  expect(snapshot.runtimeDiagnosticsSeries).toEqual([
    { drawCalls: 4, frameMs: 16.7, triangles: 96 },
    { frameMs: 17.2 },
  ]);
  installation.dispose();
});

test("fixed-step fails closed when actual updates differ from requested ticks", async () => {
  let tick = 2;
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    fixedStep: () => { tick += 2; },
    renderer,
    scene: new Scene(),
    tick: () => tick,
  });

  expect((await installation.bridge.sample({})).clock.tick).toBe(2);
  await expect(installation.bridge.advance?.(1)).rejects.toThrow(
    "fixedStep advanced 2 actual ticks; expected 1.",
  );
  installation.dispose();
});

test("fixed-step refuses to advertise without an authoritative tick provider", () => {
  expect(() => installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    fixedStep: () => undefined,
    renderer,
    scene: new Scene(),
  })).toThrow("fixedStep and its authoritative tick provider must be installed together.");
});

test("gameplay providers advertise and return animation and state channels together", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    gameplay: () => ({
      animation: { fox: { advancedFrames: 12, clip: "run" } },
      states: { fox: "run" },
    }),
    renderer,
    scene: new Scene(),
  });

  expect((await installation.bridge.describe()).capabilities).toEqual([
    "camera.observe",
    "entity.bounds",
    "entity.observe",
    "entity.setup",
    "scene.nodes",
    "scene.observe",
    "runtime.animation",
    "runtime.state",
  ]);
  expect((await installation.bridge.sample({})).gameplay).toEqual({
    animation: { fox: { advancedFrames: 12, clip: "run" } },
    states: { fox: "run" },
  });
  installation.dispose();
});

test("component and event providers advertise only the observations they supply", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    components: () => ({ player: { health: 2 } }),
    events: () => [{ entity: "player", name: "collected" }],
    renderer,
    scene: new Scene(),
  });

  const description = await installation.bridge.describe();
  expect(description.capabilities).toContain("runtime.components");
  expect(description.capabilities).toContain("runtime.events");
  expect((await installation.bridge.sample({})).components).toEqual({ player: { health: 2 } });
  expect(await installation.bridge.drainEvents?.()).toEqual([{ entity: "player", name: "collected" }]);
  installation.dispose();
});

test("an empty component provider does not advertise a dead capability", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    components: () => ({}),
    renderer,
    scene: new Scene(),
  });

  expect((await installation.bridge.describe()).capabilities).not.toContain("runtime.components");
  expect((await installation.bridge.sample({})).components).toBeUndefined();
  installation.dispose();
});

test("gameplay channels stay absent when no provider supplies them", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer,
    scene: new Scene(),
  });

  const description = await installation.bridge.describe();
  const snapshot = await installation.bridge.sample({});
  expect(description.capabilities).not.toContain("runtime.animation");
  expect(description.capabilities).not.toContain("runtime.state");
  expect(snapshot.gameplay).toBeUndefined();
  installation.dispose();
});

test("gameplay channels advertise the world observation supplied by the game", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    gameplay: () => ({
      animation: {},
      states: {},
      world: { seed: 6132 },
    }),
    gameplayChannels: () => ["runtime.world"],
    renderer,
    scene: new Scene(),
  });

  expect((await installation.bridge.describe()).capabilities).toContain("runtime.world");
  installation.dispose();
});

// The observation half of the adapter decides `visible`, which camera and
// visibility assertions rest on. An entity behind the camera that still reported
// visible:true would turn every visibility assertion into a vacuous pass.
test("an entity outside the frustum is reported not visible and carries no bounds", async () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.z = 5;
  const behind = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  behind.position.z = 40;
  scene.add(behind);
  const installation = installThreePlaytestBridge({ camera, entities: [{ id: "behind", object: behind }], renderer, scene });

  const observed = (await installation.bridge.sample({ entities: ["behind"] })).entities?.[0];

  expect(observed?.visible).toBe(false);
  expect(observed?.bounds).toBeUndefined();
  installation.dispose();
});

test("an object hidden with visible=false is reported not visible even while in frustum", async () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.z = 5;
  const hidden = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  hidden.visible = false;
  scene.add(hidden);
  const installation = installThreePlaytestBridge({ camera, entities: [{ id: "hidden", object: hidden }], renderer, scene });

  expect((await installation.bridge.sample({ entities: ["hidden"] })).entities?.[0]?.visible).toBe(false);
  installation.dispose();
});

test("sampling an unregistered id returns no observation rather than a zeroed one", async () => {
  // A zeroed placeholder would read as "entity is at the origin" and could satisfy
  // a position assertion the application never actually met.
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer,
    scene: new Scene(),
  });

  expect((await installation.bridge.sample({ entities: ["ghost"] })).entities).toEqual([]);
  installation.dispose();
});

test("setup on an unregistered entity fails loudly instead of being ignored", async () => {
  const installation = installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    renderer,
    scene: new Scene(),
  });

  await expect(installation.bridge.applySetup?.({ entities: [{ entity: "ghost", transform: { position: [1, 2, 3] } }] }))
    .rejects.toThrow(/ghost/u);
  installation.dispose();
});

test("setup refreshes dynamic entities before applying placement", async () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const player = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  let entities: Array<{ id: string; object: Mesh }> = [];
  const installation = installThreePlaytestBridge({
    camera,
    entities: () => entities,
    renderer,
    scene,
  });

  entities = [{ id: "player", object: player }];
  await installation.bridge.applySetup?.({
    entities: [{ entity: "player", transform: { position: [2, 0, 2] } }],
  });

  expect(player.position.toArray()).toEqual([2, 0, 2]);
  installation.dispose();
});

test("dispose restores a previously installed bridge instead of deleting it", () => {
  const first = installThreePlaytestBridge({ camera: new PerspectiveCamera(), renderer, scene: new Scene() });
  const second = installThreePlaytestBridge({ camera: new PerspectiveCamera(), renderer, scene: new Scene() });

  second.dispose();

  expect((globalThis as Record<string, unknown>).__THREENATIVE_PLAYTEST_BRIDGE__).toBe(first.bridge);
  first.dispose();
  expect((globalThis as Record<string, unknown>).__THREENATIVE_PLAYTEST_BRIDGE__).toBeUndefined();
});
