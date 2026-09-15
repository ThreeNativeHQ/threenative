import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, type GLTF, Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { TorusKnotGeometry } from "three";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { compileAssets } from "../src/index.js";
import { authoredLodName } from "../src/lod/eligibility.js";
import { type DiscreteLod, TNDiscreteLod, TN_DISCRETE_LOD } from "../src/lod/extension.js";
import {
  type IModelLodOptions,
  type IModelLodSummary,
  LOD_ERROR_TARGETS,
  resolveLodPolicy,
  selectDiscreteLevels,
} from "../src/lod/generate.js";
import { modelPass } from "../src/passes/model.js";
import { TNVirtualGeometry } from "../src/virtual/extension.js";

// PRD-377 §4/§5 — generation through the real model pass. Every fixture is a self-contained GLB
// driven through `modelPass`, the same entry the compile step uses; nothing here reaches into a
// private simplifier helper except where the rule under test is that helper's own (the 20% rule).

const SILENT = new Logger(Logger.Verbosity.SILENT);

function accessor(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4",
  array: Float32Array | Uint16Array | Uint32Array,
) {
  return document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}

/** A closed, indexed torus knot — every vertex referenced, so the pass self-verify has no pole drift. */
async function torusGlb(
  tubular: number,
  radial: number,
  options: {
    alpha?: "BLEND" | "MASK";
    custom?: boolean;
    joints?: boolean;
    morph?: boolean;
    name?: string;
    noIndices?: boolean;
  } = {},
): Promise<Buffer> {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene();
  const geometry = new TorusKnotGeometry(1, 0.4, tubular, radial);
  const position = accessor(
    document,
    buffer,
    "VEC3",
    Float32Array.from(geometry.attributes.position?.array ?? []),
  );
  const normal = accessor(
    document,
    buffer,
    "VEC3",
    Float32Array.from(geometry.attributes.normal?.array ?? []),
  );
  const material = document.createMaterial("rock");
  if (options.alpha !== undefined) material.setAlphaMode(options.alpha);
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setMaterial(material);
  if (options.noIndices !== true)
    primitive.setIndices(
      accessor(document, buffer, "SCALAR", Uint32Array.from(geometry.index?.array ?? [])),
    );
  const count = position.getCount();
  if (options.joints === true) {
    const joints = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let vertex = 0; vertex < count; vertex += 1) weights[vertex * 4] = 1;
    primitive.setAttribute("JOINTS_0", accessor(document, buffer, "VEC4", joints));
    primitive.setAttribute("WEIGHTS_0", accessor(document, buffer, "VEC4", weights));
  }
  if (options.custom === true)
    primitive.setAttribute(
      "_CUSTOM",
      accessor(document, buffer, "VEC2", new Float32Array(count * 2)),
    );
  if (options.morph === true) primitive.addTarget(document.createPrimitiveTarget());
  const name = options.name ?? "hull";
  scene.addChild(
    document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)),
  );
  return Buffer.from(await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document));
}

/** 8,192 triangles: eligible at the default floor, far below the virtual bake's 65,536 line. */
async function mediumGlb(options: Parameters<typeof torusGlb>[2] = {}): Promise<Buffer> {
  return torusGlb(256, 16, options);
}

/** 512 triangles: under the default floor, so a chain here could only come from config. */
async function smallGlb(options: Parameters<typeof torusGlb>[2] = {}): Promise<Buffer> {
  return torusGlb(32, 8, options);
}

/** A raw primitive with explicit indices, for topology and boundary fixtures. */
async function rawGlb(spec: {
  indices: number[];
  mode?: GLTF.MeshPrimitiveMode;
  minVertices: number;
  name?: string;
}): Promise<Buffer> {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene();
  const positions = new Float32Array(spec.minVertices * 3);
  for (let vertex = 0; vertex < spec.minVertices; vertex += 1) positions[vertex * 3] = vertex * 0.1;
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", accessor(document, buffer, "VEC3", positions))
    .setIndices(accessor(document, buffer, "SCALAR", Uint32Array.from(spec.indices)))
    .setMaterial(document.createMaterial("rock"));
  if (spec.mode !== undefined) primitive.setMode(spec.mode);
  const name = spec.name ?? "raw";
  scene.addChild(
    document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)),
  );
  return Buffer.from(await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document));
}

async function readWithLod(root: Buffer): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .setLogger(SILENT)
    .registerExtensions([...ALL_EXTENSIONS, TNVirtualGeometry, TNDiscreteLod])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return io.readJSON(await io.binaryToJSON(root));
}

