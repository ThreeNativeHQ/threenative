// Generated source: the starter owns this painterly algorithm and may replace it freely.
import { HalfFloatType } from "three";
import * as tsl from "three/tsl";
import type { Node } from "three/webgpu";
export interface IKernelOffset {
  readonly x: number;
  readonly y: number;
}
export interface IKuwaharaStageOptions {
  readonly anisotropy?: number;
  readonly radius?: number;
  readonly resolutionScale?: number;
  readonly strength?: number;
}
export interface IKuwaharaStage {
  readonly after: "outline";
  readonly build: (input: unknown) => unknown;
  readonly dispose: () => void;
  readonly minimumTier: "medium";
  readonly name: "kuwahara";
}
/** The signless principal axis of a 2×2 structure tensor. */
export function tensorOrientation(xx: number, xy: number, yy: number): number {
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}
/** Applies rotation × anisotropic scale to a column vector, in that order. */
export function transformKernelOffset(
  offset: IKernelOffset,
  orientation: number,
  anisotropy: number,
): IKernelOffset {
  const major = 1 + anisotropy;
  const minor = 1 - anisotropy;
  const scaledX = offset.x * major;
  const scaledY = offset.y * minor;
  const axisX = Math.cos(orientation);
  const axisY = Math.sin(orientation);
  return {
    x: axisX * scaledX - axisY * scaledY,
    y: axisY * scaledX + axisX * scaledY,
  };
}
export function createKuwaharaStage(options: IKuwaharaStageOptions = {}): IKuwaharaStage {
  const anisotropy = finiteRange(options.anisotropy ?? 0.72, 0, 1, false, "kuwahara anisotropy");
  const radius = boundedRadius(options.radius ?? 5);
  const resolutionScale = finiteRange(
    options.resolutionScale ?? 0.5,
    0,
    1,
    true,
    "kuwahara resolutionScale",
  );
  const strength = finiteRange(options.strength ?? 0.82, 0, 1, false, "kuwahara strength");
  let scratches: IScratchTexture[] = [];
  const dispose = (): void => {
    for (const scratch of scratches) scratch.dispose();
    scratches = [];
  };
  return {
    after: "outline",
    build: (input) => {
      if (!isNode(input)) throw new Error("kuwahara input is missing");
      if (strength === 0) return input;
      dispose();
      const source = tsl.convertToTexture(input) as unknown as ITextureNode;
      const texel = tsl.screenSize.reciprocal();
      const sampleUv = (x: Node<"float"> | number, y: Node<"float"> | number): Node<"vec2"> =>
        tsl.screenUV.add(texel.mul(tsl.vec2(x, y))).clamp(0, 1) as Node<"vec2">;
      const sampleColour = (x: number, y: number): Node<"float"> =>
        tsl.luminance(source.sample(sampleUv(x, y)).rgb);
      const gradientX = sampleColour(1, 0).sub(sampleColour(-1, 0)).mul(0.5);
      const gradientY = sampleColour(0, 1).sub(sampleColour(0, -1)).mul(0.5);
      const tensor = makeHalfFloatScratch(
        tsl.vec4(gradientX.mul(gradientX), gradientX.mul(gradientY), gradientY.mul(gradientY), 1),
        resolutionScale,
      );
      scratches.push(tensor);
      const tensorSample = tensor.texture.sample(tsl.screenUV);
      const orientation = tsl.atan(tensorSample.y.mul(2), tensorSample.x.sub(tensorSample.z));
      const axis = tsl.vec2(tsl.cos(orientation), tsl.sin(orientation));
      const sector = (sectorIndex: number): ISectorStats => {
        let mean: Node<"vec3"> = tsl.vec3(0);
        let secondMoment: Node<"vec3"> = tsl.vec3(0);
        const angle = (sectorIndex / 8) * Math.PI * 2;
        for (let radial = 1; radial <= radius; radial += 1) {
          const offset = transformKernelOffsetNode(
            tsl.vec2(Math.cos(angle), Math.sin(angle)).mul(radial),
            axis,
            anisotropy,
          );
          const colour = source.sample(sampleUv(offset.x, offset.y)).rgb;
          mean = mean.add(colour);
          secondMoment = secondMoment.add(colour.mul(colour));
        }
        const count = radius;
        const average = mean.div(count);
        const variance = secondMoment.div(count).sub(average.mul(average)).max(0);
        return { mean: average, score: tsl.luminance(variance) };
      };
      let best = sector(0);
      for (let sectorIndex = 1; sectorIndex < 8; sectorIndex += 1) {
        const candidate = sector(sectorIndex);
        const candidateWins = candidate.score.lessThan(best.score);
        best = {
          mean: tsl.select(candidateWins, candidate.mean, best.mean) as Node<"vec3">,
          score: tsl.select(candidateWins, candidate.score, best.score) as Node<"float">,
        };
      }
      const base = source.sample(tsl.screenUV);
      const paint = makeHalfFloatScratch(tsl.vec4(best.mean, base.a), resolutionScale);
      scratches.push(paint);
      return mixColour(base, paint.texture.sample(tsl.screenUV).rgb, strength);
    },
    dispose,
    minimumTier: "medium",
    name: "kuwahara",
  };
}
interface IScratchTexture {
  readonly texture: Node<"vec4"> & { sample(uv: Node<"vec2">): Node<"vec4"> };
  dispose: () => void;
}
interface ISectorStats {
  readonly mean: Node<"vec3">;
  readonly score: Node<"float">;
}
interface ITextureNode extends Node<"vec4"> {
  sample(uv: Node<"vec2">): Node<"vec4">;
}
function makeHalfFloatScratch(node: Node<"vec4">, resolutionScale: number): IScratchTexture {
  let scratch: IRawScratch | undefined;
  try {
    scratch = tsl.rtt(node, null, null, { type: HalfFloatType }) as unknown as IRawScratch;
    scratch.setResolutionScale(resolutionScale);
  } catch (error) {
    scratch?.renderTarget.dispose();
    throw new Error(
      `kuwahara scratch allocation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (scratch.renderTarget.texture.type !== HalfFloatType) {
    scratch.renderTarget.dispose();
    throw new Error("kuwahara scratch format is not half-float");
  }
  let released = false;
  return {
    texture: scratch,
    dispose: () => {
      if (released) return;
      released = true;
      scratch.renderTarget.dispose();
    },
  };
}
interface IRawScratch extends ITextureNode {
  readonly renderTarget: { readonly texture: { readonly type: number }; dispose: () => void };
  setResolutionScale(scale: number): void;
}
function transformKernelOffsetNode(
  offset: Node<"vec2">,
  axis: Node<"vec2">,
  anisotropy: number,
): Node<"vec2"> {
  // This is R × S × v. Reversing it to v × S × R makes strokes screen-aligned.
  const scaled = tsl.vec2(offset.x.mul(1 + anisotropy), offset.y.mul(1 - anisotropy));
  return tsl.vec2(
    axis.x.mul(scaled.x).sub(axis.y.mul(scaled.y)),
    axis.y.mul(scaled.x).add(axis.x.mul(scaled.y)),
  );
}
function mixColour(base: Node<"vec4">, paint: Node<"vec3">, strength: number): Node<"vec4"> {
  return tsl.mix(base, tsl.vec4(paint, base.a), strength) as Node<"vec4">;
}
function boundedRadius(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 9)
    throw new Error("kuwahara radius must be an integer from 1 through 9");
  return value;
}
function finiteRange(
  value: number,
  minimum: number,
  maximum: number,
  exclusiveMinimum: boolean,
  name: string,
): number {
  const lower = exclusiveMinimum ? value <= minimum : value < minimum;
  if (!Number.isFinite(value) || lower || value > maximum)
    throw new Error(
      `${name} must be finite and in ${exclusiveMinimum ? "(0" : "[0"}..${String(maximum)}]`,
    );
  return value;
}
function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" && value !== null && (value as { isNode?: boolean }).isNode === true
  );
}
