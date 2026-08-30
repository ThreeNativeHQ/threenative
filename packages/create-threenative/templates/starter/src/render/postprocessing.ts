// Generated for you: ordinary Three.js; ThreeNative does not read this file.
import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { sharpen } from "three/addons/tsl/display/SharpenNode.js";
import { pass } from "three/tsl";
type OutputRenderer = {
  kind: "webgpu" | "webgl2";
  raw: unknown;
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
    name: "bloom" | "sharpen";
    build: (input: unknown, context: RenderChainStageContext) => unknown;
  }[];
};

export function setupPost(renderer: OutputRenderer, scene: Scene, camera: Camera): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.15;
  const colour = pass(scene, camera).getTextureNode();
  if (renderer.createRenderChain === undefined) throw new Error("RenderChain is unavailable.");
  renderer.createRenderChain({
    input: colour,
    request: { stages: ["sharpen", "bloom"], tier: "high" },
    stages: [
      {
        build: (input) => sharpen(input as typeof colour, 0.28, false),
        name: "sharpen",
      },
      {
        build: (input) =>
          (input as typeof colour).add(bloom(input as typeof colour, 0.7, 0.5, 0.2)),
        name: "bloom",
      },
    ],
  });
}
