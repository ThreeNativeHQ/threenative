import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { evaluateRichPlaytestAssertions } from "../src/assertions.js";
import type { IPlaytestReport } from "../src/report.js";
import type { IPlaytestScenario } from "../src/scenario.js";
import {
  measureWorldTopology,
  type IWorldTopologyField,
} from "../src/evaluators/world-gameplay.js";

function scenario(assert: IPlaytestScenario["assert"] = {}): IPlaytestScenario {
  return {
    assert,
    name: "terrain-topology",
    schemaVersion: 1,
    steps: [],
    subject: "player",
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 0,
  } as IPlaytestScenario;
}

function report(debug: unknown): IPlaytestReport {
  const fields = debug as Record<string, unknown>;
  return {
    diagnostics: [],
    distance: 0,
    entity: "player",
    expectMoved: false,
    frames: 1,
    observations: {
      components: {
        terrain: {
          residentTiles: { after: 1 },
          ...(Object.hasOwn(fields, "topology")
            ? { topology: { after: fields.topology } }
            : {}),
        },
      },
      console: [],
      hud: {},
      network: [],
      resources: {},
    },
    trivialityOptOuts: [],
  };
}

for (const [label, debug] of [
  ["missing topology", {}],
  [
    "malformed topology",
    { topology: { columns: 2, depth: 1, heights: [0], rows: 2, width: 1 } },
  ],
] as const) {
  test(`fails closed for ${label}`, () => {
    const result = evaluateRichPlaytestAssertions({ report: report(debug), scenario: scenario() });
    const topologyAssertions = result.assertions.filter(({ id }) => id.startsWith("world.topology."));

    expect(topologyAssertions).toHaveLength(8);
    expect(topologyAssertions.every(({ pass }) => !pass)).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TN_PLAYTEST_WORLD_TOPOLOGY_ASSERTION_FAILED" }),
    );
  });
}

test("uses routed flow when measuring drainage hierarchy", () => {
  const rows = 65;
  const columns = 65;
  const heights = Float32Array.from({ length: rows * columns }, (_, index) => {
    const x = index % columns;
    const z = Math.floor(index / columns);
    return Math.hypot(x - 32, z - 32);
  });
  const routedFlow = new Float32Array(heights.length).fill(1);
  const noFlow = new Float32Array(heights.length);
  const base: Omit<IWorldTopologyField, "flow"> = {
    columns,
    depth: 1024,
    heights,
    rows,
    width: 1024,
  };

  const routed = measureWorldTopology({ ...base, flow: routedFlow });
  const disabled = measureWorldTopology({ ...base, flow: noFlow });

  expect(routed.maxHortonStrahlerOrder).toBeGreaterThan(disabled.maxHortonStrahlerOrder);
  expect(disabled.maxHortonStrahlerOrder).toBe(0);
});

test("rejects a resident-tile topology that is smaller than the declared measurement region", () => {
  const result = evaluateRichPlaytestAssertions({
    report: report({
      topology: {
        columns: 2,
        depth: 64,
        flow: [0, 0, 0, 0],
        heights: [0, 1, 1, 0],
        rows: 2,
        width: 64,
      },
    }),
    scenario: scenario(),
  });
  expect(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "TN_PLAYTEST_WORLD_TOPOLOGY_ASSERTION_FAILED" &&
        diagnostic.message.includes("1024m by 1024m"),
    ),
  ).toBe(true);
});

test("requires the terrain scenario to prove an LOD transition after its baseline", () => {
  const scenario = JSON.parse(
    readFileSync(path.resolve("examples/abyss-framework/playtests/terrain.playtest.json"), "utf8"),
  ) as { assert: { components: Array<Record<string, unknown>> } };
  const lod = scenario.assert.components.find((assertion) => assertion.component === "lodTransitions");
  expect(lod).toMatchObject({ changed: true });
  expect(lod).not.toHaveProperty("allowTrivial");
  expect(lod).not.toHaveProperty("gte");
});
