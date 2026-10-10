import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { type IBrowserRuntime, defineBrowserClasses } from "../src/browser-backend.js";
import { type WebEngineModule, defineWebRenderer } from "../src/browser-renderer.js";

interface IRenderer {
  init(): Promise<unknown>;
  compileAsync(root: unknown, camera?: unknown, scene?: unknown): Promise<void>;
  render(root: unknown, camera: unknown): void;
  initTexture(texture: unknown): Promise<void>;
}

function fixture() {
  const empty = {
    constructor: true,
    methods: [],
    getters: [],
    setters: [],
    members: [],
    callbacks: [],
  };
  const runtime: IBrowserRuntime = {
    typeId: (name) => (name === "Scene" ? 1 : name === "PerspectiveCamera" ? 2 : 3),
    construct: () => {
      throw new Error("unused constructor");
    },
    invoke: () => undefined,
    get: () => undefined,
    set: () => {},
    release: () => {},
    setCallback: () => {},
  };
  const { wrap } = defineBrowserClasses(
    { classes: { Scene: empty, PerspectiveCamera: empty, Texture: empty } },
    runtime,
  );
  const root = wrap({ type: 1, key: "1:1:1:1" });
  const camera = wrap({ type: 2, key: "2:1:2:1" });
  const scene = wrap({ type: 1, key: "1:1:3:1" });
  const texture = wrap({ type: 3, key: "3:1:4:1" });
  let pointer = 48;
  let completed = 0;
  let syncCreates = 0;
  let error = "";
  const releases: Array<() => void> = [];
  const creates = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
  // GPU stub and the host's start/poll protocol: two missing pipeline keys, completed independently.
  const module = {
    HEAPU8: new Uint8Array(4096),
    specialHTMLTargets: {},
    _malloc: (bytes: number) => {
      const p = pointer;
      pointer += bytes;
      return p;
    },
    _free: () => {},
    lengthBytesUTF8: () => 32,
    stringToUTF8: () => {},
    UTF8ToString: () => error,
    _tnw_web_init: () => 0,
    _tnw_web_set_samples: () => 0,
    _tnw_web_poll: () => 1,
    _tnw_web_adapter: () => 0,
    _tnw_web_resize: () => 0,
    _tnw_web_error: () => 0,
    _tnw_web_renderer_state: () => 0,
    _tnw_web_init_texture: vi.fn((_texture: number) => 0),
    _tnw_web_frame: () => syncCreates,
    _tnw_web_compile: vi.fn(() => {
      for (let i = 0; i < 2; ++i)
        void creates().then(() => {
          completed++;
        });
      return 1;
    }),
    _tnw_web_compile_poll: vi.fn(() => (error ? -1 : completed === 2 ? 1 : 0)),
    _tnw_web_render: vi.fn(() => {
      syncCreates += 2 - completed;
      return 0;
    }),
  };
  class Color {
    r = 0;
    g = 0;
    b = 0;
  }
  const Renderer = defineWebRenderer(module as unknown as WebEngineModule, Color);
  const renderer = new Renderer({
    canvas: { width: 32, height: 32, setAttribute() {} },
  }) as IRenderer;
  return {
    renderer,
    module,
    root,
    camera,
    scene,
    texture,
    creates,
    releases,
    syncCreates: () => syncCreates,
    fail: (message: string) => {
      error = message;
    },
  };
}

