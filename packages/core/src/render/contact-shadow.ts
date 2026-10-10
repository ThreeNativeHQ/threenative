// Screen-space contact shadows: TSL port of Bend Studio's Screen Space Shadows (bend_sss_gpu.h).
//
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
//
// Modified: ported from HLSL to three.js TSL for ThreeNative. Wave intrinsics are replaced by a
// workgroup-memory flag, the clamp-to-border sampler by a bounds-checked texture load, and the
// output is a storage texture the game reads as a mask. See THIRD_PARTY_NOTICES.md.

import { Matrix4, Vector2, Vector3, Vector4 } from "three";
import type { Camera } from "three";
import {
  Fn,
  If,
  abs,
  clamp,
  float,
  floor,
  fract,
  int,
  ivec2,
  localId,
  min,
  mix,
  nodeObject,
  screenCoordinate,
  sign,
  textureLoad,
  textureStore,
  uint,
  uniform,
  uvec2,
  vec2,
  vec4,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
} from "three/tsl";
import { Node, NodeUpdateType, StorageTexture } from "three/webgpu";
import type { ComputeNode, NodeBuilder, NodeFrame } from "three/webgpu";
import {
  CONTACT_SHADOW_MAX_DISPATCHES,
  CONTACT_SHADOW_WAVE_SIZE,
  buildContactShadowDispatchList,
  contactShadowLightProjection,
} from "./contact-shadow-dispatch.js";
import type { IContactShadowDispatchOptions } from "./contact-shadow-dispatch.js";

/**
 * A TSL value this module builds its kernel from.
 *
 * Three's node types are precise about swizzles and vague about what a workgroup element or a
 * texture load resolves to, and the kernel is arithmetic on exactly those. The cast stays here.
 */
// quality-allow: the kernel is a typed handle onto three's TSL nodes, which resolve to `any` in 0.185.
// biome-ignore lint/suspicious/noExplicitAny: three's TSL types refuse the chains this kernel reads.
type Kernel = any;

/** One TSL value, without the type noise. */
function nodes(value: unknown): Kernel {
  return value as Kernel;
}

/** What the kernel needs from the scene pass: a depth texture node it can `textureLoad`. */
export interface IContactShadowDepth {
  /** A TSL texture node holding the pass's raw (non-linear) depth, e.g. `scenePass.getTextureNode("depth")`. */
  readonly node: unknown;
  /** The depth texture's size in pixels, read each frame. */
  readonly size: () => { readonly width: number; readonly height: number };
}

/**
 * Everything the mechanism needs and nothing about the look. The thicknesses, the length in pixels
 * and the contrast are the game's, so every one of them is required.
 */
export interface IContactShadowOptions {
  readonly depth: IContactShadowDepth;
  /** The camera the depth was rendered with. Its current matrices are read every frame. */
  readonly camera: Camera;
  /** World-space direction from the surface toward the light, read every frame. */
  readonly direction: () => { readonly x: number; readonly y: number; readonly z: number };
  /** Shadow length in screen pixels. Also the cost: one depth sample per pixel of length. */
  readonly sampleCount: number;
  /** The first samples, which cast a hard (not averaged) shadow. At most `sampleCount`. */
  readonly hardSamples: number;
  /** The last samples, which fade the shadow out. At most `sampleCount - hardSamples`. */
  readonly fadeSamples: number;
  /** Assumed thickness of a pixel as a fraction of the remaining depth range. Live-tunable. */
  readonly surfaceThickness: number;
  /** Depth difference, as a fraction, above which two neighbouring depths are an edge. Live-tunable. */
  readonly bilinearThreshold: number;
  /** Boost on the in/out-of-shadow transition. At least 1. Live-tunable. */
  readonly contrast: number;
  /** When true, an edge pixel does not cast. Default false. */
  readonly ignoreEdgePixels?: boolean;
  /** True when the renderer's depth buffer is reversed (far 0, near 1). Default false. */
  readonly reversedDepth?: boolean;
  /** Pixels whose depth is outside (min, max) are skipped. Default (0, 1): sky and near plane. */
  readonly depthBounds?: readonly [number, number];
  /** Pixel bounds the shadow is wanted in. Default: the whole depth texture. */
  readonly bounds?: IContactShadowDispatchOptions["bounds"];
}

interface ISlot {
  readonly compute: ComputeNode;
  readonly waveOffset: ReturnType<typeof uniform>;
}

function checkedCount(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`contactShadow ${name} must be an integer >= ${String(minimum)}.`);
  return value;
}

