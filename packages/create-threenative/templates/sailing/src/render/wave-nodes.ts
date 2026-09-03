// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import type { Node } from "three/webgpu";

/**
 * What the water material needs from whatever is generating the swell.
 *
 * `WaveField` from `@threenative/core` satisfies it, and so does anything else that can answer the
 * same three questions. The normal is on the interface rather than differenced from the height
 * because the field can differentiate its own wave sum exactly, and a differenced normal repeats
 * where the sampling grid does.
 */
export interface IWaveDisplacementSource {
  displacementNode(): Node;
  heightNode(): Node<"float">;
  normalNode(): Node<"vec3">;
}

export function createWaveSurfaceNode(source: IWaveDisplacementSource): Node {
  return source.displacementNode();
}
