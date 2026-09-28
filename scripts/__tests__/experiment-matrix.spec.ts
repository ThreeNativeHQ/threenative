import { describe, expect, it } from "vitest";
import {
  CROSS_ENGINE_FAMILIES,
  type ICensusValue,
  type IExperimentCell,
  REQUIRED_EXPERIMENT_MATRIX,
  assertMatrixFrozen,
  cellsByFamily,
  experimentKey,
  keyOf,
  unfrozenCensuses,
  unfrozenFixtures,
} from "../engine-load-test/experiment-matrix.js";

/** PRD-449 §5. The enumerated cell count per family, written out here so an accidental widening —
 *  a cross-product of loads, variants, classes or profiles — fails instead of quietly becoming the
 *  required matrix. 12 primary + 6 diagnostic + 1 realtime, and so on. */
const CELLS_PER_FAMILY = {
  "bevy-city": 6,
  "bevy-many-cubes": 19,
  "bevy-many-foxes": 15,
  "godot-culling": 11,
  "godot-lights-meshes": 14,
  "three-independent-meshes": 15,
} as const;

function cellAt(workload: string, variant: string, load?: string): IExperimentCell {
  const found = REQUIRED_EXPERIMENT_MATRIX.find(
    (entry) =>
      entry.workload === workload &&
      entry.variant === variant &&
      (load === undefined || entry.load === load),
  );
  if (found === undefined)
    throw new Error(`no ${workload} cell named ${variant} at ${load ?? "any"}`);
  return found;
}

function cell(workload: string, variant: string): IExperimentCell {
  return cellAt(workload, variant);
}

/** Replaces the identity part after `@` of every cell's fixture revision — a claimed
 *  `sha256:<64 lowercase hex>` hash, or a deliberately malformed one. */
function revised(cells: readonly IExperimentCell[], identity: string): IExperimentCell[] {
  return cells.map((entry) => ({
    ...entry,
    fixtureRevision: `${entry.fixtureRevision.split("@")[0]}@${identity}`,
  }));
}

