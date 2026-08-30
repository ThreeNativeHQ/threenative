// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

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
    name: "bloom";
    build: (input: unknown, context: RenderChainStageContext) => unknown;
  }[];
};

type AtmosphereLike = {
  aerialPerspective(scenePass: unknown, depth: unknown, inScatteredRadiance?: unknown): unknown;
  radiance(direction: unknown): unknown;
};

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  atmosphere?: AtmosphereLike,
): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.15;
  const scenePass = pass(scene, camera);
  const colour = scenePass.getTextureNode();
  let output: Node<"vec4"> = colour;
  if (atmosphere !== undefined) {
    // Exposure belongs to this generated game source, so the framework only applies its depth
    // attenuation to the radiance the game chose for its sky.
    const hazeRadiance = atmosphere.radiance(vec3(0, 0, 1)) as Node<"vec3">;
    const aerial = atmosphere.aerialPerspective(
      scenePass,
      scenePass.getViewZNode(),
      hazeRadiance.mul(24),
    ) as Node<"vec4">;
    // Delete this one assignment to disable aerial perspective while retaining the sky and bloom.
    output = aerial;
  }
  if (renderer.createRenderChain === undefined) throw new Error("RenderChain is unavailable.");
  renderer.createRenderChain({
    input: output,
    request: { stages: ["bloom"], tier: "high" },
    stages: [
      {
        build: (input) =>
          (input as typeof output).add(bloom(input as typeof output, 0.5, 0.5, 0.2)),
        name: "bloom",
      },
    ],
  });
}
