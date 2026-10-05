import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { compileAssets } from "../src/index.js";
import {
  type INativePackageEntry,
  NativeEntryKind,
  NativePackageError,
  WGPU_TEXTURE_FORMAT_RGBA8_UNORM,
  readNativePackageManifest,
  writeNativePackage,
} from "../src/native-package.js";

/** The exact inputs `package_writer_fixture.cpp` writes, in the same order. */
function referenceEntries(): INativePackageEntry[] {
  const geometry = Uint8Array.from({ length: 16 }, (_value, index) => index);
  const texture = Buffer.alloc(12);
  texture.writeUInt32LE(2, 0);
  texture.writeUInt32LE(2, 4);
  texture.writeUInt32LE(WGPU_TEXTURE_FORMAT_RGBA8_UNORM, 8);
  const pixels = Uint8Array.from({ length: 2 * 2 * 4 }, (_value, index) => 255 - index);
  return [
    {
      data: geometry,
      dependencies: [],
      kind: NativeEntryKind.Buffer,
      name: "geometry/positions",
      uploadSize: 16,
    },
    {
      data: Uint8Array.from([1, 2, 3, 4]),
      dependencies: [0, 2],
      kind: NativeEntryKind.Scene,
      name: "scenes/main",
      uploadSize: 0,
    },
    {
      data: Buffer.concat([texture, pixels]),
      dependencies: [0],
      kind: NativeEntryKind.Texture,
      name: "textures/albedo",
      uploadSize: 16,
    },
  ];
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NativePackageError) return error.code;
    throw error;
  }
  throw new Error("expected readNativePackageManifest to refuse");
}

describe("writeNativePackage", () => {
  it("round-trips the header and table through the reader", () => {
    const bytes = writeNativePackage(referenceEntries());
    const manifest = readNativePackageManifest(bytes);

    expect(manifest.version).toBe(1);
    expect(manifest.entries.map((entry) => entry.name)).toEqual([
      "geometry/positions",
      "scenes/main",
      "textures/albedo",
    ]);
    expect(manifest.entries.map((entry) => entry.kind)).toEqual([1, 6, 2]);
    expect(manifest.entries.map((entry) => entry.dependencies)).toEqual([[], [0, 2], [0]]);
    expect(manifest.entries.map((entry) => entry.size)).toEqual([16, 4, 28]);
    expect(manifest.entries.map((entry) => entry.uploadSize)).toEqual([16, 0, 16]);

    const positions = referenceEntries()[0]?.data ?? new Uint8Array();
    const digest = new Uint8Array(createHash("sha256").update(positions).digest());
    expect(manifest.entries[0]?.hash).toEqual(digest);
    // Data sits right after the table, in entry order.
    const tableEnd = manifest.entries[0]?.offset ?? 0;
    expect(manifest.entries[1]?.offset).toBe(tableEnd + 16);
  });

  it("produces byte-identical output to the C++ reference writer", async () => {
    const reference = await readFile(path.join(import.meta.dirname, "fixtures/reference.tnpk"));
    const written = Buffer.from(writeNativePackage(referenceEntries()));

    expect(written.length).toBe(reference.length);
    expect(written.equals(reference)).toBe(true);
  });

  it("refuses truncation, magic, version and out-of-range data with the C++ codes", async () => {
    const reference = await readFile(path.join(import.meta.dirname, "fixtures/reference.tnpk"));
    const view = (bytes: Buffer): DataView =>
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(codeOf(() => readNativePackageManifest(reference.subarray(0, 10)))).toBe(
      "TN_PACKAGE_TRUNCATED",
    );

    const magic = Buffer.from(reference);
    magic[0] = 0x58;
    expect(codeOf(() => readNativePackageManifest(magic))).toBe("TN_PACKAGE_MAGIC");

    const version = Buffer.from(reference);
    view(version).setUint32(4, 2, true);
    expect(codeOf(() => readNativePackageManifest(version))).toBe("TN_PACKAGE_VERSION");

    const tableRunsPastEnd = Buffer.from(reference);
    view(tableRunsPastEnd).setBigUint64(16, BigInt(reference.length), true);
    expect(codeOf(() => readNativePackageManifest(tableRunsPastEnd))).toBe("TN_PACKAGE_TRUNCATED");

    const range = Buffer.from(reference);
    // The first entry's offset field: name length and name precede kind, decoders and offset.
    const nameLength = view(range).getUint16(24, true);
    view(range).setBigUint64(24 + 2 + nameLength + 2 + 4, BigInt(reference.length), true);
    expect(codeOf(() => readNativePackageManifest(range))).toBe("TN_PACKAGE_RANGE");

    const dependency = writeNativePackage([
      { data: Uint8Array.from([1, 2, 3, 4]), dependencies: [0], kind: 1, name: "self" },
    ]);
    expect(codeOf(() => readNativePackageManifest(dependency))).toBe("TN_PACKAGE_DEPENDENCY");
  });
});

describe("assets.nativePackage", () => {
  it("writes one Texture entry per RGBA8 PNG and one Buffer entry per binary buffer", async () => {
    const root = await makeTempDir("threenative-native-package-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 4, width: 4 }));
    await writeFile(path.join(root, "assets", "data.bin"), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    // Decoder-free and model-free: the PNG ships as a PNG, so it is a legal v1 texture.
    const first = await compileAssets({
      config: { models: "none", nativePackage: true, textures: "none" },
      cwd: root,
    });
    const output = await readFile(path.join(root, "public", "native", "assets.tnpk"));
    const manifest = readNativePackageManifest(output);

    expect(manifest.entries.map((entry) => entry.name)).toEqual(["data.bin", "rock.png"]);
    expect(manifest.entries[0]?.kind).toBe(NativeEntryKind.Buffer);
    expect(manifest.entries[0]?.size).toBe(8);
    expect(manifest.entries[1]?.kind).toBe(NativeEntryKind.Texture);
    // 12-byte header plus 4x4 RGBA pixels.
    expect(manifest.entries[1]?.size).toBe(12 + 4 * 4 * 4);
    expect(manifest.entries[1]?.uploadSize).toBe(4 * 4 * 4);
    expect(first.receipt?.outputs.some((entry) => entry.path === "native/assets.tnpk")).toBe(true);

    // A cache hit rebuilds the package from the outputs on disk and still lists it.
    const second = await compileAssets({
      config: { models: "none", nativePackage: true, textures: "none" },
      cwd: root,
    });
    expect(second.written).toBe(0);
    expect(second.receipt?.outputs.some((entry) => entry.path === "native/assets.tnpk")).toBe(true);
    expect(
      (await readFile(path.join(root, "public", "native", "assets.tnpk"))).equals(output),
    ).toBe(true);
  });

  it("writes nothing when the option is off", async () => {
    const root = await makeTempDir("threenative-native-package-off-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 4, width: 4 }));

    await compileAssets({ config: { models: "none", textures: "none" }, cwd: root });

    await expect(readFile(path.join(root, "public", "native", "assets.tnpk"))).rejects.toThrow();
  });

  it("accepts the resolved option and rejects a non-boolean with the named code", async () => {
    const root = await makeTempDir("threenative-native-package-config-");
    await expect(
      compileAssets({ config: { nativePackage: true }, cwd: root }),
    ).resolves.toBeDefined();
    await expect(
      compileAssets({
        config: { nativePackage: "yes" } as unknown as { nativePackage: boolean },
        cwd: root,
      }),
    ).rejects.toThrow(/TN_ASSETS_CONFIG_INVALID: assets\.nativePackage must be a boolean/u);
  });
});
