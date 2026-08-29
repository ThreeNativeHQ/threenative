// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

type OutputRenderer = {
  kind: string;
  raw: unknown;
  setOutputNode(node: unknown): void;
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
  if (renderer.kind !== "webgpu") return;
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
  renderer.setOutputNode(output.add(bloom(output, 0.5, 0.5, 0.2)));
}