describe("compileAsync on the browser renderer", () => {
  it("awaits every async pipeline creation; the next frame creates none", async () => {
    const f = fixture();
    let done = false;
    const compilation = f.renderer.compileAsync(f.root, f.camera, f.scene).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(f.creates).toHaveBeenCalledTimes(2));
    expect(done).toBe(false);
    expect(f.module._tnw_web_render).not.toHaveBeenCalled();
    f.releases[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(done).toBe(false);
    f.releases[1]?.();
    await compilation;
    f.renderer.render(f.root, f.camera);
    expect(f.syncCreates()).toBe(0);
    const [root, camera, scene] = f.module._tnw_web_compile.mock.calls[0] as unknown as number[];
    const view = new DataView(f.module.HEAPU8.buffer);
    expect(view.getUint32((root ?? 0) + 4, true)).toBe(1);
    expect(view.getUint32((camera ?? 0) + 4, true)).toBe(2);
    expect(view.getUint32((scene ?? 0) + 4, true)).toBe(3);
  });

  it.each([1, 2])("supports the %i-argument form", async (arity) => {
    const f = fixture();
    const pending =
      arity === 1 ? f.renderer.compileAsync(f.root) : f.renderer.compileAsync(f.root, f.camera);
    await vi.waitFor(() => expect(f.creates).toHaveBeenCalledTimes(2));
    for (const resolve of f.releases) resolve();
    await pending;
    const args = f.module._tnw_web_compile.mock.calls[0] as unknown as number[];
    expect(args[1] === 0).toBe(arity === 1);
    expect(args[2]).toBe(0);
  });

  it("rejects a failed async compile", async () => {
    const f = fixture();
    const pending = f.renderer.compileAsync(f.root, f.camera);
    const rejection = expect(pending).rejects.toThrow("TN_NATIVE_PIPELINE_REFUSED");
    await vi.waitFor(() => expect(f.creates).toHaveBeenCalledTimes(2));
    f.fail("TN_NATIVE_PIPELINE_REFUSED");
    await rejection;
    expect(f.module._tnw_web_render).not.toHaveBeenCalled();
    expect(() => f.renderer.render(f.root, f.camera)).not.toThrow();
  });

  it("uploads a texture through the host before resolving initTexture", async () => {
    const f = fixture();
    await f.renderer.initTexture(f.texture);
    expect(f.module._tnw_web_init_texture).toHaveBeenCalledTimes(1);
    const pointer = f.module._tnw_web_init_texture.mock.calls[0]?.[0] as number | undefined;
    expect(new DataView(f.module.HEAPU8.buffer).getUint32((pointer ?? 0) + 4, true)).toBe(4);
    expect(f.module._tnw_web_render).not.toHaveBeenCalled();
  });

  it("rejects texture upload failures and invalid engine objects", async () => {
    const f = fixture();
    f.module._tnw_web_init_texture.mockReturnValue(1);
    f.fail("TN_NATIVE_TEXTURE_INVALID");
    await expect(f.renderer.initTexture(f.texture)).rejects.toThrow("TN_NATIVE_TEXTURE_INVALID");
    await expect(f.renderer.initTexture({})).rejects.toThrow("not an engine object");
  });

  it("keeps speculative failures local", () => {
    const host = readFileSync(
      new URL("../../runtime-native/src/engine/wasm/web_host.cpp", import.meta.url),
      "utf8",
    );
    const compile = host.slice(
      host.indexOf('extern "C" uint32_t tnw_web_compile('),
      host.indexOf('extern "C" int tnw_web_render_target('),
    );
    expect(compile).not.toMatch(/\bfail\(/);
  });

  it("uses a separate compile database to preserve render scene records", () => {
    const host = readFileSync(
      new URL("../../runtime-native/src/engine/wasm/web_host.cpp", import.meta.url),
      "utf8",
    );
    const compile = host.slice(
      host.indexOf('extern "C" uint32_t tnw_web_compile('),
      host.indexOf('extern "C" int tnw_web_compile_poll('),
    );
    expect(compile).toMatch(/RenderDatabase\s+\w+;/);
    expect(compile).not.toMatch(/\bdatabase\.compileAsync/);
  });

  it("captures speculative shader validation before it reaches the global device error handler", () => {
    const cache = readFileSync(
      new URL("../../runtime-native/src/engine/renderer/pipeline_cache.cpp", import.meta.url),
      "utf8",
    );
    const creation = cache.slice(cache.indexOf("WGPURenderPipeline PipelineCache::create("));
    expect(creation.indexOf("wgpuDevicePushErrorScope")).toBeGreaterThan(-1);
    expect(creation.indexOf("wgpuDevicePushErrorScope")).toBeLessThan(
      creation.indexOf("WGPUShaderModule vs"),
    );
    expect(creation).toContain("wgpuDevicePopErrorScope");
    expect(creation.match(/std::unique_ptr<std::shared_ptr<Pending>> request/g)).toHaveLength(2);
  });
});