function checkedNumber(name: string, value: number, minimum: number, strict: boolean): number {
  if (!Number.isFinite(value) || (strict ? value <= minimum : value < minimum))
    throw new Error(
      `contactShadow ${name} must be a finite number ${strict ? ">" : ">="} ${String(minimum)}.`,
    );
  return value;
}

/**
 * The contact-shadow mask as a TSL node.
 *
 * Evaluating the node reads the mask at the fragment's screen pixel: `1` is lit and `0` is
 * shadowed, in `.r`. The compute dispatches run in `updateBefore`, once a frame, from the depth the
 * scene pass has already written. The module applies nothing: the game multiplies the mask into
 * whatever it chooses.
 */
export class ContactShadowNode extends Node {
  /** Live-tunable, in the units of {@link IContactShadowOptions}. */
  readonly surfaceThickness = uniform(0);
  readonly bilinearThreshold = uniform(0);
  readonly contrast = uniform(1);

  readonly #options: IContactShadowOptions;
  readonly #output = new StorageTexture(1, 1);
  readonly #lightCoordinate = uniform(new Vector4());
  readonly #size = uniform(new Vector2(1, 1));
  readonly #slots: ISlot[] = [];
  readonly #viewProjection = new Matrix4();
  readonly #direction = new Vector3();
  readonly #wave = CONTACT_SHADOW_WAVE_SIZE;
  #disposed = false;

