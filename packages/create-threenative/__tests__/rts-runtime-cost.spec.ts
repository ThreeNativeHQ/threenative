import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { OrthographicCamera, Scene, Texture, Vector2 } from "three";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { Game } from "../templates/rts/src/sim/game.js";

/**
 * The rts kit's ordinary-frame cost, measured the way `template-runtime-cost.spec.ts` measures
 * every other template: a warm-up, then a counted window in which a fresh three.js vector is a
 * failure. The count is the claim, so it is a sentinel on the constructors and on `clone()` — a
 * path that copies its result instead of writing into a scratch vector is the exact defect this
 * catches, and the render modules already hold one `_dummy` and one `_ndc` for that reason.
 *
 * Vectors are not the whole story. `filter`, `map`, `slice` and friends each hand back a new
 * array, so a steady frame that calls one of them is allocating at sixty units — which is what a
 * `V2` sentinel alone would report as clean. Every array-producing call in the measured window is
 * counted too, across the simulation step, the render sync and the scene frame.
 */
const probeState = vi.hoisted(() => ({
  arrayAllocations: 0,
  vector2Allocations: 0,
  vector3Allocations: 0,
  vector3Clones: 0,
}));

/** The array-returning builtins: each call is one fresh array plus its callback closure. */
const ARRAY_ALLOCATORS = [
  "concat",
  "entries",
  "filter",
  "flat",
  "flatMap",
  "keys",
  "map",
  "slice",
  "splice",
  "toReversed",
  "toSorted",
  "values",
] as const;

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class CountingVector2 extends actual.Vector2 {
    constructor(x?: number, y?: number) {
      super(x, y);
      probeState.vector2Allocations += 1;
    }
  }
  class CountingVector3 extends actual.Vector3 {
    constructor(x?: number, y?: number, z?: number) {
      super(x, y, z);
      probeState.vector3Allocations += 1;
    }
  }
  const clone = actual.Vector3.prototype.clone;
  actual.Vector3.prototype.clone = function () {
    probeState.vector3Clones += 1;
    return clone.call(this);
  };
  return { ...actual, Vector2: CountingVector2, Vector3: CountingVector3 };
});

vi.mock("@threenative/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/src/index.js")>();
  // The kit asks the platform once, at `enter()`, and picks its quality tier from the answer.
  return { ...actual, isMobile: () => false };
});

const WARMUP_FRAMES = 30;
const MEASURED_FRAMES = 600;
const DT = 1 / 60;
/** The size the box names: sixty of the player's own units on the field at once. */
const OWN_UNITS = 60;

function measureVectorAllocations(step: () => void): { clones: number; constructors: number } {
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) step();
  probeState.vector2Allocations = 0;
  probeState.vector3Allocations = 0;
  probeState.vector3Clones = 0;
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) step();
  return { clones: probeState.vector3Clones, constructors: probeState.vector3Allocations };
}

/**
 * Counts every array the measured window allocates, and names the ones it saw. Wrapping the
 * builtins rather than sampling the heap keeps the gate deterministic: no profiler, no threshold,
 * and a regression names the call that came back.
 */
function countArrayAllocations<T>(step: () => T): { calls: number; where: string[] } {
  const proto = Array.prototype as unknown as Record<string, unknown>;
  const original = new Map<string, (...args: never[]) => unknown>();
  for (const name of ARRAY_ALLOCATORS) original.set(name as string, proto[name as string] as never);
  const where: string[] = [];
  // Formatting a stack walks `split` and `slice`, which are themselves wrapped, so the capture
  // happens before anything is wrapped and the wrappers stay one frame deep.
  let capturing = false;
  const count = (): void => {
    if (where.length >= 8 || capturing) return;
    capturing = true;
    try {
      Error.stackTraceLimit = 6;
      where.push((new Error().stack ?? "").split("\n").slice(3).join(" | "));
      Error.stackTraceLimit = 10;
    } finally {
      capturing = false;
    }
  };
  try {
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) step();
    where.length = 0;
    for (const name of ARRAY_ALLOCATORS) {
      const built = original.get(name as string) as (...args: never[]) => unknown;
      proto[name as string] = function guarded(this: unknown[], ...args: never[]): unknown {
        count();
        return built.apply(this, args);
      };
    }
    for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) step();
  } finally {
    for (const [key, built] of original) proto[key] = built;
  }
  return { calls: where.length, where };
}

function simFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return simFiles(file);
    return /\.ts$/u.test(entry.name) ? [file] : [];
  });
}

