// PRD-449 §5: the required six-family matrix, expanded cell by cell. This is a DRAFT expansion, not
// a frozen plan: the cell identifiers, arms and Godot censuses are known, but the City fixture
// censuses, the small fixture's generator settings and every fixture's hashed identity are not, and
// `assertMatrixFrozen` refuses the matrix until they are. Nothing here times anything, runs an adapter
// or reads a result — the frozen plan, the CLI and the report are later phases (see
// `campaign-report.ts` for the record contract and §7.1 for what freezing means).
//
// Two rules shape the data. Every family enumerates only the cells §5 names — a factor list per
// family, never a cross-product of loads, variants, classes, protocols and profiles — and each cell
// carries its own optimization class, so a light or shadow diagnostic is labelled `default` (ordinary
// authoring, one extra named feature) rather than mislabelled as an optimization switch (§3.1).
// A cell's census keeps the requested and the actual count apart (§5.1): Godot builds
// `round(sqrt(count))**2` objects, so nominal 1,000 is 1,024 and nominal 10 lights is 9, and an
// unfrozen fixture is `null` plus a reason, never a guessed number.

import type {
  ExecutionProtocol,
  ICampaignExperimentKey,
  OptimizationClass,
} from "./campaign-report.js";
import { BenchError } from "./report.js";

/** §5. All six are required; a family is not complete without at least one supported load measured on
 *  both TN and the upstream engine. */
export const CROSS_ENGINE_FAMILIES = [
  "bevy-city",
  "bevy-many-cubes",
  "bevy-many-foxes",
  "godot-culling",
  "godot-lights-meshes",
  "three-independent-meshes",
] as const;
export type CrossEngineFamily = (typeof CROSS_ENGINE_FAMILIES)[number];

/** §6.3. 1920x1080 attachment, DPR 1, resolution scale 1, no adaptive quality or LOD reduction, fixed
 *  exposure, no motion blur, MSAA off, shadows off except where a named variant turns them on. */
export const COMMON_RENDERING_PROFILE = "common-1920x1080";
/** §6.3. The upstream City profile keeps its own declared settings and is never joined with a
 *  common-profile row; its ratios carry the `qualified` comparability status. */
export const UPSTREAM_CITY_PROFILE = "upstream-city-visual";

/** §3. Arms vary engine/runtime/backend only. Godot's culling arm is a RenderingServer/RID workload and
 *  the Bevy arms are release-feature builds; both identities belong in the execution lock, not here. */
export const EXPERIMENT_ARMS = [
  "bevy-native",
  "godot-native",
  "plain-three-webgpu",
  "tn-native",
  "tn-web",
] as const;
export type ExperimentArm = (typeof EXPERIMENT_ARMS)[number];

export interface ICensusValue {
  /** `null` while the actual object count is unknown. Never a guess: PRD §5.1 forbids reading the
   *  historical ~55k City count as an observation. */
  readonly actual: number | null;
  readonly reason: string | null;
  readonly requested: number | null;
}

export type ExperimentCellKind = "diagnostic" | "primary" | "realtime-representative";

export interface IExperimentCell {
  readonly arms: readonly ExperimentArm[];
  readonly census: {
    readonly lights: ICensusValue;
    readonly objects: ICensusValue;
  };
  readonly executionProtocol: ExecutionProtocol;
  /** §3. The identity of the fixture the cell runs on, prefixed by the pinned upstream it came from. */
  readonly fixtureRevision: string;
  readonly kind: ExperimentCellKind;
  readonly load: string;
  readonly notes: string | null;
  readonly optimizationClass: OptimizationClass;
  readonly renderingProfile: string;
  readonly variant: string;
  readonly workload: CrossEngineFamily;
}

/** One enumerated factor: a variant at a load, with the census the cell asserts. A family is the list
 *  of these, which is where the "no uncontrolled Cartesian product" rule is kept in code. */
