import {
  Fn,
  abs,
  atan,
  cos,
  cross,
  exp,
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

// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Every spark, puff and mote in the woods: one recipe per effect, each a `GPUParticles3D` the scene
// creates once and re-fires with `restart()` from the real event that caused it. The recipe owns the
// look (colour, size, lifetime, blend, launch cone, gravity); the engine only pools and dispatches.
// A `"box"` recipe fills a volume instead of a point, which is how the drifting motes and the
// falling leaves cover the whole clearing in one draw each.
export interface IVfxBuffers {
  readonly positions: StorageBufferNode<"vec3">;
  readonly velocities: StorageBufferNode<"vec3">;
}

export interface IVfxOptions {
  readonly amount: number;
  readonly material: SpriteNodeMaterial;
  readonly start: (buffers: IVfxBuffers) => ComputeNode;
  readonly process: (buffers: IVfxBuffers) => ComputeNode;
}

type Recipe = {
  readonly amount: number;
  readonly lifetime: readonly [number, number];
  readonly shape: "box" | "disc" | "line";
  readonly extent?: readonly [number, number, number];
  readonly blend?: "additive" | "normal";
  readonly fadeIn?: number;
  readonly opacity?: number;
  readonly lineStart?: readonly [number, number, number];
  readonly lineEnd?: readonly [number, number, number];
  readonly radius: number;
  readonly direction: readonly [number, number, number];
  readonly speed: readonly [number, number];
  readonly cone: number;
  readonly size: number;
  readonly ribbonWidth?: number;
  readonly colour: readonly [number, number, number];
  readonly highlight: readonly [number, number, number];
  readonly style: "arc" | "glow" | "spark";
  readonly acceleration: readonly [number, number, number];
  readonly drag: number;
};

const TAU = Math.PI * 2;

function random(seed: number, salt: number) {
  return hash(instanceIndex.add(seed + salt));
}

function phase(recipe: Recipe, seed: number) {
  const lifetime = float(recipe.lifetime[0]).add(
    random(seed, 13).mul(recipe.lifetime[1] - recipe.lifetime[0]),
  );
  return fract(time.div(lifetime).add(random(seed, 19)));
}

function spawnPosition(recipe: Recipe, seed: number) {
  const lineStart = recipe.lineStart ?? [0, 0, 0];
  const lineEnd = recipe.lineEnd ?? [0, 0, 0];
  const along = random(seed, 3);
  if (recipe.shape === "line") {
    return vec3(...lineStart)
      .mul(float(1).sub(along))
      .add(vec3(...lineEnd).mul(along));
  }
  if (recipe.shape === "box") {
    const [ex, ey, ez] = recipe.extent ?? [1, 1, 1];
    return vec3(
      random(seed, 5).sub(0.5).mul(ex),
      random(seed, 6).sub(0.5).mul(ey),
      random(seed, 8).sub(0.5).mul(ez),
    );
  }
  const angle = random(seed, 7).mul(TAU);
  const radius = random(seed, 11).sqrt().mul(recipe.radius);
  return vec3(
    cos(angle).mul(radius),
    sin(angle).mul(radius),
    random(seed, 17)
      .sub(0.5)
      .mul(recipe.radius * 0.16),
  );
}

function launch(recipe: Recipe, seed: number) {
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

function mask(style: Recipe["style"]) {
  const point = uv().sub(0.5);
  const radius = point.length();
  if (style === "spark") {
    const streak = float(1)
      .sub(smoothstep(0.018, 0.09, abs(point.y)))
      .mul(float(1).sub(smoothstep(0.12, 0.5, abs(point.x))));
    return float(1)
      .sub(smoothstep(0.05, 0.5, radius))
      .max(streak);
  }
  if (style === "glow") {
    return float(1)
      .sub(smoothstep(0.08, 0.56, radius))
      .add(float(0.2).mul(float(1).sub(smoothstep(0.01, 0.2, radius))));
  }
  const crossRay = float(1)
    .sub(smoothstep(0.018, 0.09, abs(point.x)))
    .max(float(1).sub(smoothstep(0.018, 0.09, abs(point.y))));
  const diagonal = float(1)
    .sub(smoothstep(0.018, 0.075, abs(point.x.sub(point.y))))
    .max(float(1).sub(smoothstep(0.018, 0.075, abs(point.x.add(point.y)))));
  return float(1)
    .sub(smoothstep(0.08, 0.5, radius))
    .max(crossRay.max(diagonal).mul(smoothstep(0.5, 0.05, radius)));
}

function createEmitter(recipe: Recipe, seed: number): IVfxOptions {
  const material = new SpriteMaterial({
    blending: recipe.blend === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  const particlePhase = varying(phase(recipe, seed));
  const scale =
    recipe.shape === "line"
      ? vec2(
          Math.max(recipe.size * 3.8, recipe.lineEnd?.[0] ?? recipe.size),
          recipe.ribbonWidth ?? recipe.size,
        )
      : vec2(recipe.size);
  material.scaleNode = scale
    .mul(recipe.style === "glow" ? mix(1.08, 0.66, particlePhase) : mix(1.16, 0.36, particlePhase))
    .mul(0.52);
  material.colorNode = vec4(
    mix(vec3(...recipe.colour), vec3(...recipe.highlight), particlePhase),
    mask(recipe.style)
      .mul(float(1).sub(smoothstep(0.96, 1, particlePhase)))
      .mul(recipe.fadeIn === undefined ? 1 : smoothstep(0, recipe.fadeIn, particlePhase))
      .mul(recipe.opacity ?? 0.96),
  );
  const start = ({ positions, velocities }: IVfxBuffers): ComputeNode =>
    Fn(() => {
      const spawn = spawnPosition(recipe, seed);
      positions.element(instanceIndex).assign(spawn);
      velocities.element(instanceIndex).assign(launch(recipe, seed));
    })().compute(recipe.amount);
  const process = ({ positions, velocities }: IVfxBuffers): ComputeNode =>
    Fn(() => {
      const spawn = spawnPosition(recipe, seed);
      const velocity = launch(recipe, seed);
      const lifetime = float(recipe.lifetime[0]).add(
        random(seed, 13).mul(recipe.lifetime[1] - recipe.lifetime[0]),
      );
      const elapsed = phase(recipe, seed).mul(lifetime);
      const nextPosition = spawn
        .add(velocity.mul(elapsed))
        .add(vec3(...recipe.acceleration).mul(elapsed.mul(elapsed).mul(0.5)))
        .mul(exp(float(-recipe.drag).mul(elapsed)));
      positions.element(instanceIndex).assign(nextPosition);
      velocities.element(instanceIndex).assign(velocity);
    })().compute(recipe.amount);
  const direction = launch(recipe, seed);
  material.rotationNode = atan(direction.y, direction.x);
  return { amount: recipe.amount, material, start, process };
}

/** The sword's crescent: a short ribbon of pale light, fired at the moment the blade swings. */
export function createAttackArc(seed = 41): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0, 0, 0],
      amount: 150,
      colour: [1, 0.98, 0.9],
      cone: 0.34,
      direction: [0, 0.2, 0],
      drag: 0.06,
      highlight: [0.85, 0.95, 0.6],
      lifetime: [0.12, 0.26],
      lineEnd: [0.55, 0.3, 0.2],
      lineStart: [-0.55, 0.1, -0.2],
      radius: 0,
      ribbonWidth: 0.05,
      shape: "line",
      size: 0.08,
      speed: [0.15, 0.55],
      style: "arc",
    },
    seed,
  );
}

