export type ThreeNativeOrientation = "landscape" | "portrait" | "sensor";

/** Which renderer draws a game's `src/ui/`. @see IThreeNativeConfig.ui */
export type ThreeNativeUiRenderer = "native" | "web";

/** What the native host does with the render loop while the app is off-screen. */
export type ThreeNativeBackgroundMode = "continue" | "pause";

export interface IThreeNativeIconVariants {
  readonly android?: {
    readonly foreground?: string;
    readonly background?: string;
    readonly monochrome?: string;
  };
  readonly ios?: {
    readonly dark?: string;
    readonly tinted?: string;
  };
  readonly web?: {
    readonly favicon?: string;
    readonly maskable?: string;
    readonly monochrome?: string;
    readonly appleTouch?: string;
  };
}

export interface IThreeNativeBootSplash {
  readonly backgroundColor?: string;
  readonly image?: string;
}

/** Texture compression options for the asset compile step; `"none"` ships sources verbatim. */
export interface IThreeNativeTexturesConfig {
  /** Integer at least 4; caps the longest edge, preserving aspect and 4x4 alignment; never upscales. */
  readonly maxSize?: number;
  readonly overrides?: readonly {
    readonly codec: "etc1s" | "none" | "uastc";
    readonly glob: string;
    readonly quality?: number;
  }[];
  /** ETC1S encoder quality 1–255. Ignored for UASTC. */
  readonly quality?: number;
}

/** Model optimization sub-pass switches; absent means every pass runs. */
export interface IThreeNativeModelPassesConfig {
  readonly dedup?: boolean;
  readonly meshopt?: boolean;
  readonly prune?: boolean;
  readonly quantize?: boolean;
  readonly reorder?: boolean;
}

/** Model optimization options for the asset compile step; `"none"` ships sources verbatim. */
export interface IThreeNativeModelsConfig {
  /** Standard glTF TEXCOORD_1 atlas generation for offline static-light assets. */
  readonly lightmap?: {
    readonly atlasSize: number;
    readonly padding: number;
  };
  readonly passes?: IThreeNativeModelPassesConfig;
  readonly quantize?: {
    readonly normalBits?: number;
    readonly positionBits?: number;
    readonly uvBits?: number;
  };
  /**
   * Write each distinct embedded image once under `shared/images/` and reference it from every
   * model that carries it. A marketplace pack whose eight pines all embed the same bark map then
   * ships and encodes it once. Default false; the served GLB references files beside it.
   */
  readonly sharedImages?: boolean;
  /**
   * Embedded-texture compression for images carried inside a `.glb`.
   *
   * On by default in the compile step; `"none"` ships every embedded image exactly as
   * authored. `maxSize` caps the longest edge, preserving aspect and snapping to whole 4x4
   * blocks, and never upscales.
   */
  readonly textures?:
    | "none"
    | {
        readonly maxSize?: number;
        readonly quality?: number;
        readonly overrides?: readonly {
          readonly slot: string;
          readonly codec: "etc1s" | "none" | "uastc";
        }[];
      };
  /**
   * Mesh simplification. Absent means none at all, which is the default.
   *
   * `ratio` is the fraction of triangles to keep. `error` is a quality guard rather than a
   * target — the largest a vertex may move as a fraction of the mesh's extent — so a loose
   * ratio with a tight error stops short, and the compile step reports the ratio it actually
   * achieved next to the one that was asked for.
   */
  readonly simplify?: {
    readonly ratio: number;
    readonly error?: number;
  };
  /**
   * Cluster-DAG bake for virtual geometry, or `"none"` to ship every primitive as authored.
   *
   * Absent means on with defaults: any primitive of 65,536 triangles or more bakes to a cluster
   * DAG the loader turns into a `ClusteredMesh`, and everything below that line compiles
   * byte-identically. The payload costs roughly 3-4x the primitive's compiled bytes, which is
   * what `"none"` and `minSourceTriangles` are for.
   */
  readonly virtual?:
    | "none"
    | {
        /** Clusters folded together per group, default 4. */
        readonly groupSize?: number;
        /** Upper bound on a cluster's triangles, default 128. */
        readonly maxTriangles?: number;
        /** Lower bound on a cluster's triangles, default 96. */
        readonly minTriangles?: number;
        /** Primitives below this many triangles are left alone, default 65,536. */
        readonly minSourceTriangles?: number;
        /** Fraction of a group's triangles kept per level, default 0.5. */
        readonly simplifyRatio?: number;
      };
}

