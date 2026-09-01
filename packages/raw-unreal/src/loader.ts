import { FileLoader, Loader, type LoadingManager } from "three";

import { parseUAssetStaticMesh } from "./static-mesh.js";
import { createThreeObject, type IThreeAdapterOptions } from "./three-adapter.js";
import type { IUAssetParseOptions } from "./types.js";

export interface IUAssetLoaderOptions {
  parse?: IUAssetParseOptions;
  three?: IThreeAdapterOptions;
}

/** Loads a raw Unreal editor `.uasset` static mesh under the standard three.js loader protocol:
 * `load(url)` for the browser, `parse(data)` for bytes you already hold. Parse and adapter
 * options pass straight through; the parse options carry the injected codecs. */
export class UAssetLoader extends Loader {
  readonly options: IUAssetLoaderOptions;

  constructor(manager?: LoadingManager, options: IUAssetLoaderOptions = {}) {
    super(manager);
    this.options = options;
  }

  parse(data: ArrayBuffer | ArrayBufferView) {
    return createThreeObject(parseUAssetStaticMesh(data, this.options.parse), this.options.three);
  }

  override load(
    url: string,
    onLoad: (object: ReturnType<UAssetLoader["parse"]>) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): this {
    const fileLoader = new FileLoader(this.manager);
    fileLoader.setPath(this.path);
    fileLoader.setRequestHeader(this.requestHeader);
    fileLoader.setWithCredentials(this.withCredentials);
    fileLoader.setResponseType("arraybuffer");
    fileLoader.load(
      url,
      (data) => {
        try {
          if (!(data instanceof ArrayBuffer)) {
            throw new TypeError("Expected FileLoader to return an ArrayBuffer");
          }
          onLoad(this.parse(data));
        } catch (error) {
          onError?.(error);
        }
      },
      onProgress,
      onError,
    );
    return this;
  }
}
