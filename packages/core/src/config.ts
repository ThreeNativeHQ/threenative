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
  readonly passes?: IThreeNativeModelPassesConfig;
  readonly quantize?: {
    readonly normalBits?: number;
    readonly positionBits?: number;
    readonly uvBits?: number;
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
     * which the display policy may decline because of hardware, power, or thermal state.
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