/** A blow landing: warm sparks thrown up and out, falling under gravity. */
export function createHitBurst(seed = 53): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0, -8.5, 0],
      amount: 160,
      colour: [1, 0.95, 0.75],
      cone: Math.PI / 1.75,
      direction: [0.05, 1, 0.04],
      drag: 0.22,
      highlight: [0.95, 0.6, 0.15],
      lifetime: [0.23, 0.6],
      radius: 0.08,
      shape: "disc",
      size: 0.085,
      speed: [3.5, 6.5],
      style: "spark",
    },
    seed,
  );
}

/** A pot bursting: tan and brown crumbs that fall, drawn opaque so dark colours stay dark. */
export function createPotBurst(seed = 71): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0, -9, 0],
      amount: 90,
      blend: "normal",
      colour: [0.62, 0.5, 0.32],
      cone: Math.PI / 2.2,
      direction: [0, 1, 0],
      drag: 0.3,
      highlight: [0.34, 0.26, 0.16],
      lifetime: [0.4, 0.9],
      radius: 0.12,
      shape: "disc",
      size: 0.11,
      speed: [1.6, 3.6],
      style: "glow",
    },
    seed,
  );
}

/** A sigil, a chest or the altar waking: a rising fountain of gold-white light. */
export function createSigilBurst(seed = 67): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0, 0.9, 0],
      amount: 240,
      colour: [1, 0.96, 0.78],
      cone: Math.PI / 1.4,
      direction: [0, 1, 0],
      drag: 0.18,
      highlight: [0.75, 1, 0.7],
      lifetime: [0.9, 1.7],
      radius: 0.25,
      shape: "disc",
      size: 0.16,
      speed: [1.2, 3.4],
      style: "glow",
    },
    seed,
  );
}

