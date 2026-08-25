import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { Document, type Material, NodeIO } from "@gltf-transform/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { compileAssets } from "../src/compile.js";
import {
  type IAssetFinding,
  type IAssetHealthEntry,
  type IAssetHealthInput,
  type IAssetHealthReport,
  formatHealthReport,
  runHealthReport,
} from "../src/health.js";
import { parsePng } from "../src/png.js";

const io = new NodeIO();

interface ITextureSpec {
  readonly colorType: number;
  readonly height: number;
  readonly width: number;
}

interface IModelSpec {
  readonly clips?: number;
  readonly materials?: number;
  readonly motionTarget?: "child" | "root";
  readonly rootNodeName?: string;
  readonly textures?: readonly ITextureSpec[];
  readonly triangles?: number;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    const entry = CRC_TABLE[(crc ^ byte) & 0xff];
    if (entry === undefined) throw new Error("CRC table hole");
    crc = entry ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typed, data])), 0);
  return Buffer.concat([length, typed, data, checksum]);
}

function pngBytes(
  width: number,
  height: number,
  colorType: number,
  withTransparency = false,
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(colorType, 9);
  const raw = Buffer.concat([Buffer.from([0]), Buffer.alloc(height * width * 4, 0x80)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...(withTransparency ? [pngChunk("tRNS", Buffer.from([0, 0]))] : []),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A minimal JPEG the glTF-Transform image parser accepts: SOI, one throwaway COM segment
 * (its scanner checks the marker *following* each segment), then SOF0 carrying the size.
 */
function jpgBytes(width: number, height: number): Buffer {
  const segment = (marker: number, payload: Buffer): Buffer => {
    const length = payload.length + 2;
    return Buffer.concat([Buffer.from([0xff, marker, length >> 8, length & 0xff]), payload]);
  };
  const sof = Buffer.from([8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xfe, Buffer.from("x")),
    segment(0xc0, sof),
  ]);
}

function textureBytes(spec: ITextureSpec): Buffer {
  return pngBytes(spec.width, spec.height, spec.colorType);
}

function buildModel(spec: IModelSpec = {}): Document {
  const doc = new Document();
  doc.createBuffer("buf");
  const materialCount = spec.materials ?? 1;
  let material: Material | undefined;
  for (let index = 0; index < materialCount; index += 1) {
    material = doc.createMaterial(`mat${index}`);
  }
  if (!material) throw new Error("fixture models declare at least one material");
  const vertexCount = (spec.triangles ?? 1) * 3;
  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) positions[vertex * 3] = vertex;
  const indices = Uint16Array.from({ length: vertexCount }, (_, index) => index);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor("pos").setType("VEC3").setArray(positions))
    .setIndices(doc.createAccessor("idx").setType("SCALAR").setArray(indices))
    .setMaterial(material);
  (spec.textures ?? []).forEach((texture, index) => {
    const created = doc
      .createTexture(`tex${index}`)
      .setImage(textureBytes(texture))
      .setMimeType("image/png");
    if (index === 0) material.setBaseColorTexture(created);
    else material.setEmissiveTexture(created);
  });
  const mesh = doc.createMesh("mesh").addPrimitive(prim);
  const body = doc.createNode("body").setMesh(mesh);
  const rootNode = doc.createNode(spec.rootNodeName ?? "root").addChild(body);
  doc.createScene("Scene").addChild(rootNode);
  for (let clip = 0; clip < (spec.clips ?? 0); clip += 1) {
    const animation = doc.createAnimation(`clip${clip}`);
    const input = doc
      .createAccessor(`times${clip}`)
      .setType("SCALAR")
      .setArray(new Float32Array([0, 1]));
    const output = doc
      .createAccessor(`values${clip}`)
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0]));
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    const channel = doc
      .createAnimationChannel()
      .setTargetPath("translation")
      .setTargetNode(spec.motionTarget === "child" ? body : rootNode)
      .setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  return doc;
}

async function modelBytes(spec: IModelSpec = {}): Promise<Buffer> {
  return Buffer.from(await io.writeBinary(buildModel(spec)));
}

async function assetsDir(prefix: string): Promise<string> {
  const root = await makeTempDir(prefix);
  await mkdir(path.join(root, "assets", "models"), { recursive: true });
  return root;
}

async function placeModel(root: string, logical: string, spec: IModelSpec = {}): Promise<void> {
  await writeFile(path.join(root, "assets", logical), await modelBytes(spec));
}

/** Minimal self-contained .gltf text, used where GLB cannot carry the field under test. */
function gltfText(asset: Record<string, string>): Buffer {
  return Buffer.from(
    JSON.stringify({
      asset: { version: "2.0", ...asset },
      nodes: [{ name: "n" }],
      scenes: [{ nodes: [0] }],
    }),
    "utf8",
  );
}

