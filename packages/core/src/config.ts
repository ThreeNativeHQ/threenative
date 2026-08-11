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
  readonly nativeEntry?: string;
  readonly renderer?: {
    readonly preferWebGPU?: boolean;
  };
}
