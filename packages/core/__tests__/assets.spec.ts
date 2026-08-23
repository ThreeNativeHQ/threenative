import {
  BoxGeometry,
  type CompressedTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "../src/assets.js";
import { defineGame } from "../src/game.js";
import { type ICtx, Scene } from "../src/scene.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

describe("IAssetLoader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("should return the same promise for a repeated model request", async () => {
    const requests: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      model: async (url) => {
        requests.push(url);
        return { url };
      },
    });

    const first = assets.model<{ url: string }>("a.glb");
    const second = assets.model<{ url: string }>("a.glb");

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ url: "/assets/a.glb" });
    expect(requests).toEqual(["/assets/a.glb"]);
  });

  it("should release one cached asset and reload it on the next request", async () => {
    const requests: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      model: async (url) => {
        requests.push(url);
        return { url };
      },
    });

    await assets.model("a.glb");

    expect(assets.release("model", "a.glb")).toBe(true);
    expect(assets.release("model", "a.glb")).toBe(false);
    await assets.model("a.glb");

    expect(requests).toEqual(["/assets/a.glb", "/assets/a.glb"]);
  });

  it("should dispose a texture once and ignore a double release", async () => {
    const texture = new Texture();
    const dispose = vi.spyOn(texture, "dispose");
    const assets = createAssetLoader({ texture: async () => texture });

    await assets.texture("albedo.png");

    expect(assets.release("texture", "albedo.png")).toBe(true);
    expect(assets.release("texture", "albedo.png")).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("should dispose model geometry, material, and material textures once on clear", async () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(geometry, material);
    const scene = new Group().add(mesh);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const assets = createAssetLoader({ model: async () => ({ scene }) });

    await assets.model("model.glb");
    assets.clear();
    assets.clear();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("loads textures through fetch and createImageBitmap when Image is unavailable", async () => {
    const bitmap = { height: 16, width: 16 } as ImageBitmap;
    const createBitmap = vi.fn(async () => bitmap);
    // The loader probes for a compiled-asset manifest first; this game serves none.
    const fetchAsset = vi.fn(async (url: string) =>
      url === "assets.manifest.json"
        ? new Response("gone", { status: 404 })
        : new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }),
    );
    vi.stubGlobal("Image", undefined);
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal("fetch", fetchAsset);

    const texture = await createAssetLoader().texture("native-proof.png");

    expect(fetchAsset).toHaveBeenCalledWith("native-proof.png");
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(texture.image).toBe(bitmap);
    expect(texture.version).toBe(1);
  });

  it("should enter the scene only after load resolves", async () => {
    const events: string[] = [];
    class OrderedScene extends Scene<{ loaded: boolean }> {
      override async load(_ctx: ICtx<{ loaded: boolean }>): Promise<void> {
        await Promise.resolve();
        events.push("load");
      }

      override enter(_ctx: ICtx<{ loaded: boolean }>): void {
        events.push("enter");
      }
    }

    const canvas = testCanvas();
    const game = defineGame<{ loaded: boolean }>({
      initialState: { loaded: false },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { ordered: OrderedScene },
      start: "ordered",
    });

    await game.start();

    expect(events).toEqual(["load", "enter"]);
    game.stop();
  });
});