interface IFactor {
  readonly arms?: readonly ExperimentArm[];
  readonly census?: { lights?: ICensusValue; objects?: ICensusValue };
  readonly class?: OptimizationClass;
  readonly kind?: ExperimentCellKind;
  readonly load: string;
  readonly notes?: string;
  readonly profile?: string;
  readonly protocol?: ExecutionProtocol;
  readonly variant: string;
}

interface IFamily {
  /** Arm set for every cell in the family, before a factor narrows or widens it. */
  readonly arms: readonly ExperimentArm[];
  readonly factors: readonly IFactor[];
  readonly fixtureRevision: string;
  readonly realtime?: IFactor;
  readonly workload: CrossEngineFamily;
}

function counted(requested: number, actual = requested): ICensusValue {
  return { actual, reason: null, requested };
}

/** §5.1. `create_scattered(count)` builds `round(sqrt(count))^2` children, so the two counts differ
 *  upstream's own way. Preserved rather than corrected: a corrected exact-count generator is a
 *  separate experiment, and the report labels chart axes with the actual count. */
function scattered(requested: number): ICensusValue {
  const actual = Math.round(Math.sqrt(requested)) ** 2;
  return {
    actual,
    reason:
      actual === requested
        ? null
        : `upstream create_scattered(count) builds round(sqrt(${requested}))^2 = ${actual}`,
    requested,
  };
}

function unfrozen(reason: string): ICensusValue {
  return { actual: null, reason, requested: null };
}

/** A cell with no lights in it. Zero is the derived census, not a missing observation (§10). */
const NO_LIGHTS: ICensusValue = { actual: 0, reason: null, requested: 0 };

/** Bevy 0.19.0 and godot-benchmarks revisions are pinned in `benchmark/engine-load-test/sources.lock.json`;
 *  the fixture revisions built on them are not hashed until §6.1's full-fixture identity lands. */
const CUBES_REVISION = "bevy-many-cubes@c6f634c-draft";
const FOXES_REVISION = "bevy-many-foxes@c6f634c-draft";
const CULLING_REVISION = "godot-culling@b059e38a-draft";
const LIGHTS_REVISION = "godot-lights-meshes@b059e38a-draft";
const THREE_MESH_REVISION = "three-independent-meshes@three-0.185.1-draft";
/** Kenney bytes are pinned at bevy_asset_files 086f0304, but no city fixture has been exported. */
const CITY_DEFAULT_REVISION = "bevy-city@c6f634c-086f0304-unfrozen";
const CITY_SMALL_REVISION = "bevy-city-small@unfrozen";

/** §6.1, §7.1. A frozen revision is `fixture-name@sha256:<64 lowercase hex>`, and every revision
 *  above is still a draft placeholder, so `unfrozenFixtures` refuses all of them. This checks the
 *  syntax only: it proves a hashed identity is *claimed*, never that the fixture bytes hash to it —
 *  hashing the exported bytes is the future freezer's job, not this gate's. */
const FROZEN_REVISION = /^[^@\s]+@sha256:[0-9a-f]{64}$/u;

/** §5.1. The generated fixtures' generator inputs, keyed by fixture name — the part of a cell's
 *  `fixtureRevision` before `@`. A `null` is the honest state until Phase 1 records the frozen values
 *  from the fixture export; no seed, size or count is invented here. Fixtures with no generator to
 *  record are absent, and absence never blocks. */
export const GENERATOR_SETTINGS: Readonly<Record<string, Readonly<Record<string, string | null>>>> =
  {
    "bevy-city-small": { seed: null, size: null },
  };

const NATIVE_PAIR: readonly ExperimentArm[] = ["bevy-native", "tn-native"];

/** A declared load rung: the label the report and the charts use, and the exact count it means. */
type LoadRung = readonly [load: string, objects: number];

/** Both named static and moving variants at every declared rung — the enumeration §5 asks for, not a
 *  product of variants with classes, protocols or profiles. */
function loadRungs(
  rungs: readonly LoadRung[],
  variants: readonly [string, string],
): readonly IFactor[] {
  return rungs.flatMap(([load, objects]) =>
    variants.map(
      (variant): IFactor => ({
        census: { objects: counted(objects) },
        load,
        variant,
      }),
    ),
  );
}