/** A gem picked up: a few green glints. */
export function createGemGlint(seed = 79): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0, -3, 0],
      amount: 40,
      colour: [0.8, 1, 0.85],
      cone: Math.PI / 2,
      direction: [0, 1, 0],
      drag: 0.4,
      highlight: [0.3, 0.85, 0.55],
      lifetime: [0.3, 0.6],
      radius: 0.05,
      shape: "disc",
      size: 0.07,
      speed: [1.2, 2.6],
      style: "spark",
    },
    seed,
  );
}

/** Sunlit dust hanging in the air over the whole clearing. */
export function createMotes(seed = 89): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0.01, 0.005, 0],
      amount: 170,
      colour: [1, 0.96, 0.7],
      cone: Math.PI,
      direction: [0, 1, 0],
      drag: 0,
      extent: [64, 9, 64],
      fadeIn: 0.2,
      highlight: [1, 0.9, 0.6],
      lifetime: [7, 12],
      radius: 0,
      shape: "box",
      size: 0.09,
      speed: [0.03, 0.14],
      style: "glow",
    },
    seed,
  );
}

/** Leaves let go by the canopy, coming down slowly all across the clearing. */
export function createFallingLeaves(seed = 97): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0.03, -0.16, 0.01],
      amount: 46,
      blend: "normal",
      colour: [0.62, 0.72, 0.34],
      cone: 0.5,
      direction: [0.2, -0.2, 0.1],
      drag: 0,
      extent: [56, 2, 56],
      fadeIn: 0.06,
      highlight: [0.72, 0.62, 0.28],
      lifetime: [11, 16],
      radius: 0,
      shape: "box",
      size: 0.16,
      speed: [0.05, 0.2],
      style: "glow",
    },
    seed,
  );
}

/** Low mist lying on the paths: big soft puffs, mostly transparent, drifting slowly along the ground. */
export function createGroundMist(seed = 101): IVfxOptions {
  return createEmitter(
    {
      acceleration: [0, 0, 0],
      amount: 90,
      blend: "normal",
      colour: [0.78, 0.8, 0.68],
      cone: Math.PI,
      direction: [0.3, 0.02, 0.1],
      drag: 0,
      extent: [46, 0.9, 74],
      fadeIn: 0.25,
      highlight: [0.92, 0.92, 0.8],
      lifetime: [10, 17],
      opacity: 0.11,
      radius: 0,
      shape: "box",
      size: 3.2,
      speed: [0.05, 0.22],
      style: "glow",
    },
    seed,
  );
}