/** A reader that has never heard of the extension, exactly like a stock `GLTFLoader`. */
async function readGeneric(root: Buffer): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .setLogger(SILENT)
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return io.readJSON(await io.binaryToJSON(root));
}

async function cook(
  input: Buffer,
  options: Parameters<typeof modelPass>[0],
): Promise<IModelLodSummary> {
  const result = await modelPass(options).apply(input, "hull.glb");
  if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
  if (result.entry?.lod === undefined) throw new Error("the pass produced no lod summary");
  return result.entry.lod as IModelLodSummary;
}

const GENERATE = { generation: { maxLevels: 4, minTriangles: 1_000 } } as const;

describe("automatic discrete LOD generation", () => {
  it("generates a monotonic, bounded chain on an eligible dense primitive", async () => {
    const input = await mediumGlb();
    const summary = await cook(input, { lod: GENERATE, virtual: "none" });

    expect(summary.enabled).toBe(true);
    expect(summary.generated).toBe(1);
    expect(summary.levels).toBeGreaterThanOrEqual(1);
    expect(summary.levels).toBeLessThanOrEqual(GENERATE.generation.maxLevels - 1);
    const levels = summary.primitives[0]?.levels ?? [];
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]?.triangles).toBeLessThan(levels[index - 1]?.triangles ?? 0);
      expect(levels[index]?.error).toBeGreaterThanOrEqual(levels[index - 1]?.error ?? 0);
    }
    expect(levels.at(-1)?.triangles ?? Number.POSITIVE_INFINITY).toBeLessThan(
      summary.trianglesBefore,
    );
    expect(summary.trianglesAfter).toBeLessThan(summary.trianglesBefore);
    expect(LOD_ERROR_TARGETS.length).toBeGreaterThanOrEqual(summary.levels);
    expect(summary.reasons).not.toContain("too-small");
  }, 120_000);

  it("records the chain in the artifact and round-trips it", async () => {
    const input = await mediumGlb();
    const result = await modelPass({ lod: GENERATE, virtual: "none" }).apply(input, "hull.glb");
    if (Buffer.isBuffer(result)) throw new Error("unchanged");

    const read = await readWithLod(result.buffer);
    // The document-level extension carries the identity once; the primitive carries the chain.
    const json = JSON.parse(
      result.buffer.subarray(20, 20 + result.buffer.readUInt32LE(12)).toString("utf8"),
    ) as { extensions?: Record<string, { generationFingerprint?: string }> };
    expect(json.extensions?.[TN_DISCRETE_LOD]?.generationFingerprint).toBe(
      (result.entry?.lod as IModelLodSummary).fingerprint,
    );
    const root = read.getRoot();
    const primitives = root
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .filter((primitive) => primitive.getExtension(TN_DISCRETE_LOD) !== null);
    expect(primitives).toHaveLength(1);
    const property = primitives[0]?.getExtension(TN_DISCRETE_LOD) as DiscreteLod | null;
    expect(property).not.toBeNull();
    expect(property?.getStrategy()).toBe("discrete");
    expect(property?.getSharedVertexBuffers()).toBe(true);
    expect(property?.getLod0Triangles()).toBe(8192);
    expect(property?.getCounts()).toHaveLength(property?.getIndices().length ?? 0);
    expect(property?.getErrors()).toHaveLength(property?.getCounts().length ?? 0);
    expect(property?.getErrorScale()).toBeGreaterThan(0);
  }, 120_000);

  it("leaves a primitive under minTriangles untouched and says why", async () => {
    const input = await smallGlb();
    const summary = await cook(input, {
      lod: { generation: { minTriangles: 5_000 } },
      virtual: "none",
    });
    expect(summary.generated).toBe(0);
    expect(summary.reasons).toContain("too-small");
  }, 60_000);

  it("does not generate when the policy is off", async () => {
    const summary = await cook(await mediumGlb(), { lod: { enabled: false }, virtual: "none" });
    expect(summary.enabled).toBe(false);
    expect(summary.generated).toBe(0);
    expect(summary.reasons).toContain("disabled");
  }, 60_000);

  it("skips a ClusteredMesh-owned primitive instead of stacking a discrete owner", async () => {
    // 65,536 triangles at a lowered virtual floor: the bake owns it, so discrete must not.
    const dense = await torusGlb(512, 64);
    const result = await modelPass({
      lod: { generation: { minTriangles: 1_000 } },
      virtual: { minSourceTriangles: 1024 },
    }).apply(dense, "hull.glb");
    if (Buffer.isBuffer(result)) throw new Error("unchanged");
    const summary = result.entry?.lod as IModelLodSummary;
    expect((result.entry?.virtual as { primitives: number }).primitives).toBe(1);
    expect(summary.generated).toBe(0);
    expect(summary.reasons).toContain("virtual-owned");
  }, 600_000);

  it("never turns virtual:none into default-on discrete", async () => {
    const summary = await cook(await mediumGlb(), { lod: {}, virtual: "none" });
    expect(summary.generated).toBe(0);
    expect(summary.reasons).toContain("virtual-none");
    expect(summary.enabled).toBe(false);
  }, 60_000);

  it("skips explicit legacy simplify with explicit-legacy-simplify", async () => {
    // Default virtual is fine here: 8,192 triangles is under its 65,536 floor, so the legacy
    // declaration under test is `simplify`, not `virtual: "none"`.
    const summary = await cook(await mediumGlb(), {
      lod: {},
      simplify: { ratio: 0.5 },
    });
    expect(summary.generated).toBe(0);
    expect(summary.reasons).toContain("explicit-legacy-simplify");
  }, 60_000);

  it("declines an already-cooked chain instead of reprocessing it", async () => {
    const input = await mediumGlb();
    const first = await modelPass({ lod: GENERATE, virtual: "none" }).apply(input, "hull.glb");
    if (Buffer.isBuffer(first)) throw new Error("unchanged");
    const second = await modelPass({ lod: GENERATE, virtual: "none" }).apply(
      first.buffer,
      "hull.glb",
    );
    if (Buffer.isBuffer(second)) throw new Error("unchanged");
    const summary = second.entry?.lod as IModelLodSummary;
    expect(summary.generated).toBe(0);
    expect(summary.reasons).toContain("already-cooked");
  }, 120_000);

  it("reports each structural skip reason on a fixture that triggers it", async () => {
    const cases: readonly {
      reason: string;
      build: () => Promise<Buffer>;
      lod?: Parameters<typeof modelPass>[0];
    }[] = [
      {
        build: () => rawGlb({ indices: [0, 1, 2], minVertices: 3, mode: 1 }),
        reason: "unsupported-topology",
      },
      {
        build: () => rawGlb({ indices: [0, 1, 2], minVertices: 3, mode: 0 }),
        reason: "unsupported-topology",
      },
      { build: () => smallGlb({ custom: true }), reason: "unsupported-attributes" },
      { build: () => smallGlb({ joints: true }), reason: "deforming" },
      { build: () => smallGlb({ morph: true }), reason: "deforming" },
      { build: () => smallGlb({ alpha: "BLEND" }), reason: "material-unsupported" },
      { build: () => smallGlb({ alpha: "MASK" }), reason: "material-unsupported" },
      { build: () => smallGlb({ name: "hull_LOD1" }), reason: "authored-lod" },
      {
        // Edge (0,1) is shared by three triangles: a non-manifold fan. A tiny floor is needed so
        // the fixture is not declined as too-small first.
        build: () => rawGlb({ indices: [0, 1, 2, 0, 1, 3, 0, 1, 4], minVertices: 5 }),
        lod: { lod: { generation: { minTriangles: 1 } }, virtual: "none" },
        reason: "boundary-unsafe",
      },
    ];
    for (const { reason, build, lod } of cases) {
      const summary = await cook(await build(), lod ?? { lod: GENERATE, virtual: "none" });
      expect(summary.generated, reason).toBe(0);
      expect(summary.reasons, reason).toContain(reason);
    }
  }, 120_000);
});

