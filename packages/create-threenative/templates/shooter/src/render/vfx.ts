import {
  Fn,
  abs,
  atan,
  cos,
  cross,
  float,
  fract,
  hash,
  instanceIndex,
  mix,
  normalize,
  sin,
  smoothstep,
  time,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  type ComputeNode,
  SpriteNodeMaterial as SpriteMaterial,
  type SpriteNodeMaterial,
  type StorageBufferNode,
} from "three/webgpu";
import * as THREE from "three/webgpu";

export interface IShooterVfxBuffers {
  readonly positions: StorageBufferNode<"vec3">;
  readonly velocities: StorageBufferNode<"vec3">;
}

export interface IShooterVfxOptions {
  readonly amount: number;
  readonly material: SpriteNodeMaterial;
  readonly start: (buffers: IShooterVfxBuffers) => ComputeNode;
  readonly process: (buffers: IShooterVfxBuffers) => ComputeNode;
}

type DonorRecipe = {
  readonly amount: number;
  readonly lifetime: readonly [number, number];
  readonly radius: number;
  readonly direction: readonly [number, number, number];
  readonly speed: readonly [number, number];
  readonly cone: number;
  readonly size: number;
  readonly colour: readonly [number, number, number];
  readonly highlight: readonly [number, number, number];
  readonly style: "flash" | "smoke" | "spark";
  readonly acceleration: readonly [number, number, number];
  readonly drag: number;
};

const TAU = Math.PI * 2;

function random(seed: number, salt: number) {
  return hash(instanceIndex.add(seed + salt));
}

function phase(recipe: DonorRecipe, seed: number) {
  const lifetime = float(recipe.lifetime[0]).add(
    random(seed, 13).mul(recipe.lifetime[1] - recipe.lifetime[0]),
  );
  return fract(time.div(lifetime).add(random(seed, 19)));
}

function launch(recipe: DonorRecipe, seed: number) {
  const speed = float(recipe.speed[0]).add(random(seed, 23).mul(recipe.speed[1] - recipe.speed[0]));
  const direction = normalize(vec3(...recipe.direction));
  const tangent = Math.abs(recipe.direction[1] ?? 1) > 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  const bitangent = normalize(cross(direction, tangent));
  const cone = float(recipe.cone).mul(random(seed, 29).sqrt());
  const azimuth = random(seed, 31).mul(TAU);
  return normalize(
    direction
      .mul(cos(cone))
      .add(tangent.mul(cos(azimuth)).mul(sin(cone)))
      .add(bitangent.mul(sin(azimuth)).mul(sin(cone))),
  ).mul(speed);
}

function mask(style: DonorRecipe["style"]) {
  const point = uv().sub(0.5);
  const radius = point.length();
  if (style === "smoke") {
    const noise = hash(point.x.mul(127.1).add(point.y.mul(311.7)).add(time.mul(0.14)));
    return float(1)
      .sub(smoothstep(0.24, 0.55, radius.add(noise.sub(0.5).mul(0.18))))
      .mul(float(0.85));
  }
  if (style === "spark") return float(1).sub(smoothstep(0.06, 0.5, radius));
  const ray = float(1)
    .sub(smoothstep(0.018, 0.09, abs(point.x)))
    .max(float(1).sub(smoothstep(0.018, 0.09, abs(point.y))));
  return float(1)
    .sub(smoothstep(0.08, 0.5, radius))
    .max(ray.mul(smoothstep(0.5, 0.05, radius)));
}

function createDonorEmitter(recipe: DonorRecipe, seed: number): IShooterVfxOptions {
  const material = new SpriteMaterial({
    blending: recipe.style === "smoke" ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  const particlePhase = varying(phase(recipe, seed));
  material.scaleNode = vec2(recipe.size)
    .mul(recipe.style === "smoke" ? mix(0.62, 1.95, particlePhase) : mix(1.18, 0.42, particlePhase))
    .mul(0.72);
  material.colorNode = vec4(
    mix(vec3(...recipe.colour), vec3(...recipe.highlight), particlePhase),
    mask(recipe.style)
      .mul(float(1).sub(smoothstep(0.97, 1, particlePhase)))
      .mul(0.96),
  );
  const start = ({ positions, velocities }: IShooterVfxBuffers): ComputeNode =>
    Fn(() => {
      const angle = random(seed, 37).mul(TAU);
      const radius = random(seed, 41).sqrt().mul(recipe.radius);
      const spawn = vec3(
        cos(angle).mul(radius),
        sin(angle).mul(radius),
        random(seed, 43).sub(0.5).mul(recipe.radius),
      );
      positions.element(instanceIndex).assign(spawn);
      velocities.element(instanceIndex).assign(launch(recipe, seed));
    })().compute(recipe.amount);
  const process = ({ positions, velocities }: IShooterVfxBuffers): ComputeNode =>
    Fn(() => {
      const angle = random(seed, 37).mul(TAU);
      const radius = random(seed, 41).sqrt().mul(recipe.radius);
      const spawn = vec3(
        cos(angle).mul(radius),
        sin(angle).mul(radius),
        random(seed, 43).sub(0.5).mul(recipe.radius),
      );
      const velocity = launch(recipe, seed);
      const lifetime = float(recipe.lifetime[0]).add(
        random(seed, 13).mul(recipe.lifetime[1] - recipe.lifetime[0]),
      );
      const elapsed = phase(recipe, seed).mul(lifetime);
      const nextPosition = spawn
        .add(velocity.mul(elapsed))
        .add(vec3(...recipe.acceleration).mul(elapsed.mul(elapsed).mul(0.5)))
        .mul(float(1).sub(recipe.drag).pow(elapsed));
      positions.element(instanceIndex).assign(nextPosition);
      velocities.element(instanceIndex).assign(velocity);
    })().compute(recipe.amount);
  material.rotationNode = atan(launch(recipe, seed).y, launch(recipe, seed).x);
  return { amount: recipe.amount, material, start, process };
}

export function createMuzzleFlash(seed = 73): IShooterVfxOptions {
  return createDonorEmitter(
    {
      amount: 180,
      lifetime: [0.112, 0.16],
      radius: 0.05,
      direction: [0, 0.12, 1],
      speed: [0.08, 0.34],
      cone: Math.PI / 8,
      size: 0.22,
      colour: [1, 0.95, 0.79],
      highlight: [1, 0.99, 0.92],
      style: "flash",
      acceleration: [0.01, 0, 0.02],
      drag: 0.62,
    },
    seed,
  );
}

export function createImpactSparks(seed = 83): IShooterVfxOptions {
  return createDonorEmitter(
    {
      amount: 260,
      lifetime: [0.23, 0.64],
      radius: 0.08,
      direction: [0.05, 1, 0.04],
      speed: [5.704, 9.2],
      cone: Math.PI / 1.75,
      size: 0.09,
      colour: [1, 0.95, 0.82],
      highlight: [1, 0.34, 0.06],
      style: "spark",
      acceleration: [0, -8.5, 0],
      drag: 0.22,
    },
    seed,
  );
}

export function createImpactDust(seed = 37): IShooterVfxOptions {
  return createDonorEmitter(
    {
      amount: 260,
      lifetime: [0.882, 1.4],
      radius: 0.18,
      direction: [0, 1, 0],
      speed: [0.28, 0.86],
      cone: 1.05,
      size: 0.42,
      colour: [0.78, 0.69, 0.54],
      highlight: [0.45, 0.42, 0.36],
      style: "smoke",
      acceleration: [0, 0.24, 0],
      drag: 0.2,
    },
    seed,
  );
}
