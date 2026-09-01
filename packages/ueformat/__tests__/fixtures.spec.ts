import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Group } from "three";
import { describe, expect, it } from "vitest";

import {
  type IUEModelSummary,
  UEFormatError,
  createThreeObject,
  parseUEModel,
  summarizeUEModel,
} from "../src/index.js";

const fixturesUrl = new URL("../fixtures/", import.meta.url);

async function readFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fileURLToPath(new URL(name, fixturesUrl))));
}

describe("shipped .uemodel fixtures", () => {
  // The parser is pure TypeScript with no browser or Node globals, so this suite *is* the
  // off-browser conformance run: the same bytes, parsed by the same code, outside a browser.
  it("parses the uncompressed table fixture and reports its contents", async () => {
    const summary: IUEModelSummary = summarizeUEModel(
      parseUEModel(await readFixture("sample-table.uemodel")),
    );

    expect(summary.objectName).toBe("SM_SampleTable");
    expect(summary.formatVersion).toBe(10);
    expect(summary.compression).toBeNull();
    expect(summary.lods).toHaveLength(1);
    expect(summary.lods[0]).toMatchObject({
      name: "LOD0",
      vertices: 3,
      triangles: 1,
      materials: ["M_Table"],
    });
    expect(summary.skeleton).toBeNull();
    expect(summary.unknownAttributes).toEqual([]);
  });

  it("decompresses the GZIP table fixture into the same mesh", async () => {
    const summary = summarizeUEModel(parseUEModel(await readFixture("sample-table-gzip.uemodel")));

    expect(summary.compression).toBe("GZIP");
    expect(summary.lods[0]).toMatchObject({
      name: "LOD0",
      vertices: 3,
      triangles: 1,
      materials: ["M_Table"],
    });
    expect(summary.skeleton).toBeNull();
  });

  it("parses the rigged GZIP fixture with skeleton, weights, morphs, and collision", async () => {
    const model = parseUEModel(await readFixture("sample-rigged-gzip.uemodel"));
    const summary = summarizeUEModel(model);

    expect(summary.objectName).toBe("SK_Sample");
    expect(summary.compression).toBe("GZIP");
    expect(summary.lods[0]).toMatchObject({ vertices: 3, weights: 3, morphTargets: ["Bent"] });
    expect(summary.skeleton).toEqual({ bones: 2, sockets: 1, virtualBones: 1 });
    expect(summary.collisionMeshes).toEqual([{ name: "Box", vertices: 3, triangles: 1 }]);

    const object = createThreeObject(model);
    expect(object).toBeInstanceOf(Group);
    expect(object.userData.ue.header.objectName).toBe("SK_Sample");
    expect(object.userData.ue.skeleton.bones).toHaveLength(2);
    expect(object.userData.ue.collisionGeometries).toHaveLength(1);
  });

  it("fails closed on truncated real bytes instead of returning partial data", async () => {
    const bytes = await readFixture("sample-table.uemodel");
    expect(() => parseUEModel(bytes.subarray(0, 40))).toThrow(UEFormatError);
  });
});
