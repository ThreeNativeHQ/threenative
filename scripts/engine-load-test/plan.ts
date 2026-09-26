import type { IExperimentKey } from "./report-v2.js";

const BEVY = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const GODOT = "b059e38a81230a87293828bbf65ab247b6b2d2a8";

export interface IPlannedCell {
  arms: string[];
  family: string;
  id: string;
  experiment: IExperimentKey;
  plannedBlocks: { block: number; session: number }[];
  requested: Record<string, number>;
  sourceUrl: string | null;
  /** Source-derived counts only. `null` means the built fixture has not been counted. */
  upstreamActual: Record<string, number | null>;
}

/** A matrix, not a publication plan: source/build locks and City census are still outstanding. */
export function buildDraftPlan(): { status: "draft"; cells: IPlannedCell[] } {
  const cells: IPlannedCell[] = [];
  const blocks = () =>
    Array.from({ length: 7 }, (_, index) => ({
      block: index + 1,
      session: index < 4 ? 1 : 2,
    }));
  const add = (
    family: string,
    variant: string,
    load: string,
    arms: string[],
    requested: Record<string, number>,
    upstreamActual: Record<string, number | null>,
    sourceUrl: string | null,
    options: Partial<Pick<IExperimentKey, "optimizationClass" | "renderingProfile">> = {},
  ) => {
    const experiment: IExperimentKey = {
      fixtureRevision: "draft-1",
      load,
      optimizationClass: options.optimizationClass ?? "default",
      protocol: "deterministic-throughput",
      renderingProfile: options.renderingProfile ?? "common",
      variant,
      workload: family,
    };
    cells.push({
      arms,
      experiment,
      family,
      id: [family, variant, load, experiment.optimizationClass, experiment.renderingProfile].join(
        ".",
      ),
      plannedBlocks: blocks(),
      requested,
      sourceUrl,
      upstreamActual,
    });
  };

  const cubesSource = `https://github.com/bevyengine/bevy/blob/${BEVY}/examples/stress_tests/many_cubes.rs`;
  for (const count of [1000, 10000, 50000, 100000, 400000, 1600000]) {
    for (const motion of ["static", "rotating"]) {
      add(
        "bevy-many-cubes",
        motion,
        String(count),
        ["tn-desktop", "bevy-desktop", ...(count === 10000 || count === 100000 ? ["tn-web"] : [])],
        { cubes: count },
        { cubes: count, enclosureMeshes: 1 },
        cubesSource,
      );
    }
  }
  for (const count of [10000, 100000]) {
    for (const switchName of ["no-culling", "no-batching", "shadows"]) {
      add(
        "bevy-many-cubes",
        `static-${switchName}`,
        String(count),
        ["tn-desktop", "bevy-desktop"],
        { cubes: count },
        { cubes: count, enclosureMeshes: 1 },
        cubesSource,
        switchName === "shadows"
          ? { renderingProfile: "shadows-on" }
          : { optimizationClass: "independent-diagnostic" },
      );
    }
  }

  for (const count of [1000, 5000, 10000, 20000, 50000]) {
    for (const motion of ["static", "rotating"]) {
      add(
        "three-independent-meshes",
        motion,
        String(count),
        ["plain-three-web", "tn-web", "tn-desktop"],
        { meshes: count },
        { meshes: count, materials: 1 },
        null,
      );
    }
  }
  for (const variant of [
    "rotating-projection-off",
    "rotating-instanced",
    "rotating-64-materials",
  ]) {
    add(
      "three-independent-meshes",
      variant,
      "20000",
      ["plain-three-web", "tn-web", "tn-desktop"],
      { meshes: 20000 },
      variant === "rotating-instanced"
        ? { meshes: 1, instances: 20000, materials: 1 }
        : { meshes: 20000, materials: variant === "rotating-64-materials" ? 64 : 1 },
      null,
      {
        optimizationClass: variant.endsWith("instanced")
          ? "explicit-instancing"
          : "independent-diagnostic",
      },
    );
  }

  const foxesSource = `https://github.com/bevyengine/bevy/blob/${BEVY}/examples/stress_tests/many_foxes.rs`;
  for (const count of [50, 100, 250, 500, 1000]) {
    for (const phase of ["synchronized", "staggered"]) {
      add(
        "bevy-many-foxes",
        `moving-${phase}`,
        String(count),
        ["tn-desktop", "bevy-desktop", ...(count === 100 || count === 500 ? ["tn-web"] : [])],
        { foxes: count },
        { foxes: count, rings: null },
        foxesSource,
      );
    }
  }
  for (const count of [100, 1000]) {
    for (const variant of ["moving-staggered-paused", "moving-staggered-shadows"]) {
      add(
        "bevy-many-foxes",
        variant,
        String(count),
        ["tn-desktop", "bevy-desktop"],
        { foxes: count },
        { foxes: count, rings: null },
        foxesSource,
        variant.endsWith("shadows") ? { renderingProfile: "shadows-on" } : {},
      );
    }
  }

  const cullingSource = `https://github.com/godotengine/godot-benchmarks/blob/${GODOT}/benchmarks/rendering/culling.gd`;
  for (const variant of [
    "basic_cull",
    "dynamic_cull",
    "dynamic_rotate_cull",
    "directional_light_cull",
    "static_omni_light_cull",
    "static_omni_light_cull_with_shadows",
    "dynamic_omni_light_cull",
    "dynamic_omni_light_cull_with_shadows",
    "static_spot_light_cull_with_shadows",
    "dynamic_spot_light_cull_with_shadows",
  ]) {
    const lights =
      variant.includes("omni") || variant.includes("spot")
        ? 100
        : variant.includes("directional")
          ? 1
          : 0;
    add(
      "godot-culling",
      variant,
      "10000",
      ["tn-desktop", "godot-desktop"],
      { objects: 10000, lights },
      {
        renderingServerInstances: 10000,
        lightInstances: lights === 100 ? 100 : 0,
        directionalLightNodes: lights === 1 ? 1 : 0,
      },
      cullingSource,
      variant.includes("shadows") || variant.includes("directional")
        ? { renderingProfile: "shadows-on" }
        : {},
    );
  }

  const lightsSource = `https://github.com/godotengine/godot-benchmarks/blob/${GODOT}/benchmarks/rendering/lights_and_meshes.gd`;
  const scattered = (count: number) => Math.round(Math.sqrt(count)) ** 2;
  for (const geometry of ["box", "sphere"]) {
    for (const objects of [100, 1000, 10000]) {
      add(
        "godot-lights-meshes",
        `${geometry}-${objects}`,
        String(objects),
        ["tn-desktop", "godot-desktop"],
        { objects, lights: 10 },
        { objects: scattered(objects), lights: 9 },
        lightsSource,
      );
    }
  }
  for (const kind of ["omni", "spot"]) {
    for (const lights of [10, 100]) {
      add(
        "godot-lights-meshes",
        `${kind}-${lights}`,
        String(lights),
        ["tn-desktop", "godot-desktop"],
        { objects: 1000, lights },
        { objects: 1024, lights: scattered(lights) },
        lightsSource,
      );
    }
  }
  for (const speed of ["fast", "slow"]) {
    add(
      "godot-lights-meshes",
      `speed-${speed}`,
      "1000",
      ["tn-desktop", "godot-desktop"],
      { objects: 1000, lights: 10 },
      { objects: 1024, lights: 9 },
      lightsSource,
    );
  }
  add(
    "godot-lights-meshes",
    "stress",
    "10000",
    ["tn-desktop", "godot-desktop"],
    { objects: 10000, lights: 100 },
    { objects: 10000, lights: 100 },
    lightsSource,
  );

  const citySource = `https://github.com/bevyengine/bevy/tree/${BEVY}/examples/large_scenes/bevy_city`;
  for (const [sizeName, size] of [
    ["small", 8],
    ["default", 30],
  ] as const) {
    for (const motion of ["static", "moving"]) {
      add(
        "bevy-city",
        `${sizeName}-${motion}`,
        String(size),
        ["tn-desktop", "bevy-desktop", ...(sizeName === "small" ? ["tn-web"] : [])],
        { gridSize: size, seed: 42 },
        { gridTiles: size * size, renderedObjects: null },
        citySource,
      );
    }
  }
  add(
    "bevy-city",
    "default-moving-upstream-visual",
    "30",
    ["tn-desktop", "bevy-desktop"],
    { gridSize: 30, seed: 42 },
    { gridTiles: 900, renderedObjects: null },
    citySource,
    { renderingProfile: "upstream-visual" },
  );

  return { status: "draft", cells };
}
