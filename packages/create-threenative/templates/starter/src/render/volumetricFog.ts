// Generated for you: opt-in Three.js, with no default tier or picture change.
// Compose this medium before exposure/bloom/output. Disable its scene fog, aerial haze and
// god rays; a separate clear-air sky remains valid. Density/phase/colour belong to this game.
// Pinned Three 0.185.1 VolumeNodeMaterial skips directional lights and couples extinction to
// illumination. This bounded integrator reuses GodraysNode's depth/shadow coordinates instead.
import {
  type Box3,
  type Color,
  type DirectionalLight,
  HalfFloatType,
  NearestFilter,
  type PerspectiveCamera,
  type PointLight,
  Vector3,
} from "three";
import {
  Fn,
  If,
  Loop,
  float,
  getViewPosition,
  lightShadowMatrix,
  max,
  min,
  type pass,
  reference,
  rtt,
  screenUV,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, NodeMaterial, RenderTarget } from "three/webgpu";

type ScenePass = ReturnType<typeof pass>;
type FogTexture = ReturnType<typeof rtt> & {
  renderTarget: RenderTarget;
  _quadMesh: { material: NodeMaterial };
};
export interface IFogVolume {
  bounds: Box3;
  /** Extinction per metre at/below baseHeight, independent of light intensity. */
  density: number;
  baseHeight: number;
  heightFalloff: number;
}
export interface IVolumetricFogOptions {
  enabled: boolean;
  renderer: string;
  /** Explicit unqualified budget, 8–128. No automatic tier admission before measurements. */
  steps: number;
  resolutionScale: number;
  volumes: IFogVolume[];
  albedo: Color;
  ambient: Color;
  anisotropy: number;
  sun?: DirectionalLight;
  /** At most four unshadowed finite-range PointLights; spot/cube shadows are excluded. */
  points?: PointLight[];
  logarithmicDepth?: boolean;
  reversedDepth?: boolean;
  environment: { aerialPerspective: boolean; godRays: boolean; sceneFog: boolean };
}
function finite(name: string, value: number, low: number, high = Number.POSITIVE_INFINITY): void {
  if (!Number.isFinite(value) || value < low || value > high)
    throw new Error(`volumetricFog: ${name} must be finite in [${low}, ${high}].`);
}
function validateVolumes(volumes: IFogVolume[]): void {
  if (volumes.length > 8) throw new Error("volumetricFog: at most eight bounds.");
  for (const volume of volumes) {
    finite("density", volume.density, 0);
    finite("heightFalloff", volume.heightFalloff, 0);
    finite("baseHeight", volume.baseHeight, Number.NEGATIVE_INFINITY);
    const { min: low, max: high } = volume.bounds;
    if (
      ![...low, ...high].every(Number.isFinite) ||
      low.x >= high.x ||
      low.y >= high.y ||
      low.z >= high.z
    )
      throw new Error("volumetricFog: bounds need finite positive extent.");
  }
}
function validateOptions(camera: PerspectiveCamera, options: IVolumetricFogOptions): void {
  if (!camera.isPerspectiveCamera) throw new Error("volumetricFog: perspective camera required.");
  if (options.logarithmicDepth || options.reversedDepth)
    throw new Error("volumetricFog: only ordinary perspective depth is qualified for this graph.");
  finite("steps", options.steps, 8, 128);
  if (!Number.isInteger(options.steps)) throw new Error("volumetricFog: steps must be integer.");
  if (options.resolutionScale !== 1 && options.resolutionScale !== 0.5)
    throw new Error("volumetricFog: resolutionScale must be 1 or 0.5.");
  finite("anisotropy", options.anisotropy, -0.9, 0.9);
  validateVolumes(options.volumes);
  for (const channel of options.albedo.toArray()) finite("albedo", channel, 0, 1);
  for (const channel of options.ambient.toArray()) finite("ambient", channel, 0);
  if (Object.values(options.environment).some(Boolean))
    throw new Error(
      "volumetricFog: disable aerial perspective, scene fog and god rays for the same medium.",
    );
  const sun = options.sun;
  if (
    sun !== undefined &&
    (!sun.castShadow || sun.shadow.map?.depthTexture == null || sun.shadow.shadowNode != null)
  )
    throw new Error("volumetricFog: sun needs an initialized ordinary directional shadow map.");
  const points = options.points ?? [];
  if (points.length > 4) throw new Error("volumetricFog: at most four local lights.");
  for (const point of points) {
    if (
      !point.isPointLight ||
      point.castShadow ||
      !Number.isFinite(point.distance) ||
      point.distance <= 0
    )
      throw new Error("volumetricFog: local lights must be unshadowed finite-range PointLights.");
    finite("point decay", point.decay, 0, 4);
  }
}
function lightRadiance(light: DirectionalLight | PointLight) {
  const value = new Vector3();
  return uniform(value).onRenderUpdate(() =>
    value
      .set(light.color.r, light.color.g, light.color.b)
      .multiplyScalar(light.visible ? light.intensity : 0),
  );
}

