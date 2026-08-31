// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import { DoubleSide } from "three";
import { float } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { waterColourNode } from "./water-shaders.js";
import { createWaveSurfaceNode } from "./wave-nodes.js";
import type { IWaveDisplacementSource } from "./wave-nodes.js";

export function createWaterMaterial(source: IWaveDisplacementSource): MeshBasicNodeMaterial {
  const water = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, opacity: 0.9 });
  water.positionNode = createWaveSurfaceNode(source);
  water.colorNode = waterColourNode(float(0));
  return water;
}
