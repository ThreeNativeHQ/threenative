// Copyright 2023 Sony Interactive Entertainment.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// Modified: ported to TypeScript for ThreeNative

export const CONTACT_SHADOW_WAVE_SIZE = 64;
export const CONTACT_SHADOW_MAX_DISPATCHES = 8;

export interface IContactShadowDispatch {
  /** Workgroup counts [x, y, z]: x walks along the ray, y and z tile the wavefronts. */
  readonly groups: readonly [number, number, number];
  /** Pixel offset of this dispatch's first wavefront, already multiplied by the wave size. */
  readonly waveOffset: readonly [number, number];
}

export interface IContactShadowDispatchList {
  /** Light pixel x, light pixel y, light depth, +1 for w > 0 else -1. */
  readonly lightCoordinate: readonly [number, number, number, number];
  readonly dispatches: readonly IContactShadowDispatch[];
}

export interface IContactShadowDispatchOptions {
  /** Inclusive pixel bounds. Default: the whole viewport. */
  readonly bounds?: {
    readonly min: readonly [number, number];
    readonly max: readonly [number, number];
  };
  /** Map API clip z in [-1, 1] to depth in [0, 1]. Default false. */
  readonly expandedZRange?: boolean;
  /** Default CONTACT_SHADOW_WAVE_SIZE. */
  readonly waveSize?: number;
}

