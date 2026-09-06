// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import { DoubleSide } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { waterColourNode } from "./water-shaders.js";
import { createWaveSurfaceNode } from "./wave-nodes.js";
import type { IWaveDisplacementSource } from "./wave-nodes.js";

export function createWaterMaterial(source: IWaveDisplacementSource): MeshBasicNodeMaterial {
  // Opaque. At 0.9 the sky showed through every square metre of sea, so the water took a tenth of
  // the horizon's own value everywhere and the whole frame flattened towards one pale wash — the
  // exact failure `waterColourNode` exists to avoid, arriving through the alpha instead.
  const water = new MeshBasicNodeMaterial({ side: DoubleSide });
  water.positionNode = createWaveSurfaceNode(source);
  // The same field, evaluated again per fragment. That is the cost of ripples that survive at any
  // distance from the camera: differencing the vertex height instead quantises a field that has
  // no repeat, and puts a visible grid in the water.
  water.colorNode = waterColourNode(source.heightNode(), source.normalNode());
  return water;
}