function findingOf(
  report: IAssetHealthReport,
  id: string,
  asset?: string,
  subject?: string,
): IAssetFinding {
  const match = report.findings.find(
    (candidate) =>
      candidate.id === id &&
      candidate.asset === (asset ?? candidate.asset) &&
      candidate.subject === (subject ?? candidate.subject),
  );
  if (!match) {
    const seen = report.findings.map((f) => `${f.asset} ${f.subject ?? ""} ${f.id}`).join("; ");
    throw new Error(`no '${id}' finding for ${asset ?? "*"}; saw: ${seen}`);
  }
  return match;
}

function entryOf(report: IAssetHealthReport, asset: string): IAssetHealthEntry {
  const match = report.entries.find((candidate) => candidate.asset === asset);
  if (!match) throw new Error(`no entry for ${asset}; saw: ${report.entries.map((e) => e.asset)}`);
  return match;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runHealthReport", () => {
  it("should report a triangle count that fails a declared target", async () => {
    const data = await modelBytes({ triangles: 2 });

    const strict = await runHealthReport([{ data, logicalPath: "models/knight.glb" }], {
      maxTriangles: 1,
    });
    expect(findingOf(strict, "triangles", "models/knight.glb").grade).toBe("fail");
    expect(findingOf(strict, "triangles", "models/knight.glb").value).toBe(2);
    expect(strict.failed).toBe(true);

    // Negative control: raising the target to the measured count turns the same finding ok.
    const lenient = await runHealthReport([{ data, logicalPath: "models/knight.glb" }], {
      maxTriangles: 2,
    });
    expect(findingOf(lenient, "triangles", "models/knight.glb").grade).toBe("ok");
    expect(lenient.failed).toBe(false);
  });

  it("should report license as unknown when no metadata exists", async () => {
    const report = await runHealthReport([
      { data: await modelBytes({ triangles: 2 }), logicalPath: "models/knight.glb" },
      { data: Buffer.from("riff-wave"), logicalPath: "audio/hum.ogg" },
    ]);

    expect(entryOf(report, "models/knight.glb").license).toBe("unknown");
    expect(findingOf(report, "license", "audio/hum.ogg").value).toBe("unknown");

    // Negative control: attribution carried by the file is reported verbatim.
    const attributed = await runHealthReport([
      { data: gltfText({ copyright: "CC-BY-4.0" }), logicalPath: "props/statue.gltf" },
    ]);
    expect(entryOf(attributed, "props/statue.gltf").license).toBe("CC-BY-4.0");
    expect(findingOf(attributed, "license", "props/statue.gltf").grade).toBe("ok");
  });

  it("should not fail the build when no target is declared", async () => {
    const root = await assetsDir("threenative-health-no-target-");
    await placeModel(root, path.join("models", "knight.glb"), { triangles: 2 });
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    const result = await compileAssets({ cwd: root, transcoder: basisTranscoderPaths() });

    // Default result shape stays exactly as before — no report key unless asked for.
    expect(result).toEqual({ skipped: 0, written: 2 });

    const detailed = await compileAssets({
      cwd: root,
      health: true,
      transcoder: basisTranscoderPaths(),
    });
    expect(detailed.report?.failed).toBe(false);
    expect(detailed.report?.summary.fail).toBe(0);
    expect(detailed.report?.summary.warn).toBeGreaterThan(0);
  });

  it("should report a count that changes with the asset", async () => {
    const small = await runHealthReport([
      { data: await modelBytes({ triangles: 2 }), logicalPath: "models/slime.glb" },
    ]);
    const large = await runHealthReport([
      { data: await modelBytes({ triangles: 5 }), logicalPath: "models/titan.glb" },
    ]);

    expect(findingOf(small, "triangles", "models/slime.glb").value).toBe(2);
    expect(findingOf(large, "triangles", "models/titan.glb").value).toBe(5);
  });

  it("should fail compilation only when a declared target is exceeded", async () => {
    const root = await assetsDir("threenative-health-target-");
    await placeModel(root, path.join("models", "knight.glb"), { triangles: 2 });

    await expect(
      compileAssets({ config: { targets: { maxTriangles: 1 } }, cwd: root }),
    ).rejects.toThrow(/TN_ASSETS_HEALTH_FAILED.*knight\.glb/u);

    await expect(
      compileAssets({ config: { targets: { maxTriangles: 2 } }, cwd: root }),
    ).resolves.toMatchObject({ written: 1 });
  });

  it("should reject an unknown key inside assets.targets", async () => {
    // TypeScript rejects this key statically; the compile step must also reject it at
    // runtime for callers arriving through parsed config.
    const bogus = { maxTriangles: 100, bogus: 1 };
    await expect(compileAssets({ config: { targets: bogus }, cwd: "." })).rejects.toThrow(
      /assets\.targets\.bogus/u,
    );
  });

  it("should detect colliders named with the convention and warn when absent", async () => {
    const marked = await runHealthReport([
      { data: await modelBytes({ rootNodeName: "knight-col" }), logicalPath: "models/knight.glb" },
    ]);
    expect(entryOf(marked, "models/knight.glb").model?.colliderPresent).toBe(true);
    expect(findingOf(marked, "collider", "models/knight.glb").grade).toBe("ok");

    const bare = await runHealthReport([
      { data: await modelBytes({ rootNodeName: "knight" }), logicalPath: "models/knight.glb" },
    ]);
    expect(entryOf(bare, "models/knight.glb").model?.colliderPresent).toBe(false);
    expect(findingOf(bare, "collider", "models/knight.glb").grade).toBe("warn");
  });

  it("should detect root motion only from translation channels on scene-root nodes", async () => {
    const moving = await runHealthReport([
      { data: await modelBytes({ clips: 1, motionTarget: "root" }), logicalPath: "models/run.glb" },
    ]);
    expect(entryOf(moving, "models/run.glb").model?.rootMotion).toBe(true);

    const local = await runHealthReport([
      {
        data: await modelBytes({ clips: 1, motionTarget: "child" }),
        logicalPath: "models/idle.glb",
      },
    ]);
    expect(entryOf(local, "models/idle.glb").model?.rootMotion).toBe(false);
  });

  it("should measure standalone textures for dimensions, power-of-two, and alpha", async () => {
    const report = await runHealthReport(
      [
        { data: pngBytes(3, 5, 6), logicalPath: "rock.png" },
        { data: pngBytes(4, 4, 2), logicalPath: "wall.png" },
        { data: jpgBytes(32, 16), logicalPath: "sky.jpg" },
      ],
      { maxTextureDimension: 64 },
    );

    const rock = entryOf(report, "rock.png").texture;
    expect(rock).toEqual({ alpha: true, height: 5, powerOfTwo: false, width: 3 });
    expect(findingOf(report, "texture.powerOfTwo", "rock.png").grade).toBe("warn");
    expect(findingOf(report, "texture.alpha", "rock.png").value).toBe(true);

    const wall = entryOf(report, "wall.png").texture;
    expect(wall).toEqual({ alpha: false, height: 4, powerOfTwo: true, width: 4 });
    expect(findingOf(report, "texture.powerOfTwo", "wall.png").grade).toBe("ok");

    const sky = entryOf(report, "sky.jpg").texture;
    expect(sky?.width).toBe(32);
    expect(sky?.height).toBe(16);
    expect(sky?.alpha).toBe(false);
  });

  it("should share the PNG parser for tRNS alpha in health results", async () => {
    const data = pngBytes(3, 5, 2, true);
    expect(parsePng(data)).toEqual({ height: 5, width: 3, hasAlpha: true });
    expect(
      entryOf(await runHealthReport([{ data, logicalPath: "trns.png" }]), "trns.png").texture,
    ).toMatchObject({ alpha: true, height: 5, width: 3 });
  });

  it("should count materials and animation clips per model", async () => {
    const stats = entryOf(
      await runHealthReport([
        {
          data: await modelBytes({ clips: 2, materials: 2 }),
          logicalPath: "models/hero.glb",
        },
      ]),
      "models/hero.glb",
    ).model;

    expect(stats?.animationClips).toBe(2);
    expect(stats?.materials).toBe(2);
    expect(stats?.textures).toEqual([]);
  });

  it("should refuse an unreadable model instead of reporting invented numbers", async () => {
    const root = await assetsDir("threenative-health-corrupt-");
    await writeFile(path.join(root, "assets", "broken.glb"), Buffer.from("definitely not glTF"));

    await expect(compileAssets({ cwd: root })).rejects.toThrow(
      /TN_ASSETS_MODEL_UNREADABLE.*broken\.glb/u,
    );
  });

  it("should read a model that requires a glTF extension the health report does not decode", async () => {
    // A .glb authored with EXT_texture_webp is a normal export today, and the model pass reads
    // it because `createIo()` registers ALL_EXTENSIONS. The health report built its own bare
    // `new NodeIO()`, so glTF-Transform refused the file for a *required* extension it had not
    // been told about and the whole build died on a report that is meant to be advisory.
    const root = await assetsDir("threenative-health-webp-");
    await writeFile(
      path.join(root, "assets", "webp-required.gltf"),
      Buffer.from(
        JSON.stringify({
          asset: { version: "2.0" },
          extensionsRequired: ["EXT_texture_webp"],
          extensionsUsed: ["EXT_texture_webp"],
          nodes: [{ name: "n" }],
          scenes: [{ nodes: [0] }],
        }),
        "utf8",
      ),
    );

    await expect(compileAssets({ cwd: root })).resolves.toBeDefined();
  });

  it("should print one line per finding plus a summary when compiling", async () => {
    const root = await assetsDir("threenative-health-print-");
    await placeModel(root, path.join("models", "knight.glb"), { triangles: 2 });
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      await compileAssets({ cwd: root, transcoder: basisTranscoderPaths() });
    } finally {
      log.mockRestore();
    }

    const printed = lines.join("\n");
    expect(printed).toContain("[warn] rock.png:");
    expect(printed).toContain("[warn] rock.png: license: unknown");
    expect(printed).toMatch(/asset health: 2 asset\(s\), \d+ ok, \d+ warn, \d+ fail/u);
    expect(formatHealthReport(await runHealthReport([])).length).toBeGreaterThan(0);
  });
});
