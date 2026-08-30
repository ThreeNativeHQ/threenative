import { Group, Vector4 } from "three";
import type { Node, UniformNode } from "three/src/nodes/Nodes.js";
import type UniformArrayNode from "three/src/nodes/accessors/UniformArrayNode.js";
import {
  Fn,
  If,
  Loop,
  abs,
  clamp,
  compute,
  float,
  instanceIndex,
  length,
  storageTexture,
  textureStore,
  uint,
  uniform,
  uniformArray,
  uvec2,
  vec2,
  vec4,
} from "three/tsl";
import {
  ClampToEdgeWrapping,
  type ComputeNode,
  FloatType,
  RGBAFormat,
  StorageTexture,
  type StorageTextureNode,
} from "three/webgpu";
import type { IRendererLike } from "./renderer.js";

export interface IFluidFieldVector2 {
  readonly x: number;
  readonly y: number;
}

export interface IFluidFieldOptions {
  readonly resolution: number;
  readonly viscosity?: number;
  readonly pressureIterations?: number;
  readonly maxSplats?: number;
  readonly timeStep?: number;
  readonly vorticity?: number;
  readonly splatRadius?: number;
}

export interface IFluidFieldSampler {
  sample(uv: Node<"vec2">): StorageTextureNode;
}

type TexturePair = readonly [StorageTexture, StorageTexture];
type ComputePair = readonly [ComputeNode, ComputeNode];
type ComputeMatrix = readonly [ComputePair, ComputePair];

const DEFAULT_MAX_SPLATS = 8;
const DEFAULT_TIME_STEP = 1 / 60;
const DEFAULT_VORTICITY = 0.2;
const DEFAULT_SPLAT_RADIUS = 0.08;

function positiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`FluidField2D.${name} must be positive.`);
}

function nonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`FluidField2D.${name} must be non-negative.`);
}

