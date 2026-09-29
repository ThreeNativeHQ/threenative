import { type ICtx, type RenderChain, Scene, type SceneFrame } from "@threenative/core";
import { createWebGPUInterop } from "@threenative/core/webgpu";
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, type PerspectiveCamera, PlaneGeometry } from "three";
import { pass } from "three/tsl";
import { createFixtureProvider } from "../render/neural/fixture-provider.js";
import { readFixtureProof } from "../render/neural/fixture-proof.js";
import { attachNeuralCapture } from "../render/neural/render-capture.js";

export type NeuralSandboxState = { proofPassed: boolean; proofCount: number; nrStatus: string; nrError: string; resultAgeFrames: number };

/**
 * The tonal fixture the PRD asks the sandbox to carry: a gray ramp, the three saturated primaries
 * and an HDR highlight. It is also what makes a captured frame readable at all — a flat cube on a
 * flat background renders five distinct colours, and the runner's non-blank guard needs eight, so
 * without it a full-frame visual assertion cannot pass however correct the render is. Linear HDR
 * values, so a double tonemap, a clipped highlight or a swapped channel is visible in the pixels.
 */
const RAMP = [0.02, 0.06, 0.15, 0.35, 0.8, 1.6] as const;
const PRIMARIES = [[3, 0, 0], [0, 3, 0], [0, 0, 3]] as const;

/** A row of flat quads at `y`, one mesh per linear HDR colour. */
function testCardRow(ctx: ICtx<NeuralSandboxState>, geometry: PlaneGeometry, colors: readonly (readonly [number, number, number])[], y: number): MeshBasicMaterial[] {
  const step = 0.6;
  const materials = colors.map((rgb, index) => new MeshBasicMaterial({ color: new Color(...rgb) }));
  materials.forEach((material, index) => {
    const patch = new Mesh(geometry, material);
    patch.position.set((index - (colors.length - 1) / 2) * step, y, -1.2);
    ctx.add(patch);
  });
  return materials;
}

/** Portable browser/native diagnostic scene. This provider is NOT neural enhancement. */
export class NeuralSnapshotScene extends Scene<NeuralSandboxState> {
  static override readonly initialState: NeuralSandboxState = {
    proofPassed: false, proofCount: 0, nrStatus: "starting", nrError: "", resultAgeFrames: 0,
  };
  #cleanup: (() => Promise<void>) | undefined;

  override enter(ctx: ICtx<NeuralSandboxState>): SceneFrame<NeuralSandboxState> {
    console.log("TN_NEURAL_FIXTURE: channel-swap integration test, NOT neural enhancement");
    const bridge = createWebGPUInterop(ctx.renderer);
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const backgrounds = [[4, 0.25, 0.5], [0.25, 3, 1]] as const;
    ctx.scene.background = new Color(...backgrounds[0]);
    const geometry = new BoxGeometry(1.5, 1.5, 1.5);
    const material = new MeshBasicMaterial({ color: new Color(0.1, 0.5, 2) });
    const cube = ctx.add(new Mesh(geometry, material));
    const cardGeometry = new PlaneGeometry(0.5, 0.3);
    const cardMaterials = [
      ...testCardRow(ctx, cardGeometry, RAMP.map((level) => [level, level, level] as const), -2.2),
      ...testCardRow(ctx, cardGeometry, PRIMARIES, 2.2),
    ];
    const world = pass(ctx.scene, camera);
    const provider = createFixtureProvider(bridge.device, 64, 64);
    let chain: RenderChain | undefined;
    const capture = attachNeuralCapture({ worldPass: world, bridge, provider, maxBytes: 8 * 1024 * 1024,
      rebuildGraph: () => { if (chain !== undefined && !chain.disposed) chain.apply(); } });
    if (ctx.renderer.createRenderChain === undefined) throw new Error("NEURAL_CHAIN: renderer has no render-chain factory");
    chain = ctx.renderer.createRenderChain({ input: world.getTextureNode(), worldPass: world,
      stages: [capture.stage], request: { stages: [capture.stage.name], tier: "high" } });
    let exited = false;
    this.#cleanup = async () => {
      exited = true;
      await capture.dispose();
      chain?.dispose();
      world.dispose();
      geometry.dispose();
      material.dispose();
      cardGeometry.dispose();
      for (const card of cardMaterials) card.dispose();
    };
    let captureHeld = false;
    let divider = 0.5;
    let checking = false;
    let proofCount = 0;
    let error = "";
    return (frameCtx, dt) => {
      cube.rotation.y += dt * 0.7;
      const keys = frameCtx.input.raw.keys;
      const held = keys.has("KeyC");
      if (held && !captureHeld && !checking) {
        proofCount = 0; error = "";
        ctx.scene.background = new Color(...backgrounds[0]);
        capture.capture();
      }
      captureHeld = held;
      if (keys.has("Digit1")) capture.setView("original");
      if (keys.has("Digit2")) capture.setView("split");
      if (keys.has("Digit3")) capture.setView("enhanced");
      if (keys.has("ArrowLeft")) divider = Math.max(0, divider - dt * 0.5);
      if (keys.has("ArrowRight")) divider = Math.min(1, divider + dt * 0.5);
      capture.setDivider(divider);
      const state = capture.state;
      if (!checking && proofCount < 2 && state.status === "ready" && error === "") {
        checking = true;
        const background = backgrounds[proofCount];
        if (background === undefined) throw new Error("NEURAL_PROOF: invalid sequence");
        void readFixtureProof(bridge, capture.textures, 64, 64, background).then((proof) => {
          if (exited) return;
          proofCount += 1;
          console.log(`TN_NEURAL_FIXTURE_PROOF: ${JSON.stringify({ ...proof, capture: proofCount, frame: state.frameId })}`);
          if (proofCount === 1) {
            ctx.scene.background = new Color(...backgrounds[1]);
            capture.capture();
          }
        }).catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : String(cause);
          console.error(`TN_NEURAL_FIXTURE_FAILED: ${error}`);
        }).finally(() => { checking = false; });
      }
      frameCtx.state.set({ proofPassed: proofCount === 2, proofCount, nrStatus: state.status,
        nrError: error || state.error || "", resultAgeFrames: state.resultAgeFrames ?? 0 });
    };
  }

  override exit(): void {
    void this.#cleanup?.().catch((error: unknown) => console.error("TN_NEURAL_CLEANUP_FAILED", error));
    this.#cleanup = undefined;
  }
}