describe("IAssetLoader through the asset manifest", () => {
  afterEach(() => vi.unstubAllGlobals());

  function manifestResponse(body: string | unknown, status = 200): Response {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }

  it("should resolve a logical path to the manifest output when a manifest exists", async () => {
    const fetchAsset = vi.fn(async () =>
      manifestResponse({
        version: 1,
        entries: {
          "rock.png": { output: "rock.a1b2c3.png", kind: "texture", bytes: 184320, passes: [] },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchAsset);
    const requests: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      manifest: "my-assets.json",
      texture: async (url) => {
        requests.push(url);
        return new Texture();
      },
    });

    const texture = await assets.texture("rock.png");

    expect(texture).toBeInstanceOf(Texture);
    expect(fetchAsset).toHaveBeenCalledWith("/assets/my-assets.json");
    expect(requests).toEqual(["/assets/rock.a1b2c3.png"]);
  });

  it("should load the raw path when no manifest is served", async () => {
    const fetchAsset = vi.fn(async () => manifestResponse("gone", 404));
    vi.stubGlobal("fetch", fetchAsset);
    const requests: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      model: async (url) => {
        requests.push(url);
        return { url };
      },
    });

    await expect(assets.model("rock.png")).resolves.toEqual({ url: "/assets/rock.png" });
    expect(fetchAsset).toHaveBeenCalledWith("/assets/assets.manifest.json");
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(requests).toEqual(["/assets/rock.png"]);
  });

  it("should throw when the manifest is present but the path is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => manifestResponse({ version: 1, entries: {} })),
    );
    const assets = createAssetLoader({ basePath: "/assets", model: async () => ({}) });

    await expect(assets.model("rock.png")).rejects.toThrow(/rock\.png/u);
  });

  it("should fail the load when a manifest entry points at a missing output", async () => {
    // The negative control for manifest trust: a corrupted `output` value must surface as a
    // broken load naming the compiled file, never silently fall through to the raw path.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        manifestResponse({
          version: 1,
          entries: {
            "rock.png": { output: "rock.deadbeef.png", kind: "texture", bytes: 1, passes: [] },
          },
        }),
      ),
    );
    const requested: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      texture: async (url) => {
        requested.push(url);
        throw new Error(`404: ${url}`);
      },
    });

    await expect(assets.texture("rock.png")).rejects.toThrow(/rock\.deadbeef\.png/u);
    expect(requested).toEqual(["/assets/rock.deadbeef.png"]);
  });

  it("should throw when the manifest version is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => manifestResponse({ version: 2, entries: {} })),
    );
    const assets = createAssetLoader({ basePath: "/assets", model: async () => ({}) });

    await expect(assets.model("rock.png")).rejects.toThrow(/version/u);
  });

  it("should throw when the manifest body does not parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => manifestResponse("{not json")),
    );
    const assets = createAssetLoader({ basePath: "/assets", model: async () => ({}) });

    await expect(assets.model("rock.png")).rejects.toThrow(/manifest/u);
  });

  it("should throw when the manifest response is an error other than 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => manifestResponse("boom", 500)),
    );
    const assets = createAssetLoader({ basePath: "/assets", model: async () => ({}) });

    await expect(assets.model("rock.png")).rejects.toThrow(/500/u);
  });

  it("should memoise the manifest fetch across kinds and repeats", async () => {
    const fetchAsset = vi.fn(async () =>
      manifestResponse({
        version: 1,
        entries: {
          "a.png": { output: "a.111111.png" },
          "b.glb": { output: "b.222222.glb" },
          "c.ogg": { output: "c.333333.ogg" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchAsset);
    const assets = createAssetLoader({
      basePath: "/assets",
      model: async () => ({}),
      texture: async () => new Texture(),
      audio: async () => ({ length: 0 }) as unknown as AudioBuffer,
    });

    await Promise.all([
      assets.texture("a.png"),
      assets.model("b.glb"),
      assets.audio("c.ogg"),
      assets.texture("a.png"),
    ]);

    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });
});

describe("IAssetLoader compressed textures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function manifestResponse(body: string | unknown, status = 200): Response {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }

  /** A WebGL-shaped renderer stub whose extension surface reports exactly `supported`. */
  function webglRenderer(supported: Record<string, boolean>): object {
    return { extensions: { has: (name: string) => supported[name] ?? false } };
  }

  const S3TC = { WEBGL_compressed_texture_s3tc: true };

  it("should throw when no compressed format is supported", async () => {
    // Nothing reports a compressed-texture extension: the loader must reject at construction,
    // naming the renderer kind, rather than let three silently transcode to RGBA32 later.
    const assets = createAssetLoader({ basePath: "/assets", renderer: webglRenderer({}) });

    await expect(assets.compressedTextures?.ready).rejects.toThrow(/TN_ASSETS_KTX2_UNSUPPORTED/u);
    await expect(assets.compressedTextures?.ready).rejects.toThrow(/webgl2/u);
  });

  it("should configure the shared loader from the real detected support", async () => {
    const assets = createAssetLoader({
      basePath: "/assets",
      renderer: webglRenderer(S3TC),
    });

    const loader = (await assets.compressedTextures?.loader) as unknown as {
      transcoderPath: string;
      workerConfig: Record<string, boolean>;
    };
    expect(loader.workerConfig).toEqual(expect.objectContaining({ dxtSupported: true }));
    expect(loader.transcoderPath).toBe("/assets/basis/");
  });

  it("should call detectSupport exactly once for repeated loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        manifestResponse({
          version: 1,
          entries: {
            "rock.png": {
              output: "rock.a1b2c3d4.ktx2",
              kind: "texture",
              bytes: 9,
              passes: ["ktx2"],
            },
            "wall.png": {
              output: "wall.e5f6a7b8.ktx2",
              kind: "texture",
              bytes: 9,
              passes: ["ktx2"],
            },
          },
        }),
      ),
    );
    vi.spyOn(KTX2Loader.prototype, "load").mockImplementation(
      (_url: string, onLoad: (data: CompressedTexture) => void) => {
        onLoad(new Texture() as unknown as CompressedTexture);
        return undefined;
      },
    );
    const detectSpy = vi.spyOn(KTX2Loader.prototype, "detectSupport");
    const assets = createAssetLoader({ basePath: "/assets", renderer: webglRenderer(S3TC) });

    // Two distinct textures: both go through the loader, detection must still run once.
    await Promise.all([assets.texture("rock.png"), assets.texture("wall.png")]);

    expect(detectSpy).toHaveBeenCalledTimes(1);
  });

  it("should throw when compiled compressed output loads without a renderer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        manifestResponse({
          version: 1,
          entries: {
            "rock.png": {
              output: "rock.a1b2c3d4.ktx2",
              kind: "texture",
              bytes: 9,
              passes: ["ktx2"],
            },
          },
        }),
      ),
    );
    const assets = createAssetLoader({ basePath: "/assets" });

    await expect(assets.texture("rock.png")).rejects.toThrow(/TN_ASSETS_KTX2_NO_RENDERER/u);
  });

  it("should share one KTX2 loader between model and texture loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        manifestResponse({
          version: 1,
          entries: {
            "rock.png": {
              output: "rock.a1b2c3d4.ktx2",
              kind: "texture",
              bytes: 9,
              passes: ["ktx2"],
            },
            "b.glb": { output: "b.22222222.glb", kind: "model", bytes: 9, passes: [] },
          },
        }),
      ),
    );
    const detectSpy = vi.spyOn(KTX2Loader.prototype, "detectSupport");
    vi.spyOn(KTX2Loader.prototype, "load").mockImplementation(
      (_url: string, onLoad: (data: CompressedTexture) => void) => {
        onLoad(new Texture() as unknown as CompressedTexture);
        return undefined;
      },
    );
    const setKtx2Spy = vi.spyOn(GLTFLoader.prototype, "setKTX2Loader").mockReturnThis();
    vi.spyOn(GLTFLoader.prototype, "parse").mockImplementation(function (
      this: GLTFLoader,
      _data: ArrayBuffer,
      _path: string,
      onLoad: never,
    ) {
      (onLoad as (value: unknown) => void)({ url: "loaded.glb" });
      return this;
    } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | RequestInfo) =>
        String(url).endsWith(".glb")
          ? new Response(new Uint8Array(0))
          : manifestResponse({
              version: 1,
              entries: {
                "rock.png": {
                  output: "rock.a1b2c3d4.ktx2",
                  kind: "texture",
                  bytes: 9,
                  passes: ["ktx2"],
                },
                "b.glb": { output: "b.22222222.glb", kind: "model", bytes: 9, passes: [] },
              },
            }),
      ),
    );
    const assets = createAssetLoader({ basePath: "/assets", renderer: webglRenderer(S3TC) });
    const shared = await assets.compressedTextures?.loader;

    await Promise.all([assets.texture("rock.png"), assets.model("b.glb")]);

    expect(setKtx2Spy).toHaveBeenCalledTimes(1);
    expect(setKtx2Spy.mock.calls[0]?.[0]).toBe(shared);
    expect(detectSpy).toHaveBeenCalledTimes(1);
  });
});

