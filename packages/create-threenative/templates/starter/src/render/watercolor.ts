// Generated source: the starter owns this value treatment and paper field.

import { color, convertToTexture, float, hash, luminance, mix, screenUV, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";

export interface IWatercolorStageOptions {
  readonly levels?: number;
  readonly paperStrength?: number;
  readonly shadowStrength?: number;
  readonly shadowTint?: number;
  readonly strength?: number;
}

export interface IWatercolorStage {
  readonly after: "kuwahara";
  readonly build: (input: unknown) => unknown;
  readonly dispose: () => void;
  readonly minimumTier: "medium";
  readonly name: "watercolor";
}

/** Luminance grouping plus deterministic procedural paper tooth. */
export function createWatercolorStage(options: IWatercolorStageOptions = {}): IWatercolorStage {
  const levels = boundedInteger(options.levels ?? 8, 2, 16, "watercolor levels");
  const paperStrength = unit(options.paperStrength ?? 0.2, "watercolor paperStrength");
  const shadowStrength = unit(options.shadowStrength ?? 0.16, "watercolor shadowStrength");
  const strength = unit(options.strength ?? 0.72, "watercolor strength");
  const shadowTint = color(options.shadowTint ?? 0x6d5a52);

  return {
    after: "kuwahara",
    build: (input) => {
      if (!isNode(input)) throw new Error("watercolor input is missing");
      if (strength === 0) return input;
      const source = convertToTexture(input) as unknown as ITextureNode;
      const base = source.sample(screenUV);
      const sceneLuminance = luminance(base.rgb);
      // Quantise one scalar and apply its ratio to the full colour vector; never quantise RGB
      // channels independently, which would drift the hue at every value step.
      const stepped = sceneLuminance.mul(levels).floor().add(0.5).div(levels).clamp(0, 1);
      const grouped = base.rgb.mul(stepped.div(sceneLuminance.max(0.0001)));
      const shadow = sceneLuminance.smoothstep(0.04, 0.56).oneMinus().mul(shadowStrength);
      const shaded = mix(grouped, grouped.mul(shadowTint), shadow);
      const paper = mix(float(1), paperField(), paperStrength);
      const painted = shaded.mul(paper);
      return mix(base, vec4(painted, base.a), strength) as Node<"vec4">;
    },
    dispose: () => undefined,
    minimumTier: "medium",
    name: "watercolor",
  };
}

interface ITextureNode extends Node<"vec4"> {
  sample(uv: Node<"vec2">): Node<"vec4">;
}

function paperField(): Node<"float"> {
  const fine = hash(screenUV.x.mul(173).add(screenUV.y.mul(271)));
  const broad = hash(screenUV.x.mul(31).add(screenUV.y.mul(47)));
  return fine.mul(0.65).add(broad.mul(0.35)).sub(0.5).mul(0.16).add(1);
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${name} must be an integer from ${String(minimum)} through ${String(maximum)}`,
    );
  return value;
}

function unit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${name} must be finite and between 0 and 1`);
  return value;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" && value !== null && (value as { isNode?: boolean }).isNode === true
  );
}
