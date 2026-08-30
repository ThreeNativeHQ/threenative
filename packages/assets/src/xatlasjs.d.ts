declare module "xatlasjs/dist/node/xatlas.js" {
  const createXAtlasModule: (options?: Record<string, unknown>) => Promise<unknown>;
  export default createXAtlasModule;
}

declare module "xatlasjs/dist/node/api.mjs" {
  export function Api(
    createXAtlasModule: (options?: Record<string, unknown>) => Promise<unknown>,
  ): {
    new (
      onLoad: () => void,
      locateFile: (path: string, directory: string) => string,
      onProgress?: (mode: string, progress: number) => void,
    ): {
      addMesh(
        indices: Uint16Array,
        vertices: Float32Array,
        normals?: Float32Array | null,
        coords?: Float32Array | null,
        mesh?: string,
        useNormals?: boolean,
        useCoords?: boolean,
      ): unknown;
      createAtlas(): void;
      destroyAtlas(): void;
      generateAtlas(
        chartOptions: Record<string, unknown>,
        packOptions: Record<string, unknown>,
      ): IXAtlasResult;
    };
  };

  interface IXAtlasMesh {
    readonly index: Uint16Array;
    readonly mesh: string;
    readonly oldIndexes: Uint16Array;
    readonly vertex: {
      readonly coords1: Float32Array;
      readonly vertices: Float32Array;
    };
  }

  interface IXAtlasResult {
    readonly atlasCount: number;
    readonly height: number;
    readonly meshes: readonly IXAtlasMesh[];
    readonly texelsPerUnit: number;
    readonly width: number;
  }
}
