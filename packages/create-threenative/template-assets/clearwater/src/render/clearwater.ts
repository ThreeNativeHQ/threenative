// Generated for you: the complete water appearance is editable here, not hidden in core.
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, Mesh, PlaneGeometry, RGBAFormat, Vector2, Vector3 } from "three";
import { cameraPosition, cameraProjectionMatrixInverse, cameraWorldMatrix, clamp, dFdx, dFdy, float, getViewPosition, mix, positionLocal, positionWorld, screenUV, select, texture, transformNormalToView, uniform, vec2, vec3, vec4, viewportDepthTexture } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node, StorageBufferNode } from "three/webgpu";
import { DisposalScope } from "../clearwaterLifetime.js";
import { createClearwaterCaustics } from "./clearwaterCaustics.js";
import { beerLambert, dielectricFresnel } from "./clearwaterOptics.js";
import type { IResolvedClearwaterOptions } from "./clearwaterOptions.js";

/** Structural inputs keep generated render code independent of framework imports. */
export interface IClearwaterOceanSource {
  readonly resolution: number;
  readonly cascades: readonly { readonly patchSize: number }[];
  cascadePatchSize(index: number): number;
  cascadeDisplacement(index: number): StorageBufferNode<"vec4">;
}
export interface IClearwaterRippleSource {
  readonly resolution: number;
  readonly size: number;
  readonly dx: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly version: number;
  readonly height: Float32Array;
}
export interface IClearwaterSurfaceSource {
  reflectionAt(offset?: Node<"vec2">): Node<"vec3">;
  refractionAt(offset?: Node<"vec2">): Node<"vec3">;
  thicknessAt(offset?: Node<"vec2">): Node<"float">;
}