function storage(width: number, height: number): StorageTexture {
  const texture = new StorageTexture(width, height);
  texture.type = FloatType;
  texture.format = RGBAFormat;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function computeKernel(name: string, resolution: number, callback: () => Node): ComputeNode {
  const node = compute(Fn(callback)(), resolution * resolution);
  node.setName(name);
  return node;
}

/** @internal Keep the scalar regression model in lockstep with the TSL force mapping. */
export function mapVorticityForce<T>(
  force: Readonly<{ x: T; y: T }>,
  negate: (value: T) => T,
): readonly [T, T] {
  return [force.x, negate(force.y)];
}

function pixelCoordinate(resolution: number) {
  return uvec2(instanceIndex.mod(resolution), instanceIndex.div(resolution));
}

function pixelUv(resolution: number): Node<"vec2"> {
  return vec2(
    float(instanceIndex.mod(resolution)).add(0.5).div(resolution),
    float(instanceIndex.div(resolution)).add(0.5).div(resolution),
  );
}

function readFluidTexture(texture: StorageTexture): StorageTextureNode {
  return storageTexture(texture).toReadOnly().setSampler(false);
}

function sampleAt(
  texture: StorageTextureNode,
  uv: Node<"vec2">,
  resolution: number,
): StorageTextureNode {
  const size = resolution;
  return texture.sample(
    uvec2(uint(clamp(uv.x.mul(size), 0, size - 1)), uint(clamp(uv.y.mul(size), 0, size - 1))),
  );
}

class FluidFieldSampler implements IFluidFieldSampler {
  #texture: StorageTextureNode;
  #resolution: number;

  constructor(texture: StorageTexture, resolution: number) {
    this.#texture = readFluidTexture(texture);
    this.#resolution = resolution;
  }

  sample(uv: Node<"vec2">): StorageTextureNode {
    return sampleAt(this.#texture, uv, this.#resolution);
  }

  setTexture(texture: StorageTexture): void {
    this.#texture.value = texture;
  }
}

function write(texture: StorageTexture, resolution: number, value: Node): StorageTextureNode {
  return textureStore(
    storageTexture(texture).toWriteOnly(),
    pixelCoordinate(resolution),
    value,
  ).toWriteOnly();
}

function neighbour(
  texture: StorageTextureNode,
  uv: Node<"vec2">,
  texel: Node<"vec2">,
  resolution: number,
  x: number,
  y: number,
) {
  return sampleAt(texture, clamp(uv.add(vec2(x, y).mul(texel)), 0, 1), resolution);
}

function pair<T>(first: T, second: T): readonly [T, T] {
  return [first, second];
}

/**
 * Run a deterministic GPU fluid field whose data stays available to the game's render graph.
 *
 * The class is deliberately a scene object with the compute-driven lifecycle contract: adding it
 * to a game scene attaches the renderer, warm-up sees every pass, fixed steps dispatch the passes,
 * and removing it releases every GPU allocation. `dye` and `velocity` are read-only numeric
 * samplers; the game decides what those values become when drawn.
 * @situation simulate smoke, fire, fog, wind, or fluid response on a grid
 * @situation inject a touch, pointer, or gameplay impulse into a fluid field
 * @situation sample fluid dye or velocity in a game-owned render node
 * @constraint add the field through `ctx.add` so renderer attachment, fixed-step dispatch, and release are automatic
 * @constraint `dye` and `velocity` are numeric samplers; appearance stays in the game's `src/render/` code
 * @override pressureIterations, viscosity, vorticity, and splatRadius tune the solver without changing its pass order
 * @example const field = new FluidField2D({ resolution: 256, viscosity: 0, pressureIterations: 20 });
 * ctx.add(field);
 * field.splat({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0 }, 1);
 */
export class FluidField2D extends Group {
  readonly resolution: number;
  readonly viscosity: number;
  readonly pressureIterations: number;
  readonly maxSplats: number;
  readonly timeStep: number;
  readonly vorticity: number;
  readonly splatRadius: number;
  readonly processCadence = "fixed" as const;
  readonly warmupNodes: readonly ComputeNode[];
  readonly velocity: IFluidFieldSampler;
  readonly dye: IFluidFieldSampler;

  #velocityTextures: TexturePair;
  #dyeTextures: TexturePair;
  #pressureTextures: TexturePair;
  #curlTexture: StorageTexture;
  #divergenceTexture: StorageTexture;
  #velocitySplat: ComputePair;
  #dyeSplat: ComputePair;
  #curl: ComputePair;
  #vorticity: ComputePair;
  #divergence: ComputePair;
  #pressureReset: ComputeNode;
  #pressureSolve: ComputePair;
  #gradient: ComputeMatrix;
  #advectVelocity: ComputePair;
  #advectDye: ComputeMatrix;
  #velocitySampler: FluidFieldSampler;
  #dyeSampler: FluidFieldSampler;
  #splatPositions: UniformArrayNode<"vec4">;
  #splatAmounts: UniformArrayNode<"vec4">;
  #splatCount: UniformNode<"uint", number>;
  #renderer: IRendererLike | undefined;
  #velocityIndex = 0;
  #dyeIndex = 0;
  #pressureIndex = 0;
  #queuedSplats = 0;
  #steps = 0;
  #splatsApplied = 0;
  #released = false;

  constructor(options: IFluidFieldOptions) {
    if (!Number.isInteger(options.resolution) || options.resolution < 2)
      throw new Error("FluidField2D.resolution must be an integer of at least 2.");
    const pressureIterations = options.pressureIterations ?? 20;
    const maxSplats = options.maxSplats ?? DEFAULT_MAX_SPLATS;
    const timeStep = options.timeStep ?? DEFAULT_TIME_STEP;
    const viscosity = options.viscosity ?? 0;
    const vorticity = options.vorticity ?? DEFAULT_VORTICITY;
    const splatRadius = options.splatRadius ?? DEFAULT_SPLAT_RADIUS;
    if (!Number.isInteger(pressureIterations) || pressureIterations < 0)
      throw new Error("FluidField2D.pressureIterations must be a non-negative integer.");
    if (!Number.isInteger(maxSplats) || maxSplats <= 0)
      throw new Error("FluidField2D.maxSplats must be a positive integer.");
    nonNegativeFinite("viscosity", viscosity);
    positiveFinite("timeStep", timeStep);
    nonNegativeFinite("vorticity", vorticity);
    positiveFinite("splatRadius", splatRadius);

    super();
    this.resolution = options.resolution;
    this.pressureIterations = pressureIterations;
    this.maxSplats = maxSplats;
    this.timeStep = timeStep;
    this.viscosity = viscosity;
    this.vorticity = vorticity;
    this.splatRadius = splatRadius;

    this.#velocityTextures = pair(
      storage(this.resolution, this.resolution),
      storage(this.resolution, this.resolution),
    );
    this.#dyeTextures = pair(
      storage(this.resolution, this.resolution),
      storage(this.resolution, this.resolution),
    );
    this.#pressureTextures = pair(
      storage(this.resolution, this.resolution),
      storage(this.resolution, this.resolution),
    );
    this.#curlTexture = storage(this.resolution, this.resolution);
    this.#divergenceTexture = storage(this.resolution, this.resolution);
    this.#velocitySampler = new FluidFieldSampler(this.#velocityTextures[0], this.resolution);
    this.#dyeSampler = new FluidFieldSampler(this.#dyeTextures[0], this.resolution);
    this.velocity = this.#velocitySampler;
    this.dye = this.#dyeSampler;
    this.#splatPositions = uniformArray(
      Array.from({ length: this.maxSplats }, () => new Vector4()),
      "vec4",
    );
    this.#splatAmounts = uniformArray(
      Array.from({ length: this.maxSplats }, () => new Vector4()),
      "vec4",
    );
    this.#splatCount = uniform(0, "uint");

    const initial = this.#makeInitialPasses();
    this.#velocitySplat = this.#makeVelocitySplatPair();
    this.#dyeSplat = this.#makeDyeSplatPair();
    this.#curl = this.#makeCurlPair();
    this.#vorticity = this.#makeVorticityPair();
    this.#divergence = this.#makeDivergence();
    this.#pressureReset = this.#makePressureReset();
    this.#pressureSolve = this.#makePressureSolvePair();
    this.#gradient = this.#makeGradientMatrix();
    this.#advectVelocity = this.#makeAdvectVelocityPair();
    this.#advectDye = this.#makeAdvectDyeMatrix();
    this.warmupNodes = [
      ...initial,
      ...this.#velocitySplat,
      ...this.#dyeSplat,
      ...this.#curl,
      ...this.#vorticity,
      ...this.#divergence,
      this.#pressureReset,
      ...this.#pressureSolve,
      ...this.#gradient.flat(),
      ...this.#advectVelocity,
      ...this.#advectDye.flat(),
    ];
    this.addEventListener("removed", this.#onRemoved);
  }

  get released(): boolean {
    return this.#released;
  }

  get queuedSplats(): number {
    return this.#queuedSplats;
  }

  get steps(): number {
    return this.#steps;
  }

  get splatsApplied(): number {
    return this.#splatsApplied;
  }

  attachRenderer(renderer: IRendererLike): void {
    if (this.#released) throw new Error("FluidField2D cannot be attached after release.");
    if (this.#renderer === renderer) return;
    if (this.#renderer !== undefined)
      throw new Error("FluidField2D is already attached to a renderer.");
    this.#renderer = renderer;
    for (const node of this.warmupNodes.slice(0, 8)) renderer.compute(node);
  }

  splat(uv: IFluidFieldVector2, velocity: IFluidFieldVector2, amount: number): void {
    if (this.#released) throw new Error("FluidField2D cannot splat after release.");
    if (![uv.x, uv.y, velocity.x, velocity.y, amount].every(Number.isFinite))
      throw new Error("FluidField2D.splat arguments must be finite.");
    if (amount < 0) throw new Error("FluidField2D.splat amount must be non-negative.");
    if (amount === 0) return;
    if (this.#queuedSplats >= this.maxSplats) return;
    const offset = this.#queuedSplats * 4;
    const position = this.#splatPositions.array[offset / 4] as Vector4;
    const splatAmount = this.#splatAmounts.array[offset / 4] as Vector4;
    position.set(clampNumber(uv.x, 0, 1), clampNumber(uv.y, 0, 1), velocity.x, velocity.y);
    splatAmount.set(amount, 0, 0, 0);
    this.#queuedSplats += 1;
  }

  process(renderer = this.#renderer): void {
    if (this.#released) return;
    if (renderer === undefined) throw new Error("FluidField2D is not attached to a renderer.");
    this.#splatCount.value = this.#queuedSplats;
    this.#dispatch(
      renderer,
      tupleValue(this.#velocitySplat, this.#velocityIndex, "velocity splat"),
    );
    this.#velocityIndex = 1 - this.#velocityIndex;
    this.#dispatch(renderer, tupleValue(this.#dyeSplat, this.#dyeIndex, "dye splat"));
    this.#dyeIndex = 1 - this.#dyeIndex;
    this.#queuedSplats = 0;
    this.#dispatch(renderer, tupleValue(this.#curl, this.#velocityIndex, "curl"));
    this.#dispatch(renderer, tupleValue(this.#vorticity, this.#velocityIndex, "vorticity"));
    this.#velocityIndex = 1 - this.#velocityIndex;
    this.#dispatch(renderer, tupleValue(this.#divergence, this.#velocityIndex, "divergence"));
    this.#dispatch(renderer, this.#pressureReset);
    this.#pressureIndex = 0;
    for (let iteration = 0; iteration < this.pressureIterations; iteration += 1) {
      this.#dispatch(
        renderer,
        tupleValue(this.#pressureSolve, this.#pressureIndex, "pressure solve"),
      );
      this.#pressureIndex = 1 - this.#pressureIndex;
    }
    this.#dispatch(
      renderer,
      matrixValue(this.#gradient, this.#velocityIndex, this.#pressureIndex, "gradient"),
    );
    this.#velocityIndex = 1 - this.#velocityIndex;
    this.#dispatch(
      renderer,
      tupleValue(this.#advectVelocity, this.#velocityIndex, "velocity advection"),
    );
    this.#velocityIndex = 1 - this.#velocityIndex;
    this.#dispatch(
      renderer,
      matrixValue(this.#advectDye, this.#dyeIndex, this.#velocityIndex, "dye advection"),
    );
    this.#dyeIndex = 1 - this.#dyeIndex;
    this.#velocitySampler.setTexture(
      tupleValue(this.#velocityTextures, this.#velocityIndex, "velocity texture"),
    );
    this.#dyeSampler.setTexture(tupleValue(this.#dyeTextures, this.#dyeIndex, "dye texture"));
    this.#steps += 1;
    this.#splatsApplied += this.#splatCount.value;
  }

  detach(): void {
    if (this.#released) return;
    this.#renderer = undefined;
    for (const node of this.warmupNodes) node.dispose();
    for (const texture of [
      ...this.#velocityTextures,
      ...this.#dyeTextures,
      ...this.#pressureTextures,
      this.#curlTexture,
      this.#divergenceTexture,
    ])
      texture.dispose();
    this.#released = true;
  }

  #dispatch(renderer: IRendererLike, node: ComputeNode): void {
    renderer.compute(node);
  }

  #makeInitialPasses(): ComputeNode[] {
    const textures = [
      ...this.#velocityTextures,
      ...this.#dyeTextures,
      ...this.#pressureTextures,
      this.#curlTexture,
      this.#divergenceTexture,
    ];
    return textures.map((texture, index) =>
      computeKernel(`fluid.init.${index}`, this.resolution, () =>
        write(texture, this.resolution, vec4(0)),
      ),
    );
  }

  #makeVelocitySplatPair(): ComputePair {
    return this.#makePair("fluid.splat.velocity", this.#velocityTextures, (source, target) => {
      const sourceNode = readFluidTexture(source);
      const uv = pixelUv(this.resolution);
      const pixel = sampleAt(sourceNode, uv, this.resolution).toVar();
      Loop({ type: "uint", start: 0, end: this.#splatCount }, ({ i }) => {
        const position = this.#splatPositions.element(i);
        const impulse = this.#splatAmounts.element(i).x;
        const influence = clamp(
          float(1).sub(length(uv.sub(position.xy)).div(this.splatRadius)),
          0,
          1,
        );
        If(influence.greaterThan(0), () =>
          pixel.assign(vec4(pixel.xy.add(position.zw.mul(impulse).mul(influence)), pixel.zw)),
        );
      });
      return write(target, this.resolution, pixel);
    });
  }

  #makeDyeSplatPair(): ComputePair {
    return this.#makePair("fluid.splat.dye", this.#dyeTextures, (source, target) => {
      const sourceNode = readFluidTexture(source);
      const uv = pixelUv(this.resolution);
      const pixel = sampleAt(sourceNode, uv, this.resolution).toVar();
      Loop({ type: "uint", start: 0, end: this.#splatCount }, ({ i }) => {
        const position = this.#splatPositions.element(i);
        const amount = this.#splatAmounts.element(i).x;
        const influence = clamp(
          float(1).sub(length(uv.sub(position.xy)).div(this.splatRadius)),
          0,
          1,
        );
        If(influence.greaterThan(0), () => pixel.x.addAssign(amount.mul(influence)));
      });
      return write(target, this.resolution, pixel);
    });
  }

  #makeCurlPair(): ComputePair {
    return pair(
      this.#makeCurlKernel("fluid.curl.a", this.#velocityTextures[0]),
      this.#makeCurlKernel("fluid.curl.b", this.#velocityTextures[1]),
    );
  }

  #makeCurlKernel(name: string, sourceTexture: StorageTexture): ComputeNode {
    const source = readFluidTexture(sourceTexture);
    return computeKernel(name, this.resolution, () => {
      const uv = pixelUv(this.resolution);
      const texel = vec2(1 / this.resolution);
      const center = sampleAt(source, uv, this.resolution);
      const l = neighbour(source, uv, texel, this.resolution, -1, 0).y;
      const r = neighbour(source, uv, texel, this.resolution, 1, 0).y;
      const b = neighbour(source, uv, texel, this.resolution, 0, -1).x;
      const t = neighbour(source, uv, texel, this.resolution, 0, 1).x;
      return write(
        this.#curlTexture,
        this.resolution,
        vec4(0, 0, r.sub(l).sub(t).add(b).mul(0.5), center.w),
      );
    });
  }

  #makeVorticityPair(): ComputePair {
    return this.#makePair("fluid.vorticity", this.#velocityTextures, (source, target) => {
      const velocity = readFluidTexture(source);
      const curl = readFluidTexture(this.#curlTexture);
      const uv = pixelUv(this.resolution);
      const texel = vec2(1 / this.resolution);
      const center = sampleAt(velocity, uv, this.resolution);
      const curlCenter = sampleAt(curl, uv, this.resolution).z;
      const gradient = vec2(
        abs(neighbour(curl, uv, texel, this.resolution, 0, 1).z).sub(
          abs(neighbour(curl, uv, texel, this.resolution, 0, -1).z),
        ),
        abs(neighbour(curl, uv, texel, this.resolution, 1, 0).z).sub(
          abs(neighbour(curl, uv, texel, this.resolution, -1, 0).z),
        ),
      );
      const force = gradient.div(length(gradient).add(0.0001));
      const [forceX, forceY] = mapVorticityForce(force, (value) => value.negate());
      const next = center.xy.add(
        vec2(forceX, forceY)
          .mul(curlCenter)
          .mul(this.vorticity * this.timeStep),
      );
      return write(target, this.resolution, vec4(next, center.zw));
    });
  }

  #makeDivergence(): ComputePair {
    return pair(
      this.#makeDivergenceKernel("fluid.divergence.a", this.#velocityTextures[0]),
      this.#makeDivergenceKernel("fluid.divergence.b", this.#velocityTextures[1]),
    );
  }

  #makeDivergenceKernel(name: string, sourceTexture: StorageTexture): ComputeNode {
    const source = readFluidTexture(sourceTexture);
    return computeKernel(name, this.resolution, () => {
      const uv = pixelUv(this.resolution);
      const texel = vec2(1 / this.resolution);
      const left = neighbour(source, uv, texel, this.resolution, -1, 0).x;
      const right = neighbour(source, uv, texel, this.resolution, 1, 0).x;
      const bottom = neighbour(source, uv, texel, this.resolution, 0, -1).y;
      const top = neighbour(source, uv, texel, this.resolution, 0, 1).y;
      return write(
        this.#divergenceTexture,
        this.resolution,
        vec4(0, 0, 0, right.sub(left).add(top).sub(bottom).mul(0.5)),
      );
    });
  }

  #makePressureReset(): ComputeNode {
    return computeKernel("fluid.pressure.reset", this.resolution, () =>
      write(this.#pressureTextures[0], this.resolution, vec4(0)),
    );
  }

  #makePressureSolvePair(): ComputePair {
    const divergence = readFluidTexture(this.#divergenceTexture);
    return pair(
      this.#makePressureKernel(
        "fluid.pressure.solve.a",
        this.#pressureTextures[0],
        this.#pressureTextures[1],
        divergence,
      ),
      this.#makePressureKernel(
        "fluid.pressure.solve.b",
        this.#pressureTextures[1],
        this.#pressureTextures[0],
        divergence,
      ),
    );
  }

  #makePressureKernel(
    name: string,
    sourceTexture: StorageTexture,
    targetTexture: StorageTexture,
    divergence: StorageTextureNode,
  ): ComputeNode {
    return computeKernel(name, this.resolution, () => {
      const pressure = readFluidTexture(sourceTexture);
      const uv = pixelUv(this.resolution);
      const texel = vec2(1 / this.resolution);
      const left = neighbour(pressure, uv, texel, this.resolution, -1, 0).x;
      const right = neighbour(pressure, uv, texel, this.resolution, 1, 0).x;
      const bottom = neighbour(pressure, uv, texel, this.resolution, 0, -1).x;
      const top = neighbour(pressure, uv, texel, this.resolution, 0, 1).x;
      const value = left
        .add(right)
        .add(bottom)
        .add(top)
        .sub(sampleAt(divergence, uv, this.resolution).w)
        .mul(0.25);
      return write(targetTexture, this.resolution, vec4(value, 0, 0, 0));
    });
  }

  #makeGradientMatrix(): ComputeMatrix {
    return [
      [
        this.#makeGradientKernel(
          "fluid.gradient.a.a",
          this.#velocityTextures[0],
          this.#velocityTextures[1],
          this.#pressureTextures[0],
        ),
        this.#makeGradientKernel(
          "fluid.gradient.a.b",
          this.#velocityTextures[0],
          this.#velocityTextures[1],
          this.#pressureTextures[1],
        ),
      ],
      [
        this.#makeGradientKernel(
          "fluid.gradient.b.a",
          this.#velocityTextures[1],
          this.#velocityTextures[0],
          this.#pressureTextures[0],
        ),
        this.#makeGradientKernel(
          "fluid.gradient.b.b",
          this.#velocityTextures[1],
          this.#velocityTextures[0],
          this.#pressureTextures[1],
        ),
      ],
    ];
  }

  #makeGradientKernel(
    name: string,
    sourceTexture: StorageTexture,
    targetTexture: StorageTexture,
    pressureTexture: StorageTexture,
  ): ComputeNode {
    return computeKernel(name, this.resolution, () => {
      const velocity = readFluidTexture(sourceTexture);
      const pressure = readFluidTexture(pressureTexture);
      const uv = pixelUv(this.resolution);
      const texel = vec2(1 / this.resolution);
      const center = sampleAt(velocity, uv, this.resolution);
      const gradient = vec2(
        neighbour(pressure, uv, texel, this.resolution, 1, 0).x.sub(
          neighbour(pressure, uv, texel, this.resolution, -1, 0).x,
        ),
        neighbour(pressure, uv, texel, this.resolution, 0, 1).x.sub(
          neighbour(pressure, uv, texel, this.resolution, 0, -1).x,
        ),
      ).mul(0.5);
      return write(targetTexture, this.resolution, vec4(center.xy.sub(gradient), center.zw));
    });
  }

  #makeAdvectVelocityPair(): ComputePair {
    return this.#makePair("fluid.advect.velocity", this.#velocityTextures, (source, target) => {
      const velocity = readFluidTexture(source);
      const uv = pixelUv(this.resolution);
      const texel = vec2(1 / this.resolution);
      const center = sampleAt(velocity, uv, this.resolution);
      const traced = clamp(uv.sub(center.xy.mul(this.timeStep)), 0, 1);
      const advected = sampleAt(velocity, traced, this.resolution).xy;
      const laplacian = neighbour(velocity, uv, texel, this.resolution, -1, 0)
        .xy.add(neighbour(velocity, uv, texel, this.resolution, 1, 0).xy)
        .add(neighbour(velocity, uv, texel, this.resolution, 0, -1).xy)
        .add(neighbour(velocity, uv, texel, this.resolution, 0, 1).xy)
        .sub(center.xy.mul(4));
      const next = advected.add(laplacian.mul(this.viscosity * this.timeStep));
      return write(target, this.resolution, vec4(next, center.zw));
    });
  }

  #makeAdvectDyeMatrix(): ComputeMatrix {
    return [
      [
        this.#makeAdvectDyeKernel(
          "fluid.advect.dye.a.a",
          this.#dyeTextures[0],
          this.#dyeTextures[1],
          this.#velocityTextures[0],
        ),
        this.#makeAdvectDyeKernel(
          "fluid.advect.dye.a.b",
          this.#dyeTextures[0],
          this.#dyeTextures[1],
          this.#velocityTextures[1],
        ),
      ],
      [
        this.#makeAdvectDyeKernel(
          "fluid.advect.dye.b.a",
          this.#dyeTextures[1],
          this.#dyeTextures[0],
          this.#velocityTextures[0],
        ),
        this.#makeAdvectDyeKernel(
          "fluid.advect.dye.b.b",
          this.#dyeTextures[1],
          this.#dyeTextures[0],
          this.#velocityTextures[1],
        ),
      ],
    ];
  }

  #makeAdvectDyeKernel(
    name: string,
    sourceTexture: StorageTexture,
    targetTexture: StorageTexture,
    velocityTexture: StorageTexture,
  ): ComputeNode {
    return computeKernel(name, this.resolution, () => {
      const dye = readFluidTexture(sourceTexture);
      const velocity = readFluidTexture(velocityTexture);
      const uv = pixelUv(this.resolution);
      const traced = clamp(
        uv.sub(sampleAt(velocity, uv, this.resolution).xy.mul(this.timeStep)),
        0,
        1,
      );
      return write(targetTexture, this.resolution, sampleAt(dye, traced, this.resolution));
    });
  }

  #makePair(
    name: string,
    textures: TexturePair,
    callback: (source: StorageTexture, target: StorageTexture) => Node,
  ): ComputePair {
    return pair(
      computeKernel(`${name}.a`, this.resolution, () => callback(textures[0], textures[1])),
      computeKernel(`${name}.b`, this.resolution, () => callback(textures[1], textures[0])),
    );
  }

  #onRemoved = (): void => this.detach();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tupleValue<T>(values: readonly T[], index: number, name: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(`FluidField2D.${name} pass is missing.`);
  return value;
}

function matrixValue<T>(
  values: readonly (readonly T[])[],
  row: number,
  column: number,
  name: string,
): T {
  return tupleValue(tupleValue(values, row, `${name} row`), column, `${name} column`);
}
