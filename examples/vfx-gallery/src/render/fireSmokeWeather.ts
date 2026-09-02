import {
  Fn,
  abs,
  atan,
  clamp,
  cos,
  cross,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  mix,
  normalize,
  sin,
  smoothstep,
  step,
  time,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  type ComputeNode,
  type Node,
  SpriteNodeMaterial as SpriteMaterial,
  type SpriteNodeMaterial,
  type StorageBufferNode,
} from "three/webgpu";
import * as THREE from "three/webgpu";
import { type ArchiveLayer, type ArchiveVec3, createArchiveLayers } from "./archivePresets.js";

export interface IParticleBuffers {
  readonly positions: StorageBufferNode<"vec3">;
  readonly velocities: StorageBufferNode<"vec3">;
}

export interface IParticleOptions {
  readonly amount: number;
  readonly material: SpriteNodeMaterial;
  readonly start: (buffers: IParticleBuffers) => ComputeNode;
  readonly process: (buffers: IParticleBuffers) => ComputeNode;
}

const TAU = Math.PI * 2;
const GALLERY_PARTICLE_LIMIT = 96;
const GALLERY_PARTICLE_FLOOR = 18;
const GALLERY_WORLD_SCALE = 1;

function particleAmount(layer: ArchiveLayer): number {
  // The donor capacities remain authoritative in archivePresets.ts. The gallery uses a bounded
  // representative count so all 46 compositions can stay resident during one browser capture.
  return Math.max(
    GALLERY_PARTICLE_FLOOR,
    Math.min(GALLERY_PARTICLE_LIMIT, Math.round(Math.sqrt(layer.capacity) * 2.5)),
  );
}

function random(index: typeof instanceIndex, seed: number, salt: number) {
  return hash(index.add(seed + salt));
}

function valueNoise(point: Node<"vec2">): Node<"float"> {
  const cell = floor(point);
  const local = point.sub(cell);
  const smooth = local.mul(local).mul(float(3).sub(local.mul(2)));
  const at = (offset: Node<"vec2">) =>
    hash(cell.x.add(offset.x).mul(127.1).add(cell.y.add(offset.y).mul(311.7)));
  return mix(
    mix(at(vec2(0, 0)), at(vec2(1, 0)), smooth.x),
    mix(at(vec2(0, 1)), at(vec2(1, 1)), smooth.x),
    smooth.y,
  );
}

function fractalNoise(point: Node<"vec2">): Node<"float"> {
  return valueNoise(point)
    .mul(0.5)
    .add(valueNoise(point.mul(2.03).add(17.1)).mul(0.25))
    .add(valueNoise(point.mul(4.01).add(31.7)).mul(0.125));
}

function scalarCurve(
  points: readonly (readonly [number, number])[] | undefined,
  t: Node<"float">,
  fallback: number,
) {
  if (points === undefined || points.length === 0) return float(fallback);
  let value: Node<"float"> = float(points[0]?.[1] ?? fallback);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const segment = clamp(t.sub(previous[0]).div(Math.max(current[0] - previous[0], 0.0001)), 0, 1);
    const interpolated = mix(float(previous[1]), float(current[1]), segment);
    value = mix(value, interpolated, step(previous[0], t).mul(step(t, current[0])));
  }
  const last = points[points.length - 1];
  return last === undefined ? value : mix(value, float(last[1]), step(last[0], t));
}

function colorCurve(
  points:
    | readonly (readonly [
        number,
        readonly [number, number, number] | readonly [number, number, number, number],
      ])[]
    | undefined,
  t: Node<"float">,
  fallback: readonly [number, number, number],
) {
  if (points === undefined || points.length === 0) return vec3(...fallback);
  const first = points[0]?.[1];
  let value: Node<"vec3"> = vec3(
    first?.[0] ?? fallback[0],
    first?.[1] ?? fallback[1],
    first?.[2] ?? fallback[2],
  );
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const previousColor = previous[1];
    const currentColor = current[1];
    const segment = clamp(t.sub(previous[0]).div(Math.max(current[0] - previous[0], 0.0001)), 0, 1);
    const interpolated = mix(
      vec3(
        previousColor[0] ?? fallback[0],
        previousColor[1] ?? fallback[1],
        previousColor[2] ?? fallback[2],
      ),
      vec3(
        currentColor[0] ?? fallback[0],
        currentColor[1] ?? fallback[1],
        currentColor[2] ?? fallback[2],
      ),
      segment,
    );
    value = mix(value, interpolated, step(previous[0], t).mul(step(t, current[0])));
  }
  const last = points[points.length - 1]?.[1];
  return last === undefined
    ? value
    : mix(
        value,
        vec3(last[0] ?? fallback[0], last[1] ?? fallback[1], last[2] ?? fallback[2]),
        step(points[points.length - 1]?.[0] ?? 1, t),
      );
}

