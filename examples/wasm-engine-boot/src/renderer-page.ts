/**
 * PRD-540 phase 2: three alone on the Wasm engine. Under `engine: "native"` these imports are the
 * engine's classes and `WebGPURenderer` is its facade; the scenario reads what the engine drew.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  DataTexture,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from "three";
import { uniform, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";

const SOFTWARE = /swiftshader|llvmpipe|lavapipe|softwarerasterizer|software adapter|basic render/iu;
const probe = {
  adapter: "",
  software: true,
  frames: 0,
  draws: 0,
  triangles: 0,
  error: "",
  /** The engine's refusal of a tone mapping it does not implement (three's CustomToneMapping, 5). */
  refusal: "",
  ticks: 0,
};
const started = performance.now();

Object.assign(globalThis, {
  __THREENATIVE_PLAYTEST_BRIDGE__: {
    describe: () => ({
      name: "wasm-engine-renderer",
      protocolVersion: 1,
      capabilities: ["runtime.components", "runtime.fixedStep"],
      limits: {
        maxEntitiesPerSample: 100,
        maxEventsPerDrain: 1000,
        maxPayloadBytes: 1000000,
        operationTimeoutMs: 5000,
      },
    }),
    ready: async () => {
      while (probe.frames < 1 && probe.error === "")
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { ready: true };
    },
    advance: async (count: number) => {
      const target = probe.ticks + count;
      while (probe.ticks < target && probe.error === "")
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { clock: { mode: "fixed-step", tick: probe.ticks }, ticks: count };
    },
    sample: () => ({
      clock: { mode: "fixed-step", tick: probe.ticks, timeMs: performance.now() - started },
      components: { "wasm-renderer": { probe: { ...probe } } },
    }),
  },
});

try {
  const canvas = document.querySelector<HTMLCanvasElement>("#c");
  if (canvas === null) throw new Error("Missing #c canvas.");
  const renderer = new WebGPURenderer({ canvas });
  renderer.setSize(640, 360, false);
  await renderer.init();
  const info = (
    renderer as unknown as { backend: { gpu: { requestAdapter(): Promise<{ info: object }> } } }
  ).backend.gpu;
  const facts = Object.values((await info.requestAdapter()).info).join(" ");
  probe.adapter = facts;
  probe.software = SOFTWARE.test(facts) || facts.trim() === "";

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 640 / 360, 0.1, 100);
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 0);
  const box = new Mesh(
    new BoxGeometry(1.6, 1.6, 1.6),
    new MeshStandardMaterial({ color: 0xff8030 }),
  );
  box.position.x = -1;
  // A TSL graph through the engine's shared name table: Midway's first TSL call is `uniform(0)`.
  const tint = uniform(0.5);
  const tinted = new MeshBasicNodeMaterial();
  tinted.colorNode = vec4(tint.mul(0.2), tint, tint.mul(1.6), 1);
  const tile = new Mesh(new BoxGeometry(1, 1, 1), tinted);
  tile.position.x = 1.2;
  // A smooth sphere: its shading gradient keeps every capture far from a flat, near-blank frame.
  // Its checker map is a texture upload (queue.writeTexture) out of the engine's Wasm memory.
  const checker = new DataTexture(
    new Uint8Array(
      Array.from({ length: 16 }, (_, i) =>
        (i + (i >> 2)) % 2 ? [255, 255, 255, 255] : [40, 40, 40, 255],
      ).flat(),
    ),
    4,
    4,
  );
  checker.needsUpdate = true;
  const ball = new Mesh(
    new SphereGeometry(0.45, 32, 16),
    new MeshStandardMaterial({ color: 0xf0e0c0, map: checker }),
  );
  ball.position.set(0.15, -0.9, 0.6);
  scene.add(box, tile, ball);
  const sun = new DirectionalLight(0xffffff, 3);
  sun.position.set(3, 5, 4);
  scene.add(sun, new AmbientLight(0xffffff, 0.4));
  renderer.setClearColor(0x102030, 1);
  // Midway's renderer settings: they reach the engine before each frame, as on the V8 player.
  renderer.toneMapping = 5;
  try {
    renderer.render(scene, camera);
  } catch (error) {
    probe.refusal = error instanceof Error ? error.message : String(error);
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const frame = () => {
    probe.ticks += 1;
    box.rotation.y += 0.02;
    // Written every frame, as Midway writes its clock: the engine updates the uniform, no recompile.
    tint.value = 0.5 + 0.3 * Math.sin(probe.ticks * 0.05);
    try {
      renderer.render(scene, camera);
      probe.frames += 1;
      probe.draws = renderer.info.render.drawCalls;
      probe.triangles = renderer.info.render.triangles;
      requestAnimationFrame(frame);
    } catch (error) {
      probe.error = error instanceof Error ? error.message : String(error);
    }
  };
  requestAnimationFrame(frame);
} catch (error) {
  probe.error = error instanceof Error ? error.message : String(error);
}
