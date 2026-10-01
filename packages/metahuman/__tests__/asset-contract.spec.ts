import "./file-fetch.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type IMetaHumanAssetInput,
  assertAssetPath,
  validateMetaHumanAssets,
} from "../src/asset-contract.js";
import { MetaHumanAssetError } from "../src/errors.js";
import { RigEvaluator } from "../src/wasm-evaluator.js";

const DNA_PATH = fileURLToPath(new URL("../fixtures/synthetic.dna", import.meta.url));
const dna = new Uint8Array(readFileSync(DNA_PATH));
const dnaSha256 = createHash("sha256").update(dna).digest("hex");
const glb = new TextEncoder().encode("glTF fixture bytes for @threenative/metahuman");
const glbSha256 = createHash("sha256").update(glb).digest("hex");

/** Real names and counts, read through the evaluator rather than hard-coded. */
async function rigFacts() {
  const evaluator = await RigEvaluator.create(dna);
  try {
    const counts = evaluator.counts();
    return {
      gui: evaluator.names("gui"),
      raw: evaluator.names("raw"),
      joints: evaluator.names("joint"),
      blendShapes: evaluator.names("blendShape"),
      animatedMaps: evaluator.names("animatedMap"),
      lodCount: counts.lodCount,
    };
  } finally {
    evaluator.dispose();
  }
}

/** One GLB shaped like a prepared head: three joints, one mesh, one target per channel. */
function gltfFacts(
  targetNames: string[] = ["syn_jawOpen", "syn_smile_L", "syn_smile_R", "syn_browRaise"],
) {
  return {
    nodes: [{ name: "face_root" }, { name: "jaw" }, { name: "brow_center" }],
    meshes: [
      {
        name: "head",
        primitives: [{ targets: targetNames.map(() => ({})), extras: { targetNames } }],
      },
    ],
  };
}

function bindings(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    specimen: { id: "synthetic", source: "packages/metahuman/fixtures", license: "MIT" },
    hashes: { dna: dnaSha256, glb: glbSha256 },
    coordinates: { sourceUnits: "cm", sourceUp: "y", handedness: "right" },
    joints: [
      { dna: "face_root", node: "face_root" },
      { dna: "jaw", node: "jaw" },
      { dna: "brow_center", node: "brow_center" },
    ],
    morphs: [
      { channel: "syn_jawOpen", mesh: 0, primitive: 0, target: 0 },
      { channel: "syn_smile_L", mesh: 0, primitive: 0, target: 1 },
    ],
    lods: [{ lod: 0, meshes: [0] }],
    controls: [{ alias: "jawOpen", gui: "jawOpen", min: 0, max: 1, default: 0 }],
    ...overrides,
  };
}

async function input(
  overrides: Record<string, unknown> = {},
  facts?: Awaited<ReturnType<typeof rigFacts>>,
) {
  return {
    bindings: bindings(overrides),
    dnaSha256,
    glbSha256,
    rig: facts ?? (await rigFacts()),
    gltf: gltfFacts(),
  };
}

/** The same input with the contract's `readonly` stripped, so a case can corrupt one field. */
type MutableInput = { -readonly [K in keyof IMetaHumanAssetInput]: IMetaHumanAssetInput[K] };

/** Every rejection the contract promises, as one case each. */
async function rejects(code: string, mutate: (value: MutableInput) => void) {
  const value = await input();
  mutate(value);
  expect(() => validateMetaHumanAssets(value)).toThrowError(
    expect.objectContaining({ code }) as unknown as Error,
  );
}