/** Clip-space light position: viewProjection * (direction, 0) for a directional light. */
export function buildContactShadowDispatchList(
  lightProjection: readonly [number, number, number, number],
  viewport: { readonly width: number; readonly height: number },
  options: IContactShadowDispatchOptions = {},
): IContactShadowDispatchList {
  const waveSize = options.waveSize ?? CONTACT_SHADOW_WAVE_SIZE;
  for (const [name, value] of [
    ["viewport.width", viewport.width],
    ["viewport.height", viewport.height],
    ["waveSize", waveSize],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }
  if (
    lightProjection.length !== 4 ||
    Array.from(lightProjection).some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError("lightProjection must contain four finite components");
  }
  const { min, max } = options.bounds ?? {
    min: [0, 0] as const,
    max: [viewport.width - 1, viewport.height - 1] as const,
  };
  for (const axis of [0, 1] as const) {
    if (!Number.isInteger(min[axis]) || !Number.isInteger(max[axis]) || min[axis] > max[axis]) {
      throw new TypeError("bounds must contain integer min <= max on each axis");
    }
  }

  let xyLightW = lightProjection[3];
  const floatingPointLimit = 0.000002 * waveSize;
  if (xyLightW >= 0 && xyLightW < floatingPointLimit) xyLightW = floatingPointLimit;
  else if (xyLightW < 0 && xyLightW > -floatingPointLimit) xyLightW = -floatingPointLimit;

  // The kernel reads this as a float32 uniform, so round it here: floor() must agree on both sides.
  const lightCoordinate: [number, number, number, number] = [
    Math.fround(((lightProjection[0] / xyLightW) * 0.5 + 0.5) * viewport.width),
    Math.fround(((lightProjection[1] / xyLightW) * -0.5 + 0.5) * viewport.height),
    Math.fround(lightProjection[3] === 0 ? 0 : lightProjection[2] / lightProjection[3]),
    lightProjection[3] > 0 ? 1 : -1,
  ];
  if (options.expandedZRange) lightCoordinate[2] = lightCoordinate[2] * 0.5 + 0.5;
  // The kernel measures every wavefront from the centre of pixel floor(light), so the bounds
  // are made relative to that pixel too. The upstream CPU code rounds instead, which is one pixel
  // off whenever the fraction is 0.5 or more and is only hidden by passing max = viewport size.
  const lightX = Math.floor(lightCoordinate[0]);
  const lightY = Math.floor(lightCoordinate[1]);
  const biasedBounds = [
    min[0] - lightX,
    -(max[1] - lightY),
    max[0] - lightX,
    -(min[1] - lightY),
  ] as const;
  const dispatches: IContactShadowDispatch[] = [];

  for (let q = 0; q < 4; q++) {
    const vertical = q === 0 || q === 3;
    const bounds = [
      Math.trunc(Math.max(0, q & 1 ? biasedBounds[0] : -biasedBounds[2]) / waveSize),
      Math.trunc(Math.max(0, q & 2 ? biasedBounds[1] : -biasedBounds[3]) / waveSize),
      Math.trunc(
        Math.max(
          0,
          (q & 1 ? biasedBounds[2] : -biasedBounds[0]) + waveSize * (vertical ? 1 : 2) - 1,
        ) / waveSize,
      ),
      Math.trunc(
        Math.max(
          0,
          (q & 2 ? biasedBounds[3] : -biasedBounds[1]) + waveSize * (vertical ? 2 : 1) - 1,
        ) / waveSize,
      ),
    ] as const;
    if (bounds[2] - bounds[0] <= 0 || bounds[3] - bounds[1] <= 0) continue;
    const disp: { groups: [number, number, number]; waveOffset: [number, number] } = {
      groups: [waveSize, bounds[2] - bounds[0], bounds[3] - bounds[1]],
      waveOffset: [
        (q & 1 ? bounds[0] : -bounds[2]) + (q === 2 || q === 3 ? 1 : 0),
        (q & 2 ? -bounds[3] : bounds[1]) + (q === 1 || q === 3 ? 1 : 0),
      ],
    };
    let axisDelta = biasedBounds[0] - biasedBounds[1];
    if (q === 1) axisDelta = biasedBounds[2] + biasedBounds[1];
    if (q === 2) axisDelta = -biasedBounds[0] - biasedBounds[3];
    if (q === 3) axisDelta = -biasedBounds[2] + biasedBounds[3];
    axisDelta = Math.trunc((axisDelta + waveSize - 1) / waveSize);
    const quadrantDispatches = [disp];
    if (axisDelta > 0) {
      const disp2 = {
        groups: [...disp.groups] as [number, number, number],
        waveOffset: [...disp.waveOffset] as [number, number],
      };
      if (q === 0) {
        disp2.groups[2] = Math.min(disp.groups[2], axisDelta);
        disp.groups[2] -= disp2.groups[2];
        disp2.waveOffset[1] = disp.waveOffset[1] + disp.groups[2];
        disp2.waveOffset[0]--;
        disp2.groups[1]++;
      }
      if (q === 1) {
        disp2.groups[1] = Math.min(disp.groups[1], axisDelta);
        disp.groups[1] -= disp2.groups[1];
        disp2.waveOffset[0] = disp.waveOffset[0] + disp.groups[1];
        disp2.groups[2]++;
      }
      if (q === 2) {
        disp2.groups[1] = Math.min(disp.groups[1], axisDelta);
        disp.groups[1] -= disp2.groups[1];
        disp.waveOffset[0] += disp2.groups[1];
        disp2.groups[2]++;
        disp2.waveOffset[1]--;
      }
      if (q === 3) {
        disp2.groups[2] = Math.min(disp.groups[2], axisDelta);
        disp.groups[2] -= disp2.groups[2];
        disp.waveOffset[1] += disp2.groups[2];
        disp2.groups[1]++;
      }
      quadrantDispatches.push(disp2);
    }
    for (const dispatch of quadrantDispatches) {
      if (dispatch.groups[1] <= 0 || dispatch.groups[2] <= 0) continue;
      dispatch.waveOffset[0] *= waveSize;
      dispatch.waveOffset[1] *= waveSize;
      dispatches.push(dispatch);
    }
  }
  return { lightCoordinate, dispatches };
}

/** Plain-TypeScript ComputeWavefrontExtents reference, returning the kernel's floor(pixel_xy). */
export function contactShadowWritePixel(
  list: Pick<IContactShadowDispatchList, "lightCoordinate">,
  dispatch: IContactShadowDispatch,
  group: readonly [number, number, number],
  thread: number,
  waveSize = CONTACT_SHADOW_WAVE_SIZE,
): readonly [number, number] {
  let x = group[1] * waveSize + dispatch.waveOffset[0];
  let y = group[2] * waveSize + dispatch.waveOffset[1];
  const lightX = Math.floor(list.lightCoordinate[0]) + 0.5;
  const lightY = Math.floor(list.lightCoordinate[1]) + 0.5;
  const fractionX = list.lightCoordinate[0] - lightX;
  const fractionY = list.lightCoordinate[1] - lightY;
  const signX = Math.sign(x);
  const signY = Math.sign(y);
  const horizontal = Math.abs(x + signY) < Math.abs(y - signX);
  x += (horizontal ? signY : 0) * group[0];
  y += (horizontal ? 0 : -signX) * group[0];
  const majorAxis = Math.abs(x) > Math.abs(y) ? x : y;
  let majorLightFraction = Math.abs(x) > Math.abs(y) ? fractionX : fractionY;
  majorLightFraction = majorAxis > 0 ? -majorLightFraction : majorLightFraction;
  const startX = x + lightX;
  const startY = y + lightY;
  const ratio =
    (Math.abs(majorAxis) - waveSize + majorLightFraction) /
    (Math.abs(majorAxis) + majorLightFraction);
  const endX = list.lightCoordinate[0] + (startX - list.lightCoordinate[0]) * ratio;
  const endY = list.lightCoordinate[1] + (startY - list.lightCoordinate[1]) * ratio;
  const threadStep = thread ^ (list.lightCoordinate[3] > 0 ? 0 : waveSize - 1);
  return [
    Math.floor(startX + (endX - startX) * (threadStep / waveSize)),
    Math.floor(startY + (endY - startY) * (threadStep / waveSize)),
  ];
}

/** Column-major viewProjection (three's Matrix4.elements) times (direction, 0). */
export function contactShadowLightProjection(
  viewProjection: ArrayLike<number>,
  directionToLight: { readonly x: number; readonly y: number; readonly z: number },
): [number, number, number, number] {
  if (
    viewProjection.length !== 16 ||
    Array.from(viewProjection).some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError("viewProjection must contain 16 finite components");
  }
  const { x, y, z } = directionToLight;
  if (![x, y, z].every(Number.isFinite)) {
    throw new TypeError("directionToLight must contain finite components");
  }
  return [0, 1, 2, 3].map(
    (row) =>
      (viewProjection[row] as number) * x +
      (viewProjection[row + 4] as number) * y +
      (viewProjection[row + 8] as number) * z,
  ) as [number, number, number, number];
}
