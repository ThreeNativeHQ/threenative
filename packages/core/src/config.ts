export type ThreeNativeOrientation = "landscape" | "portrait" | "sensor";

export interface IThreeNativeConfig {
  readonly app?: {
    readonly id?: string;
    readonly name?: string;
    readonly version?: string;
    readonly build?: number;
    readonly icon?: string;
  };
  readonly display?: {
    readonly orientation?: ThreeNativeOrientation;
    readonly fullscreen?: boolean;
    readonly keepScreenOn?: boolean;
  };
  readonly window?: {
    readonly title?: string;
    readonly width?: number;
    readonly height?: number;
    readonly resizable?: boolean;
  };
  /**
   * What the generated loading screen reads.
   *
   * These are declarations, not a renderer: `src/render/loading.ts` is your source and it is the
   * only thing that draws them, so a look this cannot express is a file you edit rather than an
   * option we add. Deleting that file still opts out of the screen entirely.
   */
  readonly loading?: {
    /** Image drawn centred above the bar, project-relative like `public/logo.png`. */
    readonly image?: string;
    readonly backdropColor?: string;
    readonly trackColor?: string;
    readonly progressColor?: string;
    /** False draws the backdrop and image with no bar. */
    readonly showProgressBar?: boolean;
  };
  readonly nativeEntry?: string;
  readonly renderer?: {
    readonly preferWebGPU?: boolean;
  };
}