function shapePosition(layer: ArchiveLayer, seed: number) {
  const shape = layer.shape;
  const h0 = random(instanceIndex, seed, 3);
  const h1 = random(instanceIndex, seed, 11);
  const h2 = random(instanceIndex, seed, 19);
  if (shape.type === "point") return vec3(0);
  if (shape.type === "disc") {
    const angle = h0.mul(TAU);
    const radius = h1.sqrt().mul(shape.radius);
    return vec3(
      cos(angle).mul(radius),
      sin(angle).mul(radius),
      h2.sub(0.5).mul(shape.radius * 0.16),
    );
  }
  if (shape.type === "box") {
    return vec3(
      h0.sub(0.5).mul(shape.extents[0]),
      h1.sub(0.5).mul(shape.extents[1]),
      h2.sub(0.5).mul(shape.extents[2]),
    );
  }
  if (shape.type === "line") {
    return vec3(...shape.start)
      .mul(float(1).sub(h0))
      .add(vec3(...shape.end).mul(h0));
  }
  const z = h0.mul(2).sub(1);
  const planar = float(1).sub(z.mul(z)).max(0).sqrt();
  const angle = h1.mul(TAU);
  const radius = shape.type === "sphere" ? h2.pow(1 / 3).mul(shape.radius) : float(shape.radius);
  return vec3(
    cos(angle).mul(planar).mul(radius),
    sin(angle).mul(planar).mul(radius),
    z.mul(radius),
  );
}

function velocityDirection(layer: ArchiveLayer, spawn: Node<"vec3">, seed: number): Node<"vec3"> {
  const velocity = layer.velocity;
  const speed = float(velocity.speed[0]).add(
    random(instanceIndex, seed, 37).mul(velocity.speed[1] - velocity.speed[0]),
  );
  if (velocity.mode === "radial") {
    const origin = vec3(...(velocity.origin ?? [0, 0, 0]));
    return normalize(spawn.sub(origin).add(vec3(0.0001, 0.0002, 0.0003))).mul(speed);
  }
  const direction = normalize(vec3(...(velocity.direction ?? [0, 1, 0])));
  const angle = velocity.angle ?? 0;
  if (angle <= 0) return direction.mul(speed);
  const tangent = Math.abs(velocity.direction?.[1] ?? 1) > 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  const bitangent = normalize(cross(direction, tangent));
  const coneAngle = float(angle).mul(random(instanceIndex, seed, 43).sqrt());
  const azimuth = random(instanceIndex, seed, 47).mul(TAU);
  const spread = sin(coneAngle);
  return normalize(
    direction
      .mul(cos(coneAngle))
      .add(tangent.mul(cos(azimuth)).mul(spread))
      .add(bitangent.mul(sin(azimuth)).mul(spread)),
  ).mul(speed);
}

function acceleration(layer: ArchiveLayer) {
  const values = layer.acceleration ?? [];
  if (values.length === 0) return vec3(0);
  const sum = values.reduce(
    (total, value) =>
      [total[0] + value[0], total[1] + value[1], total[2] + value[2]] as ArchiveVec3,
    [0, 0, 0],
  );
  return vec3(...sum);
}

function phaseNode(layer: ArchiveLayer, seed: number) {
  const lifetime = float(layer.lifetime[0]).add(
    random(instanceIndex, seed, 53).mul(layer.lifetime[1] - layer.lifetime[0]),
  );
  const emissionRate = layer.spawnRate ?? layer.burstCount ?? 1;
  return fract(
    time
      .mul(Math.max(0.35, Math.min(2.4, (emissionRate / Math.max(layer.capacity, 1)) * 8)))
      .div(lifetime)
      .add(random(instanceIndex, seed, 59)),
  );
}

