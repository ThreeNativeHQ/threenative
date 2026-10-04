// Generated for you: GPU reduction and adaptation; exposure.ts owns the game's look.
import { FloatType, NearestFilter, RenderTarget } from "three";
import {
  Fn,
  If,
  float,
  ivec2,
  mix,
  screenCoordinate,
  smoothstep,
  type texture,
  textureLoad,
  vec2,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { IExposureSettings } from "./exposure.js";

export type ColourTexture = ReturnType<typeof texture>;
export type Meter = (colour: Node<"vec4">, uv: Node<"vec2">) => Node<"vec2">;
export type Decode = (mean: Node<"float">) => Node<"float">;

export function exposureTarget(): RenderTarget {
  return new RenderTarget(1, 1, {
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
  });
}

/** Sum/16 at each level keeps values bounded. Mask partial blocks; never replicate edge texels. */
export function reduceExposure(
  input: ColourTexture,
  size: Node<"vec2">,
  meter?: Meter,
): Node<"vec4"> {
  return Fn(() => {
    const sum = vec2(0).toVar();
    const origin = screenCoordinate.xy.floor().mul(4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const pixel = origin.add(vec2(x, y));
        If(pixel.x.lessThan(size.x).and(pixel.y.lessThan(size.y)), () => {
          const colour = textureLoad(input, ivec2(pixel));
          sum.addAssign(meter === undefined ? colour.rg : meter(colour, pixel.add(0.5).div(size)));
        });
      }
    return vec4(sum.div(16), 0, 1);
  })();
}

export function adaptExposure(
  reduced: ColourTexture,
  previous: ColourTexture,
  resetMode: Node<"float">,
  seed: Node<"float">,
  delta: Node<"float">,
  policy: Readonly<IExposureSettings>,
  decode: Decode,
): Node<"vec4"> {
  return Fn(() => {
    const measure = textureLoad(reduced, ivec2(0));
    const luminance = decode(measure.r.div(measure.g.max(1e-20)));
    const valid = measure.g
      .greaterThan(0)
      .and(luminance.greaterThan(0))
      .and(luminance.lessThan(3.4e38));
    const goal = float(Math.log2(policy.key))
      .sub(luminance.max(1e-20).log2())
      .clamp(policy.minStops, policy.maxStops);
    const old = resetMode.equal(1).select(seed, textureLoad(previous, ivec2(0)).r);
    const error = goal.sub(old);
    const rate = error.greaterThan(0).select(float(policy.rateUp), float(policy.rateDown));
    const normal = float(1).sub(delta.mul(rate).negate().exp());
    const cut = smoothstep(policy.snapLo, policy.snapHi, error.abs()).mul(policy.snapGain);
    const adapted = valid.select(
      resetMode.equal(2).select(goal, mix(old, goal, mix(normal, float(1), cut))),
      old,
    );
    const settled = goal.sub(adapted).abs().lessThanEqual(policy.settleStops).select(1, 0);
    return vec4(adapted, valid.select(luminance, -1), goal, settled);
  })();
}
