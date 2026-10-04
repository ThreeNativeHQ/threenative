import { describe, expect, it } from "vitest";
import {
  type IDiscovered,
  type IInventory,
  buildInventory,
  inventoryProblems,
  parseOwnerKeys,
  rendererRawProperties,
  threeImportSymbols,
} from "../native-engine-inventory.js";

/**
 * PRD-497 (N00): the inventory fails closed. Each fixture below is one way a committed
 * classification can drift from the source, and each must be reported by name rather than defaulted.
 */

const MODULES = ["packages/core/src/loop.ts", "packages/core/src/ui-layer.ts"] as const;

const KEYS: ReadonlySet<string> = new Set(["N00", "N06", "N18"]);

function discovered(overrides: Partial<IDiscovered> = {}): IDiscovered {
  return { modules: [...MODULES], keys: KEYS, ...overrides };
}

function inventory(overrides: Partial<IInventory> = {}): IInventory {
  return {
    modules: {
      "packages/core/src/loop.ts": { class: "native-engine", owner: "N06" },
      "packages/core/src/ui-layer.ts": { class: "binding-glue", owner: "N18" },
    },
    symbols: { imports: [], rendererRawProperties: [] },
    ...overrides,
  };
}

describe("parseOwnerKeys", () => {
  it("should read the batch index Key column and nothing else", () => {
    const keys = parseOwnerKeys(
      [
        "| Key | PRD | Depends on |",
        "| --- | --- | --- |",
        "| N00 | decision | — |",
        "| N15 | loop | N06 |",
        "",
        "not | a | table row",
      ].join("\n"),
    );
    expect([...keys]).toEqual(["N00", "N15"]);
  });

  it("should throw when the batch index has no Key column", () => {
    expect(() => parseOwnerKeys("# batch\nno table here\n")).toThrow(/Key column/u);
  });
});

describe("threeImportSymbols", () => {
  it("should take named imports from every supported three entry point", () => {
    const source = [
      'import { Mesh, BoxGeometry as Box } from "three";',
      'import type { Ctx } from "@threenative/core";',
      'import { pass, mrt } from "three/tsl";',
      'import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";',
    ].join("\n");
    expect(threeImportSymbols(source)).toEqual([
      "three/addons/utils/BufferGeometryUtils.js:mergeGeometries",
      "three/tsl:mrt",
      "three/tsl:pass",
      "three:BoxGeometry",
      "three:Mesh",
    ]);
  });

  it("should take members read off a three namespace import", () => {
    const source = 'import * as THREE from "three/webgpu";\nconst m = new THREE.Mesh();\n';
    expect(threeImportSymbols(source)).toEqual(["three/webgpu:Mesh"]);
  });
});

describe("rendererRawProperties", () => {
  it("should read properties through the alias templates assign renderer.raw to", () => {
    const source = [
      "const raw = ctx.renderer.raw as { toneMapping?: number; outputColorSpace: string };",
      "raw.toneMapping = 1;",
      "setupPost(ctx.renderer.raw, scene, camera);",
    ].join("\n");
    expect(rendererRawProperties(source)).toEqual(["outputColorSpace", "toneMapping"]);
  });

  it("should read a direct property access and a destructure", () => {
    expect(
      rendererRawProperties(
        "const { shadowMap } = ctx.renderer.raw;\nrenderer.raw.shadowMap.type = 1;\n",
      ),
    ).toEqual(["shadowMap"]);
  });
});

describe("inventoryProblems", () => {
  it("should pass a fully classified inventory", () => {
    expect(inventoryProblems(inventory(), discovered())).toEqual([]);
  });

  it("should fail a module with no class", () => {
    const broken = inventory({
      modules: {
        "packages/core/src/loop.ts": { class: "unclassified", owner: "" },
        "packages/core/src/ui-layer.ts": { class: "binding-glue", owner: "N18" },
      },
    });
    expect(inventoryProblems(broken, discovered())).toEqual([
      "unclassified module: packages/core/src/loop.ts",
    ]);
  });

  it("should fail a module missing from the committed inventory", () => {
    const broken = inventory({ modules: {} });
    expect(inventoryProblems(broken, discovered())).toEqual([
      "unclassified module: packages/core/src/loop.ts",
      "unclassified module: packages/core/src/ui-layer.ts",
    ]);
  });

  it("should fail an owner key the batch index does not define", () => {
    const broken = inventory({
      modules: {
        "packages/core/src/loop.ts": { class: "native-engine", owner: "N42" },
        "packages/core/src/ui-layer.ts": { class: "binding-glue", owner: "N18" },
      },
    });
    expect(inventoryProblems(broken, discovered()).join("\n")).toMatch(
      /loop\.ts is classed native-engine and names owner 'N42'/u,
    );
  });

  it("should fail a stale entry no longer in the source tree", () => {
    const broken = inventory();
    broken.modules["packages/core/src/deleted.ts"] = { class: "native-engine", owner: "N06" };
    expect(inventoryProblems(broken, discovered())).toEqual([
      "stale entry: packages/core/src/deleted.ts no longer exists",
    ]);
  });

  it("should fail a used symbol the committed list omits and one it still names", () => {
    const found = discovered({
      symbols: { imports: ["three:Mesh"], rendererRawProperties: [] },
    });
    const broken = inventory({
      symbols: { imports: ["three:BoxGeometry"], rendererRawProperties: [] },
    });
    const problems = inventoryProblems(broken, found).join("\n");
    expect(problems).toMatch(/symbol missing .*three:Mesh/u);
    expect(problems).toMatch(/symbol no longer used: three:BoxGeometry/u);
  });
});

describe("buildInventory", () => {
  it("should keep every existing class and add new modules as unclassified", () => {
    const existing = inventory({
      modules: { "packages/core/src/loop.ts": { class: "native-engine", owner: "N06" } },
    });
    const rebuilt = buildInventory(existing, discovered());
    expect(rebuilt.modules["packages/core/src/loop.ts"]).toEqual({
      class: "native-engine",
      owner: "N06",
    });
    expect(rebuilt.modules["packages/core/src/ui-layer.ts"]).toEqual({
      class: "unclassified",
      owner: "",
    });
  });

  it("should drop an entry whose module no longer exists", () => {
    const existing = inventory();
    existing.modules["packages/core/src/gone.ts"] = { class: "native-engine", owner: "N06" };
    expect(Object.keys(buildInventory(existing, discovered()).modules)).toEqual([...MODULES]);
  });
});