export function createClearwaterAppearance(
  ocean: IClearwaterOceanSource, ripples: IClearwaterRippleSource,
  surface: IClearwaterSurfaceSource, options: IResolvedClearwaterOptions,
) {
  const scope = new DisposalScope();
  try {
    const level = uniform(options.level);
    const sunDirection = uniform(new Vector3(...options.sunDirection));
    const rippleCenter = uniform(new Vector2(ripples.centerX, ripples.centerZ));
    const pixels = new Uint16Array(ripples.resolution * ripples.resolution * 4);
    const rippleTexture = new DataTexture(pixels, ripples.resolution, ripples.resolution, RGBAFormat, HalfFloatType);
    rippleTexture.minFilter = LinearFilter;
    rippleTexture.magFilter = LinearFilter;
    rippleTexture.generateMipmaps = false;
    rippleTexture.needsUpdate = true;
    scope.defer(() => rippleTexture.dispose());
    const rippleImage = texture(rippleTexture);
    let uploadedVersion = -1;

    function rippleAt(xz: Node<"vec2">): Node<"vec4"> {
      const uv = xz.sub(rippleCenter).div(ripples.size).add(0.5);
      const edge = uv.min(uv.oneMinus());
      const inside = edge.x.min(edge.y).smoothstep(0, 2 / ripples.resolution);
      // Core stores endpoint samples, not texel-centre samples. Match its CPU heightAt convention.
      const sampleUV = uv.mul((ripples.resolution - 1) / ripples.resolution).add(0.5 / ripples.resolution);
      return rippleImage.sample(sampleUV.clamp(0, 1)).level(float(0)).mul(inside);
    }
    function waveHeight(xz: Node<"vec2">): Node<"float"> {
      let height: Node<"float"> = float(0);
      const grid = float(ocean.resolution);
      for (let index = 0; index < ocean.cascades.length; index += 1) {
        const p = xz.div(ocean.cascadePatchSize(index)).mul(grid);
        const base = p.floor();
        const f = p.sub(base);
        const buffer = ocean.cascadeDisplacement(index);
        const wrap = (v: Node<"float">) => v.mod(grid).add(grid).mod(grid);
        const read = (x: Node<"float">, z: Node<"float">) => buffer.element(wrap(z).mul(grid).add(wrap(x)).toUint()).y;
        const near = mix(read(base.x, base.y), read(base.x.add(1), base.y), f.x);
        const far = mix(read(base.x, base.y.add(1)), read(base.x.add(1), base.y.add(1)), f.x);
        height = height.add(mix(near, far, f.y));
      }
      return height;
    }
    const step = Math.min(...ocean.cascades.map((cascade) => cascade.patchSize)) / ocean.resolution;
    const field = {
      heightAt(xz: Node<"vec2">): Node<"float"> { return waveHeight(xz).add(rippleAt(xz).x); },
      normalAt(xz: Node<"vec2">): Node<"vec3"> {
        const ripple = rippleAt(xz);
        const dx = waveHeight(xz.add(vec2(step, 0))).sub(waveHeight(xz.sub(vec2(step, 0)))).div(2 * step).add(ripple.y);
        const dz = waveHeight(xz.add(vec2(0, step))).sub(waveHeight(xz.sub(vec2(0, step)))).div(2 * step).add(ripple.z);
        return vec3(dx.negate(), 1, dz.negate()).normalize();
      },
    };
    const caustics = options.caustics ? createClearwaterCaustics(field, level, sunDirection, options) : undefined;
    if (caustics !== undefined) scope.defer(() => caustics.dispose());
    const geometry = new PlaneGeometry(options.size, options.size, options.segments, options.segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(options.center[0], 0, options.center[1]);
    scope.defer(() => geometry.dispose());
    // Transparent is required for the opaque colour/depth snapshot, despite final alpha being one.
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, opacity: 1 });
    scope.defer(() => material.dispose());
    material.positionNode = vec3(positionLocal.x, level.add(field.heightAt(positionLocal.xz)), positionLocal.z);
    const normal = field.normalAt(positionWorld.xz);
    const view = cameraPosition.sub(positionWorld).normalize();
    const normalView = transformNormalToView(normal);
    const proposedOffset = normalView.xy.mul(options.distortion);
    const offset = select(surface.thicknessAt(proposedOffset).greaterThan(0), proposedOffset, vec2(0));
    const uv = clamp(screenUV.add(offset), vec2(0), vec2(1));
    const behind = getViewPosition(uv, viewportDepthTexture(uv), cameraProjectionMatrixInverse);
    const receiver = cameraWorldMatrix.mul(vec4(behind, 1)).xyz;
    const verticalDepth = level.sub(receiver.y).max(0);
    // View-space depth difference alone under-attenuates at oblique angles. Use reconstructed metres.
    const pathLength = receiver.sub(positionWorld).length().min(options.depth * 12);
    const extinction = options.absorption.map((a, index) => a + (options.scattering[index] ?? 0));
    const transmittance = vec3(
      beerLambert(pathLength, extinction[0] ?? 0),
      beerLambert(pathLength, extinction[1] ?? 0),
      beerLambert(pathLength, extinction[2] ?? 0),
    );
    let floorLight: Node<"vec3"> = surface.refractionAt(offset);
    if (caustics !== undefined) {
      // The ray grid is focused at one depth. Fade its approximation away from that receiver plane.
      const depthConfidence = float(1).sub(verticalDepth.sub(options.depth).abs().div(options.depth)).clamp(0, 1);
      floorLight = floorLight.mul(mix(vec3(1), caustics.at(receiver.xz), depthConfidence.mul(options.causticsStrength)));
    }
    const singleScatter = vec3(
      options.scattering[0] / Math.max(extinction[0] ?? 0, 1e-6),
      options.scattering[1] / Math.max(extinction[1] ?? 0, 1e-6),
      options.scattering[2] / Math.max(extinction[2] ?? 0, 1e-6),
    ).mul(transmittance.oneMinus()).mul(vec3(...options.sunColor)).mul(0.08);
    const under = floorLight.mul(transmittance).add(singleScatter);
    const facing = normal.dot(view).max(0.001);
    const fresnel = dielectricFresnel(facing, options.ior);
    // Reflection-off is an explicit performance/appearance choice, not a fake sky texture.
    const reflected = options.reflection ? surface.reflectionAt(normalView.xy.mul(options.distortion)) : vec3(0.11, 0.27, 0.62);
    const half = view.add(sunDirection).normalize();
    const nh = normal.dot(half).clamp(0.001, 1);
    const nl = normal.dot(sunDirection).max(0);
    // Screen derivatives widen glints at distance rather than aliasing into single-pixel fireflies.
    const variance = dFdx(normal).length().pow(2).add(dFdy(normal).length().pow(2));
    const a2 = variance.mul(1.2).add(0.00012).min(1);
    const cos2 = nh.mul(nh);
    const tan2 = cos2.oneMinus().div(cos2);
    const distribution = tan2.negate().div(a2).exp().div(a2.mul(Math.PI).mul(cos2.mul(cos2)));
    const visibility = float(0.5).div(nl.mul(facing.mul(facing).mul(a2.oneMinus()).add(a2).sqrt())
      .add(facing.mul(nl.mul(nl).mul(a2.oneMinus()).add(a2).sqrt())).add(0.00001));
    const specular = distribution.mul(visibility).mul(dielectricFresnel(half.dot(view), options.ior)).mul(nl).min(12000);
    material.colorNode = mix(under, reflected, fresnel).add(vec3(...options.sunColor).mul(specular));
    const mesh = new Mesh(geometry, material);
    mesh.name = "clearwater-surface";
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return {
      mesh, material, level, sunDirection, caustics,
      uploadRipples(): void {
        if (scope.disposed) return;
        rippleCenter.value.set(ripples.centerX, ripples.centerZ);
        if (uploadedVersion === ripples.version) return;
        const n = ripples.resolution;
        for (let z = 0; z < n; z += 1) for (let x = 0; x < n; x += 1) {
          const i = z * n + x;
          const west = ripples.height[z * n + Math.max(0, x - 1)] ?? 0;
          const east = ripples.height[z * n + Math.min(n - 1, x + 1)] ?? 0;
          const north = ripples.height[Math.min(n - 1, z + 1) * n + x] ?? 0;
          const south = ripples.height[Math.max(0, z - 1) * n + x] ?? 0;
          pixels[i * 4] = DataUtils.toHalfFloat(ripples.height[i] ?? 0);
          pixels[i * 4 + 1] = DataUtils.toHalfFloat((east - west) / (2 * ripples.dx));
          pixels[i * 4 + 2] = DataUtils.toHalfFloat((north - south) / (2 * ripples.dx));
        }
        rippleTexture.needsUpdate = true;
        uploadedVersion = ripples.version;
      },
      dispose(): void { scope.dispose(); },
    };
  } catch (error) {
    try { scope.dispose(); } catch { /* Preserve the construction error. */ }
    throw error;
  }
}