function moveParticle(
  layer: ArchiveLayer,
  spawn: Node<"vec3">,
  velocity: Node<"vec3">,
  phase: Node<"float">,
  seed: number,
) {
  const lifetime = float(layer.lifetime[0]).add(
    random(instanceIndex, seed, 53).mul(layer.lifetime[1] - layer.lifetime[0]),
  );
  const elapsed = phase.mul(lifetime);
  const elapsedSquared = elapsed.mul(elapsed).mul(0.5);
  let position = spawn.add(velocity.mul(elapsed)).add(acceleration(layer).mul(elapsedSquared));
  if (layer.drag !== undefined) position = position.mul(exp(float(-layer.drag).mul(elapsed)));
  if (layer.curl !== undefined) {
    const frequency = layer.curl.frequency;
    const curl = vec3(
      sin(position.y.mul(frequency).add(time.mul(frequency))).mul(layer.curl.strength),
      cos(position.x.mul(frequency).sub(time.mul(frequency * 0.83))).mul(layer.curl.strength),
      sin(position.z.mul(frequency).add(time.mul(frequency * 0.61))).mul(layer.curl.strength),
    );
    position = position.add(curl.mul(elapsed));
  }
  if (layer.attractor !== undefined) {
    position = position.add(
      vec3(...layer.attractor.position)
        .sub(position)
        .mul(layer.attractor.strength)
        .mul(elapsedSquared),
    );
  }
  if (layer.vortex !== undefined) {
    const angle = time.mul(layer.vortex.strength).add(phase.mul(layer.vortex.strength));
    const c = cos(angle);
    const s = sin(angle);
    position = vec3(
      position.x.mul(c).sub(position.y.mul(s)),
      position.x.mul(s).add(position.y.mul(c)),
      position.z,
    );
  }
  if (layer.floor !== undefined)
    position = vec3(position.x, position.y.max(layer.floor.height), position.z);
  return position.mul(GALLERY_WORLD_SCALE);
}

function styleMask(style: number) {
  const p = uv().sub(0.5);
  const radius = p.length();
  const noise = fractalNoise(p.mul(5.2).add(vec2(time.mul(0.12), time.mul(0.08))));
  if (style === 0) {
    const flameRadius = vec2(p.x.mul(1.15), p.y.add(0.09).mul(0.88)).length();
    let mask = float(1).sub(smoothstep(0.24, 0.51, flameRadius.add(noise.sub(0.5).mul(0.11))));
    mask = mask.mul(smoothstep(-0.58, -0.27, p.y).add(0.58));
    return mask.mul(float(1).sub(smoothstep(0.27, 0.58, p.y.add(abs(p.x).mul(0.34)))));
  }
  if (style === 1) {
    const smokeRadius = vec2(p.x.mul(0.92), p.y.mul(1.04)).length();
    return float(1)
      .sub(smoothstep(0.28, 0.54, smokeRadius.add(noise.sub(0.5).mul(0.27))))
      .mul(mix(0.76, 1, valueNoise(p.mul(8).add(vec2(4, 7)))));
  }
  if (style === 2) return float(1).sub(smoothstep(0.08, 0.49, radius));
  if (style === 3) {
    return float(1)
      .sub(smoothstep(0.12, 0.54, radius))
      .mul(mix(0.74, 1, noise))
      .add(float(0.24).mul(float(1).sub(smoothstep(0.02, 0.22, radius))));
  }
  if (style === 4) {
    const ray = float(1)
      .sub(smoothstep(0.018, 0.09, abs(p.x)))
      .max(float(1).sub(smoothstep(0.018, 0.09, abs(p.y))));
    const diagonal = float(1)
      .sub(smoothstep(0.018, 0.075, abs(p.x.sub(p.y))))
      .max(float(1).sub(smoothstep(0.018, 0.075, abs(p.x.add(p.y)))));
    return float(1)
      .sub(smoothstep(0.08, 0.45, radius))
      .max(ray.max(diagonal).mul(smoothstep(0.5, 0.05, radius)));
  }
  if (style === 5) {
    const angle = abs(atan(p.y, p.x));
    const crystal = abs(cos(angle.mul(3)));
    return float(1)
      .sub(smoothstep(0.06, 0.5, radius))
      .mul(float(0.42).add(float(0.58).mul(smoothstep(0.58, 0.98, crystal))));
  }
  const wind = abs(
    p.y
      .add(sin(p.x.mul(10).add(noise.mul(2)).mul(0.075)))
      .add(sin(p.x.mul(21).sub(noise)).mul(0.035)),
  );
  return float(1)
    .sub(smoothstep(0.025, 0.12, wind))
    .mul(float(1).sub(smoothstep(0.3, 0.54, abs(p.x))))
    .mul(mix(0.55, 1, noise));
}

