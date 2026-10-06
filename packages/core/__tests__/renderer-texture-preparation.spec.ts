import { CompressedTexture, DataTexture, RGBA_BPTC_Format } from "three";
import { afterEach, expect, it, vi } from "vitest";
import { createRenderer } from "../src/renderer.js";

afterEach(() => vi.unstubAllGlobals());

function canvas(): HTMLCanvasElement {
  const value = new EventTarget();
  Object.defineProperties(value, {
    clientHeight: { value: 180 },
    clientWidth: { value: 320 },
  });
  return value as HTMLCanvasElement;
}

function compressed(): CompressedTexture {
  const value = new CompressedTexture(
    [{ data: new Uint8Array(16), width: 4, height: 4 }],
    4,
    4,
    RGBA_BPTC_Format,
  );
  value.needsUpdate = true;
  return value;
}

it("forwards original compressed Texture identities once and awaits their preparation gate", async () => {
  vi.stubGlobal("navigator", { gpu: {} });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepare = vi.fn((_texture: unknown, _options: object) => gate);
  const renderer = await createRenderer({
    canvas: canvas(),
    webgpuFactory: () => ({
      domElement: canvas(),
      prepareTextureAsync: prepare,
      render: () => {},
      setSize: () => {},
    }),
  });
  try {
    const texture = compressed();
    const ordinary = new DataTexture(new Uint8Array(4), 1, 1);
    let complete = false;
    const pending = renderer.prepareTextures?.([texture, texture, ordinary]).then((count) => {
      complete = true;
      return count;
    });
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0]).toBe(texture);
    expect(prepare.mock.calls[0]?.[1]).toMatchObject({ budgetMs: 2, maxBytesPerWrite: 65_536 });
    expect(complete).toBe(false);
    release();
    await expect(pending).resolves.toBe(1);
  } finally {
    release();
    renderer.dispose();
  }
});

it("fails closed when a WebGPU renderer lacks the bounded preparation seam", async () => {
  vi.stubGlobal("navigator", { gpu: {} });
  const sync = vi.fn();
  const renderer = await createRenderer({
    canvas: canvas(),
    webgpuFactory: () => ({
      domElement: canvas(),
      initTexture: sync,
      render: () => {},
      setSize: () => {},
    }),
  });
  try {
    await expect(renderer.prepareTextures?.([compressed()])).rejects.toThrow(
      /bounded|unsupported/i,
    );
    expect(sync).not.toHaveBeenCalled();
  } finally {
    renderer.dispose();
  }
});

it("cancels preparation when the renderer is disposed", async () => {
  vi.stubGlobal("navigator", { gpu: {} });
  const prepare = vi.fn(
    (_texture: unknown, options: { signal: AbortSignal }) =>
      new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        });
      }),
  );
  const renderer = await createRenderer({
    canvas: canvas(),
    webgpuFactory: () => ({
      domElement: canvas(),
      prepareTextureAsync: prepare,
      render: () => {},
      setSize: () => {},
    }),
  });
  const pending = renderer.prepareTextures?.([compressed()]);
  const rejected = expect(pending).rejects.toThrow(/disposed/i);
  await Promise.resolve();
  renderer.dispose();
  await rejected;
});
