import { type ICtx, type RenderChain, Scene, type SceneFrame } from "@threenative/core";
import { createWebGPUInterop } from "@threenative/core/webgpu";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { pass } from "three/tsl";
import { readFixtureProof } from "../render/neural/fixture-proof.js";
import { createFixtureProvider } from "../render/neural/fixture-provider.js";
import { attachNeuralCapture } from "../render/neural/render-capture.js";

export type NeuralSandboxState = {
  proofPassed: boolean;
  proofCount: number;
  nrStatus: string;
  nrError: string;
  resultAgeFrames: number;
};

/**
 * Scene-referred HDR backgrounds, so the channel swap is visible as a whole-frame shift and the
 * fixture's HDR requirement is met by the sky alone. Cool daylight and the warm sky its swap
 * produces: the pair reads as two plausible times of day rather than as two neon test colours.
 */
const backgrounds = [
  [0.32, 0.58, 1.5],
  [1.5, 0.58, 0.32],
] as const;

/**
 * The PRD's tonal fixture: a six-step gray ramp, the three saturated primaries and HDR values above
 * 1. It is also what makes a captured frame readable at all — the runner's non-blank guard fails
 * closed below eight distinct colours, and a scene of flat-shaded props cannot clear that on its
 * own. Linear HDR values, so a double tonemap, a clipped highlight or a swapped channel shows up in
 * the pixels rather than only in the readback.
 */
const RAMP = [0.02, 0.06, 0.15, 0.35, 0.8, 1.6] as const;
const PRIMARIES = [
  [3, 0, 0],
  [0, 3, 0],
  [0, 0, 3],
] as const;

/** A row of flat quads at `y`, one mesh per linear HDR colour. */
function cardRow(
  ctx: ICtx<NeuralSandboxState>,
  geometry: PlaneGeometry,
  colors: readonly (readonly [number, number, number])[],
  y: number,
): MeshStandardMaterial[] {
  const step = 0.6;
  const materials = colors.map((rgb) => new MeshStandardMaterial({ color: new Color(...rgb) }));
  materials.forEach((material, index) => {
    const patch = new Mesh(geometry, material);
    patch.position.set(-4.3 + (index - (colors.length - 1) / 2) * step, y, -2.2);
    ctx.add(patch);
  });
  return materials;
}

/**
 * Portable browser/native diagnostic scene. This provider is NOT neural enhancement.
 *
 * It owns its own render chain rather than composing onto a template's, and that is a contract
 * requirement rather than a preference: `attachNeuralCapture` captures the world pass texture
 * directly, so its stage must receive that same texture as the chain's input. A chain that
 * composes anything first — an exposure multiply, a game's own aerial perspective — would be
 * displaying one image while the neural stage captured another, and the stage refuses that
 * arrangement instead of producing a silently mismatched pair.
 */
export class NeuralSnapshotScene extends Scene<NeuralSandboxState> {
  static override readonly initialState: NeuralSandboxState = {
    proofPassed: false,
    proofCount: 0,
    nrStatus: "starting",
    nrError: "",
    resultAgeFrames: 0,
  };
  #cleanup: (() => Promise<void>) | undefined;