/** Off, unsupported and zero-density return before allocating any graph/target/material. */
export function createVolumetricFog(camera: PerspectiveCamera, supplied: IVolumetricFogOptions) {
  if (!supplied.enabled || supplied.renderer !== "webgpu") return undefined;
  const options = { ...supplied };
  validateOptions(camera, options);
  const volumes = options.volumes.filter((volume) => volume.density > 0);
  if (volumes.length === 0) return undefined;
  const bounds = volumes.map((volume) => ({
    ...volume,
    low: uniform(volume.bounds.min.clone()),
    high: uniform(volume.bounds.max.clone()),
  }));
  const cameraMatrix = uniform(camera.matrixWorld);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const cameraPosition = new Vector3();
  const origin = uniform(cameraPosition).onRenderUpdate(() =>
    camera.getWorldPosition(cameraPosition),
  );
  const ambient = uniform(new Vector3(options.ambient.r, options.ambient.g, options.ambient.b));
  const albedo = uniform(new Vector3(options.albedo.r, options.albedo.g, options.albedo.b));
  const sun = options.sun;
  const shadowDepth = sun?.shadow.map?.depthTexture;
  const directionValue = new Vector3();
  const targetValue = new Vector3();
  const sunDirection =
    sun === undefined
      ? undefined
      : uniform(directionValue).onRenderUpdate(() =>
          sun
            .getWorldPosition(directionValue)
            .sub(sun.target.getWorldPosition(targetValue))
            .normalize(),
        );
  const sunRadiance = sun === undefined ? undefined : lightRadiance(sun);
  const localLights = (options.points ?? []).map((point) => {
    const position = new Vector3();
    return {
      point,
      radiance: lightRadiance(point),
      position: uniform(position).onRenderUpdate(() => point.getWorldPosition(position)),
    };
  });
  const phase = (cosine: Node<"float">) =>
    float(1 - options.anisotropy ** 2).div(
      float(1 + options.anisotropy ** 2)
        .sub(cosine.mul(2 * options.anisotropy))
        .pow(1.5)
        .mul(4 * Math.PI),
    );
  let scratch: FogTexture | undefined;
  let transport: Node<"vec4"> | undefined;
  let disposed = false;
  return {
    get target(): RenderTarget | undefined {
      return scratch?.renderTarget;
    },
    get material(): NodeMaterial | undefined {
      return scratch?._quadMesh.material;
    },
    get transport(): Node<"vec4"> | undefined {
      return transport;
    },
    diagnostics: () => ({
      steps: options.steps,
      resolutionScale: options.resolutionScale,
      volumes: volumes.length,
      localLights: localLights.length,
      history: false,
      renderTargets: scratch === undefined ? 0 : 1,
      pixels: scratch === undefined ? 0 : scratch.renderTarget.width * scratch.renderTarget.height,
      disposed,
    }),
    compose(scenePass: ScenePass): Node<"vec4"> {
      if (disposed) throw new Error("volumetricFog: disposed controller.");
      if (scratch !== undefined) throw new Error("volumetricFog: compose once per owned graph.");
      if (scenePass.camera !== camera)
        throw new Error("volumetricFog: scene depth must come from this camera.");
      if (Reflect.get(scenePass.scene, "fog") != null)
        throw new Error("volumetricFog: scene fog duplicates the same medium.");
      const depth = scenePass.getTextureNode("depth");
      const scene = scenePass.getTextureNode("output");
      const integrate = Fn(() => {
        const endpoint = cameraMatrix.mul(
          vec4(getViewPosition(screenUV, depth.r, inverseProjection), 1),
        ).xyz;
        const toSurface = endpoint.sub(origin).toVar();
        const distance = toSurface.length().max(0.000001).toVar();
        const direction = toSurface.div(distance).toVar();
        const safeDirection = direction
          .greaterThanEqual(0)
          .select(direction.abs().max(0.000001), direction.abs().max(0.000001).negate());
        const near = distance.toVar();
        const far = float(0).toVar();
        for (const volume of bounds) {
          const a = volume.low.sub(origin).div(safeDirection);
          const b = volume.high.sub(origin).div(safeDirection);
          const entry = min(a, b);
          const exit = max(a, b);
          const start = max(max(entry.x, entry.y), max(entry.z, 0));
          const end = min(min(exit.x, exit.y), min(exit.z, distance));
          If(end.greaterThan(start), () => {
            near.assign(min(near, start));
            far.assign(max(far, end));
          });
        }
        const transmission = float(1).toVar();
        const scattering = vec3(0).toVar();
        If(far.greaterThan(near), () => {
          const ds = far.sub(near).div(options.steps).toVar();
          Loop(options.steps, ({ i }) => {
            const position = origin.add(direction.mul(near.add(float(i).add(0.5).mul(ds)))).toVar();
            const extinction = float(0).toVar();
            for (const volume of bounds) {
              If(
                position
                  .greaterThanEqual(volume.low)
                  .all()
                  .and(position.lessThanEqual(volume.high).all()),
                () => {
                  extinction.addAssign(
                    position.y
                      .sub(volume.baseHeight)
                      .max(0)
                      .mul(-volume.heightFalloff)
                      .exp()
                      .mul(volume.density),
                  );
                },
              );
            }
            const illumination = vec3(ambient).toVar();
            if (
              sun !== undefined &&
              shadowDepth != null &&
              sunDirection !== undefined &&
              sunRadiance !== undefined
            ) {
              const projected = lightShadowMatrix(sun).mul(vec4(position, 1));
              const coordinate = projected.xyz.div(projected.w).toVar();
              // Outside the finite shadow map, Three treats the directional source as unshadowed.
              const visibility = float(1).toVar();
              If(
                coordinate.greaterThanEqual(0).all().and(coordinate.lessThanEqual(1).all()),
                () => {
                  visibility.assign(
                    texture(shadowDepth, vec2(coordinate.x, coordinate.y.oneMinus())).compare(
                      coordinate.z.add(reference("bias", "float", sun.shadow)),
                    ),
                  );
                },
              );
              illumination.addAssign(
                sunRadiance.mul(phase(direction.dot(sunDirection))).mul(visibility),
              );
            }
            for (const local of localLights) {
              const toLight = local.position.sub(position);
              const radius = toLight.length().max(0.01);
              const attenuation = radius
                .div(local.point.distance)
                .pow(4)
                .oneMinus()
                .max(0)
                .pow(2)
                .div(radius.pow(local.point.decay));
              illumination.addAssign(
                local.radiance.mul(attenuation).mul(phase(direction.dot(toLight.div(radius)))),
              );
            }
            // Exact homogeneous-step solution. Extinction persists when every light is off.
            const stepTransmission = extinction.mul(ds).negate().exp();
            scattering.addAssign(
              transmission.mul(stepTransmission.oneMinus()).mul(albedo).mul(illumination),
            );
            transmission.mulAssign(stepTransmission);
          });
        });
        return vec4(scattering, transmission);
      });
      transport = integrate();
      const rendered = rtt(transport, null, null, {
        depthBuffer: false,
        type: HalfFloatType,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
      }) as FogTexture;
      scratch = rendered;
      rendered.setResolutionScale(options.resolutionScale);
      const sizeValue = new Vector3();
      const size = uniform(sizeValue).onRenderUpdate(() =>
        sizeValue.set(rendered.renderTarget.width, rendered.renderTarget.height, 0),
      );
      return Fn(() => {
        const result = rendered.sample(screenUV).toVar();
        // Half-resolution nearest sampling cannot blend fog across a wall. At a depth mismatch,
        // integrate the full-resolution pixel instead; do not borrow stale/foreground history.
        if (options.resolutionScale < 1) {
          const lowUV = screenUV.mul(size.xy).floor().add(0.5).div(size.xy);
          const fullZ = getViewPosition(screenUV, depth.r, inverseProjection).z;
          const lowZ = getViewPosition(lowUV, depth.sample(lowUV).r, inverseProjection).z;
          If(
            fullZ
              .sub(lowZ)
              .abs()
              .greaterThan(max(fullZ.abs().mul(0.01), 0.01)),
            () => result.assign(integrate()),
          );
        }
        return vec4(scene.rgb.mul(result.a).add(result.rgb), scene.a);
      })();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scratch?.renderTarget.dispose();
      scratch?._quadMesh.material.dispose();
      scratch = undefined;
      transport = undefined;
    },
  };
}