function particleMaterial(layer: ArchiveLayer, seed: number): SpriteNodeMaterial {
  const material = new SpriteMaterial({
    blending:
      layer.blend === "alpha" || layer.blend === "masked"
        ? THREE.NormalBlending
        : THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  const phase = phaseNode(layer, seed);
  const phaseVarying = varying(phase);
  const color = layer.color;
  const authoredColor = colorCurve(layer.colorCurve, phaseVarying, [color[0], color[1], color[2]]);
  const authoredAlpha = scalarCurve(layer.alphaCurve, phaseVarying, color[3]).max(0.12);
  const authoredSize = scalarCurve(layer.sizeCurve, phaseVarying, 1).max(0.34);
  const lifetimeScale =
    layer.style === 0
      ? mix(1.18, 0.42, phaseVarying)
      : layer.style === 1
        ? mix(0.62, 1.95, phaseVarying)
        : float(1);
  const stretched = layer.renderer === "ribbon";
  const baseSize = Math.max(layer.size, 0.075);
  const length = stretched ? Math.max(baseSize * 3.8, layer.ribbonWidth ?? baseSize) : baseSize;
  const width = stretched
    ? Math.max(baseSize * 0.42, (layer.ribbonWidth ?? baseSize) * 1.8)
    : baseSize;
  material.scaleNode = vec2(width, length)
    .mul(authoredSize)
    .mul(lifetimeScale)
    .mul(GALLERY_WORLD_SCALE);
  material.colorNode = vec4(
    authoredColor,
    authoredAlpha.mul(styleMask(layer.style)).mul(stretched ? float(0.92) : float(1)),
  );
  const spawn = shapePosition(layer, seed);
  const launch = velocityDirection(layer, spawn, seed);
  material.rotationNode = atan(launch.y, launch.x)
    .add(layer.rotation?.[0] ?? 0)
    .add(phaseVarying.mul(layer.angularVelocity?.[0] ?? 0));
  return material;
}

export function createArchivedParticle(layer: ArchiveLayer, seed: number): IParticleOptions {
  const amount = particleAmount(layer);
  const material = particleMaterial(layer, seed);
  const start = ({ positions, velocities }: IParticleBuffers): ComputeNode =>
    Fn(() => {
      const spawn = shapePosition(layer, seed);
      positions.element(instanceIndex).assign(spawn.mul(GALLERY_WORLD_SCALE));
      velocities
        .element(instanceIndex)
        .assign(velocityDirection(layer, spawn, seed).mul(GALLERY_WORLD_SCALE));
    })().compute(amount);
  const process = ({ positions, velocities }: IParticleBuffers): ComputeNode =>
    Fn(() => {
      const spawn = shapePosition(layer, seed);
      const launch = velocityDirection(layer, spawn, seed);
      const phase = phaseNode(layer, seed);
      positions.element(instanceIndex).assign(moveParticle(layer, spawn, launch, phase, seed));
      velocities.element(instanceIndex).assign(launch);
    })().compute(amount);
  return { amount, material, start, process };
}

export function createArchivedEffect(id: string, seed: number): readonly IParticleOptions[] {
  return createArchiveLayers(id).map((layer, index) =>
    createArchivedParticle(layer, seed + index * 97),
  );
}

export function createFire(seed = 11): readonly IParticleOptions[] {
  return createArchivedEffect("fire", seed);
}
export function createJetFlame(seed = 13): readonly IParticleOptions[] {
  return createArchivedEffect("jet-flame", seed);
}
export function createSmoke(seed = 17): readonly IParticleOptions[] {
  return createArchivedEffect("smoke", seed);
}
export function createDustCloud(seed = 19): readonly IParticleOptions[] {
  return createArchivedEffect("dust-cloud", seed);
}
export function createSteamPlume(seed = 23): readonly IParticleOptions[] {
  return createArchivedEffect("steam-plume", seed);
}
export function createAshPlume(seed = 29): readonly IParticleOptions[] {
  return createArchivedEffect("ash-plume", seed);
}
export function createExplosionCloud(seed = 31): readonly IParticleOptions[] {
  return createArchivedEffect("explosion-cloud", seed);
}
export function createImpactDust(seed = 37): readonly IParticleOptions[] {
  return createArchivedEffect("impact-dust", seed);
}
export function createGroundMist(seed = 41): readonly IParticleOptions[] {
  return createArchivedEffect("ground-mist", seed);
}
export function createPoisonCloud(seed = 43): readonly IParticleOptions[] {
  return createArchivedEffect("poison-cloud", seed);
}
export function createRain(seed = 47): readonly IParticleOptions[] {
  return createArchivedEffect("rain", seed);
}
export function createSnow(seed = 53): readonly IParticleOptions[] {
  return createArchivedEffect("snow", seed);
}
export function createEffekseerWind01(seed = 59): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-wind01", seed);
}
export function createEffekseerWind02(seed = 61): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-wind02", seed);
}
export function createEffekseerWind03(seed = 67): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-wind03", seed);
}
