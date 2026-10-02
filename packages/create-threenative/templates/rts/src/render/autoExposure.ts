// Generated for you: ordinary Three.js GPU metering; exposure.ts owns the game's look.
import { FloatType, NearestFilter, RenderTarget, Texture, Vector2 } from "three";
import {
  Fn,
  If,
  float,
  ivec2,
  mix,
  nodeObject,
  screenCoordinate,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import {
  type Node,
  type NodeBuilder,
  type NodeFrame,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  type Renderer,
  RendererUtils,
  TempNode,
} from "three/webgpu";
import {
  type IExposureSettings,
  exposureLuminance,
  exposureMeter,
  exposureReductionSizes,
  validateExposureSettings,
} from "./exposure.js";

type ColourTexture = ReturnType<typeof texture>;
type Meter = (colour: Node<"vec4">, uv: Node<"vec2">) => Node<"vec2">;
type Decode = (mean: Node<"float">) => Node<"float">;

function target(): RenderTarget {
  return new RenderTarget(1, 1, {
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
  });
}

/** Sum/16 at each level keeps values bounded. Mask partial blocks; never replicate edge texels. */
function reduce(input: ColourTexture, size: Node<"vec2">, meter?: Meter): Node<"vec4"> {
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

/** Scene-referred exposure changes light, never coverage/compositing alpha. */
export function applyExposure(colour: Node<"vec4">, exposure: Node<"float">): Node<"vec4"> {
  return vec4(colour.rgb.mul(exposure), colour.a);
}

/** Owns scratch targets only. Never draws the world or installs another output transform. */
export class AutoExposureNode extends TempNode<"float"> {
  static get type(): string {
    return "AutoExposureNode";
  }
  readonly input: ColourTexture;
  readonly settings: Readonly<IExposureSettings>;
  readonly #constant: number;
  readonly #size = new Vector2();
  readonly #sourceSize = uniform(new Vector2(1, 1));
  readonly #reduceSize = uniform(new Vector2(1, 1));
  readonly #delta = uniform(0);
  readonly #resetMode = uniform(1); // 0 = history, 1 = seed, 2 = next measured target
  readonly #seed = uniform(0);
  readonly #enabled = uniform(false);
  readonly #quad = new QuadMesh();
  readonly #meterMaterial = new NodeMaterial();
  readonly #reduceMaterial = new NodeMaterial();
  readonly #adaptMaterial = new NodeMaterial();
  #readTarget = target();
  #writeTarget = target();
  #levels: RenderTarget[] = [];
  readonly #reduced = texture(new Texture());
  readonly #previous = texture(this.#readTarget.texture);
  readonly #result = texture(this.#writeTarget.texture);
  #disposed = false;
  #readPending = false;
  #generation = 0;
  #lastReport = Number.NEGATIVE_INFINITY;
  #observation: Record<string, unknown>;
  // Three's runtime accepts undefined on first use, but its declaration requires a state.
  #rendererState: Parameters<typeof RendererUtils.resetRendererState>[1] | undefined;

  constructor(
    input: ColourTexture,
    settings: IExposureSettings,
    constantExposure: number,
    meter: Meter = exposureMeter,
    decode: Decode = exposureLuminance,
  ) {
    super("float");
    validateExposureSettings(settings);
    if (!Number.isFinite(Math.fround(constantExposure)) || Math.fround(constantExposure) <= 0)
      throw new Error("Exposure constant must be finite and positive.");
    this.input = input;
    this.settings = Object.freeze({ ...settings });
    const policy = this.settings;
    this.#constant = constantExposure;
    this.#seed.value = Math.log2(settings.initialExposure);
    this.#enabled.value = settings.enabled;
    this.#observation = { measured: false, applied: settings.enabled };
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.#meterMaterial.fragmentNode = reduce(input, this.#sourceSize, meter);
    this.#reduceMaterial.fragmentNode = reduce(this.#reduced, this.#reduceSize);
    this.#adaptMaterial.fragmentNode = Fn(() => {
      const measure = textureLoad(this.#reduced, ivec2(0));
      const luminance = decode(measure.r.div(measure.g.max(1e-20)));
      const valid = measure.g
        .greaterThan(0)
        .and(luminance.greaterThan(0))
        .and(luminance.lessThan(3.4e38));
      const goal = float(Math.log2(policy.key))
        .sub(luminance.max(1e-20).log2())
        .clamp(policy.minStops, policy.maxStops);
      const old = this.#resetMode
        .equal(1)
        .select(this.#seed, textureLoad(this.#previous, ivec2(0)).r);
      const error = goal.sub(old);
      const rate = error.greaterThan(0).select(float(policy.rateUp), float(policy.rateDown));
      const normal = float(1).sub(this.#delta.mul(rate).negate().exp());
      const cut = smoothstep(policy.snapLo, policy.snapHi, error.abs()).mul(policy.snapGain);
      const adapted = valid.select(
        this.#resetMode.equal(2).select(goal, mix(old, goal, mix(normal, float(1), cut))),
        old,
      );
      const settled = goal.sub(adapted).abs().lessThanEqual(policy.settleStops).select(1, 0);
      return vec4(adapted, valid.select(luminance, -1), goal, settled);
    })();
  }

  override setup(builder: NodeBuilder): Node<"float"> {
    // Force the existing pass dependency even in disabled mode; off never means unmeasured.
    super.setup(builder);
    return this.#enabled.select(
      textureLoad(this.#result, ivec2(0)).r.exp2(),
      float(this.#constant),
    );
  }

  get exposureNode(): Node<"float"> {
    return nodeObject(this);
  }

  reset(exposure?: number): void {
    if (this.#disposed) throw new Error("Exposure node is disposed.");
    if (
      exposure !== undefined &&
      (!Number.isFinite(Math.fround(exposure)) || Math.fround(exposure) <= 0)
    )
      throw new Error("Exposure reset must be finite and positive.");
    this.#resetMode.value = exposure === undefined ? 2 : 1;
    if (exposure !== undefined) this.#seed.value = Math.log2(exposure);
    this.#generation++;
    this.#observation = { measured: false, applied: this.#enabled.value };
    this.#lastReport = Number.NEGATIVE_INFINITY;
  }

  setEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new Error("Exposure enabled must be boolean.");
    if (this.#disposed) throw new Error("Exposure node is disposed.");
    this.#enabled.value = enabled;
    this.#generation++;
    this.#observation = { measured: false, applied: enabled };
    this.#lastReport = Number.NEGATIVE_INFINITY;
  }

  getObservation(): Record<string, unknown> {
    return { ...this.#observation };
  }

  override updateBefore(frame: NodeFrame): undefined {
    if (this.#disposed) throw new Error("Exposure node is disposed.");
    const renderer = frame.renderer;
    if (renderer === null) throw new Error("Exposure requires a renderer.");
    if (!Number.isFinite(frame.deltaTime) || frame.deltaTime < 0 || !Number.isFinite(frame.time))
      throw new Error("Exposure frame time must be finite and nonnegative.");
    renderer.getDrawingBufferSize(this.#size);
    const sizes = exposureReductionSizes(this.#size.x, this.#size.y);
    this.#sourceSize.value.copy(this.#size);
    this.#delta.value = Math.min(frame.deltaTime, this.settings.maxDelta);
    while (this.#levels.length > sizes.length) this.#levels.pop()?.dispose();
    for (const [i, [width, height]] of sizes.entries()) {
      const level = this.#levels[i] ?? target();
      this.#levels[i] = level;
      level.setSize(width, height);
    }
    this.#rendererState ??= RendererUtils.saveRendererState(renderer);
    this.#rendererState = RendererUtils.resetRendererState(renderer, this.#rendererState);
    try {
      for (const [i, level] of this.#levels.entries()) {
        const previous = this.#levels[i - 1];
        if (previous !== undefined) {
          this.#reduced.value = previous.texture;
          this.#reduceSize.value.set(previous.width, previous.height);
        }
        this.#quad.material = i === 0 ? this.#meterMaterial : this.#reduceMaterial;
        renderer.setRenderTarget(level);
        this.#quad.render(renderer);
      }
      const final = this.#levels.at(-1);
      if (final === undefined) throw new Error("Exposure reduction is empty.");
      this.#reduced.value = final.texture;
      const write = this.#writeTarget;
      this.#previous.value = this.#readTarget.texture;
      this.#quad.material = this.#adaptMaterial;
      renderer.setRenderTarget(write);
      this.#quad.render(renderer);
      this.#result.value = write.texture;
      this.#writeTarget = this.#readTarget;
      this.#readTarget = write;
      this.#resetMode.value = 0;
      this.#report(renderer, write, frame.time);
    } finally {
      RendererUtils.restoreRendererState(renderer, this.#rendererState);
    }
  }

  #report(renderer: Renderer, result: RenderTarget, time: number): void {
    if (this.#readPending || time - this.#lastReport < this.settings.reportInterval) return;
    this.#readPending = true;
    this.#lastReport = time;
    const generation = this.#generation;
    void renderer
      .readRenderTargetPixelsAsync(result, 0, 0, 1, 1)
      .then((values) => {
        if (this.#disposed || generation !== this.#generation) return;
        if (
          !(values instanceof Float32Array) ||
          values.length < 4 ||
          !Array.from(values).every(Number.isFinite) ||
          (values[1] ?? 0) <= 0
        )
          throw new Error("Exposure readback is invalid; measurement is unavailable.");
        this.#observation = {
          measured: true,
          applied: this.#enabled.value,
          luminance: values[1],
          exposureStops: this.#enabled.value ? values[0] : Math.log2(this.#constant),
          targetStops: values[2],
          settled: values[3] === 1,
        };
        console.info(`TN_AUTO_EXPOSURE:${JSON.stringify(this.#observation)}`);
      })
      .catch((error: unknown) => {
        if (this.#disposed || generation !== this.#generation) return;
        this.#observation = {
          measured: false,
          applied: this.#enabled.value,
          reason: String(error),
        };
        console.error(`TN_AUTO_EXPOSURE:${JSON.stringify(this.#observation)}`);
      })
      .finally(() => {
        this.#readPending = false;
      });
  }

  override dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation++;
    for (const level of [...this.#levels, this.#readTarget, this.#writeTarget]) level.dispose();
    this.#levels = [];
    this.#meterMaterial.dispose();
    this.#reduceMaterial.dispose();
    this.#adaptMaterial.dispose();
    super.dispose();
  }
}