describe("IAssetLoader model decoders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * A genuinely meshopt-compressed `.glb` (quantized positions, required
   * EXT_meshopt_compression), built from the committed fixture generator minus its
   * textures so the parse runs in a bare-node environment.
   */
  async function compressedModelGlb(): Promise<ArrayBuffer> {
    const { EXTMeshoptCompression } = await import("@gltf-transform/extensions");
    const { MeshoptEncoder } = await import("meshoptimizer");
    const { NodeIO } = await import("@gltf-transform/core");
    const { buildFixtureDocument } = await import(
      "../../../test-support/generate-fixture-model.js"
    );
    const document = buildFixtureDocument({ textured: false });
    await MeshoptEncoder.ready;
    document
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const binary = await new NodeIO()
      .registerExtensions([EXTMeshoptCompression])
      .registerDependencies({ "meshopt.encoder": MeshoptEncoder })
      .writeBinary(document);
    return binary.buffer.slice(
      binary.byteOffset,
      binary.byteOffset + binary.byteLength,
    ) as ArrayBuffer;
  }

  /** Serves the model bytes verbatim; no manifest, so the raw-path fallback applies. */
  function serveModel(data: ArrayBuffer): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | RequestInfo) =>
        String(url).endsWith("assets.manifest.json")
          ? new Response("gone", { status: 404 })
          : new Response(new Uint8Array(data), { status: 200 }),
      ),
    );
  }

  it("should configure the meshopt decoder before loading a compressed model", async () => {
    const data = await compressedModelGlb();
    serveModel(data);
    const setDecoderSpy = vi.spyOn(GLTFLoader.prototype, "setMeshoptDecoder");
    const assets = createAssetLoader();

    const gltf = await assets.model<{ scene: unknown }>("character.glb");

    // The decoder was wired and the file really parsed through it: the scene graph exists.
    expect(setDecoderSpy).toHaveBeenCalledTimes(1);
    expect(gltf.scene).toBeDefined();
  });

  it("should fail a compressed model when the decoder wiring is removed", async () => {
    const data = await compressedModelGlb();
    serveModel(data);
    // Simulate the revert check: with the wiring gone the loader never receives a decoder,
    // and three's own loader refuses the compressed file by name.
    vi.spyOn(GLTFLoader.prototype, "setMeshoptDecoder").mockImplementation(
      (() => undefined) as unknown as () => GLTFLoader,
    );
    const assets = createAssetLoader();

    await expect(assets.model("character.glb")).rejects.toThrow(
      /setMeshoptDecoder must be called/u,
    );
  });

  it("should wire the Draco decoder only when the model declares it", async () => {
    // A meshopt-only project must never construct a DRACOLoader.
    const data = await compressedModelGlb();
    serveModel(data);
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    const dracoSpy = vi.spyOn(DRACOLoader.prototype, "setDecoderPath");
    const assets = createAssetLoader({ basePath: "/assets" });

    await assets.model("character.glb");

    expect(dracoSpy).not.toHaveBeenCalled();
  });

  it("should point the Draco decoder at the served draco directory when declared", async () => {
    // A payload whose header declares KHR_draco_mesh_compression but whose body is not a
    // valid Draco file: the wiring is observable before the (expected) decode failure.
    const header = Buffer.from(
      JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ componentType: 5126, count: 3, type: "VEC3" }],
        extensionsUsed: ["KHR_draco_mesh_compression"],
        extensionsRequired: ["KHR_draco_mesh_compression"],
      }),
      "utf8",
    );
    const chunkHeader = Buffer.alloc(8 + header.length + ((4 - (header.length % 4)) % 4));
    chunkHeader.writeUInt32LE(header.length, 0);
    chunkHeader.write("JSON", 4, "ascii");
    header.copy(chunkHeader, 8);
    const total = 12 + chunkHeader.length;
    const glb = Buffer.alloc(total);
    glb.write("glTF", 0, "ascii");
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(total, 8);
    chunkHeader.copy(glb, 12);
    serveModel(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));

    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    const dracoSpy = vi.spyOn(DRACOLoader.prototype, "setDecoderPath");
    const assets = createAssetLoader({ basePath: "/assets" });

    await expect(assets.model("legacy.glb")).rejects.toThrow();

    expect(dracoSpy).toHaveBeenCalledWith("/assets/draco/");
  });
});
