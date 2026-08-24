export type ThreeNativeOrientation = "landscape" | "portrait" | "sensor";

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
}
