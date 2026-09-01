import { FileLoader, Loader, type LoadingManager } from "three";

import { parseUEModel } from "./parser.js";
import { type IThreeAdapterOptions, createThreeObject } from "./three-adapter.js";
import type { IParseUEModelOptions } from "./types.js";

export interface IUEFormatLoaderOptions {
  parse?: IParseUEModelOptions;
  three?: IThreeAdapterOptions;
}

export class UEFormatLoader extends Loader {
  readonly options: IUEFormatLoaderOptions;

  constructor(manager?: LoadingManager, options: IUEFormatLoaderOptions = {}) {
    super(manager);
    this.options = options;
  }

  parse(data: ArrayBuffer | ArrayBufferView) {
    return createThreeObject(parseUEModel(data, this.options.parse), this.options.three);
  }

  override load(
    url: string,
    onLoad: (object: ReturnType<UEFormatLoader["parse"]>) => void,
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
          if (!(data instanceof ArrayBuffer))
            throw new TypeError("Expected FileLoader to return an ArrayBuffer");
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