/**
 * The source text of the line a counted literal sits on, cached. Classifying an allocation by what
 * the line says rather than by its number means an edit that moves the line cannot silently
 * reclassify it into the wrong bucket.
 */
function literalText(key: string): string {
  const at = key.lastIndexOf(":");
  const file = path.resolve(import.meta.dirname, "../templates/rts/src/sim", key.slice(0, at));
  const line = Number(key.slice(at + 1));
  const cached = literalText.cache.get(key);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, "utf8").split("\n")[line - 1]?.trim() ?? "";
  literalText.cache.set(key, text);
  return text;
}
literalText.cache = new Map<string, string>();

/**
 * The seeded start plus enough of an army to put the claimed sixty own units on the field.
 *
 * `ai: false`, because the two claims measured against this fixture are about the *steady* state:
 * a commander training a Surveyor mints an entity record and builds the instanced batch for a type
 * that was not on the field, which is setup work, not per-frame work. The scene frame below runs
 * with the AI on, so the commander's own per-frame cost is measured there.
 */
function sixtyUnitMatch(seed = 471): Game {
  const game = new Game({ ai: false, seed });
  const wanted = OWN_UNITS - game.army().length;
  let added = 0;
  for (let row = 0; added < wanted; row += 1) {
    for (let column = 0; column < 6 && added < wanted; column += 1) {
      game.spawn(added % 3 === 0 ? "tank" : "ranger", 0, -62 + column * 3, 38 - row * 3);
      added += 1;
    }
  }
  return game;
}

/**
 * Counts every object and array *literal* the simulation evaluates, by source line.
 *
 * The spies above cannot see these: an object literal allocates without calling anything they
 * wrap, which is how `travelEntity`'s `{x, z}` survived a spy that reported zero arrays. So the
 * sources are compiled here through a TypeScript transformer that rewrites each literal into a call
 * to a counter — the same approach an independent reviewer used to reproduce the 74 literals a
 * step at `movement.ts:54` that this file used to call clean.
 */
