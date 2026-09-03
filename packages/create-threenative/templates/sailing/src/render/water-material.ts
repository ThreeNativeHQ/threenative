// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import { DoubleSide } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { waterColourNode } from "./water-shaders.js";
import { createWaveSurfaceNode } from "./wave-nodes.js";
import type { IWaveDisplacementSource } from "./wave-nodes.js";

export function createWaterMaterial(source: IWaveDisplacementSource): MeshBasicNodeMaterial {
  const water = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, opacity: 0.9 });
  water.positionNode = createWaveSurfaceNode(source);
  // The same field, evaluated again per fragment. That is the cost of ripples that survive at any
  // distance from the camera: differencing the vertex height instead quantises a field that has
  // no repeat, and puts a visible grid in the water.
  water.colorNode = waterColourNode(source.heightNode(), source.normalNode());
  return water;
}
