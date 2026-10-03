// Generated for you: opt-in Three.js, with no default tier or picture change.
// Compose this medium before exposure/bloom/output. Disable its scene fog, aerial haze and
// god rays; a separate clear-air sky remains valid. Density/phase/colour belong to this game.
// Pinned Three 0.185.1 VolumeNodeMaterial skips directional lights and couples extinction to
// illumination. This bounded integrator reuses GodraysNode's depth/shadow coordinates instead.
// `volumetricFogOptions.ts` is the contract it accepts, `volumetricFogVolume.ts` the graph it
// builds and owns, and `volumetricFogTransport.ts` the per-step integration inside it.
import type { PerspectiveCamera } from "three";
import type { Node, NodeMaterial, RenderTarget } from "three/webgpu";
import type { IFogVolume, IVolumetricFogOptions } from "./volumetricFogOptions.js";
import { validateFogOptions } from "./volumetricFogOptions.js";
import type { ScenePass } from "./volumetricFogTransport.js";
import { type IFogVolumeGraph, composeFogVolume } from "./volumetricFogVolume.js";

export type { IFogVolume, IVolumetricFogOptions };

/** The owned medium a composed graph exposes: one controller, one graph, one owned target. */
export type IFogMedium = Exclude<ReturnType<typeof createVolumetricFog>, undefined>;

/** Off, unsupported and zero-density return before allocating any graph/target/material. */
export function createVolumetricFog(camera: PerspectiveCamera, supplied: IVolumetricFogOptions) {
  if (!supplied.enabled || supplied.renderer !== "webgpu") return undefined;
  const options = { ...supplied };
  validateFogOptions(camera, options);
  const volumes = options.volumes.filter((volume) => volume.density > 0);
  if (volumes.length === 0) return undefined;
  let graph: IFogVolumeGraph | undefined;
  let disposed = false;
  return {
    get target(): RenderTarget | undefined {
      return graph?.target;
    },
    get material(): NodeMaterial | undefined {
      return graph?.material;
    },
    get transport(): Node<"vec4"> | undefined {
      return graph?.transport;
    },
    diagnostics: () => ({
      steps: options.steps,
      resolutionScale: options.resolutionScale,
      volumes: volumes.length,
      localLights: (options.points ?? []).length,
      history: false,
      renderTargets: graph === undefined ? 0 : 1,
      pixels: graph === undefined ? 0 : graph.target.width * graph.target.height,
    }),
    compose(scenePass: ScenePass): Node<"vec4"> {
      if (disposed) throw new Error("volumetricFog: disposed controller.");
      if (graph !== undefined) throw new Error("volumetricFog: compose once per owned graph.");
      if (scenePass.camera !== camera)
        throw new Error("volumetricFog: scene depth must come from this camera.");
      if (Reflect.get(scenePass.scene, "fog") != null)
        throw new Error("volumetricFog: scene fog duplicates the same medium.");
      graph = composeFogVolume(camera, options, volumes, scenePass);
      return graph.compose;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      graph?.target.dispose();
      graph?.material.dispose();
      graph = undefined;
    },
  };
}