describe("validateMetaHumanAssets", () => {
  it("accepts a matched synthetic GLB, DNA and bindings set", async () => {
    const validated = validateMetaHumanAssets(await input());
    expect(validated.schemaVersion).toBe(1);
    expect(validated.specimen.id).toBe("synthetic");
    expect(validated.hashes).toEqual({ dna: dnaSha256, glb: glbSha256 });
    expect(validated.coordinates).toEqual({
      sourceUnits: "cm",
      sourceUp: "y",
      handedness: "right",
    });
    expect(validated.joints).toHaveLength(3);
    expect(validated.morphs).toHaveLength(2);
    expect(validated.controls[0]).toEqual({
      alias: "jawOpen",
      gui: "jawOpen",
      min: 0,
      max: 1,
      default: 0,
    });
    expect(validated.animatedMaps).toBeUndefined();
  });

  it("keeps optional animated maps when the profile declares them", async () => {
    const validated = validateMetaHumanAssets(
      await input({ animatedMaps: [{ map: "syn_map_smile" }] }),
    );
    expect(validated.animatedMaps).toEqual([{ map: "syn_map_smile" }]);
  });

  it("rejects a sidecar that is not an object", async () => {
    await rejects("TN_MH_SCHEMA", (value) => {
      value.bindings = [];
    });
  });

  it("rejects a schema version this build does not implement", async () => {
    await rejects("TN_MH_SCHEMA", (value) => {
      (value.bindings as Record<string, unknown>).schemaVersion = 2;
    });
  });

  it("rejects a hash that is not lowercase hex", async () => {
    await rejects("TN_MH_SCHEMA", (value) => {
      (value.bindings as { hashes: { dna: string } }).hashes.dna = dnaSha256.toUpperCase();
    });
  });

  it("rejects bindings that name different bytes than the loaded files", async () => {
    await rejects("TN_MH_HASH_MISMATCH", (value) => {
      value.dnaSha256 = "0".repeat(64);
    });
  });

  it("rejects a joint the DNA does not have", async () => {
    await rejects("TN_MH_UNKNOWN_JOINT", (value) => {
      (value.bindings as Record<string, unknown>).joints = [
        { dna: "not_a_joint", node: "face_root" },
      ];
    });
  });

  it("rejects a joint bound to a node the GLB does not have", async () => {
    await rejects("TN_MH_UNKNOWN_NODE", (value) => {
      (value.bindings as Record<string, unknown>).joints = [
        { dna: "face_root", node: "not_a_node" },
      ];
    });
  });

  it("rejects a blend shape channel the DNA does not have", async () => {
    await rejects("TN_MH_UNKNOWN_CHANNEL", (value) => {
      (value.bindings as Record<string, unknown>).morphs = [
        { channel: "not_a_channel", mesh: 0, primitive: 0, target: 0 },
      ];
    });
  });

  it("rejects a morph target index past the end of its primitive", async () => {
    await rejects("TN_MH_INDEX_RANGE", (value) => {
      (value.bindings as Record<string, unknown>).morphs = [
        { channel: "syn_jawOpen", mesh: 0, primitive: 0, target: 9 },
      ];
    });
  });

  it("rejects a mesh index past the end of the GLB", async () => {
    await rejects("TN_MH_INDEX_RANGE", (value) => {
      (value.bindings as Record<string, unknown>).lods = [{ lod: 0, meshes: [4] }];
    });
  });

  it("rejects a LOD the rig does not have", async () => {
    await rejects("TN_MH_BAD_LOD", (value) => {
      (value.bindings as Record<string, unknown>).lods = [{ lod: 2, meshes: [0] }];
    });
  });

  it("rejects a control alias bound to a GUI control the DNA does not have", async () => {
    await rejects("TN_MH_UNKNOWN_CONTROL", (value) => {
      (value.bindings as Record<string, unknown>).controls = [
        { alias: "jawOpen", gui: "not_a_control", min: 0, max: 1, default: 0 },
      ];
    });
  });

  it("rejects a domain that is empty or inverted", async () => {
    await rejects("TN_MH_BAD_DOMAIN", (value) => {
      (value.bindings as Record<string, unknown>).controls = [
        { alias: "jawOpen", gui: "jawOpen", min: 1, max: 1, default: 1 },
      ];
    });
  });

  it("rejects a default outside its own domain", async () => {
    await rejects("TN_MH_BAD_DOMAIN", (value) => {
      (value.bindings as Record<string, unknown>).controls = [
        { alias: "jawOpen", gui: "jawOpen", min: 0, max: 0.5, default: 0.9 },
      ];
    });
  });

  it("rejects a non-finite control value", async () => {
    await rejects("TN_MH_NON_FINITE", (value) => {
      (value.bindings as Record<string, unknown>).controls = [
        { alias: "jawOpen", gui: "jawOpen", min: 0, max: 1, default: Number.NaN },
      ];
    });
  });

  it("rejects the same alias bound twice", async () => {
    await rejects("TN_MH_DUPLICATE_ALIAS", (value) => {
      ((value.bindings as Record<string, unknown>).controls as unknown[]).push({
        alias: "jawOpen",
        gui: "smile",
        min: 0,
        max: 1,
        default: 0,
      });
    });
  });

  it("rejects an animated map the DNA does not have", async () => {
    await rejects("TN_MH_UNKNOWN_MAP", (value) => {
      (value.bindings as Record<string, unknown>).animatedMaps = [{ map: "not_a_map" }];
    });
  });

  it("rejects a morph whose target index names a different channel", async () => {
    const value = await input();
    value.gltf = gltfFacts(["syn_smile_L", "syn_jawOpen", "syn_smile_R", "syn_browRaise"]);
    expect(() => validateMetaHumanAssets(value)).toThrowError(
      expect.objectContaining({ code: "TN_MH_UNKNOWN_CHANNEL" }) as unknown as Error,
    );
  });

  it("throws MetaHumanAssetError with the code on the error object", async () => {
    const value = await input();
    value.dnaSha256 = "0".repeat(64);
    try {
      validateMetaHumanAssets(value);
      expect.unreachable("a hash mismatch is fatal");
    } catch (error) {
      expect(error).toBeInstanceOf(MetaHumanAssetError);
      expect((error as MetaHumanAssetError).code).toBe("TN_MH_HASH_MISMATCH");
      expect((error as Error).message).toContain("TN_MH_HASH_MISMATCH");
    }
  });
});

describe("assertAssetPath", () => {
  it("accepts a relative path inside the asset directory", () => {
    expect(assertAssetPath("metahuman/specimen.glb")).toBe("metahuman/specimen.glb");
  });

  for (const path of ["/etc/passwd", "C:/windows", "..\\escape", "../../escape", "a/../../b", ""]) {
    it(`rejects ${JSON.stringify(path)}`, () => {
      expect(() => assertAssetPath(path)).toThrowError(
        expect.objectContaining({ code: "TN_MH_PATH_ESCAPE" }) as unknown as Error,
      );
    });
  }
});

describe("RigEvaluator", () => {
  it("refuses truncated DNA bytes instead of loading half a rig", async () => {
    await expect(RigEvaluator.create(dna.slice(0, dna.length - 8))).rejects.toThrowError(
      expect.objectContaining({ code: "TN_MH_ABI" }) as unknown as Error,
    );
  });
});
