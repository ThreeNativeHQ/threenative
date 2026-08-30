import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";

type OutputRenderer = {
  readonly kind: "webgpu" | "webgl2";
  readonly raw: unknown;
  createRenderChain?: (options: RenderChainOptions) => unknown;
};

type RenderChainTier = "high" | "medium" | "low" | "off" | "auto";

type RenderChainStageContext = {
  readonly tier: Exclude<RenderChainTier, "auto">;
  readonly velocity: {
    readonly provisioned: boolean;
    readonly required: boolean;
    readonly source: "mrt" | "per-object" | null;
    readonly measurementFrame?: number;
    readonly rejectionFraction?: number;
  };
  readonly quality: {
    readonly denoiseIterations: number;
    readonly sliceCount: number;
    readonly stepCount: number;
  };
};

type RenderChainOptions = {
  input?: unknown;
  request?: { stages?: readonly string[]; tier?: RenderChainTier };
  stages?: readonly {
    name: "bloom";
    build: (input: unknown, context: RenderChainStageContext) => unknown;
  }[];
};

export function setupPost(renderer: OutputRenderer, scene: Scene, camera: Camera): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.08;
  const colour = pass(scene, camera).getTextureNode();
  if (renderer.createRenderChain === undefined) throw new Error("RenderChain is unavailable.");
  renderer.createRenderChain({
    input: colour,
    request: { stages: ["bloom"], tier: "high" },
    stages: [
      {
        build: (input) =>
          (input as typeof colour).add(bloom(input as typeof colour, 0.72, 0.42, 0.18)),
        name: "bloom",
      },
    ],
  });
}
