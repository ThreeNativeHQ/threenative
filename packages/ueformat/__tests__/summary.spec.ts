import { describe, expect, it } from "vitest";

import { parseUEModel, summarizeUEModel } from "../src/index.js";
import { modelFile, richModelBody } from "./fixture-builder.js";

describe("summarizeUEModel", () => {
  it("summarizes a model without dumping large vertex arrays", () => {
    const summary = summarizeUEModel(parseUEModel(modelFile({ body: richModelBody() })));

    expect(summary).toEqual({
      objectName: "SM_Test",
      objectPath: "/Game/Test/SM_Test.SM_Test",
      formatVersion: 10,
      compression: null,
      lods: [
        {
          name: "LOD0",
          vertices: 3,
          triangles: 1,
          materials: ["M_Table"],
          uvChannels: ["UV0"],
          vertexColorChannels: ["Color"],
          weights: 3,
          morphTargets: ["Bent"],
        },
      ],
      skeleton: { bones: 2, sockets: 1, virtualBones: 1 },
      collisionMeshes: [{ name: "Box", vertices: 3, triangles: 1 }],
      unknownAttributes: [],
    });
  });
});
