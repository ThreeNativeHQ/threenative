import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { writeCompressionSidecars } from "../src/compress.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function payload(size: number, seed: number): Buffer {
  return Buffer.alloc(size, seed);
}

describe("web build compression sidecars", () => {
  it("compresses only >1 KiB compressible files and round-trips their bytes", async () => {
    const root = await makeTempDir("threenative-compress-");
    roots.push(root);
    const files: Record<string, Buffer> = {
      "app.js": payload(2048, 1),
      "small.js": payload(500, 2),
      "icon.png": payload(2048, 3),
      "game.wasm": payload(2048, 4),
      "index.html": Buffer.from('<script type="module" src="/app.js"></script>'),
    };
    for (const [name, bytes] of Object.entries(files)) {
      await writeFile(path.join(root, name), bytes);
    }

    const report = await writeCompressionSidecars(root);
    expect(report).toEqual({
      brotli: (await readFile(path.join(root, "app.js.br"))).byteLength,
      entry: "app.js",
      gzip: (await readFile(path.join(root, "app.js.gz"))).byteLength,
      raw: 2048,
    });

    for (const name of ["app.js", "game.wasm"]) {
      const raw = files[name] as Buffer;
      const brotli = await readFile(path.join(root, `${name}.br`));
      const gzip = await readFile(path.join(root, `${name}.gz`));
      expect(brotliDecompressSync(brotli)).toEqual(raw);
      expect(gunzipSync(gzip)).toEqual(raw);
    }

    await expect(readFile(path.join(root, "small.js.br"))).rejects.toThrow();
    await expect(readFile(path.join(root, "small.js.gz"))).rejects.toThrow();
    await expect(readFile(path.join(root, "icon.png.br"))).rejects.toThrow();
    await expect(readFile(path.join(root, "icon.png.gz"))).rejects.toThrow();
  });
});
