// Generated source. This stage is ordinary Three.js TSL; the engine only orders and measures it.

import {
  cameraFar,
  cameraNear,
  color,
  convertToTexture,
  luminance,
  mix,
  perspectiveDepthToViewZ,
  screenSize,
  screenUV,
  texture,
  vec2,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

export interface IOutlineStageOptions {
  /** The depth attachment written by the scene pass. */
  readonly depthNode: Node;
  /** Ink colour and thresholds are this game's look decisions. */
  readonly inkColor?: number;
  readonly strength?: number;
  readonly threshold?: number;
  readonly softness?: number;
  readonly depthWeight?: number;
}

export interface IOutlineStage {
  readonly after: "bloom";
  readonly build: (input: unknown) => unknown;
  readonly name: "outline";
}

/**
 * Eight-tap Sobel edge ink, normalised to the physical framebuffer pixel size.
 *
 * Colour edges catch the painted prop boundaries while linearised depth catches silhouettes
 * whose two sides happen to have similar colours. The stage samples the original chain input
 * and never owns a material, palette or renderer fallback.
 */
export function createOutlineStage(options: IOutlineStageOptions): IOutlineStage {
  if (!isNode(options.depthNode)) throw new Error("outline depth source is missing");
  const strength = finiteNonNegative(options.strength ?? 0.8, "outline strength");
  const threshold = finiteNonNegative(options.threshold ?? 0.12, "outline threshold");
  const softness = finitePositive(options.softness ?? 0.16, "outline softness");
  const depthWeight = finiteUnit(options.depthWeight ?? 0.65, "outline depthWeight");
  const colourWeight = 1 - depthWeight;
  const ink = color(options.inkColor ?? 0x142331);

  return {
    after: "bloom",
    build: (input) => {
      if (!isNode(input)) throw new Error("outline input is missing");
      if (strength === 0) return input;
      const source = convertToTexture(input);
      const depthSource = texture(options.depthNode as never);
      const texel = screenSize.reciprocal();
      const sampleUv = (x: number, y: number): Node<"vec2"> =>
        screenUV.add(texel.mul(vec2(x, y))).clamp(0, 1) as Node<"vec2">;
      const sampleColour = (x: number, y: number): Node<"float"> =>
        luminance(source.sample(sampleUv(x, y)).rgb);
      const sampleDepth = (x: number, y: number): Node<"float"> =>
        perspectiveDepthToViewZ(depthSource.sample(sampleUv(x, y)).r, cameraNear, cameraFar);

      // Sobel's eight neighbours use physical-pixel offsets, so a resize does not change the
      // apparent line width. This is the same eight-tap neighbourhood for colour and depth.
      const colourX = sampleColour(-1, -1)
        .negate()
        .add(sampleColour(-1, 0).mul(-2))
        .add(sampleColour(-1, 1).negate())
        .add(sampleColour(1, -1))
        .add(sampleColour(1, 0).mul(2))
        .add(sampleColour(1, 1));
      const colourY = sampleColour(-1, -1)
        .negate()
        .add(sampleColour(0, -1).mul(-2))
        .add(sampleColour(1, -1).negate())
        .add(sampleColour(-1, 1))
        .add(sampleColour(0, 1).mul(2))
        .add(sampleColour(1, 1));
      const depthX = sampleDepth(-1, -1)
        .negate()
        .add(sampleDepth(-1, 0).mul(-2))
        .add(sampleDepth(-1, 1).negate())
        .add(sampleDepth(1, -1))
        .add(sampleDepth(1, 0).mul(2))
        .add(sampleDepth(1, 1));
      const depthY = sampleDepth(-1, -1)
        .negate()
        .add(sampleDepth(0, -1).mul(-2))
        .add(sampleDepth(1, -1).negate())
        .add(sampleDepth(-1, 1))
        .add(sampleDepth(0, 1).mul(2))
        .add(sampleDepth(1, 1));
      const centreDepth = sampleDepth(0, 0).abs().max(1);
      const colourEdge = colourX.mul(colourX).add(colourY.mul(colourY)).sqrt();
      const depthEdge = depthX.mul(depthX).add(depthY.mul(depthY)).sqrt().div(centreDepth);
      const edge = colourEdge.mul(colourWeight).add(depthEdge.mul(depthWeight));
      const mask = edge
        .smoothstep(threshold, threshold + softness)
        .mul(strength)
        .clamp(0, 1);
      const base = source.sample(screenUV);
      return mix(base, vec4(ink, base.a), mask);
    },
    name: "outline",
  };
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" && value !== null && (value as { isNode?: boolean }).isNode === true
  );
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be finite and non-negative`);
  return value;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and positive`);
  return value;
}

function finiteUnit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${name} must be finite and between 0 and 1`);
  return value;
}
