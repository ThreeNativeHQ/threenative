import type {
  IPlaytestBridgeDescription,
  IPlaytestEntityObservation,
  IPlaytestObservationSnapshot,
} from "../protocol.js";

/**
 * The scene, in a glance — what `threenative-playtest doctor --url` reports once it can reach a
 * running game.
 *
 * Everything here is derived from one bridge sample, and nothing is inferred beyond it: what the
 * bridge does not report is listed as unobserved rather than guessed at, because a confident number
 * with nothing behind it is exactly the failure this harness exists to prevent.
 */

export interface ISceneObservation {
  readonly description?: IPlaytestBridgeDescription | { engine?: string; name?: string; version?: string };
  readonly snapshot: IPlaytestObservationSnapshot;
  readonly url: string;
}

export interface ISceneAxisExtent {
  readonly max: number;
  readonly min: number;
  readonly size: number;
}

export interface ISceneOverview {
  readonly entities: { hidden: number; observed: number; visible: number };
  readonly extents?: { x: ISceneAxisExtent; y: ISceneAxisExtent; z: ISceneAxisExtent };
  readonly gameplay: {
    clipsAdvancing: readonly string[];
    states: number;
    tags: Record<string, number>;
  };
  readonly notObserved: readonly string[];
  readonly render: { drawCalls?: number; fps?: number; frameMs?: number; triangles?: number };
  readonly runtime: {
    clock: string;
    consoleErrors: number;
    core?: string;
    rapier?: string | null;
    seed?: number | null;
    tick?: number;
  };
  readonly scale: { largestEntityScale?: number; medianEntityScale?: number; verdict: string };
  readonly url: string;
}

/**
 * The same threshold `threenative inspect` uses on an asset: past this, a "one unit is one metre"
 * reading stops being credible and centimetre-authored source is the likelier explanation.
 */
const CENTIMETRE_HEURISTIC_THRESHOLD = 10;

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function positions(entities: readonly IPlaytestEntityObservation[]): Array<[number, number, number]> {
  return entities
    .map(({ transform }) => transform?.position)
    .filter((position): position is [number, number, number] => Array.isArray(position) && position.length === 3);
}

function axisExtent(values: readonly number[]): ISceneAxisExtent {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { max, min, size: Number((max - min).toFixed(6)) };
}

function scaleMagnitudes(entities: readonly IPlaytestEntityObservation[]): number[] {
  return entities
    .map(({ transform }) => transform?.scale)
    .filter((scale): scale is [number, number, number] => Array.isArray(scale) && scale.length === 3)
    .map((scale) => Math.max(...scale.map((component) => Math.abs(component))));
}

function scaleVerdict(entities: readonly IPlaytestEntityObservation[]): ISceneOverview["scale"] {
  // A ground plane is legitimately huge, so the median entity carries the verdict and the largest
  // is reported beside it rather than deciding it.
  const magnitudes = scaleMagnitudes(entities);
  const middle = median(magnitudes);
  if (middle === undefined) return { verdict: "no entity scales observed" };
  const largest = Math.max(...magnitudes);
  return {
    largestEntityScale: largest,
    medianEntityScale: middle,
    verdict:
      middle > CENTIMETRE_HEURISTIC_THRESHOLD
        ? `median entity is ${middle}× — assets look centimetre-authored, so one unit is probably not one metre`
        : "consistent with metres",
  };
}

function countConsoleErrors(snapshot: IPlaytestObservationSnapshot): number {
  return (snapshot.diagnostics ?? []).filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const severity = (entry as { severity?: unknown }).severity;
    const type = (entry as { type?: unknown }).type;
    return severity === "error" || type === "error";
  }).length;
}

export function summariseScene(observation: ISceneObservation): ISceneOverview {
  const { snapshot } = observation;
  const entities = snapshot.entities ?? [];
  const visible = entities.filter(({ visible }) => visible !== false).length;
  const points = positions(entities);
  const frames = (snapshot.runtimeDiagnosticsSeries ?? []).map(({ frameMs }) => frameMs);
  const frameMs = median(frames);
  const world = snapshot.gameplay?.world;
  const clips = Object.entries(snapshot.gameplay?.animation ?? {})
    .filter(([, animation]) => animation.advancedFrames > 0)
    .map(([entity, animation]) => `${entity}: ${animation.clip}`);
  return {
    entities: { hidden: entities.length - visible, observed: entities.length, visible },
    extents:
      points.length === 0
        ? undefined
        : {
            x: axisExtent(points.map(([x]) => x)),
            y: axisExtent(points.map(([, y]) => y)),
            z: axisExtent(points.map(([, , z]) => z)),
          },
    gameplay: {
      clipsAdvancing: clips,
      states: Object.keys(snapshot.gameplay?.states ?? {}).length,
      tags: Object.fromEntries(
        Object.entries(snapshot.gameplay?.tags ?? {}).map(([tag, { count }]) => [tag, count]),
      ),
    },
    notObserved: [
      "lights, materials and textures — the bridge reports entities, not renderer resources",
      "camera framing beyond its entity transform",
    ],
    render: {
      drawCalls: snapshot.performance?.drawCalls,
      fps: frameMs === undefined || frameMs <= 0 ? undefined : Math.round(1000 / frameMs),
      frameMs,
      triangles: snapshot.performance?.triangles,
    },
    runtime: {
      clock: snapshot.clock.mode,
      consoleErrors: countConsoleErrors(snapshot),
      core: world?.runtime?.core,
      rapier: world?.runtime?.rapier,
      seed: world?.seed,
      tick: snapshot.clock.tick,
    },
    scale: scaleVerdict(entities),
    url: observation.url,
  };
}

