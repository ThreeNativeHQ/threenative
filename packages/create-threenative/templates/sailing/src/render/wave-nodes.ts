// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import type { Node } from "three/webgpu";

export interface IWaveDisplacementSource {
  displacementNode(): Node;
}

export function createWaveSurfaceNode(source: IWaveDisplacementSource): Node {
  return source.displacementNode();
}
