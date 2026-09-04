// Generated for you: this is the starter's game-owned water look.
// The WaveField itself is framework plumbing; these colours, highlights and opacity are yours.
import { DoubleSide } from "three";
import { color, float, mix, normalize, smoothstep, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";
import { palette } from "./palette.js";

export interface IWaveDisplacementSource {
  displacementNode(): Node;
  heightNode(): Node<"float">;
  normalNode(): Node<"vec3">;
}

const SUN = normalize(vec3(0.45, 0.82, 0.3));

/** Water with broad colour bands and a narrow sun glint that survives the painterly grade. */
export function createWaterMaterial(source: IWaveDisplacementSource): MeshBasicNodeMaterial {
  const water = new MeshBasicNodeMaterial({
    depthWrite: false,
    opacity: 0.94,
    side: DoubleSide,
    transparent: true,
  });
  water.positionNode = source.displacementNode();

  const height = source.heightNode();
  const normal = source.normalNode();
  const facing = normal.dot(SUN).clamp(0, 1);
  const troughToCrest = smoothstep(-0.26, 0.26, height);
  const waterMid = mix(color(palette.skyLow), color(palette.skyHigh), 0.35);
  const body = mix(color(palette.skyLow), waterMid, troughToCrest.mul(0.16).add(0.42));
  const litBody = body.mul(mix(float(0.92), float(1), facing));
  const glint = color(palette.skyHigh).mul(facing.pow(48).mul(0.07));
  const crestFoam = color(palette.player).mul(smoothstep(0.16, 0.26, height).mul(0.025));
  water.colorNode = litBody.add(glint).add(crestFoam);
  return water;
}
