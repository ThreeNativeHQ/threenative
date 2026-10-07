import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import {
  CanvasTexture,
  CompressedTexture,
  DataTexture,
  FloatType,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  RGBA_S3TC_DXT5_Format,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Texture,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import * as WebGPUTextureUtils from "three/addons/utils/WebGPUTextureUtils.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { prepareStarterExportTextures } from "../scripts/starter-visual-cook.js";

vi.mock("three/addons/utils/WebGPUTextureUtils.js", () => ({ decompress: vi.fn() }));

// CPU canvas boundary: reject non-drawable images just as the browser does.
class CpuCanvas {
  width = 1;
  height = 1;
  pixels = new Uint8ClampedArray();
  flipped = false;
  getContext() {
    return {
      putImageData: (image: { data: Uint8ClampedArray }) => {
        this.pixels = image.data.slice();
      },
      getImageData: () => ({ data: this.pixels.slice() }),
      translate: () => {},
      scale: (_x: number, y: number) => {
        this.flipped = y === -1;
      },
      drawImage: (image: CpuCanvas) => {
        if (!(image instanceof CpuCanvas)) throw new TypeError("drawImage: non-drawable image");
        this.pixels = image.pixels.slice();
        if (this.flipped) {
          const stride = this.width * 4;
          for (let y = 0; y < this.height; y++)
            this.pixels.set(
              image.pixels.subarray((this.height - 1 - y) * stride, (this.height - y) * stride),
              y * stride,
            );
        }
      },
    };
  }
  toDataURL() {
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.pixels);
    return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
  }
}