const CUBE_MOTIONS = ["static", "all-rotating"] as const;
const MESH_MOTIONS = ["static", "all-rotating"] as const;
const FOX_ANIMATIONS = ["synchronized", "staggered"] as const;

/** §5 primary: sphere layout, static and all-cubes-rotating, 1k…1.6M, default class with shadows off.
 *  Diagnostics at 10k and 100k change exactly one named factor each, from upstream's default timed
 *  behaviour (all cubes rotating). §7.3 keeps seven blocks for any ratio published from a
 *  diagnostic, which is a protocol property and not a second cell. */
const CUBES: IFamily = {
  arms: NATIVE_PAIR,
  factors: [
    // §5.1: the enclosing geometry is counted apart from the requested cube count, so the object
    // census is exactly the requested number.
    ...loadRungs(
      [
        ["1k", 1_000],
        ["10k", 10_000],
        ["50k", 50_000],
        ["100k", 100_000],
        ["400k", 400_000],
        ["1.6M", 1_600_000],
      ],
      CUBE_MOTIONS,
    ),
    ...(["10k", "100k"] as const).flatMap(
      (load) =>
        [
          {
            census: { objects: counted(load === "10k" ? 10_000 : 100_000) },
            class: "independent-diagnostic",
            kind: "diagnostic",
            load,
            notes:
              "culling disabled; the switch name and its actual effect are verified against the adapter's effective flags, never the option name (§5.1)",
            variant: "all-rotating-culling-disabled",
          },
          {
            census: { objects: counted(load === "10k" ? 10_000 : 100_000) },
            class: "independent-diagnostic",
            kind: "diagnostic",
            load,
            notes:
              "independent batching disabled only; this does not imply culling, caching or indirect drawing are disabled (§3.1)",
            variant: "all-rotating-batching-disabled",
          },
          {
            census: { objects: counted(load === "10k" ? 10_000 : 100_000) },
            kind: "diagnostic",
            load,
            notes: "shadows on, everything else at the common profile (§6.3)",
            variant: "all-rotating-shadows",
          },
        ] satisfies readonly IFactor[],
    ),
  ],
  fixtureRevision: CUBES_REVISION,
  realtime: {
    census: { objects: counted(100_000) },
    load: "100k",
    notes:
      "§7.2/Phase 6 representative realtime cell for this family; TN web is labelled separately",
    protocol: "realtime-presentation",
    variant: "all-rotating",
  },
  workload: "bevy-many-cubes",
};

/** §5: shared geometry and material, static and all-rotating, 1k…50k. The primary arms are the
 *  plain-Three WebGPU browser baseline, TN web and TN native; §5's note keeps plain-Three's
 *  independent `Mesh` authoring as the baseline that instanced numbers may not replace. */
const THREE_MESHES: IFamily = {
  arms: ["plain-three-webgpu", "tn-native", "tn-web"],
  factors: [
    ...loadRungs(
      [
        ["1k", 1_000],
        ["5k", 5_000],
        ["10k", 10_000],
        ["20k", 20_000],
        ["50k", 50_000],
      ],
      MESH_MOTIONS,
    ),
    {
      arms: ["tn-native", "tn-web"],
      census: { objects: counted(20_000) },
      class: "independent-diagnostic",
      kind: "diagnostic",
      load: "20k",
      notes:
        "TN projection off, measured against the plain-Three baseline as a diagnostic, not as TN's default",
      variant: "static-projection-off",
    },
    {
      arms: ["tn-native", "tn-web"],
      census: { objects: counted(20_000) },
      class: "default",
      kind: "diagnostic",
      load: "20k",
      notes:
        "TN projection on — the labelled product comparison, separately from the plain-Three baseline",
      variant: "static-projection-on",
    },
    {
      census: { objects: counted(20_000) },
      class: "explicit-instancing",
      kind: "diagnostic",
      load: "20k",
      notes:
        "plain-Three InstancedMesh is the explicit-instancing counterpart; its numbers never stand in for independent meshes",
      variant: "static-explicit-instancing",
    },
    {
      census: { objects: counted(20_000) },
      kind: "diagnostic",
      load: "20k",
      notes:
        "64 distinct materials on the shared geometry; one declared change, no switch combined with it",
      variant: "static-64-materials",
    },
  ],
  fixtureRevision: THREE_MESH_REVISION,
  realtime: {
    census: { objects: counted(20_000) },
    load: "20k",
    notes: "Phase 6 requires qualified presentation evidence for the 20k-mesh native comparison",
    protocol: "realtime-presentation",
    variant: "static",
  },
  workload: "three-independent-meshes",
};

