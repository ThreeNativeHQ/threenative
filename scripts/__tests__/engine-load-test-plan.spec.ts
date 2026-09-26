import { describe, expect, it } from "vitest";
import { buildDraftPlan } from "../engine-load-test/plan.js";

describe("PRD-449 draft campaign matrix", () => {
  it("expands all six pinned families without duplicate cells or missing paired blocks", () => {
    const plan = buildDraftPlan();
    expect(plan.status).toBe("draft");
    expect(plan.cells).toHaveLength(73);
    expect(new Set(plan.cells.map((cell) => cell.id)).size).toBe(plan.cells.length);
    expect(new Set(plan.cells.map((cell) => cell.family))).toEqual(
      new Set([
        "bevy-many-cubes",
        "three-independent-meshes",
        "bevy-many-foxes",
        "godot-culling",
        "godot-lights-meshes",
        "bevy-city",
      ]),
    );
    for (const cell of plan.cells) {
      expect(cell.arms.length).toBeGreaterThanOrEqual(2);
      expect(cell.plannedBlocks.map(({ block }) => block)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(new Set(cell.plannedBlocks.map(({ session }) => session))).toEqual(new Set([1, 2]));
    }
  });

  it("records source-backed Godot grid counts and keeps unmeasured City objects unresolved", () => {
    const cells = buildDraftPlan().cells;
    const lights = cells.find((cell) => cell.id.includes("godot-lights-meshes.spot-10"));
    expect(lights?.upstreamActual).toMatchObject({ objects: 1024, lights: 9 });
    const city = cells.find((cell) => cell.id.includes("bevy-city.default-moving"));
    expect(city?.upstreamActual).toMatchObject({ gridTiles: 900, renderedObjects: null });
    expect(cells.filter((cell) => cell.family === "godot-culling")).toHaveLength(10);
    expect(cells.filter((cell) => cell.family === "godot-lights-meshes")).toHaveLength(13);
  });

  it("records the built mesh fixture census for independent and explicit-instancing arms", () => {
    const cells = buildDraftPlan().cells;
    const ordinary = cells.find((cell) =>
      cell.id.includes("three-independent-meshes.rotating.20000.default"),
    );
    expect(ordinary?.upstreamActual).toMatchObject({ meshes: 20_000, materials: 1 });
    const instanced = cells.find((cell) =>
      cell.id.includes("three-independent-meshes.rotating-instanced"),
    );
    expect(instanced?.upstreamActual).toMatchObject({ meshes: 1, instances: 20_000, materials: 1 });
    const varied = cells.find((cell) =>
      cell.id.includes("three-independent-meshes.rotating-64-materials"),
    );
    expect(varied?.upstreamActual).toMatchObject({ meshes: 20_000, materials: 64 });
  });
});
