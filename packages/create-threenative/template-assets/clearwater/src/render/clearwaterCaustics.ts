// Refracted-grid caustics adapted from Clearwater, MIT (Lumaris 2026).
// See CLEARWATER-LICENSE.txt. No WebGL handles, DOM, extra animation loop or asset fetches.
import {
  AdditiveBlending,
  Color,
  OrthographicCamera,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RenderTarget,
  Scene,
} from "three";
import {
  attribute,
  dFdx,
  dFdy,
  float,
  mix,
  refract,
  texture,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node, WebGPURenderer } from "three/webgpu";
import { DisposalScope } from "../clearwaterLifetime.js";
import type { IResolvedClearwaterOptions } from "./clearwaterOptions.js";
import { withClearwaterTarget } from "./clearwaterPass.js";

export interface IClearwaterHeightSource {
  heightAt(xz: Node<"vec2">): Node<"float">;
  normalAt(xz: Node<"vec2">): Node<"vec3">;
}

/** A finite ray grid: caustics are transported from the same waves/ripples as the surface. */
export function createClearwaterCaustics(
  field: IClearwaterHeightSource,
  level: Node<"float">,
  sun: Node<"vec3">,
  options: IResolvedClearwaterOptions,
) {
  const scope = new DisposalScope();
  try {
    const target = new RenderTarget(options.causticsResolution, options.causticsResolution, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = "clearwater-caustic-flux";
    scope.defer(() => target.dispose());
    const geometry = new PlaneGeometry(
      options.size,
      options.size,
      options.causticsSegments,
      options.causticsSegments,
    );
    scope.defer(() => geometry.dispose());
    const scene = new Scene();
    // WebGPURenderer still requires a projection-capable camera even though vertexNode emits clip space.
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const center = vec2(options.center[0], options.center[1]);
    const sourceXZ = attribute<"vec3">("position", "vec3").xy.add(center);
    const sourcePosition = vec3(sourceXZ.x, level.add(field.heightAt(sourceXZ)), sourceXZ.y);
    const normal = field.normalAt(sourceXZ);
    const rayOrigin = varying(sourceXZ);
    const dx = dFdx(rayOrigin);
    const dy = dFdy(rayOrigin);
    // The inverse mapping's Jacobian measures incoming area per receiving pixel.
    // A flat, unperturbed surface is exactly one, independent of texture or grid resolution.
    const flux = dx.x
      .mul(dy.y)
      .sub(dx.y.mul(dy.x))
      .abs()
      .mul((options.causticsResolution / options.size) ** 2)
      .min(40);
    const masks = [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)];
    const dispersion = [-0.002, 0, 0.003];
    for (let channel = 0; channel < 3; channel += 1) {
      const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      scope.defer(() => material.dispose());
      const ior = Math.max(1.0001, options.ior + (dispersion[channel] ?? 0));
      const ray = refract(sun.negate(), normal, float(1 / ior));
      const distance = level.sub(options.depth).sub(sourcePosition.y).div(ray.y.min(-0.001)).max(0);
      const focus = sourcePosition.add(ray.mul(distance)).xz.sub(center).div(options.size);
      material.vertexNode = vec4(focus.mul(2), 0.5, 1);
      material.fragmentNode = vec4((masks[channel] ?? masks[0] ?? vec3(1, 0, 0)).mul(flux), 1);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    const image = texture(target.texture);
    const black = new Color(0);
    const previousColor = new Color();
    return {
      texture: target.texture,
      scene,
      camera,
      at(xz: Node<"vec2">): Node<"vec3"> {
        const uv = xz.sub(center).div(options.size).add(0.5);
        const edge = uv.min(uv.oneMinus());
        const inside = edge.x.min(edge.y).smoothstep(0, 0.025);
        // A finite receiver is not RepeatWrapping: local interaction must not tile across the sea.
        return mix(vec3(1), image.sample(uv.clamp(0, 1)).rgb, inside);
      },
      render(renderer: WebGPURenderer): void {
        if (scope.disposed) return;
        withClearwaterTarget(renderer, target, black, previousColor, () =>
          renderer.render(scene, camera),
        );
      },
      dispose(): void {
        scope.dispose();
      },
    };
  } catch (error) {
    try {
      scope.dispose();
    } catch {
      /* Keep the construction failure as the primary error. */
    }
    throw error;
  }
}