/** §5: 50…1,000 foxes, synchronized and deterministically staggered animation, moving rings in both,
 *  shadows off. Diagnostics at 100 and 1,000 are separate controls taken from the synchronized variant:
 *  paused animation with the rings still moving is never a substitute for the active arm, and each
 *  character keeps its own independently evaluated skeleton (§5.1). */
const FOXES: IFamily = {
  arms: NATIVE_PAIR,
  factors: [
    ...loadRungs(
      [
        ["50", 50],
        ["100", 100],
        ["250", 250],
        ["500", 500],
        ["1000", 1_000],
      ],
      FOX_ANIMATIONS,
    ),
    ...([100, 1000] as const).flatMap(
      (count) =>
        [
          {
            census: { objects: counted(count) },
            kind: "diagnostic",
            load: String(count),
            notes: "animation paused, rings still moving — a distinct control, not the active arm",
            variant: "synchronized-animation-paused",
          },
          {
            census: { objects: counted(count) },
            kind: "diagnostic",
            load: String(count),
            notes: "directional shadows on, animation unchanged",
            variant: "synchronized-directional-shadows",
          },
        ] satisfies readonly IFactor[],
    ),
  ],
  fixtureRevision: FOXES_REVISION,
  realtime: {
    census: { objects: counted(100) },
    load: "100",
    notes: "Phase 6 requires qualified presentation evidence for the 100-fox comparison",
    protocol: "realtime-presentation",
    variant: "synchronized",
  },
  workload: "bevy-many-foxes",
};

/** §5: 10,000 RID-authored objects, static/basic-unshaded, translating and rotating, each variant's
 *  upstream shading preserved. The light and shadow cells are named Godot variants, not optimization
 *  switches, so they stay `default` and are separate cells. */