function extentLine(extents: ISceneOverview["extents"]): string {
  if (extents === undefined) return "  extents      not observed";
  // Full precision stays in the JSON; two decimals is what a glance can use.
  const round = (value: number): string => String(Number(value.toFixed(2)));
  const axis = (name: "x" | "y" | "z"): string => {
    const { max, min, size } = extents[name];
    return `${name} ${round(min)}..${round(max)} (${round(size)})`;
  };
  return `  extents      ${axis("x")} · ${axis("y")} · ${axis("z")}`;
}

export function formatSceneOverview(overview: ISceneOverview): string {
  const { entities, gameplay, render, runtime, scale } = overview;
  const tags = Object.entries(gameplay.tags).map(([tag, count]) => `${tag} ${count}`);
  const lines = [
    `scene overview — ${overview.url}`,
    `  runtime      core ${runtime.core ?? "?"} · rapier ${runtime.rapier ?? "none"} · seed ${
      runtime.seed ?? "none"
    } · clock ${runtime.clock}${runtime.tick === undefined ? "" : ` at tick ${runtime.tick}`}`,
    entities.observed === 0
      ? "  entities     no entities observed — the game may register none, or the bridge sampled before startup"
      : `  entities     ${entities.observed} observed, ${entities.visible} visible, ${entities.hidden} hidden`,
    extentLine(overview.extents),
    `  scale        ${scale.verdict}${
      scale.medianEntityScale === undefined
        ? ""
        : ` (median ${scale.medianEntityScale}×, largest ${scale.largestEntityScale}×)`
    }`,
    `  render       ${render.drawCalls ?? "?"} draw calls · ${
      render.triangles === undefined ? "? triangles" : `${render.triangles.toLocaleString("en-US")} triangles`
    }${render.frameMs === undefined ? "" : ` · ${render.frameMs.toFixed(1)} ms/frame (${render.fps} fps)`}`,
    `  gameplay     ${gameplay.states} states · ${
      gameplay.clipsAdvancing.length === 0 ? "no clips advancing" : `clips ${gameplay.clipsAdvancing.join(", ")}`
    }${tags.length === 0 ? "" : ` · tags ${tags.join(", ")}`}`,
    `  console      ${runtime.consoleErrors} errors`,
    ...overview.notObserved.map((entry) => `  not observed ${entry}`),
  ];
  return `${lines.join("\n")}\n`;
}

export interface IObserveSceneOptions {
  readonly browserArgs?: readonly string[];
  readonly headless?: boolean;
  readonly timeoutMs?: number;
  readonly warmupMs?: number;
}

/**
 * Launch a browser, reach the running game's bridge, take one sample, and leave. Nothing here
 * drives input or asserts anything: this reports the scene as found, and a scenario is still what
 * proves the game.
 */
export async function observeScene(
  url: string,
  options: IObserveSceneOptions = {},
): Promise<ISceneObservation> {
  const { chromium } = await import("playwright");
  const { connectPlaytestBridge } = await import("./bridgeClient.js");
  const { resolveBrowserArguments } = await import("./browser.js");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const browser = await chromium.launch({
    ...(options.browserArgs === undefined ? {} : { args: resolveBrowserArguments(options.browserArgs) }),
    headless: options.headless ?? true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: timeoutMs, waitUntil: "load" });
    // The bridge appears at startup, but entity registration and the first rendered frames land
    // after it, and an overview taken before them reports an empty scene that is not empty.
    await page.waitForTimeout(options.warmupMs ?? 1_500);
    const bridge = await connectPlaytestBridge(
      page,
      {
        assert: { entities: [{ entity: "*", exists: true }] },
        name: "doctor",
        schemaVersion: 1,
        steps: [],
        target: "browser",
        viewport: { height: 720, width: 1280 },
        warmupFrames: 0,
      } as unknown as import("../scenario.js").IPlaytestScenario,
      timeoutMs,
    );
    if (bridge === undefined) {
      throw new Error(
        "TN_PLAYTEST_BRIDGE_MISSING: the page at this URL installs no playtest bridge, so its scene cannot be read. Install playtest() in defineGame, or installThreePlaytestBridge for a plain Three.js project.",
      );
    }
    const snapshot = await bridge.sample({
      include: ["runtimeDiagnostics", "performance", "gameplay", "diagnostics"],
    });
    await bridge.close();
    return { description: bridge.description, snapshot, url };
  } finally {
    await browser.close();
  }
}