export interface IThreeNativeConfig {
  readonly app?: {
    readonly id?: string;
    readonly name?: string;
    readonly version?: string;
    readonly build?: number;
    readonly icon?: string;
    readonly icons?: IThreeNativeIconVariants;
  };
  readonly display?: {
    readonly orientation?: ThreeNativeOrientation;
    readonly fullscreen?: boolean;
    readonly keepScreenOn?: boolean;
    /**
     * Maximum native presentation rate in frames per second. Defaults to 60; `0` removes the
     * software ceiling. Android also submits this value as the surface's preferred frame rate,
     * which the display policy may decline because of hardware, power, or thermal state. Android
     * uses non-blocking presentation above 60 fps so a missed high-refresh interval does not fall
     * to an integer refresh-rate divisor.
     */
    readonly maxFps?: number;
    /**
     * What the native host does when the player leaves the app — presses the power button,
     * switches away, minimizes the window. `"pause"` (the default) stops running frames and
     * suspends audio until the app comes back; `"continue"` keeps rendering off-screen, which a
     * server-shaped or split-screen game may genuinely want.
     *
     * Turning the pause off does not turn the reporting off: `TN_LIFECYCLE` markers are emitted
     * either way and name the mode that executed.
     */
    readonly backgroundMode?: ThreeNativeBackgroundMode;
  };
  readonly window?: {
    readonly title?: string;
    readonly width?: number;
    readonly height?: number;
    readonly resizable?: boolean;
  };
  readonly assets?: {
    readonly models?: "none" | IThreeNativeModelsConfig;
    readonly output?: string;
    readonly source?: string;
    readonly targets?: {
      readonly maxMaterials?: number;
      readonly maxTriangles?: number;
      readonly maxTextureDimension?: number;
    };
    /** Texture compression options, or `"none"` to ship every texture exactly as committed. */
    readonly textures?: "none" | IThreeNativeTexturesConfig;
  };
  readonly bootSplash?: IThreeNativeBootSplash;
  readonly nativeEntry?: string;
  readonly renderer?: {
    readonly preferWebGPU?: boolean;
    /**
     * Portable drawing-buffer scale. CSS and UI layout dimensions are unchanged.
     *
     * `"auto"` — the default a template ships — lets the engine hold the `display.maxFps` budget
     * without the game hand-authoring a resolution constant. A number in `(0, 1]` pins it and
     * turns the loop off. Either way the active scale is reported in every `TN_FRAME_BUDGET`
     * window: turning the convention off does not turn its measurement off.
     */
    readonly resolutionScale?: number | "auto";
    /** Portable multisampling. Sampling and resolution are one pixel budget, not two. */
    readonly antialias?: boolean;
    /**
     * Android-only rendering overrides selected by the engine.
     *
     * `antialias` belongs here beside `resolutionScale` because they spend the same budget: a
     * tile-based mobile GPU resolves MSAA in tile memory and prices it quite differently from a
     * desktop one, so a platform that scales resolution down must be able to buy sampling back
     * on that same platform rather than accepting whatever the portable value happened to be.
     */
    readonly android?: {
      readonly resolutionScale?: number | "auto";
      readonly antialias?: boolean;
    };
  };
  readonly ui?: {
    /**
     * Which renderer draws `src/ui/`.
     *
     * `"web"` runs the same React DOM, Tailwind, CSS, SVG and fonts on every target, through
     * that platform's own browser-class renderer composited over the game surface. What is
     * guaranteed is source parity — one `src/ui/` — not browser-binary parity, which no design
     * using the platforms' own engines can offer once iOS is in the set.
     *
     * `"native"` maps React to `CanvasLayer` quads with no web view, no CSS and no second
     * process. Choose it for a UI that is part of the rendered frame, or a target with no web
     * view, or zero extra processes — and own the appearance difference, which is the trade
     * being made rather than something to discover in a screenshot.
     *
     * Which surface `"web"` lands on is the platform's business and never a game's: no config,
     * type or document names the engine underneath.
     */
    readonly renderer?: ThreeNativeUiRenderer;
  };
}