describe("discrete LOD artifact rules", () => {
  it("keeps LOD0 byte-identical to the non-AutoLOD cook", async () => {
    const input = await mediumGlb();
    const plain = await modelPass({ virtual: "none" }).apply(input, "hull.glb");
    const generated = await modelPass({ lod: GENERATE, virtual: "none" }).apply(input, "hull.glb");
    if (Buffer.isBuffer(plain) || Buffer.isBuffer(generated)) throw new Error("unchanged");

    const plainRoot = (await readWithLod(plain.buffer)).getRoot();
    const generatedRoot = (await readWithLod(generated.buffer)).getRoot();
    const arrays = (root: ReturnType<Document["getRoot"]>): Uint8Array[] =>
      root
        .listMeshes()
        .flatMap((mesh) => mesh.listPrimitives())
        .flatMap((primitive) => [
          ...(primitive.getIndices()?.getArray() ?? []),
          ...(primitive.getAttribute("POSITION")?.getArray() ?? []),
        ]);
    expect(arrays(generatedRoot)).toEqual(arrays(plainRoot));
  }, 120_000);

  it("shows a generic reader only LOD0", async () => {
    const input = await mediumGlb();
    const result = await modelPass({ lod: GENERATE, virtual: "none" }).apply(input, "hull.glb");
    if (Buffer.isBuffer(result)) throw new Error("unchanged");

    const generic = await readGeneric(result.buffer);
    const source = await readGeneric(input);
    const triangles = (root: ReturnType<Document["getRoot"]>) =>
      root
        .listMeshes()
        .flatMap((mesh) => mesh.listPrimitives())
        .map((primitive) => primitive.getIndices()?.getCount() ?? 0);
    expect(triangles(generic.getRoot())).toEqual(triangles(source.getRoot()));
    expect(generic.getRoot().listMeshes()).toHaveLength(1);
    expect(generic.getRoot().listMeshes()[0]?.listPrimitives()).toHaveLength(1);
  }, 120_000);

  it("is deterministic and independent of runtime-only budget edits", async () => {
    const input = await mediumGlb();
    const base = {
      generation: { maxLevels: 4, minTriangles: 1_000 },
      runtime: { maxPixelError: 1 },
    };
    const first = await modelPass({ lod: base, virtual: "none" }).apply(input, "hull.glb");
    const second = await modelPass({ lod: base, virtual: "none" }).apply(input, "hull.glb");
    const retuned = await modelPass({
      lod: { ...base, runtime: { maxPixelError: 5, hysteresis: 0.3 } },
      virtual: "none",
    }).apply(input, "hull.glb");
    if (Buffer.isBuffer(first) || Buffer.isBuffer(second) || Buffer.isBuffer(retuned))
      throw new Error("unchanged");

    expect(first.buffer.equals(second.buffer)).toBe(true);
    // The runtime edit changes neither the bytes nor the pass's generation cache key.
    expect(first.buffer.equals(retuned.buffer)).toBe(true);
    expect(JSON.stringify(modelPass({ lod: base, virtual: "none" }).configuration)).toBe(
      JSON.stringify(
        modelPass({
          lod: { ...base, runtime: { maxPixelError: 5, hysteresis: 0.3 } },
          virtual: "none",
        }).configuration,
      ),
    );
  }, 120_000);

  it("drops a level that saves under 20% of its predecessor", () => {
    const kept = selectDiscreteLevels(
      [
        { error: 0.001, triangles: 850 }, // 15% off the 1,000 reference: dropped
        { error: 0.01, triangles: 700 }, // 30% off the reference: kept
        { error: 0.02, triangles: 640 }, // 8.5% off 700: dropped
        { error: 0.05, triangles: 500 }, // 28.5% off 700: kept
      ],
      4,
      1_000,
    );
    expect(kept.map((level) => level.triangles)).toEqual([700, 500]);
  });

  it("honours maxLevels as a ceiling, not a promise", () => {
    const kept = selectDiscreteLevels(
      [
        { error: 0.001, triangles: 800 },
        { error: 0.002, triangles: 600 },
        { error: 0.003, triangles: 400 },
        { error: 0.004, triangles: 200 },
      ],
      2,
      1_000,
    );
    expect(kept).toHaveLength(1);
  });

  it("resolves per-asset generation precedence and the absolute kill switch", () => {
    const project = {
      generation: { maxLevels: 6, minTriangles: 9_000 },
      overrides: { "hull.glb": { generation: { maxLevels: 2 } }, "off.glb": false },
    };
    expect(resolveLodPolicy(project, "hull.glb")).toMatchObject({
      enabled: true,
      generation: { maxLevels: 2, minTriangles: 9_000 },
    });
    expect(resolveLodPolicy(project, "off.glb")).toMatchObject({
      enabled: false,
      reasons: ["disabled"],
    });
    expect(resolveLodPolicy(false, "hull.glb", { virtualNone: true })).toMatchObject({
      enabled: false,
      reasons: ["disabled"],
    });
  });

  it("keeps the runtime budget out of the generation fingerprint", () => {
    const base = resolveLodPolicy(undefined, "hull.glb");
    const budget = resolveLodPolicy({ runtime: { hysteresis: 0.3, maxPixelError: 2 } }, "hull.glb");
    expect(budget.fingerprint.generation).toBe(base.fingerprint.generation);
    expect(budget.fingerprint.runtime).not.toBe(base.fingerprint.runtime);
    expect(budget.runtime).toEqual({ hysteresis: 0.3, maxPixelError: 2 });
  });

  it("matches authored LOD names", () => {
    expect(authoredLodName("hull_LOD1")).toBe(true);
    expect(authoredLodName("hull-lod2")).toBe(true);
    expect(authoredLodName("hull")).toBe(false);
    expect(authoredLodName("lodestone")).toBe(false);
  });
});

