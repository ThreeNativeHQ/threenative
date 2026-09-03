import type { Object3D } from "three";

/** The marker shared by alpha-antialiasing logs, playtests, and native diagnostics. */
export const ALPHA_ANTIALIASING_MARKER = "TN_ALPHA_ANTIALIASING";

export interface IAlphaAntialiasingReport {
  /** True once at least one cutout material has been put on the coverage mask. */
  readonly applied: boolean;
  readonly marker: typeof ALPHA_ANTIALIASING_MARKER;
  /** Empty when applied; otherwise why the convention did nothing, and what to change. */
  readonly reason: string;
  /** The sample count the decision was made against. One means there is no coverage mask. */
  readonly sampleCount: number;
  /** How many distinct cutout materials this renderer has converted. */
  readonly materials: number;
}

/**
 * The part of `THREE.Material` this reads. Structural rather than imported so a native adapter
 * and a test stub are the same input as a `MeshStandardNodeMaterial`.
 */
export interface IAlphaAntialiasingMaterial {
  alphaHash?: boolean;
  alphaTest?: number;
  alphaTestNode?: unknown;
  alphaToCoverage?: boolean;
  transparent?: boolean;
}

/**
 * A cutout is an opaque material whose silhouette is carved by an alpha test — and that is the one
 * shape alpha-to-coverage is for. A transparent material is already resolved by sorting and
 * blending, and taking its alpha for coverage would dither it instead; a material with no alpha
 * test has no cutout edge to resolve.
 */
function isCutout(material: IAlphaAntialiasingMaterial): boolean {
  if (material.transparent === true || material.alphaHash === true) return false;
  const threshold = material.alphaTest;
  return (
    (typeof threshold === "number" && threshold > 0) ||
    (material.alphaTestNode !== undefined && material.alphaTestNode !== null)
  );
}

function isTraversable(
  value: unknown,
): value is { traverse(callback: (child: unknown) => void): void } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { traverse?: unknown }).traverse === "function"
  );
}

/**
 * Alpha antialiasing: resolve alpha-tested silhouettes through the multisample coverage mask.
 * Godot's `alpha_antialiasing_mode`, in Three.js's `alphaToCoverage`.
 *
 * MSAA antialiases triangle edges. A leaf, a fern, a chain-link fence and a hair card have no
 * triangle edge to antialias — the silhouette is carved *inside* the triangle by `discard`, which
 * is all-or-nothing per pixel however many samples the target holds. So a game can own a 4x
 * multisampled target, pay its bandwidth every frame, and still draw a distant tree line as a
 * black-and-white stipple. `alphaToCoverage` is what spends that target on cutouts: three swaps
 * the binary discard for a screen-space-derivative smoothstep and hands the result to the hardware
 * coverage mask, so a leaf edge can land on one, two, three or four of the samples already
 * allocated. No new target, no second pass, no extra memory.
 *
 * Which is why the coupling is the framework's and not the game's. The flag itself is one line of
 * plain Three.js, but it is a silent no-op — worse, a fattened silhouette — unless the surface
 * being drawn is multisampled, and the sample count is the renderer's answer on a seam that
 * differs between the browser and the native host. A game cannot portably ask. So the engine
 * couples the two, ships it on, and reports it: turning the convention off does not turn its
 * measurement off, and neither does refusing it.
 */
export class AlphaAntialiasing {
  readonly #converted = new WeakSet<object>();
  readonly #enabled: boolean;
  readonly #report: (line: string) => void;
  readonly #sampleCount: () => number;
  #announced = false;
  #armed: boolean | undefined;
  #materials = 0;

  constructor(options: {
    readonly enabled: boolean;
    readonly report: (line: string) => void;
    readonly sampleCount: () => number;
  }) {
    this.#enabled = options.enabled;
    this.#report = options.report;
    this.#sampleCount = options.sampleCount;
  }

  /**
   * Convert every cutout material under a root, then announce the decision once.
   *
   * Called from the renderer's warm-up, which is the point that matters: three builds a pipeline
   * from `alphaToCoverage` and rebuilds it when the flag moves, so a convention applied at draw
   * time would throw away exactly the warm-up it was applied during. Cheap to repeat — a material
   * is looked at once ever.
   */
  convertTree(root: unknown): void {
    if (this.#active() && isTraversable(root)) {
      root.traverse((child) => {
        const material = (child as Object3D & Record<string, unknown>).material;
        if (Array.isArray(material)) for (const one of material) this.convertMaterial(one);
        else this.convertMaterial(material);
      });
    }
    this.#announce();
  }

  /**
   * Convert one material as the renderer is about to draw with it, which is how content that
   * streams in after warm-up is caught. Its pipeline is being built for the first time either way,
   * so there is nothing to rebuild. Per draw call, and a `WeakSet` hit after the first sight.
   */
  convertMaterial(material: unknown): void {
    if (!this.#active()) return;
    if (typeof material !== "object" || material === null) return;
    if (this.#converted.has(material)) return;
    this.#converted.add(material);
    const candidate = material as IAlphaAntialiasingMaterial;
    if (!isCutout(candidate) || candidate.alphaToCoverage === true) return;
    candidate.alphaToCoverage = true;
    this.#materials += 1;
  }

  report(): IAlphaAntialiasingReport {
    const sampleCount = this.#sampleCount();
    return {
      applied: this.#materials > 0,
      marker: ALPHA_ANTIALIASING_MARKER,
      materials: this.#materials,
      reason: this.#reason(sampleCount),
      sampleCount,
    };
  }

  #reason(sampleCount: number): string {
    if (this.#materials > 0) return "";
    if (!this.#enabled) return "renderer.alphaAntialiasing is false";
    if (sampleCount < 2)
      return "the surface is single-sampled, so there is no coverage mask for a cutout edge to resolve into; set renderer.antialias (or renderer.android.antialias) true to give it one";
    return "no cutout material has been drawn; nothing in this scene carves its silhouette with an alpha test";
  }

  /** True while the convention can still do something. The sample count cannot move after boot. */
  #active(): boolean {
    this.#armed ??= this.#enabled && this.#sampleCount() > 1;
    return this.#armed;
  }

  #announce(): void {
    if (this.#announced) return;
    this.#announced = true;
    this.#report(`${ALPHA_ANTIALIASING_MARKER}:${JSON.stringify(this.report())}`);
  }
}
