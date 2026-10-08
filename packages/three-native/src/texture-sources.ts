/**
 * three's texture sources on the browser back end: the typed array a `DataTexture` was built
 * from, a 2D canvas, and an image (`ImageBitmap`, `<img>`, `ImageData`). The engine holds a copy of
 * the texels, so the JS-side source is re-sent on `needsUpdate`, as three re-reads `texture.image`
 * before an upload. The V8 player's equivalent is `runtime-native/src/engine/player/core-textures.mjs`;
 * the browser decodes images itself, so no bitmap needs the engine decoder here.
 */
import { type IBrowserRuntime, type IEngineRef, engineRef } from "./browser-backend.js";

type EngineClass = new (...args: unknown[]) => object;

interface IPixels {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

interface ICanvasLike {
  readonly width: number;
  readonly height: number;
  getContext(
    kind: "2d",
  ): { getImageData(x: number, y: number, w: number, h: number): IPixels } | null;
}

/** three's Texture defaults: an image is flipped and linear-filtered, unlike DataTexture's. */
const IMAGE_DEFAULTS = { flipY: true, magFilter: 1006, minFilter: 1008 };

function isCanvas(image: unknown): image is ICanvasLike {
  return typeof (image as Partial<ICanvasLike>)?.getContext === "function";
}

function isPixels(image: unknown): image is IPixels {
  const candidate = image as Partial<IPixels> | null;
  return ArrayBuffer.isView(candidate?.data) && typeof candidate?.width === "number";
}

/** An image's RGBA pixels: its own `data`, a canvas's 2D readback, or a drawable drawn once. */
function pixelsOf(image: unknown): IPixels {
  if (isPixels(image)) return image;
  const source = isCanvas(image) ? image : undefined;
  if (source !== undefined) {
    const pixels = source.getContext("2d")?.getImageData(0, 0, source.width, source.height);
    if (pixels !== undefined) return pixels;
  }
  const drawable = image as { width?: number; height?: number } | null;
  if (
    typeof OffscreenCanvas !== "undefined" &&
    drawable?.width &&
    drawable.height &&
    !isCanvas(image)
  ) {
    const context = new OffscreenCanvas(drawable.width, drawable.height).getContext("2d");
    context?.drawImage(image as CanvasImageSource, 0, 0);
    const pixels = context?.getImageData(0, 0, drawable.width, drawable.height);
    if (pixels !== undefined) return pixels;
  }
  throw new TypeError(
    "TN_BROWSER_TEXTURE_SOURCE: expected ImageData, a canvas with a 2D context, or an image OffscreenCanvas can draw",
  );
}

/** `DataTexture`, `CanvasTexture`, `Texture` and `ImageBitmapLoader` over the engine's classes. */
export function defineTextureSources(
  classes: Readonly<Record<string, unknown>>,
  runtime: IBrowserRuntime,
): Record<string, unknown> {
  const BaseTexture = classes.Texture as EngineClass;
  const BaseData = classes.DataTexture as EngineClass;
  const sources = new WeakMap<object, unknown>();
  const prototype = BaseData.prototype as object;
  const needsUpdate = Object.getOwnPropertyDescriptor(prototype, "needsUpdate")?.set;
  if (needsUpdate === undefined) throw new TypeError("TN_BROWSER_UNBOUND: DataTexture.needsUpdate");
  Object.defineProperties(prototype, {
    image: {
      configurable: true,
      get(this: object) {
        return sources.get(this);
      },
      set(this: object, image: unknown) {
        sources.set(this, image);
      },
    },
    needsUpdate: {
      configurable: true,
      set(this: object, value: unknown) {
        const image = value ? sources.get(this) : undefined;
        if (image !== undefined)
          runtime.set(
            engineRef(this) as IEngineRef,
            "image.data",
            Array.from(pixelsOf(image).data),
          );
        needsUpdate.call(this, value);
      },
    },
  });

  /** An engine DataTexture holding `pixels`, re-read from `image` on every needsUpdate. */
  const fromImage = (image: unknown, target: object): object => {
    const pixels = pixelsOf(image);
    const texture = new BaseData(pixels.data, pixels.width, pixels.height);
    Object.setPrototypeOf(texture, target);
    Object.assign(texture, IMAGE_DEFAULTS);
    sources.set(texture, image);
    return texture;
  };

  function DataTexture(
    this: unknown,
    data?: ArrayLike<number> | null,
    width = 1,
    height = 1,
    ...rest: unknown[]
  ) {
    const texture = Reflect.construct(
      BaseData,
      [data ?? undefined, width, height, ...rest],
      new.target ?? DataTexture,
    );
    if (data) sources.set(texture, { data, width, height });
    return texture;
  }
  DataTexture.prototype = prototype;

  // ponytail: a DataTexture underneath, one mip level; bind a native CanvasTexture for mipmapped art.
  function CanvasTexture(canvas: unknown) {
    const texture = fromImage(canvas, CanvasTexture.prototype);
    (texture as { needsUpdate: boolean }).needsUpdate = true;
    return texture;
  }
  CanvasTexture.prototype = Object.create(prototype, {
    constructor: { value: CanvasTexture, writable: true, configurable: true },
    isCanvasTexture: { value: true },
  });

  /** `new Texture(image)` uploads the image's pixels; with no image it is the engine's Texture. */
  function Texture(this: unknown, image?: unknown, ...rest: unknown[]) {
    if (image === undefined || image === null)
      return Reflect.construct(BaseTexture, rest, new.target ?? Texture);
    return fromImage(image, prototype);
  }
  Texture.prototype = BaseTexture.prototype;

  /** three's ImageBitmapLoader: fetch, then the browser's own createImageBitmap. */
  class ImageBitmapLoader {
    options: ImageBitmapOptions = { premultiplyAlpha: "none" };
    path = "";
    setOptions(options: ImageBitmapOptions): this {
      this.options = options;
      return this;
    }
    setPath(path: string): this {
      this.path = path;
      return this;
    }
    load(
      url: string,
      onLoad?: (bitmap: ImageBitmap) => void,
      _onProgress?: unknown,
      onError?: (error: unknown) => void,
    ) {
      this.loadAsync(url).then(onLoad, (error) => {
        if (onError === undefined) throw error;
        onError(error);
      });
    }
    async loadAsync(url: string): Promise<ImageBitmap> {
      const response = await fetch(this.path + url);
      if (!response.ok)
        throw new Error(
          `TN_BROWSER_IMAGE_FETCH: ${this.path + url} answered ${String(response.status)}`,
        );
      return createImageBitmap(await response.blob(), {
        ...this.options,
        colorSpaceConversion: "none",
      });
    }
  }

  return { CanvasTexture, DataTexture, ImageBitmapLoader, Texture };
}