describe("assets.lod through the public compiler", () => {
  it("consumes the config, writes the extension and reports it in the manifest", async () => {
    const root = await makeTempDir("threenative-lod-");
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "assets/hull.glb"), await mediumGlb());

    await compileAssets({
      concurrency: 1,
      config: {
        audio: "none",
        lod: { enabled: true, generation: { maxLevels: 4, minTriangles: 1_000 } },
        models: { virtual: "none", textures: "none" },
        textures: "none",
      },
      cwd: root,
    });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { lod?: IModelLodSummary; output: string }> };
    const entry = manifest.entries["hull.glb"];
    expect(entry?.lod?.generated).toBe(1);
    expect(entry?.lod?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // The runtime selection budget travels in the manifest, not in executable config (PRD-377 §5).
    expect(entry?.lod?.preset).toBe("balanced");
    expect(entry?.lod?.runtime).toEqual({ hysteresis: 0.15, maxPixelError: 1 });
    const output = await readFile(path.join(root, "public", entry?.output ?? ""));
    const json = JSON.parse(output.subarray(20, 20 + output.readUInt32LE(12)).toString("utf8")) as {
      extensionsUsed?: string[];
    };
    expect(json.extensionsUsed).toContain(TN_DISCRETE_LOD);
  }, 120_000);

  it("bakes nothing and installs nothing when the global switch is off", async () => {
    for (const lod of [false, { enabled: false }] as const) {
      const root = await makeTempDir("threenative-lod-off-");
      await mkdir(path.join(root, "assets"), { recursive: true });
      await writeFile(path.join(root, "assets/hull.glb"), await mediumGlb());
      await compileAssets({
        concurrency: 1,
        config: {
          audio: "none",
          lod,
          models: { virtual: "none", textures: "none" },
          textures: "none",
        },
        cwd: root,
      });
      const manifest = JSON.parse(
        await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
      ) as { entries: Record<string, { lod?: IModelLodSummary; output: string }> };
      const entry = manifest.entries["hull.glb"];
      // `false` emits no row; `{ enabled: false }` reports the disabled policy. Neither bakes.
      expect(entry?.lod?.generated ?? 0).toBe(0);
      const output = await readFile(path.join(root, "public", entry?.output ?? ""));
      const json = JSON.parse(
        output.subarray(20, 20 + output.readUInt32LE(12)).toString("utf8"),
      ) as { extensionsUsed?: string[] };
      expect(json.extensionsUsed ?? []).not.toContain(TN_DISCRETE_LOD);
    }
  }, 120_000);

  it("refreshes the manifest runtime budget on a cache hit without rebaking", async () => {
    const root = await makeTempDir("threenative-lod-cache-");
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "assets/hull.glb"), await mediumGlb());
    const compile = (lod: IModelLodOptions) =>
      compileAssets({
        concurrency: 1,
        config: {
          audio: "none",
          lod,
          models: { virtual: "none", textures: "none" },
          textures: "none",
        },
        cwd: root,
      });
    const manifest = async (): Promise<{
      entries: Record<string, { bytes?: number; lod?: IModelLodSummary; output: string }>;
    }> =>
      JSON.parse(await readFile(path.join(root, "public/assets.manifest.json"), "utf8")) as never;

    await compile({ runtime: { maxPixelError: 1 } });
    const first = await manifest();
    await compile({ runtime: { maxPixelError: 5, hysteresis: 0.3 } });
    const second = await manifest();

    expect(second.entries["hull.glb"]?.lod?.runtime).toEqual({
      hysteresis: 0.3,
      maxPixelError: 5,
    });
    // The geometry is reused byte-for-byte: a runtime-only edit must not rebake.
    expect(second.entries["hull.glb"]?.output).toBe(first.entries["hull.glb"]?.output);
    expect(second.entries["hull.glb"]?.bytes).toBe(first.entries["hull.glb"]?.bytes);
  }, 120_000);
});