  override enter(ctx: ICtx<NeuralSandboxState>): SceneFrame<NeuralSandboxState> {
    console.log("TN_NEURAL_FIXTURE: deterministic grade integration test, NOT neural enhancement");
    const bridge = createWebGPUInterop(ctx.renderer);
    const camera = ctx.camera as PerspectiveCamera;
    // Looking down onto a shallow set, so the horizon sits in the top third and the props fill
    // the frame. A camera at eye height aimed at the horizon put a flat band of sky over a flat
    // band of ground with the props a smudge in between, which is not a frame anyone can judge a
    // render path on.
    camera.position.set(2.2, 1.9, 4.8);
    camera.lookAt(0, -0.9, 0);
    camera.updateProjectionMatrix();
    ctx.scene.background = new Color(...backgrounds[0]);

    // A lit scene rather than a flat cube: ordinary materials, a key light and fill, so the
    // Before/After pair shows the same frame a game would produce instead of a colour-field test.
    const key = new DirectionalLight(0xfff3e0, 3.1);
    key.position.set(4, 6, 4);
    const rim = new DirectionalLight(0x9fc4ff, 1.1);
    rim.position.set(-5, 3, -4);
    // Fill is deliberately low: at 0.55 ambient every surface sat within a few percent of the
    // ground and the props read as one flat mass.
    for (const light of [new AmbientLight(0xffffff, 0.22), key, rim]) ctx.scene.add(light);

    const disposals: Array<() => void> = [];
    const add = (mesh: Mesh): Mesh => {
      ctx.add(mesh);
      disposals.push(() => mesh.geometry.dispose());
      disposals.push(() => (mesh.material as MeshStandardMaterial).dispose());
      return mesh;
    };
    const prop = (
      geometry: BoxGeometry | CylinderGeometry | SphereGeometry,
      color: number,
      position: readonly [number, number, number],
      options: { metalness?: number; roughness?: number } = {},
    ): Mesh => {
      const mesh = add(
        new Mesh(
          geometry,
          new MeshStandardMaterial({
            color,
            metalness: options.metalness ?? 0.15,
            roughness: options.roughness ?? 0.75,
          }),
        ),
      );
      mesh.position.set(position[0], position[1], position[2]);
      return mesh;
    };

    const ground = add(
      new Mesh(
        new PlaneGeometry(400, 400),
        new MeshStandardMaterial({ color: 0x5d6b52, roughness: 0.98 }),
      ),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.4;

    // One moving rigid object the eye can follow, and static props at three depths so the frame
    // has near, middle and far geometry to judge the transform against.
    const spinner = prop(new BoxGeometry(1.1, 1.1, 1.1), 0x2f6fd0, [0, -0.6, 0], {
      metalness: 0.35,
      roughness: 0.35,
    });
    prop(new BoxGeometry(0.9, 1.6, 0.9), 0xc8c2b4, [-1.9, -0.4, 0.6]);
    prop(new CylinderGeometry(0.45, 0.45, 1.3, 24), 0xb5651d, [1.85, -0.55, 0.4]);
    prop(new SphereGeometry(0.6, 32, 24), 0x9c3f52, [-1.1, -0.7, -1.6]);
    prop(new BoxGeometry(1.6, 0.5, 1.6), 0x6f6f74, [1.3, -1.05, -1.9], {
      metalness: 0.6,
      roughness: 0.3,
    });

    const cardGeometry = new PlaneGeometry(0.5, 0.3);
    const cardMaterials = [
      ...cardRow(
        ctx,
        cardGeometry,
        RAMP.map((level) => [level, level, level] as const),
        2.35,
      ),
      ...cardRow(ctx, cardGeometry, PRIMARIES, -2.35),
    ];
    disposals.push(() => cardGeometry.dispose());
    for (const material of cardMaterials) disposals.push(() => material.dispose());

    const world = pass(ctx.scene, camera);
    // Bound here because the graph is built on the first frame, where a fresh property lookup
    // would no longer narrow; the receiver stays the renderer either way.
    const createRenderChain = ctx.renderer.createRenderChain?.bind(ctx.renderer);
    if (createRenderChain === undefined)
      throw new Error("NEURAL_CHAIN: renderer has no render-chain factory");

    // The capture pair is displayed at full frame, so its resolution *is* the Before/After
    // resolution: a 64x64 capture stretched over a 512x512 frame is the whole picture, blurred
    // 8x, and no amount of scene detail survives that. The size is therefore taken from the
    // viewport on the first frame — `PassNode.renderTarget` is not sized until the pass renders,
    // and the viewport is the number the pair is finally presented at — and capped at the PRD's
    // 512-pixel neural input without changing the frame's aspect, which is the only resampling
    // this leaves and is reported in `state.resampling`.
    const MAX_NEURAL_INPUT = 512;
    let neural:
      | {
          capture: ReturnType<typeof attachNeuralCapture>;
          chain: RenderChain;
          width: number;
          height: number;
        }
      | undefined;
    let exited = false;

    const buildNeuralGraph = (frameCtx: Parameters<SceneFrame<NeuralSandboxState>>[0]): void => {
      const { width, height } = frameCtx.viewport.size;
      const scale = Math.min(1, MAX_NEURAL_INPUT / Math.max(width, height, 1));
      const inputWidth = Math.max(1, Math.round(width * scale));
      const inputHeight = Math.max(1, Math.round(height * scale));
      const provider = createFixtureProvider(bridge.device, inputWidth, inputHeight);
      const capture = attachNeuralCapture({
        worldPass: world,
        bridge,
        provider,
        maxBytes: 8 * 1024 * 1024,
        // Assigned one statement below; this closure only runs once the chain exists.
        rebuildGraph: () => {
          const built = neural;
          if (built !== undefined && !built.chain.disposed) built.chain.apply();
        },
      });
      const chain = createRenderChain({
        input: world.getTextureNode(),
        worldPass: world,
        stages: [capture.stage],
        request: { stages: [capture.stage.name], tier: "high" },
      });
      neural = { capture, chain, width: inputWidth, height: inputHeight };
    };

    this.#cleanup = async () => {
      exited = true;
      const built = neural;
      neural = undefined;
      if (built === undefined) return;
      await built.capture.dispose();
      built.chain.dispose();
      world.dispose();
      for (const dispose of disposals) dispose();
    };
    let captureHeld = false;
    let divider = 0.5;
    let checking = false;
    let proofCount = 0;
    let error = "";
    return (frameCtx, dt) => {
      if (neural === undefined) buildNeuralGraph(frameCtx);
      const { capture, width, height } = neural as NonNullable<typeof neural>;
      spinner.rotation.y += dt * 0.6;
      const keys = frameCtx.input.raw.keys;
      const held = keys.has("KeyC");
      if (held && !captureHeld && !checking) {
        proofCount = 0;
        error = "";
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
        void readFixtureProof(bridge, capture.textures, width, height, background)
          .then((proof) => {
            if (exited) return;
            proofCount += 1;
            console.log(
              `TN_NEURAL_FIXTURE_PROOF: ${JSON.stringify({ ...proof, capture: proofCount, frame: state.frameId })}`,
            );
            if (proofCount === 1) {
              ctx.scene.background = new Color(...backgrounds[1]);
              capture.capture();
            }
          })
          .catch((cause: unknown) => {
            error = cause instanceof Error ? cause.message : String(cause);
            console.error(`TN_NEURAL_FIXTURE_FAILED: ${error}`);
          })
          .finally(() => {
            checking = false;
          });
      }
      frameCtx.state.set({
        proofPassed: proofCount === 2,
        proofCount,
        nrStatus: state.status,
        nrError: error || state.error || "",
        resultAgeFrames: state.resultAgeFrames ?? 0,
      });
    };
  }

  override exit(): void {
    void this.#cleanup?.().catch((error: unknown) =>
      console.error("TN_NEURAL_CLEANUP_FAILED", error),
    );
    this.#cleanup = undefined;
  }
}