  constructor(options: IContactShadowOptions) {
    super("vec4");
    const reads = checkedCount("sampleCount", options.sampleCount, 1);
    const hard = checkedCount("hardSamples", options.hardSamples, 0);
    const fade = checkedCount("fadeSamples", options.fadeSamples, 0);
    if (hard + fade > reads)
      throw new Error("contactShadow hardSamples + fadeSamples must not exceed sampleCount.");
    checkedNumber("surfaceThickness", options.surfaceThickness, 0, true);
    checkedNumber("bilinearThreshold", options.bilinearThreshold, 0, false);
    checkedNumber("contrast", options.contrast, 1, false);
    this.#options = options;
    this.surfaceThickness.value = options.surfaceThickness;
    this.bilinearThreshold.value = options.bilinearThreshold;
    this.contrast.value = options.contrast;
    this.#output.generateMipmaps = false;
    this.#output.minFilter = this.#output.magFilter = 1003; // NearestFilter: the mask is read per pixel
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  /** The mask texture, `.r` is the term. Resized to the depth texture on the first frame. */
  get texture(): StorageTexture {
    return this.#output;
  }

  override setup(_builder: NodeBuilder): Node<"vec4"> {
    const pixel = ivec2(nodes(screenCoordinate).xy);
    return nodes(textureLoad(this.#output, pixel));
  }

  override updateBefore(frame: NodeFrame): undefined {
    if (this.#disposed) throw new Error("Contact shadow is disposed.");
    const renderer = frame.renderer;
    if (renderer === null) throw new Error("Contact shadow requires a renderer.");
    const { width, height } = this.#options.depth.size();
    if (!(width >= 1 && height >= 1)) return;
    if (this.#size.value.x !== width || this.#size.value.y !== height) {
      this.#size.value.set(width, height);
      this.#output.setSize(width, height, 1);
    }
    const camera = this.#options.camera;
    this.#viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const toLight = this.#options.direction();
    this.#direction.set(toLight.x, toLight.y, toLight.z);
    const list = buildContactShadowDispatchList(
      contactShadowLightProjection(this.#viewProjection.elements, this.#direction),
      { height, width },
      { bounds: this.#options.bounds, waveSize: this.#wave },
    );
    this.#lightCoordinate.value.set(...list.lightCoordinate);
    const active: ComputeNode[] = [];
    for (const [index, dispatch] of list.dispatches.entries()) {
      const slot = this.#slot(index);
      nodes(slot.waveOffset.value).set(dispatch.waveOffset[0], dispatch.waveOffset[1]);
      nodes(slot.compute).dispatchSize = [...dispatch.groups];
      active.push(slot.compute);
    }
    if (active.length > 0) renderer.compute(active);
    return undefined;
  }

  override dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const slot of this.#slots) slot.compute.dispose();
    this.#slots.length = 0;
    this.#output.dispose();
    super.dispose();
  }

  #slot(index: number): ISlot {
    if (index >= CONTACT_SHADOW_MAX_DISPATCHES)
      throw new Error("contactShadow dispatch list exceeds the maximum.");
    const made = this.#slots[index];
    if (made !== undefined) return made;
    const waveOffset = uniform(new Vector2());
    const compute = this.#kernel(waveOffset);
    compute.name = `tnContactShadow${String(index)}`;
    const slot = { compute, waveOffset };
    this.#slots[index] = slot;
    return slot;
  }

  /**
   * One dispatch of the shadow kernel. The same shader for every slot: only the wave-offset uniform
   * and the group counts differ, so three compiles one pipeline.
   *
   * The kernel follows the upstream order: wavefront addressing, depth reads into thread registers,
   * the shadowing depths into workgroup memory, a barrier, then each pixel walks the shared strip.
   * Two barriers sit on uniform control flow only. The group early-out is a workgroup flag read
   * after the first barrier and applied as a branch around the work, never as a return, because a
   * return that depends on workgroup memory makes every later barrier non-uniform.
   */
  #kernel(waveOffset: unknown): ComputeNode {
    const options = this.#options;
    const wave = this.#wave;
    const reads = Math.floor(options.sampleCount / wave) + 2;
    const hardSamples = options.hardSamples;
    const fadeSamples = options.fadeSamples;
    const sampleCount = options.sampleCount;
    const reversed = options.reversedDepth === true;
    const farDepth = reversed ? 0 : 1;
    const zSign = reversed ? -1 : 1;
    const ignoreEdges = options.ignoreEdgePixels === true;
    const [boundsMin, boundsMax] = options.depthBounds ?? [0, 1];
    const depthNode = options.depth.node;
    const output = this.#output;
    const light = nodes(this.#lightCoordinate);
    const size = nodes(this.#size);
    const thickness = nodes(this.surfaceThickness);
    const threshold = nodes(this.bilinearThreshold);
    const contrast = nodes(this.contrast);
    const strip = nodes(workgroupArray("float", reads * wave));
    const flag = nodes(workgroupArray("uint", 1));

    return Fn(() => {
      // Wavefront addressing: the port of ComputeWavefrontExtents. Small integers throughout, so
      // float arithmetic is exact until the final lerps.
      const groupXY = vec2(float(workgroupId.y), float(workgroupId.z));
      const cell = nodes(groupXY.mul(wave).add(nodes(waveOffset))).toVar();
      const lightXY = nodes(floor(light.xy).add(0.5)).toVar();
      const lightFraction = nodes(light.xy.sub(lightXY)).toVar();
      const reverse = light.w.greaterThan(0);
      const signs = nodes(sign(cell)).toVar();
      const horizontal = abs(cell.x.add(signs.y)).lessThan(abs(cell.y.sub(signs.x)));
      const axis = vec2(
        horizontal.select(signs.y, float(0)),
        horizontal.select(float(0), signs.x.negate()),
      );
      const xy = nodes(axis.mul(float(workgroupId.x)).add(cell)).toVar();
      const xMajor = abs(xy.x).greaterThan(abs(xy.y));
      const major = xMajor.select(xy.x, xy.y);
      const majorStart = nodes(abs(major)).toVar();
      const majorEnd = majorStart.sub(wave);
      const fractionRaw = xMajor.select(lightFraction.x, lightFraction.y);
      const fraction = nodes(
        major.greaterThan(0).select(fractionRaw.negate(), fractionRaw),
      ).toVar();
      const startXY = nodes(xy.add(lightXY)).toVar();
      const endXY = nodes(
        mix(light.xy, startXY, majorEnd.add(fraction).div(majorStart.add(fraction))),
      ).toVar();
      const stepXY = nodes(startXY.sub(endXY)).toVar();
      const threadFloat = float(localId.x);
      const threadStep = reverse.select(threadFloat, float(wave - 1).sub(threadFloat));
      const pixelDistance = nodes(majorStart.sub(threadStep).add(fraction)).toVar();
      let pixelXY = nodes(mix(startXY, endXY, threadStep.div(wave))).toVar();
      const writeXY = nodes(floor(pixelXY)).toVar();
      const direction = nodes(light.w.negate()).toVar();

      // Out of the texture reads as the far depth: the bounds-checked stand-in for a border sampler.
      const read = (x: Kernel, y: Kernel): Kernel =>
        x
          .greaterThanEqual(0)
          .and(x.lessThan(size.x))
          .and(y.greaterThanEqual(0))
          .and(y.lessThan(size.y))
          .select(
            nodes(
              textureLoad(
                depthNode as never,
                ivec2(int(clamp(x, 0, size.x.sub(1))), int(clamp(y, 0, size.y.sub(1)))),
              ),
            ).r,
            float(farDepth),
          );

      const sampling: Kernel[] = [];
      const shadowing: Kernel[] = [];
      const scale: Kernel[] = [];
      const distance: Kernel[] = [];
      for (let i = 0; i < reads; i += 1) {
        sampling.push(float(0).toVar());
        shadowing.push(float(0).toVar());
        scale.push(float(0).toVar());
        distance.push(float(0).toVar());
      }

      // Each thread's own depth and the group's early-out decision come first, so a group that is
      // all sky pays for one read and no strip.
      const readSample = (i: number): void => {
        const readX = nodes(floor(pixelXY.x));
        const readY = nodes(floor(pixelXY.y));
        const minor = xMajor.select(pixelXY.y, pixelXY.x);
        const bias = fract(minor).sub(0.5).greaterThan(0).select(float(1), float(-1));
        const near = read(readX, readY);
        const other = read(
          readX.add(xMajor.select(float(0), bias)),
          readY.add(xMajor.select(bias, float(0))),
        );
        scale[i].assign(abs(near.sub(farDepth)));
        const usePoint = abs(near.sub(other)).greaterThan(scale[i].mul(threshold));
        sampling[i].assign(near);
        const edgeDepth = ignoreEdges ? float(1e20) : near;
        shadowing[i].assign(usePoint.select(edgeDepth, near.add(abs(near.sub(other)).mul(zSign))));
        distance[i].assign(pixelDistance.add(direction.mul(wave * i)));
        pixelXY = nodes(pixelXY.add(stepXY.mul(direction))).toVar();
      };
      const store = (i: number): void => {
        let stored = shadowing[i].sub(light.z).div(distance[i]);
        if (i !== 0) stored = distance[i].greaterThan(0).select(stored, float(1e10));
        strip.element(int(localId.x).add(i * wave)).assign(stored);
      };

      readSample(0);
      store(0);
      const skip = sampling[0].greaterThanEqual(boundsMax).or(sampling[0].lessThanEqual(boundsMin));
      If(skip.not(), () => {
        flag.element(int(0)).assign(uint(1));
      });
      workgroupBarrier();
      const groupActive = flag.element(int(0)).equal(uint(1));
      If(groupActive, () => {
        for (let i = 1; i < reads; i += 1) {
          readSample(i);
          store(i);
        }
      });
      workgroupBarrier();

      const result = float(1).toVar();
      If(groupActive.and(skip.not()), () => {
        const start = nodes(sampling[0].sub(light.z).div(distance[0])).toVar();
        const first = int(localId.x).add(1);
        const depthScale = nodes(
          min(distance[0].add(direction), float(1).div(thickness)).mul(distance[0]).div(scale[0]),
        ).toVar();
        const origin = nodes(start.mul(depthScale).sub(zSign)).toVar();
        const delta = (i: number): Kernel =>
          abs(origin.sub(strip.element(first.add(i)).mul(depthScale)));
        let hard: Kernel = float(1);
        for (let i = 0; i < hardSamples; i += 1) hard = min(hard, delta(i));
        const shadow: Kernel[] = [float(1), float(1), float(1), float(1)];
        const fadeStart = sampleCount - fadeSamples;
        for (let i = hardSamples; i < sampleCount; i += 1) {
          const fade = i >= fadeStart ? ((i + 1 - fadeStart) / (fadeSamples + 1)) * 0.75 : 0;
          shadow[i & 3] = min(shadow[i & 3], fade === 0 ? delta(i) : delta(i).add(fade));
        }
        const boosted = (value: Kernel): Kernel =>
          nodes(value.mul(contrast).add(float(1).sub(contrast))).clamp(0, 1);
        const average = boosted(shadow[0])
          .add(boosted(shadow[1]))
          .add(boosted(shadow[2]))
          .add(boosted(shadow[3]))
          .mul(0.25);
        result.assign(min(boosted(hard), average));
      });

      // A pixel nothing shadowed still has to be written: the texture is not cleared between frames.
      const px = nodes(writeXY.x);
      const py = nodes(writeXY.y);
      If(
        px
          .greaterThanEqual(0)
          .and(px.lessThan(size.x))
          .and(py.greaterThanEqual(0))
          .and(py.lessThan(size.y)),
        () => {
          textureStore(output, uvec2(uint(int(px)), uint(int(py))), vec4(result, 0, 0, 1));
        },
      );
      // three takes workgroup counts as an array, which its declarations list as a thread count only.
    })().compute([1, 1, 1] as unknown as number, [wave, 1, 1]);
  }
}

/** The contact-shadow mask for a scene pass's depth. See {@link ContactShadowNode}. */
export function contactShadow(options: IContactShadowOptions): ContactShadowNode {
  // A custom node is not a TSL proxy until it is wrapped: `.r` and the other swizzles come with it.
  return nodeObject(new ContactShadowNode(options)) as unknown as ContactShadowNode;
}