function watchSimLiterals(): {
  Game: typeof Game;
  begin: () => void;
  take: () => { calls: number; lines: Map<string, number> };
} {
  const directory = path.resolve(import.meta.dirname, "../templates/rts/src/sim");
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const counts = new Map<string, number>();
  let watching = false;
  const record = (file: string, line: number): void => {
    if (!watching) return;
    const key = `${path.basename(file)}:${line}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const load = (file: string): Record<string, unknown> => {
    const cached = cache.get(file);
    if (cached) return cached.exports;
    const module_ = { exports: {} as Record<string, unknown> };
    cache.set(file, module_);
    const source = readFileSync(file, "utf8");
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
      const visit = (node: ts.Node): ts.Node => {
        const next = ts.visitEachChild(node, visit, context);
        if (!ts.isObjectLiteralExpression(next) && !ts.isArrayLiteralExpression(next)) return next;
        const line = root.getLineAndCharacterOfPosition(next.getStart(root)).line + 1;
        return ts.factory.createParenthesizedExpression(
          ts.factory.createBinaryExpression(
            ts.factory.createCallExpression(ts.factory.createIdentifier("__literal"), undefined, [
              ts.factory.createStringLiteral(file),
              ts.factory.createNumericLiteral(line),
            ]),
            ts.SyntaxKind.CommaToken,
            next,
          ),
        );
      };
      return ts.visitNode(root, visit) as ts.SourceFile;
    };
    const { outputText } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      transformers: { before: [transformer] },
    });
    const require_ = (specifier: string): unknown =>
      load(path.join(path.dirname(file), specifier.replace(/\.js$/u, ".ts")));
    new Function("require", "exports", "module", "__literal", outputText)(
      require_,
      module_.exports,
      module_,
      record,
    );
    return module_.exports;
  };
  for (const file of simFiles(directory)) load(file);
  const exported = load(path.join(directory, "game.ts")) as { Game: typeof Game };
  return {
    Game: exported.Game,
    begin: () => {
      counts.clear();
      watching = true;
    },
    take: () => {
      watching = false;
      // Every line, uncapped: the classification below reads all of them, and a truncated list
      // would let a steady literal hide behind the eight loudest.
      return { calls: [...counts.values()].reduce((a, b) => a + b, 0), lines: new Map(counts) };
    },
  };
}

/**
 * The general case the box names: default settings, sixty own units in motion, no entity born in
 * the window, and the window long enough for the 1.2 s commander clock to tick several times.
 *
 * `ai: false` and idle units are exactly the two shortcuts that made the earlier version of this
 * file report zero on a path the kit never plays, so this fixture uses neither.
 */
function playingMatch(watcher: ReturnType<typeof watchSimLiterals>): Game {
  const game = new watcher.Game({ seed: 471 });
  for (let n = game.army().length; n < OWN_UNITS; n += 1) {
    game.spawn("tank", 0, -62 + (n % 6) * 3, 38 - Math.floor(n / 6) * 3);
  }
  const ids: number[] = [];
  for (const entity of game.own(0)) ids.push(entity.id);
  game.command(ids, "attackMove", { x: -70, z: -60 }, 0);
  return game;
}

describe("rts kit ordinary-frame runtime cost", () => {
  it("keeps the simulation free of the renderer, so a step cannot build a vector", () => {
    const sources = simFiles(path.resolve(import.meta.dirname, "../templates/rts/src/sim")).map(
      (file) => readFileSync(file, "utf8"),
    );

    expect(sources.length).toBeGreaterThan(8);
    expect(sources.join("\n")).not.toMatch(/from ["']three["']/u);
  });

  it("steps 600 frames of a sixty-unit match without a fresh vector", () => {
    const game = sixtyUnitMatch();
    const mintedBefore = game.nextId;

    const allocations = measureVectorAllocations(() => game.step());

    expect(game.army().length).toBe(OWN_UNITS);
    expect(game.own(0).length).toBeGreaterThan(OWN_UNITS);
    // The step updates the records it owns; a steady state mints no new one.
    expect(game.nextId, "rts sim entity-record sentinel").toBe(mintedBefore);
    expect(allocations, "rts sim vector allocation sentinel").toEqual({
      clones: 0,
      constructors: 0,
    });
  });

  it("steps 600 frames of a sixty-unit match without allocating an array", () => {
    const game = sixtyUnitMatch();

    const arrays = countArrayAllocations(() => game.step());

    expect(arrays.calls, `rts sim array allocation sentinel: ${arrays.where.join("\n")}`).toBe(0);
  });

  /**
   * The general case, measured where a builtin spy is blind: default settings, sixty own units
   * walking, and a window long enough for the 1.2 s commander clock to tick eight times.
   *
   * Three numbers, all asserted, none of them a rounding of "excluded":
   *
   * * **steady literals** — everything except entity birth and a unit's waypoint store growing.
   *   Must be zero on every step. This is the claim the box names.
   * * **birth literals** — one entity record per entity that appears. Counted and asserted to be a
   *   real, small number, because a fixture that spawns nothing proves nothing about spawning.
   * * **growth literals** — a unit's `pathPool` doubling past its longest route so far. This is
   *   amortised per-entity state growth, not per-frame work, but it lands on ordinary frames, so it
   *   is reported with its own bound and a convergence check rather than excused.
   *
   * The obvious way to pass this is to call everything an event. The event steps are therefore
   * counted and bounded too: the window must contain real events (it is a match, not a still life),
   * most steps must still be ordinary, and a step is ordinary *only* if it minted nothing.
   */
  it("steps a playing sixty-unit match with the default AI on without evaluating a literal", () => {
    const watcher = watchSimLiterals();
    const game = playingMatch(watcher);
    // The three seams an event step is detected through, wrapped rather than counted by hand: an
    // event is exactly a birth, an order, a training or an emitted record.
    let events = 0;
    const command = game.command.bind(game);
    const train = game.train.bind(game);
    const emit = game.emit.bind(game);
    game.command = (...args: Parameters<typeof command>) => {
      events += 1;
      return command(...args);
    };
    game.train = (...args: Parameters<typeof train>) => {
      events += 1;
      return train(...args);
    };
    game.emit = (...args: Parameters<typeof emit>) => {
      events += 1;
      return emit(...args);
    };
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) game.step();
    const movingAtWarmup = game.army().filter((entity) => entity.moving).length;
    const enemyStart = game
      .army(1)
      .map((entity) => `${entity.x},${entity.z}`)
      .join("|");
    const position = (entity: { x: number; z: number }): string => `${entity.x},${entity.z}`;
    const before = new Map(game.own(0).map((entity) => [entity.id, position(entity)]));
    let ordinary = 0;
    let eventSteps = 0;
    let steady = 0;
    let growth = 0;
    const growthSteps: number[] = [];
    const steadyWhere = new Map<string, number>();

    for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
      const minted = game.nextId;
      events = 0;
      watcher.begin();
      game.step();
      const step = watcher.take();
      if (game.nextId !== minted) {
        // A birth is cold initialisation: it mints the entity record and its state once. Counted,
        // never counted as steady work.
        continue;
      }
      // A waypoint store doubling is amortised per-entity growth, so it is counted on its own. It
      // is recognised by the source line, not by a filename or a line number that an edit moves.
      let growthHere = 0;
      let otherHere = 0;
      const whereHere = new Map<string, number>();
      for (const [line, count] of step.lines) {
        if (literalText(line).includes("pool.push")) growthHere += count;
        else {
          otherHere += count;
          whereHere.set(line, (whereHere.get(line) ?? 0) + count);
        }
      }
      growth += growthHere;
      if (growthHere > 0) growthSteps.push(frame);
      // A step that ordered, trained or emitted is ordinary play: a shot, an order, a weld and a
      // training command are the match, not an interruption of it. Counting them separately let
      // 213 of 600 active frames out of the measurement, which is most of the fight, so they are
      // counted here like every other frame and reported as their own total beside it.
      if (events > 0) eventSteps += 1;
      ordinary += 1;
      steady += otherHere;
      for (const [line, count] of whereHere)
        steadyWhere.set(line, (steadyWhere.get(line) ?? 0) + count);
    }
    const where = [...steadyWhere.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([line, count]) => `${line} x${count}`);
    const moved = game.own(0).filter((entity) => before.get(entity.id) !== position(entity)).length;

    // Reported, not just asserted: a reader has to be able to see how much of the window was
    // combat and orders rather than take the zero on faith.
    console.log(
      `rts ordinary-frame window: ${ordinary} frames measured, ${eventSteps} of them ordered, trained or emitted, ${MEASURED_FRAMES - ordinary} skipped as entity birth, steady literals ${steady}, growth ${growth}`,
    );
    expect(game.ai, "the default AI must stay on for this case to mean anything").toBe(true);
    expect(movingAtWarmup, "the fixture must be moving units, not idle ones").toBeGreaterThan(40);
    expect(game.result, "a finished match would stop stepping and pass by doing nothing").toBe(
      null,
    );
    // Most of the window must be ordinary, or "zero on ordinary steps" would be a narrow claim. The
    // rest must still be real events, or the fixture would be a board that stopped playing.
    expect(ordinary, "most steps must be ordinary, not excused as events").toBeGreaterThan(
      MEASURED_FRAMES * 0.5,
    );
    expect(
      eventSteps,
      "the window must still contain events: it is a match, not a still life",
    ).toBeGreaterThan(0);
    expect(
      game
        .army(1)
        .map((entity) => `${entity.x},${entity.z}`)
        .join("|"),
      "an enemy commander must have run: its army is on the move",
    ).not.toBe(enemyStart);
    expect(moved, "the units must have actually travelled").toBeGreaterThan(40);
    expect(steady, `rts sim steady-state literal sentinel: ${where.join("\n")}`).toBe(0);
    // Growth is bounded and converges. A unit pays it once per doubling of its longest route, so a
    // 600-frame window must see it only a handful of times — and the second half of the window must
    // see strictly fewer than the first, which is what "amortised, not per-frame" actually means.
    // (An absolute zero here would be a claim about one seed's longest route, not about the code.)
    expect(growthSteps.length, "waypoint-store growth must be rare").toBeLessThan(
      MEASURED_FRAMES * 0.1,
    );
    expect(
      growthSteps.filter((frame) => frame >= MEASURED_FRAMES / 2).length,
      "waypoint-store growth must decay: the second half of a window sees fewer than the first",
    ).toBeLessThanOrEqual(growthSteps.filter((frame) => frame < MEASURED_FRAMES / 2).length);
    expect(
      growth,
      "waypoint-store growth must be a few allocations per unit, not per frame",
    ).toBeLessThan(game.entities.length * 16);
  });

  it("counts a literal when one is evaluated, so the zero above is a measurement", () => {
    const watcher = watchSimLiterals();
    watcher.begin();
    // Setting up the fixture allocates: the spawn records, the command's formation and the order
    // objects. Without this control a broken observer would make the case above pass for free.
    playingMatch(watcher);

    expect(watcher.take().calls).toBeGreaterThan(0);
  });

  it("syncs sixty units of render state for 600 frames without a fresh vector", async () => {
    const { createArmy } = await import("../templates/rts/src/render/army.js");
    const { createUnitModels } = await import("../templates/rts/src/render/models.js");
    const { createResources } = await import("../templates/rts/src/render/resources.js");
    const { createTerrain } = await import("../templates/rts/src/render/terrain.js");
    const game = sixtyUnitMatch(472);
    const camera = new OrthographicCamera(-53, 53, 30, -30, 1, 600);
    camera.position.set(-70, 62, 58);
    camera.lookAt(-70, 0, 58);
    const terrain = createTerrain();
    const resources = createResources();
    const models = createUnitModels();
    const army = createArmy(models);
    const selected = new Set<number>();
    for (const entity of game.army()) selected.add(entity.id);
    const root = new Scene();
    root.add(terrain.root, resources.root, army.root);
    let time = 0;

    const allocations = measureVectorAllocations(() => {
      time += DT;
      game.step();
      terrain.updateFog(game);
      resources.sync(game);
      army.sync(game, selected, time, DT, camera);
    });
    const arrays = countArrayAllocations(() => {
      time += DT;
      game.step();
      terrain.updateFog(game);
      resources.sync(game);
      army.sync(game, selected, time, DT, camera);
    });

    expect(selected.size).toBeGreaterThanOrEqual(OWN_UNITS);
    expect(allocations, "rts render vector allocation sentinel").toEqual({
      clones: 0,
      constructors: 0,
    });
    expect(arrays.calls, `rts render array allocation sentinel: ${arrays.where.join("\n")}`).toBe(
      0,
    );
    terrain.root.removeFromParent();
    resources.root.removeFromParent();
    army.root.removeFromParent();
    army.dispose();
    models.dispose();
  });

  it("runs 600 scene frames over the seeded battlefield without a fresh vector", async () => {
    const { Play } = await import("../templates/rts/src/scenes/Play.js");
    const { INITIAL_STATE } = await import("../templates/rts/src/state.js");
    const state = { ...INITIAL_STATE };
    const patchIdentities = new Set<object>();
    const scene = new Scene();
    const camera = new OrthographicCamera(-53, 53, 30, -30, 1, 600);
    const context = {
      add: (object: { isObject3D?: boolean }) => {
        scene.add(object as never);
        return object;
      },
      assets: { texture: async () => new Texture() },
      camera,
      canvasLayer: { camera, opaque: true, scene: new Scene() },
      entities: {
        add: <T>(_id: string, entity: T): T => entity,
        remove: () => undefined,
      },
      input: {
        axis: () => 0,
        justPressed: () => false,
        raw: {
          keys: new Set<string>(),
          pointer: { buttons: 0, position: new Vector2(0.5, 0.5) },
          pointerEdges: new Map<number, { type: string; id: number; buttons: number }[]>(),
          pointers: new Map<number, { position: Vector2 }>(),
        },
        vector: () => new Vector2(),
      },
      random: { range: (from: number, to: number) => from + 1 },
      renderer: {
        createRenderChain: () => ({ applied: { dropped: [], stages: ["bloom"] } }),
        kind: "webgl",
        raw: { shadowMap: { enabled: false, type: 0 } },
        setOutputNode: () => undefined,
      },
      scene,
      state: {
        getState: () => state,
        set: (patch: unknown) => {
          patchIdentities.add(patch as object);
          Object.assign(state, patch as Record<string, unknown>);
        },
      },
      viewport: { size: { aspect: 16 / 9, height: 720, width: 1280 } },
    };

    const play = new Play();
    await play.load(context as never);
    const frame = play.enter(context as never);
    if (typeof frame !== "function")
      throw new Error("Allocation fixture returned no rts scene frame.");
    for (let warm = 0; warm < WARMUP_FRAMES; warm += 1) frame(context as never, DT);
    const warmPatches = patchIdentities.size;
    probeState.vector2Allocations = 0;
    probeState.vector3Allocations = 0;
    probeState.vector3Clones = 0;
    for (let measured = 0; measured < MEASURED_FRAMES; measured += 1) frame(context as never, DT);

    expect(state.selection).toBeGreaterThan(0);
    expect(state.simTime).toBeGreaterThan(0);
    // One reused patch object for the whole run: the scene mutates it rather than minting a new
    // one per frame, and the store would otherwise clone a fresh object sixty times a second.
    expect(patchIdentities.size, "rts Play state-patch high-water sentinel").toBe(warmPatches);
    expect(
      { clones: probeState.vector3Clones, constructors: probeState.vector3Allocations },
      "rts Play frame vector allocation sentinel",
    ).toEqual({ clones: 0, constructors: 0 });
    play.exit(context as never);
  });
});
