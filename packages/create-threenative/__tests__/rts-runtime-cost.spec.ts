import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { OrthographicCamera, Scene, Texture, Vector2 } from "three";
import { describe, expect, it, vi } from "vitest";
import { Game } from "../templates/rts/src/sim/game.js";

/**
 * The rts kit's ordinary-frame cost, measured the way `template-runtime-cost.spec.ts` measures
 * every other template: a warm-up, then a counted window in which a fresh three.js vector is a
 * failure. The count is the claim, so it is a sentinel on the constructors and on `clone()` — a
 * path that copies its result instead of writing into a scratch vector is the exact defect this
 * catches, and the render modules already hold one `_dummy` and one `_ndc` for that reason.
 */
const probeState = vi.hoisted(() => ({
  vector2Allocations: 0,
  vector3Allocations: 0,
  vector3Clones: 0,
}));

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

function simFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? simFiles(file) : /\.ts$/u.test(entry.name) ? [file] : [];
  });
}

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

    expect(selected.size).toBeGreaterThanOrEqual(OWN_UNITS);
    expect(allocations, "rts render vector allocation sentinel").toEqual({
      clones: 0,
      constructors: 0,
    });
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
