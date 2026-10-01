import "./file-fetch.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

import { afterAll, describe, expect, it } from "vitest";

import { type IRigEvaluator, RigEvaluator } from "../src/wasm-evaluator.js";

interface IVector {
  readonly name: string;
  readonly lod: number;
  readonly mode: "gui" | "raw";
  readonly values: readonly number[];
}

interface IExpected {
  readonly joints: readonly number[];
  readonly blendshapes: readonly number[];
  readonly animatedMaps: readonly number[];
}

interface IReference {
  readonly counts: {
    readonly gui: number;
    readonly raw: number;
    readonly joint: number;
    readonly blendshape: number;
    readonly animatedMap: number;
    readonly lod: number;
  };
  readonly names: {
    readonly gui: readonly string[];
    readonly raw: readonly string[];
    readonly joint: readonly string[];
    readonly blendshape: readonly string[];
    readonly animatedMap: readonly string[];
  };
  readonly cases: readonly (IExpected & { name: string })[];
}

/** Float32 WASM against the same rig in a float32 C++ build: agree to rounding, not exactly. */
function allowedError(reference: number): number {
  return 1e-5 + 1e-4 * Math.abs(reference);
}

let worstError = 0;
let worstWhere = "nothing compared";

function compare(actual: Float32Array, expected: readonly number[], where: string): void {
  if (actual.length !== expected.length)
    throw new Error(`${where}: got ${actual.length} floats, the reference has ${expected.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index] as number;
    const error = Math.abs((actual[index] as number) - wanted);
    if (error > worstError) {
      worstError = error;
      worstWhere = `${where}[${index}]`;
    }
    if (!(error <= allowedError(wanted)))
      throw new Error(
        `${where}[${index}]: got ${actual[index]}, reference ${wanted}, error ${error} over the allowed ${allowedError(wanted)}`,
      );
  }
}

/** One case, driven exactly as its vector names it. */
function playCase(evaluator: IRigEvaluator, vector: IVector): void {
  evaluator.setLod(vector.lod);
  if (vector.mode === "gui") {
    evaluator.setGuiControls(Float32Array.from(vector.values));
    evaluator.evaluate(true);
    return;
  }
  evaluator.setRawControls(Float32Array.from(vector.values));
  evaluator.evaluate(false);
}

function syntheticDna(): Uint8Array {
  return new Uint8Array(readFileSync(new URL("../fixtures/synthetic.dna", import.meta.url)));
}

/** Every vector against its reference case, matched by name so a missing case is fatal. */
function playAndCompare(
  evaluator: IRigEvaluator,
  vectors: readonly IVector[],
  reference: IReference,
  label: string,
) {
  const byName = new Map(reference.cases.map((item) => [item.name, item]));
  expect(byName.size).toBe(reference.cases.length);
  for (const vector of vectors) {
    const expected = byName.get(vector.name);
    if (expected === undefined)
      throw new Error(`${label}: the reference has no case ${vector.name}`);
    playCase(evaluator, vector);
    compare(evaluator.jointOutputs(), expected.joints, `${label}.${vector.name}.joints`);
    compare(
      evaluator.blendShapeOutputs(),
      expected.blendshapes,
      `${label}.${vector.name}.blendshapes`,
    );
    compare(
      evaluator.animatedMapOutputs(),
      expected.animatedMaps,
      `${label}.${vector.name}.animatedMaps`,
    );
  }
}

const vectors = JSON.parse(
  readFileSync(new URL("../fixtures/synthetic.vectors.json", import.meta.url), "utf8"),
) as { cases: IVector[] };
const reference = JSON.parse(
  readFileSync(new URL("../fixtures/synthetic.reference.json", import.meta.url), "utf8"),
) as IReference;

const sampleDirectory = process.env.TN_METAHUMAN_SAMPLE_DIR;
const sampleDna = sampleDirectory === undefined ? undefined : join(sampleDirectory, "Sample.dna");
const referenceCli = join(homedir(), ".cache/openriglogic/tools/tn_rl_reference");

/**
 * The local lane runs against licensed content that deliberately is not in the repository.
 * Without `TN_METAHUMAN_SAMPLE_DIR`, or without the reference CLI, these are reported as
 * skipped — never as passed.
 */
const localIt = sampleDna !== undefined && existsSync(sampleDna) ? it : it.skip;
const cliIt =
  sampleDna !== undefined && existsSync(sampleDna) && existsSync(referenceCli) ? it : it.skip;

const temporary: string[] = [];

afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
  // One line of evidence: the worst disagreement across every comparison above.
  console.info(
    `metahuman wasm-reference: max |error| ${worstError} at ${worstWhere}; sample lane ${
      sampleDna === undefined ? "skipped, TN_METAHUMAN_SAMPLE_DIR unset" : "run"
    }; reference CLI ${existsSync(referenceCli) ? "present" : "absent"}`,
  );
});

describe("the ABI never lets a retired handle id reach the next rig", () => {
  // Driven against the raw module: the handle id is an ABI fact, and the TypeScript
  // wrapper exists precisely so no game ever holds one.
  it("rejects a destroyed rig's id while the rig created after it keeps working", async () => {
    const binary = readFileSync(new URL("../wasm/riglogic.wasm", import.meta.url));
    const factory = (await import(new URL("../wasm/riglogic.mjs", import.meta.url).href)) as {
      default: (options: { wasmBinary: Uint8Array }) => Promise<{
        HEAPU8: Uint8Array;
        UTF8ToString: (pointer: number) => string;
        _free: (pointer: number) => void;
        _malloc: (size: number) => number;
        _tn_rl_count: (handle: number, kind: number) => number;
        _tn_rl_create: (dna: number, length: number) => number;
        _tn_rl_destroy: (handle: number) => void;
        _tn_rl_evaluate: (handle: number, useGui: number) => number;
        _tn_rl_joint_outputs: (handle: number, countOut: number) => number;
        _tn_rl_last_error: () => number;
        _tn_rl_name: (handle: number, kind: number, index: number) => number;
        _tn_rl_set_lod: (handle: number, lod: number) => number;
      }>;
    };
    const module_ = await factory.default({ wasmBinary: binary });
    const dna = syntheticDna();
    const create = () => {
      const pointer = module_._malloc(dna.length);
      module_.HEAPU8.set(dna, pointer);
      const handle = module_._tn_rl_create(pointer, dna.length);
      module_._free(pointer);
      return handle;
    };

    const retired = create();
    expect(retired).toBeGreaterThan(0);
    module_._tn_rl_destroy(retired);
    const live = create();
    // The whole point: the allocator may hand back the same address, the id never repeats.
    expect(live).not.toBe(retired);

    const countSlot = module_._malloc(4);
    const lastError = () => module_.UTF8ToString(module_._tn_rl_last_error());
    expect(module_._tn_rl_count(retired, 2)).toBe(-1);
    expect(lastError()).toBe("stale handle");
    expect(module_._tn_rl_set_lod(retired, 0)).toBe(-2);
    expect(module_._tn_rl_evaluate(retired, 0)).toBe(-2);
    expect(module_._tn_rl_name(retired, 2, 0)).toBe(0);
    expect(module_._tn_rl_joint_outputs(retired, countSlot)).toBe(0);
    expect(lastError()).toBe("stale handle");
    module_._tn_rl_destroy(retired); // a second destroy is a no-op, never a double free
    expect(module_._free(countSlot)).toBeUndefined();

    // 0 is never a valid id, and the rig created after the retired one is untouched.
    expect(module_._tn_rl_count(0, 2)).toBe(-1);
    expect(lastError()).toBe("null handle");
    expect(module_._tn_rl_count(live, 2)).toBe(3);
    expect(module_._tn_rl_evaluate(live, 0)).toBe(0);
    expect(lastError()).toBe("");
    module_._tn_rl_destroy(live);
  });
});

describe("browser WASM evaluator against the standalone upstream evaluator", () => {
  it("matches every committed synthetic reference vector", async () => {
    const evaluator = await RigEvaluator.create(syntheticDna());
    try {
      expect(evaluator.counts()).toEqual({
        gui: reference.counts.gui,
        raw: reference.counts.raw,
        joints: reference.counts.joint,
        blendShapes: reference.counts.blendshape,
        animatedMaps: reference.counts.animatedMap,
        lodCount: reference.counts.lod,
      });
      expect(evaluator.names("joint")).toEqual([...reference.names.joint]);
      expect(evaluator.names("blendShape")).toEqual([...reference.names.blendshape]);
      expect(evaluator.names("animatedMap")).toEqual([...reference.names.animatedMap]);
      playAndCompare(evaluator, vectors.cases, reference, "synthetic");
      // The ABI stride is 10 floats per joint, on every case.
      expect(evaluator.jointOutputs().length).toBe(reference.counts.joint * 10);
    } finally {
      evaluator.dispose();
    }
  });

  it("returns neutral joints and output copies, never a view over WASM memory", async () => {
    const evaluator = await RigEvaluator.create(syntheticDna());
    try {
      const counts = evaluator.counts();
      expect(evaluator.neutralJoints().length).toBe(counts.joints * 10);
      const first0 = vectors.cases[0];
      if (first0 === undefined) throw new Error("synthetic.vectors.json has no cases");
      playCase(evaluator, first0);
      const first = evaluator.jointOutputs();
      const second = evaluator.jointOutputs();
      expect(first).not.toBe(second);
      expect([...first]).toEqual([...second]);
      // Mutating a returned copy must not reach back into the module.
      first[0] = 12345;
      expect(evaluator.jointOutputs()[0]).not.toBe(12345);
    } finally {
      evaluator.dispose();
      expect(() => evaluator.counts()).toThrowError(/TN_MH_DISPOSED/u);
      expect(() => evaluator.dispose()).not.toThrow();
    }
  });

  it("reports the pinned upstream revision it was built from", async () => {
    await expect(RigEvaluator.upstreamCommit()).resolves.toMatch(/^[0-9a-f]{40}$/u);
  });

  localIt("loads Sample.dna and reports one output float per rig item", async () => {
    const evaluator = await RigEvaluator.create(new Uint8Array(readFileSync(sampleDna as string)));
    try {
      const counts = evaluator.counts();
      expect(counts.joints).toBeGreaterThan(0);
      expect(counts.blendShapes).toBeGreaterThan(0);
      // This specimen carries raw controls only, so drive whatever it actually has.
      const mode = counts.gui > 0 ? "gui" : "raw";
      const width = mode === "gui" ? counts.gui : counts.raw;
      expect(width).toBeGreaterThan(0);
      playCase(evaluator, {
        name: `${mode}_zero`,
        lod: 0,
        mode,
        values: new Array<number>(width).fill(0),
      });
      expect(evaluator.jointOutputs().length).toBe(counts.joints * 10);
      expect(evaluator.blendShapeOutputs().length).toBe(counts.blendShapes);
      expect(evaluator.animatedMapOutputs().length).toBe(counts.animatedMaps);
      expect(evaluator.neutralJoints().length).toBe(counts.joints * 10);
    } finally {
      evaluator.dispose();
    }
  });

  cliIt("matches the standalone evaluator on deterministic Sample.dna vectors", async () => {
    const dna = new Uint8Array(readFileSync(sampleDna as string));
    const probe = await RigEvaluator.create(dna);
    const counts = probe.counts();
    probe.dispose();

    // Fixed values inside the legal [0, 1] faceboard range, padded to the rig's own width.
    const rows = [
      [0, 0, 0],
      [1, 0.5, 0.25],
      [0.5, 1, 0.75],
    ];
    const localVectors: IVector[] = (["gui", "raw"] as const).flatMap((mode) => {
      const width = mode === "gui" ? counts.gui : counts.raw;
      return rows.map((row, index) => ({
        name: `${mode}_row${index}`,
        lod: 0,
        mode,
        values: Array.from({ length: width }, (_, slot) => row[slot % 3] as number),
      }));
    });

    const directory = makeTempDirSync("tn-metahuman-reference-");
    temporary.push(directory);
    const vectorsPath = join(directory, "vectors.json");
    const outputPath = join(directory, "reference.json");
    writeFileSync(vectorsPath, JSON.stringify({ cases: localVectors }));
    execFileSync(referenceCli, [sampleDna as string, vectorsPath, outputPath], { stdio: "pipe" });
    const generated = JSON.parse(readFileSync(outputPath, "utf8")) as IReference;

    const evaluator = await RigEvaluator.create(dna);
    try {
      expect(evaluator.counts().gui).toBe(generated.counts.gui);
      expect(evaluator.counts().joints).toBe(generated.counts.joint);
      playAndCompare(evaluator, localVectors, generated, "Sample");
    } finally {
      evaluator.dispose();
    }
  });
});