describe("required cross-engine experiment matrix (draft expansion)", () => {
  it("should enumerate exactly the required cells for all six families", () => {
    const grouped = cellsByFamily();

    expect(Object.keys(grouped).sort()).toEqual([...CROSS_ENGINE_FAMILIES].sort());
    for (const family of CROSS_ENGINE_FAMILIES) {
      const cells = grouped[family];
      expect(cells.length, family).toBe(CELLS_PER_FAMILY[family]);
      // Every cell carries at least one arm, and exactly one realtime-presentation cell per family
      // (§7.2 asks for one representative load, not a second sweep).
      expect(
        cells.every((entry) => entry.arms.length > 0),
        family,
      ).toBe(true);
      expect(
        cells.filter((entry) => entry.executionProtocol === "realtime-presentation").length,
        family,
      ).toBe(1);
      // §7.2's single representative load is labelled as the representative, not as a second primary.
      const representatives = cells.filter((entry) => entry.kind === "realtime-representative");
      expect(representatives.length, family).toBe(1);
      expect(representatives[0]?.executionProtocol, family).toBe("realtime-presentation");
    }
    expect(REQUIRED_EXPERIMENT_MATRIX).toHaveLength(80);
  });

  it("should give every cell its own seven-part experiment key", () => {
    const keys = REQUIRED_EXPERIMENT_MATRIX.map(keyOf);

    expect(new Set(keys).size).toBe(keys.length);
    // §3: the key is these seven components and nothing else, and the family is one of them.
    for (const entry of REQUIRED_EXPERIMENT_MATRIX) {
      const key = experimentKey(entry);
      expect(Object.keys(key).sort()).toEqual([
        "executionProtocol",
        "fixtureRevision",
        "load",
        "optimizationClass",
        "renderingProfile",
        "variant",
        "workload",
      ]);
      expect(key.workload).toBe(entry.workload);
    }
  });

  it("should keep the required comparison arms, including TN web only where §5 asks for it", () => {
    const armsOf = (workload: string, load: string, variant: string): string[] => [
      ...cellAt(workload, variant, load).arms,
    ];

    // Bevy families: TN native against Bevy native, plus a separately labelled TN web cell at the
    // declared loads only.
    expect(armsOf("bevy-many-cubes", "400k", "all-rotating")).toEqual(["bevy-native", "tn-native"]);
    expect(armsOf("bevy-many-cubes", "100k", "static")).toContain("tn-web");
    expect(armsOf("bevy-many-foxes", "500", "staggered")).toContain("tn-web");
    expect(armsOf("bevy-many-foxes", "250", "staggered")).not.toContain("tn-web");
    // Godot families: TN native against Godot native.
    expect(armsOf("godot-culling", "10k", "dynamic-rotate")).toEqual(["godot-native", "tn-native"]);
    expect(armsOf("godot-lights-meshes", "1k", "omni_100")).toEqual(["godot-native", "tn-native"]);
    // Mesh family: the real plain-Three baseline beside both TN runtimes, on every primary cell.
    for (const variant of ["static", "all-rotating"])
      for (const load of ["1k", "5k", "10k", "20k", "50k"])
        expect(cellAt("three-independent-meshes", variant, load).arms).toEqual([
          "plain-three-webgpu",
          "tn-native",
          "tn-web",
        ]);
    // City: TN web on the small fixture only, on both its static and its moving variant.
    expect(armsOf("bevy-city", "default", "moving")).not.toContain("tn-web");
    for (const variant of ["static", "moving"])
      expect(armsOf("bevy-city", "small", variant), variant).toContain("tn-web");
  });

  it("should carry requested and actual censuses apart, Godot's sqrt rounding included", () => {
    // §5.1: nominal 1,000 becomes 1,024 and nominal 10 lights becomes 9, and both are recorded.
    const mesh_1000 = cell("godot-lights-meshes", "box_1000");
    expect(mesh_1000.census.objects).toMatchObject({ actual: 1_024, requested: 1_000 });
    expect(mesh_1000.census.lights).toMatchObject({ actual: 9, requested: 10 });
    expect(cell("godot-lights-meshes", "box_10000").census.objects.actual).toBe(10_000);
    expect(cell("godot-lights-meshes", "sphere_100").census.lights.actual).toBe(9);
    expect(cell("godot-lights-meshes", "spot_100").census.lights.actual).toBe(100);
    expect(cell("godot-lights-meshes", "stress").census.objects.actual).toBe(10_000);
    // Godot culling builds 10,000 RID objects and, where the source requests them, 100 lights.
    expect(cell("godot-culling", "static-omni-lights").census).toMatchObject({
      lights: { actual: 100, requested: 100 },
      objects: { actual: 10_000, requested: 10_000 },
    });
    // An unfrozen fixture is null plus a reason, and the historical ~55k guess is nowhere.
    const city = cell("bevy-city", "static");
    expect(city.census.objects.actual).toBeNull();
    expect(city.census.objects.reason).toMatch(/not frozen|not exported/u);
    expect(JSON.stringify(REQUIRED_EXPERIMENT_MATRIX)).not.toContain("55000");
  });

  it("should refuse to freeze until censuses, hashed identities and generator settings are recorded", () => {
    // The one focused freeze gate: today the City fixtures are the reason the plan cannot be frozen.
    const blockers = unfrozenCensuses();
    expect(blockers).toHaveLength(6);
    expect(blockers.every((line) => line.startsWith("bevy-city|"))).toBe(true);
    expect(() => assertMatrixFrozen()).toThrow(/TN_BENCH_MATRIX_UNFROZEN/u);
    // §6.1 and §5.1 block independently of the census: no revision is in the
    // `name@sha256:<64 lowercase hex>` identity form, and the small City fixture's seed and size are
    // not frozen. Seven revisions, two settings.
    const identityBlockers = unfrozenFixtures();
    expect(identityBlockers.filter((line) => line.startsWith("fixture revision "))).toHaveLength(7);
    expect(identityBlockers.filter((line) => line.includes("generator setting "))).toEqual([
      "bevy-city-small generator setting seed: not frozen",
      "bevy-city-small generator setting size: not frozen",
    ]);
    for (const line of identityBlockers.filter((entry) => entry.startsWith("fixture revision ")))
      expect(line, line).toMatch(/@sha256:/u);

    // A generated census records an actual count and no requested count at all.
    const recorded: ICensusValue = { actual: 12_345, reason: null, requested: null };
    const repaired = REQUIRED_EXPERIMENT_MATRIX.map((entry) =>
      entry.workload === "bevy-city"
        ? { ...entry, census: { ...entry.census, objects: recorded } }
        : entry,
    );
    const recordedSettings = { "bevy-city-small": { seed: "test-seed", size: "test-size" } };
    // Syntax-valid identities, not real fixture hashes: this gate checks the claimed form only, so
    // the freezer still has to hash the exported bytes.
    const TEST_HASH = `sha256:${"ab".repeat(32)}`;
    const hashed = revised(repaired, TEST_HASH);

    // Repairing the censuses alone is still a refusal — the revisions are still placeholders.
    expect(() => assertMatrixFrozen(repaired)).toThrow(/fixture revision/u);
    expect(() => assertMatrixFrozen(repaired, recordedSettings)).toThrow(/fixture revision/u);
    // Syntax-valid identities plus recorded settings and censuses do freeze.
    expect(() => assertMatrixFrozen(hashed, recordedSettings)).not.toThrow();
    // A revision with no draft marker is still refused unless it is a hashed identity.
    for (const revision of [
      "bevy-city@garbage",
      `bevy-city@${TEST_HASH}extra`,
      `bevy-city@${"AB".repeat(32)}`,
      `bevy-city@sha256:${"ab".repeat(31)}`,
    ])
      expect(
        () => assertMatrixFrozen(revised(hashed, revision), recordedSettings),
        revision,
      ).toThrow(/not a name@sha256/u);
    // A duplicate key is refused too, so a widened matrix cannot pass as a frozen one.
    expect(() =>
      assertMatrixFrozen([...hashed, hashed[0] as IExperimentCell], recordedSettings),
    ).toThrow(/TN_BENCH_MATRIX_DUPLICATE_KEY/u);
  });
});