function installCpuCanvas() {
  vi.stubGlobal("document", { createElement: () => new CpuCanvas() });
  vi.stubGlobal("HTMLCanvasElement", CpuCanvas);
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.stubGlobal(
    "FileReader",
    class {
      result = "";
      onloadend = () => {};
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((bytes) => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
          this.onloadend();
        });
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("starter texture export", () => {
  it("prepares the built page on CPU with the starter's real sky, sun and post graph", async () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const temporary = await makeTempDir("tn-starter-page-cpu-");
    const bundle = path.join(temporary, "starter-visual.js");
    const fixture = path.join(temporary, "starter-fixture.js");
    const esbuild = path.join(root, "node_modules/.bin/esbuild");
    await promisify(execFile)(
      esbuild,
      [
        "packages/runtime-native/scripts/starter-visual-page.ts",
        "--bundle",
        "--platform=browser",
        "--format=iife",
        "--global-name=TnStarterVisual",
        `--outfile=${bundle}`,
      ],
      { cwd: root },
    );
    const fixtureEntry = path.join(temporary, "starter-fixture.ts");
    await writeFile(
      fixtureEntry,
      `
        import { AmbientLight, DataTexture, Mesh, MeshStandardMaterial, PerspectiveCamera,
          PlaneGeometry, Scene, Texture } from "three";
        import { RenderChain } from "./packages/core/src/render/chain.ts";
        import { setupPost } from "./packages/create-threenative/templates/starter/src/render/postprocessing.ts";
        import { setupLighting } from "./packages/create-threenative/templates/starter/src/render/lighting.ts";
        import { setupSky } from "./packages/create-threenative/templates/starter/src/render/sky.ts";
        export function create(tier, fallback = false, software = false) {
          const scene = new Scene();
          const camera = new PerspectiveCamera(60, 1280 / 720, 0.1, 1000);
          scene.add(camera, new AmbientLight(0xffffff, 0.1));
          const normal = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
          const material = new MeshStandardMaterial({ normalMap: normal });
          const mesh = new Mesh(new PlaneGeometry(), material);
          mesh.receiveShadow = true;
          scene.add(mesh);
          const sky = document.createElement("canvas");
          sky.width = sky.height = 1;
          sky.pixels = new Uint8ClampedArray([17, 31, 73, 255]);
          setupSky(scene, new Texture(sky), software);
          let submitted = 0;
          const queue = { onSubmittedWorkDone: async () => { submitted++; } };
          const raw = {
            shadowMap: { enabled: false, type: 0 },
            backend: fallback ? { isWebGLBackend: true } : { isWebGPUBackend: true, device: { queue } },
          };
          const renderer = {
            kind: "webgpu", raw, render() {}, renderOverlay() {},
            softwareAdapter: software ? "SwiftShader" : undefined,
            setOutputNode(node) {
              globalThis.__tnVisualGraph = node;
              return { isCurrent: () => true, dispose() {} };
            },
            createRenderChain(options) { return new RenderChain(renderer, options); },
          };
          const { key } = setupLighting(scene, raw);
          const quality = setupPost(renderer, scene, camera, { tier, godraysLight: key });
          const ctx = { scene, camera, renderer, entities: new Map([["quality", quality]]) };
          let paused = false;
          const game = { ctx, pause() { paused = true; } };
          return { game, material, normal, submitted: () => submitted, paused: () => paused };
        }
      `.replaceAll('from "./packages/', `from "${root}/packages/`),
    );
    await promisify(execFile)(
      esbuild,
      [
        fixtureEntry,
        "--bundle",
        "--platform=browser",
        "--format=iife",
        "--global-name=StarterFixture",
        `--outfile=${fixture}`,
      ],
      { cwd: root },
    );
    const harness = path.join(temporary, "run.mjs");
    const resultFile = path.join(temporary, "result.json");
    await writeFile(
      harness,
      `
      import assert from "node:assert/strict";
      import { readFileSync, writeFileSync } from "node:fs";
      import { createContext, Script, SyntheticModule } from "node:vm";
      import { PNG } from ${JSON.stringify(path.join(root, "node_modules/pngjs/lib/png.js"))};
      ${CpuCanvas.toString()}
      CpuCanvas.prototype.toDataURL = function() {
        const png = new PNG({ width: this.width, height: this.height });
        png.data = Buffer.from(this.pixels);
        return "data:image/png;base64," + PNG.sync.write(png).toString("base64");
      };
      class CpuImage extends CpuCanvas {
        set src(value) {
          const png = PNG.sync.read(Buffer.from(value.split(",")[1], "base64"));
          this.width = png.width;
          this.height = png.height;
          this.pixels = new Uint8ClampedArray(png.data);
        }
        async decode() {}
      }
      const context = createContext({
        console, Buffer, Blob, ArrayBuffer, Uint8Array, Uint8ClampedArray, Float32Array,
        TextEncoder, setTimeout, clearTimeout, HTMLCanvasElement: CpuCanvas, Image: CpuImage,
        document: { createElement: () => new CpuCanvas() },
        ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
        FileReader: class {
          readAsDataURL(blob) {
            blob.arrayBuffer().then(bytes => {
              this.result = "data:" + blob.type + ";base64," + Buffer.from(bytes).toString("base64");
              this.onloadend();
            });
          }
        },
      });
      new Script(readFileSync(${JSON.stringify(fixture)}, "utf8")).runInContext(context);
      new Script(readFileSync(${JSON.stringify(bundle)}, "utf8"), {
        importModuleDynamically: async specifier => {
          assert.equal(specifier, "/src/game.ts");
          const module = new SyntheticModule(["default"], function() {
            this.setExport("default", context.fixture.game);
          }, { context });
          await module.link(() => { throw new Error("unexpected import"); });
          await module.evaluate();
          return module;
        },
      }).runInContext(context);
      const completed = [];
      for (const [tier, fallback, software] of [["high", false, false], ["medium", false, false], ["low", false, false], ["high", true, false], ["low", false, true]]) {
        context.fixture = context.StarterFixture.create(tier, fallback, software);
        const before = context.fixture.game.ctx.scene.children.length;
        const snapshot = await context.TnStarterVisual.prepareStarterSnapshot();
        assert.equal(snapshot.tier, tier);
        assert.equal(snapshot.shadowMap, true);
        assert.equal(context.fixture.paused(), true);
        assert.equal(context.fixture.submitted(), fallback ? 0 : 1);
        assert.equal(context.fixture.game.ctx.scene.children.length, before);
        assert.equal(context.fixture.game.ctx.scene.children.find(object => object.isMesh).material, context.fixture.material);
        assert.ok(context.fixture.normal.image.data instanceof Uint8Array);
        const sun = snapshot.lights.find(light => light.type === "DirectionalLight");
        const ambient = snapshot.lights.find(light => light.type === "AmbientLight");
        assert.equal(sun.shadow["shadow.camera.far"], 80);
        assert.equal(sun.shadow["shadow.mapSize.x"], 4096);
        assert.ok(!("shadow.focus" in sun.shadow));
        assert.deepEqual(Object.keys(ambient.shadow), []);
        assert.equal(snapshot.world.fog.type, "FogExp2");
        assert.equal(snapshot.world.environment, software ? null : snapshot.world.background);
        const kinds = snapshot.postGraph.nodes.map(node => node.kind);
        assert.ok(kinds.includes("SMAANode"));
        assert.equal(kinds.includes("GTAONode"), tier !== "low");
        assert.equal(kinds.includes("DenoiseNode"), tier !== "low");
        for (const node of snapshot.postGraph.nodes)
          for (const image of node.post?.images ?? [])
            assert.equal(image.bytes.length, image.width * image.height * 4);
        assert.ok(snapshot.gltf.images.length >= 2);
        assert.ok(snapshot.nodes.some(node => node.receiveShadow));
        JSON.parse(JSON.stringify(snapshot));
        completed.push([tier, fallback, software]);
      }
      for (const [change, error] of [
        [ctx => { delete ctx.renderer.raw.shadowMap; }, /TN_VISUAL_SHADOW_MAP_MISSING/],
        [ctx => { delete ctx.renderer.raw.backend.device; }, /TN_VISUAL_GPU_QUEUE_MISSING/],
        [ctx => { ctx.scene.environment = null; }, /TN_VISUAL_STARTER_ENVIRONMENT_MISSING/],
        [ctx => { ctx.camera = null; }, /TN_VISUAL_STARTER_NOT_READY/],
        [ctx => { ctx.entities.delete("quality"); }, /TN_VISUAL_TIER_MISSING/],
        [ctx => { context.__tnVisualGraph = null; }, /TN_VISUAL_POST_GRAPH_MISSING/],
        [ctx => { ctx.scene.background.image = null; }, /TN_VISUAL_SKY_IMAGE_MISSING/],
        [ctx => { context.__tnVisualGraph.traverse(node => {
          if (node.constructor.name === "SMAANode") node._areaTexture.image = null;
        }); }, /TN_VISUAL_SMAA_IMAGE_MISSING/],
      ]) {
        context.fixture = context.StarterFixture.create("low");
        change(context.fixture.game.ctx);
        await assert.rejects(context.TnStarterVisual.prepareStarterSnapshot(), error);
      }
      context.fixture = context.StarterFixture.create("low");
      context.fixture.game.ctx.renderer.raw.shadowMap.enabled = false;
      assert.equal((await context.TnStarterVisual.prepareStarterSnapshot()).shadowMap, false);
      writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(completed));
    `,
    );
    await promisify(execFile)(process.execPath, ["--experimental-vm-modules", harness], {
      encoding: "utf8",
      timeout: 45_000,
    });
    expect(JSON.parse(await readFile(resultFile, "utf8"))).toEqual([
      ["high", false, false],
      ["medium", false, false],
      ["low", false, false],
      ["high", true, false],
      ["low", false, true],
    ]);
    expect(await readFile(bundle, "utf8")).toContain("prepareStarterSnapshot");
  });

  it("keeps raw maps drawable, shared and unchanged in the legacy scene through glTF export", async () => {
    installCpuCanvas();
    const bytes = new Uint8Array([11, 29, 247, 255, 101, 67, 233, 255]);
    const normal = new DataTexture(bytes, 1, 2);
    normal.wrapS = RepeatWrapping;
    normal.repeat.set(3, 4);
    normal.offset.set(0.25, 0.5);
    const grid = new DataTexture(new Uint8Array([17, 31, 73, 255]), 1, 1);
    grid.colorSpace = SRGBColorSpace;
    const material = new MeshStandardMaterial({ map: grid, normalMap: normal });
    material.normalScale.set(0.18, 0.18);
    const legacy = new Scene();
    legacy.add(new Mesh(new PlaneGeometry(), material), new Mesh(new PlaneGeometry(), material));
    const source = legacy.clone();
    await prepareStarterExportTextures(source);
    const copies = source.children.map((child) => (child as Mesh).material as MeshStandardMaterial);
    expect(copies[0]).toBe(copies[1]);
    expect(copies[0]).not.toBe(material);
    expect(copies[0]?.normalMap?.image).toBeInstanceOf(CpuCanvas);
    expect(copies[0]?.normalMap?.source).not.toBe(normal.source);
    expect(copies[0]?.normalMap?.repeat.toArray()).toEqual([3, 4]);
    expect(copies[0]?.normalMap?.offset.toArray()).toEqual([0.25, 0.5]);
    expect(copies[0]?.normalMap?.wrapS).toBe(RepeatWrapping);
    expect(copies[0]?.normalMap?.flipY).toBe(false);
    expect(copies[0]?.map?.colorSpace).toBe(SRGBColorSpace);
    expect(normal.image.data).toBe(bytes);
    expect(Array.from(bytes)).toEqual([11, 29, 247, 255, 101, 67, 233, 255]);
    expect((legacy.children[0] as Mesh).material).toBe(material);
    const gltf = JSON.parse(
      JSON.stringify(await new GLTFExporter().parseAsync(source, { binary: false })),
    );
    expect(gltf.materials).toHaveLength(1);
    expect(gltf.images).toHaveLength(2);
    const exported = gltf.materials[0];
    const pixels = (index: number) =>
      Array.from(
        PNG.sync.read(
          Buffer.from(gltf.images[gltf.textures[index].source].uri.split(",")[1], "base64"),
        ).data,
      );
    expect(pixels(exported.pbrMetallicRoughness.baseColorTexture.index)).toEqual([17, 31, 73, 255]);
    // r185 bakes the green-channel flip for geometry without tangents; the normal map stays present.
    expect(pixels(exported.normalTexture.index)).toEqual([11, 226, 247, 255, 101, 188, 233, 255]);
    expect(exported.normalTexture.scale).toBe(0.18);
    expect(exported.normalTexture.extensions.KHR_texture_transform).toMatchObject({
      scale: [3, 4],
      offset: [0.25, 0.5],
    });
  });

  it("keeps drawable image textures and material arrays", async () => {
    installCpuCanvas();
    const image = new CpuCanvas();
    const texture = new Texture(image);
    const material = new MeshStandardMaterial({ map: texture });
    const scene = new Scene();
    const mesh = new Mesh(new PlaneGeometry(), [material, material]);
    scene.add(mesh);
    await prepareStarterExportTextures(scene);
    expect(mesh.material[0]).not.toBe(material);
    expect(mesh.material[0]).toBe(mesh.material[1]);
    expect(mesh.material[0]?.map).toBe(texture);
  });

  it("preserves raw pixel row order and leaves flipY to the exporter", async () => {
    installCpuCanvas();
    const texture = new Texture({
      data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
      width: 1,
      height: 2,
    });
    const mesh = new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map: texture }));
    const scene = new Scene();
    scene.add(mesh);
    await prepareStarterExportTextures(scene);
    expect(mesh.material.map?.image).toBeInstanceOf(CpuCanvas);
    expect(Array.from((mesh.material.map?.image as CpuCanvas).pixels)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
    expect(mesh.material.map?.flipY).toBe(true);
    const gltf = JSON.parse(
      JSON.stringify(await new GLTFExporter().parseAsync(scene, { binary: false })),
    );
    const png = PNG.sync.read(Buffer.from(gltf.images[0].uri.split(",")[1], "base64"));
    expect(Array.from(png.data)).toEqual([4, 5, 6, 255, 1, 2, 3, 255]);
  });

  it("copies compressed texture settings onto the readable result (GPU blit stubbed)", async () => {
    installCpuCanvas();
    const texture = new CompressedTexture(
      [{ data: new Uint8Array(16), width: 4, height: 4 }],
      4,
      4,
      RGBA_S3TC_DXT5_Format,
    );
    texture.channel = 1;
    texture.colorSpace = SRGBColorSpace;
    texture.repeat.set(2, 3);
    texture.wrapS = RepeatWrapping;
    const canvas = new CpuCanvas();
    vi.mocked(WebGPUTextureUtils.decompress).mockResolvedValue(new CanvasTexture(canvas));
    const scene = new Scene();
    const material = new MeshStandardMaterial({ map: texture, normalMap: texture });
    const mesh = new Mesh(new PlaneGeometry(), material);
    scene.add(mesh);
    await prepareStarterExportTextures(scene);
    const result = mesh.material.map;
    expect(result?.image).toBe(canvas);
    expect(result?.format).toBe(RGBAFormat);
    expect(result?.repeat.toArray()).toEqual([2, 3]);
    expect(result?.channel).toBe(1);
    expect(result?.colorSpace).toBe(SRGBColorSpace);
    expect(result?.wrapS).toBe(RepeatWrapping);
    expect(result?.flipY).toBe(false);
    expect(result?.mipmaps).toEqual([]);
    expect(Reflect.get(result as Texture, "isCompressedTexture")).toBeUndefined();
    expect(mesh.material.normalMap).toBe(result);
    expect(material.map).toBe(texture);
    expect(texture.image).toMatchObject({ width: 4, height: 4 });
  });

  it.each([
    new DataTexture(new Uint8Array(3), 1, 1),
    new DataTexture(new Float32Array(4), 1, 1, undefined, FloatType),
    new DataTexture(new Uint8Array(4), 0, 1),
    new Texture(),
  ])("refuses missing or non-byte RGBA image data instead of corrupting it", async (texture) => {
    installCpuCanvas();
    const scene = new Scene();
    scene.add(new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ normalMap: texture })));
    await expect(prepareStarterExportTextures(scene)).rejects.toThrow("TN_VISUAL_TEXTURE");
  });
});
