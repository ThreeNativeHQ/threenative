/**
 * PRD-540 phase 2: three alone on the Wasm engine. Under `engine: "native"` these imports are the
 * engine's classes and `WebGPURenderer` is its facade; the scenario reads what the engine drew.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  DataTexture,
  DirectionalLight,
  LoopOnce,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  PCFShadowMap,
  PerspectiveCamera,
  PropertyBinding,
  Scene,
  SphereGeometry,
  setConsoleFunction,
} from "three";
import {
  Fn,
  cameraFar,
  cameraNear,
  float,
  positionLocal,
  screenUV,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
  viewportLinearDepth,
  viewportSharedTexture,
} from "three/tsl";
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
  /** Runs of the tint uniform's onRenderUpdate: once per render, as Midway's ripple texture sync. */
  renderUpdates: 0,
  /** core's clip audit on the Wasm engine: track paths bound and refused through PropertyBinding. */
  trackAudit: "",
  /** AnimationMixer "finished" events on the Wasm engine, as core's AnimationPlayer listens. */
  finished: 0,
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
  (tint as unknown as { onRenderUpdate(callback: () => void): void }).onRenderUpdate(() => {
    probe.renderUpdates += 1;
  });
  const tinted = new MeshBasicNodeMaterial();
  // The same colour through Fn and r185's compound assigns, as Midway's water effects accumulate.
  tinted.colorNode = Fn(() => {
    const green = tint.mul(0.5).toVar();
    green.addAssign(tint.mul(0.5));
    // Midway's ocean takes screen-space derivatives; zero-weighted so the colour is unchanged.
    green.addAssign(uv().dFdx().x.add(uv().dFdy().lengthSq()).mul(0));
    // Midway's fog reads the camera planes; zero-weighted too.
    green.addAssign(cameraFar.sub(cameraNear).mul(0));
    // r185's clamp() with its default bounds, as WaterSurface3D clamps; green stays inside 0..1.
    green.assign(green.clamp());
    const blue = tint.toVar();
    blue.mulAssign(1.6);
    return vec4(tint.mul(0.2), green, blue, 1);
  })();
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
  // three's copy reads x, y and z: a plain object places it, as Midway's audio cues do.
  ball.position.copy({ x: 0.15, y: -0.9, z: 0.6 } as never);
  // texture(textureObject, uv) on an unnamed DataTexture, as Midway's ocean: a level-0 vertex read
  // at the local xz (Midway's positionWorld.xz swizzle) displaces the slab and a fragment read
  // colours it.
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; ++i) pixels.set([(i % 4) * 80, Math.floor(i / 4) * 80, 160, 255], i * 4);
  const grid = new DataTexture(pixels, 4, 4);
  grid.needsUpdate = true;
  const textured = new MeshBasicNodeMaterial();
  textured.positionNode = positionLocal.add(
    vec3(0, texture(grid, positionLocal.xz.add(0.5)).level(float(0)).r.mul(0.2), 0),
  );
  textured.colorNode = vec4(texture(grid, uv()).rgb, 1);
  const slab = new Mesh(new BoxGeometry(0.8, 0.3, 0.8, 4, 1, 4), textured);
  slab.position.set(-1.2, -0.9, 0.4);
  // WaterSurface3D's reads on the Wasm engine: a transparent pane over the ball shows the frame
  // behind it (viewportSharedTexture) tinted by its linear depth (viewportLinearDepth).
  const glass = new MeshBasicNodeMaterial({ transparent: true });
  glass.colorNode = vec4(
    viewportSharedTexture(screenUV)
      .rgb.mul(vec3(0.6, 0.9, 1))
      .add(vec3(0, 0, viewportLinearDepth.mul(0.3))),
    1,
  );
  const pane = new Mesh(new BoxGeometry(0.9, 0.6, 0.02), glass);
  pane.position.set(0.15, -0.75, 1.3);
  scene.add(box, tile, ball, slab, pane);
  box.name = "box";
  // What core's clip audit asks before a model's clips play: a track on a named node binds, one on a
  // missing node is reported through three's console function.
  const refused: string[] = [];
  setConsoleFunction((type: string, message: string) => refused.push(`${type}:${message}`));
  const parsed = PropertyBinding.parseTrackName("box.position");
  new PropertyBinding(scene, "box.position").bind();
  new PropertyBinding(scene, "nobody.quaternion").bind();
  setConsoleFunction(null as never);
  probe.trackAudit = `${parsed.nodeName}/${parsed.propertyName} ${String(refused.length)} refused`;
  // A one-shot clip: the engine's mixer reports "finished" to a JS listener.
  const mixer = new AnimationMixer(scene);
  // Half a second: it finishes inside the scenario, after the warm-up frames.
  const nudge = new AnimationClip("nudge", 0.5, [
    new NumberKeyframeTrack("box.position[y]", [0, 0.5], [0, 0]),
  ]);
  // MathUtils as Midway calls it, on the namespace: clamp keeps the weight inside 0..1.
  mixer
    .clipAction(nudge)
    .setLoop(LoopOnce, 1)
    .setEffectiveWeight(MathUtils.clamp(2, 0, 1))
    .play();
  mixer.addEventListener("finished", () => {
    probe.finished += 1;
  });
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
    mixer.update(1 / 60);
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