const GODOT_CULLING: IFamily = {
  arms: ["godot-native", "tn-native"],
  factors: [
    {
      census: { objects: counted(10_000) },
      load: "10k",
      notes: "benchmark_basic_cull: unshaded, static",
      variant: "basic-unshaded",
    },
    {
      census: { objects: counted(10_000) },
      load: "10k",
      notes: "benchmark_dynamic_cull: shaded, translating",
      variant: "dynamic-translate",
    },
    {
      census: { objects: counted(10_000) },
      load: "10k",
      notes: "benchmark_dynamic_rotate_cull: shaded, rotating",
      variant: "dynamic-rotate",
    },
    {
      census: { objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes: "benchmark_directional_light_cull: directional light with shadows",
      variant: "directional-shadows",
    },
    {
      census: { lights: counted(100), objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes: "benchmark_static_omni_light_cull: 100 omni lights, shadows off",
      variant: "static-omni-lights",
    },
    {
      census: { lights: counted(100), objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes:
        "benchmark_static_omni_light_cull_with_shadows: upstream's dual-paraboloid omni shadows, never equated with cubemap shadows (§5.1)",
      variant: "static-omni-lights-shadows",
    },
    {
      census: { lights: counted(100), objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes: "benchmark_dynamic_omni_light_cull: 100 omni lights moving, shadows off",
      variant: "dynamic-omni-lights",
    },
    {
      census: { lights: counted(100), objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes:
        "benchmark_dynamic_omni_light_cull_with_shadows: moving 100 omni lights with dual-paraboloid shadows",
      variant: "dynamic-omni-lights-shadows",
    },
    {
      census: { lights: counted(100), objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes: "benchmark_static_spot_light_cull_with_shadows: 100 spot lights, shadows on",
      variant: "static-spot-lights-shadows",
    },
    {
      census: { lights: counted(100), objects: counted(10_000) },
      kind: "diagnostic",
      load: "10k",
      notes: "benchmark_dynamic_spot_light_cull_with_shadows: 100 spot lights moving, shadows on",
      variant: "dynamic-spot-lights-shadows",
    },
  ],
  fixtureRevision: CULLING_REVISION,
  realtime: {
    census: { objects: counted(10_000) },
    load: "10k",
    notes: "the family's only load, taken as its realtime representative",
    protocol: "realtime-presentation",
    variant: "dynamic-translate",
  },
  workload: "godot-culling",
};

/** §5: every upstream-named lights_and_meshes cell, in the source's own settings. The source's
 *  `create_scene` defaults are box, 1,000 objects, spot lights, 10 lights, speed 1.0, so the omni,
 *  spot and speed cells inherit them. `benchmark_box_1000` and `benchmark_speed_slow` are the same
 *  upstream scene under two names; both names are kept because upstream names both, and the key
 *  differs on the variant. */
const GODOT_LIGHTS: IFamily = {
  arms: ["godot-native", "tn-native"],
  factors: [
    { census: { lights: scattered(10), objects: scattered(100) }, load: "100", variant: "box_100" },
    {
      census: { lights: scattered(10), objects: scattered(1_000) },
      load: "1k",
      variant: "box_1000",
    },
    {
      census: { lights: scattered(10), objects: scattered(10_000) },
      load: "10k",
      variant: "box_10000",
    },
    {
      census: { lights: scattered(10), objects: scattered(100) },
      load: "100",
      variant: "sphere_100",
    },
    {
      census: { lights: scattered(10), objects: scattered(1_000) },
      load: "1k",
      variant: "sphere_1000",
    },
    {
      census: { lights: scattered(10), objects: scattered(10_000) },
      load: "10k",
      variant: "sphere_10000",
    },
    {
      census: { lights: scattered(10), objects: scattered(1_000) },
      load: "1k",
      variant: "omni_10",
    },
    {
      census: { lights: scattered(100), objects: scattered(1_000) },
      load: "1k",
      variant: "omni_100",
    },
    {
      census: { lights: scattered(10), objects: scattered(1_000) },
      load: "1k",
      variant: "spot_10",
    },
    {
      census: { lights: scattered(100), objects: scattered(1_000) },
      load: "1k",
      variant: "spot_100",
    },
    {
      census: { lights: scattered(10), objects: scattered(1_000) },
      load: "1k",
      variant: "speed_slow",
    },
    {
      census: { lights: scattered(10), objects: scattered(1_000) },
      load: "1k",
      variant: "speed_fast",
    },
    {
      census: { lights: scattered(100), objects: scattered(10_000) },
      load: "10k",
      variant: "stress",
    },
  ],
  fixtureRevision: LIGHTS_REVISION,
  realtime: {
    census: { lights: scattered(10), objects: scattered(1_000) },
    load: "1k",
    notes: "the source's default scene (box, 1,000 objects, 10 lights)",
    protocol: "realtime-presentation",
    variant: "box_1000",
  },
  workload: "godot-lights-meshes",
};

const CITY_NOT_GENERATED =
  "bevy_city generates a census from its seed and size arguments, so there is no requested object count; the canonical fixture has not been exported, so the actual count is unknown (§5.1)";
const CITY_SMALL_UNFROZEN =
  "the small fixture's generator settings (seed, size) are not frozen and its census is not exported; the historical approximately-55k count is not an observation and is not recorded here";

/** §5: one small fixture and the upstream-default fixture (args seed 42, size 30), each static and
 *  with upstream moving behaviour, on the common profile; plus the upstream visual profile on the
 *  default fixture, qualified where its effects differ. §5.1 keeps runtime movement rather than
 *  baking a static export, and preserves node boundaries and material diversity. */
const CITY: IFamily = {
  arms: NATIVE_PAIR,
  factors: [
    {
      census: { objects: unfrozen(CITY_SMALL_UNFROZEN) },
      load: "small",
      notes: "TN web runs the small fixture only",
      variant: "static",
    },
    {
      census: { objects: unfrozen(CITY_SMALL_UNFROZEN) },
      load: "small",
      notes: "upstream moving behaviour retained at runtime, not baked into a static export",
      variant: "moving",
    },
    {
      census: { objects: unfrozen(CITY_NOT_GENERATED) },
      load: "default",
      variant: "static",
    },
    {
      census: { objects: unfrozen(CITY_NOT_GENERATED) },
      load: "default",
      variant: "moving",
    },
    {
      census: { objects: unfrozen(CITY_NOT_GENERATED) },
      kind: "diagnostic",
      load: "default",
      notes:
        "upstream visual profile: its own declared settings, reported qualified and never joined with common-profile rows",
      profile: UPSTREAM_CITY_PROFILE,
      variant: "moving",
    },
  ],
  fixtureRevision: CITY_DEFAULT_REVISION,
  realtime: {
    census: { objects: unfrozen(CITY_NOT_GENERATED) },
    load: "default",
    notes: "upstream's own default fixture, which is also the family representative",
    protocol: "realtime-presentation",
    variant: "moving",
  },
  workload: "bevy-city",
};

/** §5 requires TN web at these loads only. Everywhere else the family arms stand, so a web arm can
 *  never quietly become a second native comparison. */
const TN_WEB_LOADS: Readonly<Partial<Record<CrossEngineFamily, ReadonlySet<string>>>> = {
  "bevy-city": new Set(["small"]),
  "bevy-many-cubes": new Set(["10k", "100k"]),
  "bevy-many-foxes": new Set(["100", "500"]),
};

const FAMILIES: readonly IFamily[] = [
  CUBES,
  THREE_MESHES,
  FOXES,
  GODOT_CULLING,
  GODOT_LIGHTS,
  CITY,
];

function toCell(family: IFamily, factor: IFactor, kind: ExperimentCellKind): IExperimentCell {
  return {
    arms: factor.arms ?? family.arms,
    census: {
      lights: factor.census?.lights ?? NO_LIGHTS,
      objects: factor.census?.objects ?? unfrozen("no census declared for this cell"),
    },
    executionProtocol: factor.protocol ?? "deterministic-throughput",
    fixtureRevision:
      family.workload === "bevy-city" && factor.load === "small"
        ? CITY_SMALL_REVISION
        : family.fixtureRevision,
    kind,
    load: factor.load,
    notes: factor.notes ?? null,
    optimizationClass: factor.class ?? "default",
    renderingProfile: factor.profile ?? COMMON_RENDERING_PROFILE,
    variant: factor.variant,
    workload: family.workload,
  };
}

/** Every cell §5 enumerates, arms included. A family's `realtime` factor is the one representative load
 *  §7.2 asks for, so it is labelled `realtime-representative` rather than a second primary cell.
 *  `REQUIRED_EXPERIMENT_MATRIX` is the draft; freeze it only through `assertMatrixFrozen`. */
export const REQUIRED_EXPERIMENT_MATRIX: readonly IExperimentCell[] = FAMILIES.flatMap((family) => {
  const realtime =
    family.realtime === undefined
      ? []
      : [{ ...family.realtime, kind: "realtime-representative" as const }];
  return [...family.factors, ...realtime].map((factor) => {
    const cell = toCell(family, factor, factor.kind ?? "primary");
    const webLoads = TN_WEB_LOADS[cell.workload];
    if (!cell.arms.includes("tn-web") && webLoads?.has(cell.load) === true)
      return { ...cell, arms: [...cell.arms, "tn-web" as const] };
    return cell;
  });
});

/** §3. The seven components and nothing else, so two records that differ in any one of them are two
 *  different experiments and can never be joined into one speedup. */
export function experimentKey(cell: IExperimentCell): ICampaignExperimentKey {
  return {
    executionProtocol: cell.executionProtocol,
    fixtureRevision: cell.fixtureRevision,
    load: cell.load,
    optimizationClass: cell.optimizationClass,
    renderingProfile: cell.renderingProfile,
    variant: cell.variant,
    workload: cell.workload,
  };
}

export function keyOf(cell: IExperimentCell): string {
  const key = experimentKey(cell);
  return [
    key.workload,
    key.fixtureRevision,
    key.variant,
    key.load,
    key.renderingProfile,
    key.optimizationClass,
    key.executionProtocol,
  ].join("|");
}

export function cellsByFamily(
  cells: readonly IExperimentCell[] = REQUIRED_EXPERIMENT_MATRIX,
): Record<CrossEngineFamily, IExperimentCell[]> {
  const grouped = {} as Record<CrossEngineFamily, IExperimentCell[]>;
  for (const family of CROSS_ENGINE_FAMILIES) grouped[family] = [];
  for (const cell of cells) grouped[cell.workload].push(cell);
  return grouped;
}

/** Every census whose actual count is still `null`, one line per cell and axis, so the freeze refusal
 *  names what is missing instead of failing on a count of unresolved cells. A generated fixture has
 *  no `requested` count at all — that is what `requested: null` means — so only `actual` blocks. */
export function unfrozenCensuses(
  cells: readonly IExperimentCell[] = REQUIRED_EXPERIMENT_MATRIX,
): string[] {
  return cells.flatMap((cell) =>
    (["objects", "lights"] as const).flatMap((axis) => {
      const value = cell.census[axis];
      if (value.actual !== null) return [];
      return [`${keyOf(cell)} ${axis}: ${value.reason ?? "no census recorded"}`];
    }),
  );
}

/** §7.1. A plan may only be frozen when every cell runs on a hashed fixture identity whose generator
 *  inputs are recorded, not merely on a filled census: a revision that is not a
 *  `name@sha256:<64 lowercase hex>` identity, or a generated fixture with no frozen seed/size, is
 *  not a plan anyone can reproduce. One line per unresolved revision and per unresolved setting; a
 *  fixture with no declared settings cannot block. */
export function unfrozenFixtures(
  cells: readonly IExperimentCell[] = REQUIRED_EXPERIMENT_MATRIX,
  settings: Readonly<Record<string, Readonly<Record<string, string | null>>>> = GENERATOR_SETTINGS,
): string[] {
  const names = new Set(cells.map((cell) => cell.fixtureRevision.split("@")[0] ?? ""));
  return [
    ...[...new Set(cells.map((cell) => cell.fixtureRevision))]
      .filter((revision) => !FROZEN_REVISION.test(revision))
      .map(
        (revision) =>
          `fixture revision ${revision}: not a name@sha256:<64 lowercase hex> fixture identity`,
      ),
    ...Object.entries(settings).flatMap(([fixture, inputs]) =>
      names.has(fixture)
        ? Object.entries(inputs)
            .filter(([, value]) => value === null)
            .map(([setting]) => `${fixture} generator setting ${setting}: not frozen`)
        : [],
    ),
  ];
}

/** §7.1. The freeze check a later `freeze` step runs. Today it refuses, because the City censuses,
 *  every fixture identity and the small fixture's generator settings are not recorded yet. */
export function assertMatrixFrozen(
  cells: readonly IExperimentCell[] = REQUIRED_EXPERIMENT_MATRIX,
  settings: Readonly<Record<string, Readonly<Record<string, string | null>>>> = GENERATOR_SETTINGS,
): void {
  const blockers = [...unfrozenCensuses(cells), ...unfrozenFixtures(cells, settings)];
  if (blockers.length > 0)
    throw new BenchError(
      "TN_BENCH_MATRIX_UNFROZEN",
      `${blockers.length} unfrozen matrix value(s):\n  ${blockers.join("\n  ")}`,
    );
  const seen = new Set<string>();
  for (const cell of cells) {
    const key = keyOf(cell);
    if (seen.has(key)) throw new BenchError("TN_BENCH_MATRIX_DUPLICATE_KEY", key);
    seen.add(key);
  }
}
