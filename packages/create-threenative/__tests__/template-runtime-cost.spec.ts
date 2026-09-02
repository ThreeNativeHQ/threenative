import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector2,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { createRandom } from "../../core/src/random.js";
import { rapier } from "../../physics/src/index.js";
import type { IPhysicsContext } from "../../physics/src/plugin.js";

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
  // The headless probe has no AudioContext; starter Play registers the bus and plays a
  // pickup buffer, so the fixture doubles exactly that surface — allocation is the target.
  class FixtureAudioBus {
    play(_buffer: unknown): void {}
    dispose(): void {}
  }
  return { ...actual, AudioBus: FixtureAudioBus };
});
vi.mock("@threenative/physics", () => import("../../physics/src/index.js"));

const WARMUP_FRAMES = 30;
const MEASURED_FRAMES = 600;
const DT = 1 / 60;

interface IPhysicsFixture {
  readonly physics: IPhysicsContext;
  dispose(): void;
  step(dt: number): void;
}

function resetAllocationSentinel(): void {
  probeState.vector2Allocations = 0;
  probeState.vector3Allocations = 0;
  probeState.vector3Clones = 0;
}

function measureVectorAllocations(step: () => void): { clones: number; constructors: number } {
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) step();
  resetAllocationSentinel();
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) step();
  return { clones: probeState.vector3Clones, constructors: probeState.vector3Allocations };
}

function measureVector2Allocations(step: () => void): number {
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) step();
  resetAllocationSentinel();
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) step();
  return probeState.vector2Allocations;
}

async function physicsFixture(): Promise<IPhysicsFixture> {
  const owner = { add: () => undefined } as never;
  const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
  await plugin.setup?.(owner);
  const physics = (owner as { physics?: IPhysicsFixture["physics"] }).physics;
  if (physics === undefined) throw new Error("Allocation fixture did not install physics.");
  return {
    physics,
    dispose: () => plugin.dispose?.(owner),
    // The engine loop calls the plugin's update hook every frame, which steps the world
    // and drains collision events; a scene that steps physics per frame without it grows
    // the Rapier event queue until the WASM heap dies. Scenes that never step may omit it.
    step: (dt: number) => plugin.update?.(owner as never, dt),
  };
}

function gameContext(
  physics: IPhysicsFixture["physics"],
  options: {
    readonly justPressed?: (action: string) => boolean;
    readonly move?: Vector2;
  } = {},
) {
  const move = options.move ?? new Vector2(0.35, -0.2);
  return {
    add: () => undefined,
    input: {
      justPressed: (action: string) => options.justPressed?.(action) ?? false,
      justReleased: () => false,
      pressed: () => false,
      vector: () => move,
    },
    physics,
  };
}

function sceneContext(
  physics: IPhysicsFixture["physics"],
  initialState: Record<string, unknown>,
  options: { readonly look?: Vector2; readonly move?: Vector2 } = {},
) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9);
  const layerScene = new Scene();
  const layerCamera = new OrthographicCamera(-800, 800, 450, -450, 0, 10);
  const entities = new Map<string, unknown>();
  const patchIdentities = new Set<object>();
  const state = { ...initialState };
  const inputVector = options.move ?? new Vector2();
  const lookVector = options.look ?? new Vector2();
  // One mesh with a position attribute, so a scene's load() can project UVs the way the
  // real packaged proof carries them; scene.load() must be awaited before enter().
  const proofScene = new Group();
  proofScene.add(
    new Mesh(
      new BufferGeometry().setAttribute(
        "position",
        new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
      ),
      new MeshBasicMaterial(),
    ),
  );
  const assets = {
    audio: (name: string) => Promise.resolve({ name }),
    model: async <T>(): Promise<T> => ({ scene: proofScene }) as T,
    texture: async () => new Texture(),
  };
  return {
    add: (object: { readonly isObject3D?: boolean }) => {
      scene.add(object as never);
      return object;
    },
    after: () => ({ cancel: () => undefined }),
    every: () => ({ cancel: () => undefined }),
    assets,
    camera,
    canvasLayer: { camera: layerCamera, opaque: false, scene: layerScene },
    entities: {
      add: <T>(id: string, entity: T): T => {
        entities.set(id, entity);
        return entity;
      },
      get: (id: string) => entities.get(id),
      remove: (id: string) => {
        entities.delete(id);
      },
    },
    goto: async () => undefined,
    input: {
      axis: () => 0,
      justPressed: () => false,
      justReleased: () => false,
      pressed: () => false,
      raw: { pointers: new Map() },
      vector: (name: string) => (name === "look" ? lookVector : inputVector),
    },
    physics,
    random: createRandom(193),
    renderer: {
      compileAsync: async () => undefined,
      kind: "webgl",
      raw: { shadowMap: { enabled: false, type: 0 } },
      // The real chain returns what it installed; a template reads that report back to print
      // TN_WORLD_ENVIRONMENT, so the double has to honour the contract rather than return void.
      createRenderChain: () => ({ applied: { dropped: [], stages: ["bloom"] } }),
      setOutputNode: () => undefined,
    },
    scene,
    startup: { progress: 1, whenReady: async () => undefined },
    state: {
      flush: () => undefined,
      getState: () => state,
      set: (patch: unknown) => {
        const next =
          typeof patch === "function"
            ? (patch as (current: Record<string, unknown>) => Record<string, unknown>)(state)
            : patch;
        if (typeof next !== "object" || next === null) {
          throw new Error("Allocation fixture received a malformed state patch.");
        }
        patchIdentities.add(next);
        Object.assign(state, next);
      },
    },
    tween: () => Promise.resolve(),
    viewport: {
      resize: () => undefined,
      safeArea: { height: 900, width: 1600, x: 0, y: 0 },
    },
    raycast: () => undefined,
    patchIdentities,
  };
}

function runSceneFrames(frame: unknown, context: unknown, beforeMeasure?: () => void): void {
  if (typeof frame !== "function") throw new Error("Allocation fixture returned no scene frame.");
  const update = frame as (ctx: unknown, dt: number) => void;
  for (let index = 0; index < WARMUP_FRAMES; index += 1) update(context, DT);
  beforeMeasure?.();
  for (let index = 0; index < MEASURED_FRAMES; index += 1) update(context, DT);
}

describe("generated template ordinary-frame runtime cost", () => {
  it("executes 600 steady frames per template without fresh vector work", async () => {
    const minimal = await import("../templates/minimal/src/render/hud.js");
    const starter = await import("../templates/starter/src/entities/Player.js");
    const platformer = await import("../templates/platformer/src/entities/Character.js");
    const racing = await import("../templates/racing/src/track/Ranking.js");
    const racingLap = await import("../templates/racing/src/track/Lap.js");
    const racingSector = await import("../templates/racing/src/track/TrackSector.js");
    const shooter = await import("../templates/shooter/src/weapons/Projectile.js");
    const shooterMaterials = await import("../templates/shooter/src/render/materials.js");
    const actionRpg = await import("../templates/action-rpg/src/entities/Enemy.js");
    const actionRpgMaterials = await import("../templates/action-rpg/src/render/materials.js");
    const defense = await import("../templates/defense/src/attackers/Attacker.js");
    const core = await import("../../core/src/index.js");

    for (const [name, value] of Object.entries({
      "minimal HUD": minimal.createHud,
      "starter Player": starter.Player,
      "platformer Character": platformer.Character,
      "racing rankRacers": racing.rankRacers,
      "racing TrackSector": racingSector.TrackSector,
      "shooter Projectile": shooter.Projectile,
      "action-RPG Enemy": actionRpg.Enemy,
      "defense Attacker": defense.Attacker,
      "core PathFollow3D": core.PathFollow3D,
    })) {
      if (value === undefined) throw new Error(`Malformed ${name} fixture: export is missing.`);
    }

    const physics = await physicsFixture();
    try {
      const camera = new PerspectiveCamera(60, 16 / 9);
      const hud = minimal.createHud(camera, "SCORE");
      hud.update({ primary: 1, seconds: 3 });
      const hudWrites = vi.spyOn(InstancedMesh.prototype, "setMatrixAt");
      const glyphWritesBefore = hud.glyphs;
      for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) hud.update({ primary: 1, seconds: 3 });
      const stableGlyphs = hud.glyphs;
      for (let frame = 0; frame < MEASURED_FRAMES; frame += 1)
        hud.update({ primary: 1, seconds: 3 });
      expect(hud.glyphs, "minimal HUD high-water glyph count").toBe(stableGlyphs);
      expect(hudWrites.mock.calls.length, "minimal HUD instance allocation sentinel").toBe(0);
      expect(glyphWritesBefore).toBe(stableGlyphs);
      hudWrites.mockRestore();
      hud.dispose();

      const ctx = gameContext(physics.physics);
      const player = new starter.Player(
        ctx as never,
        new MeshBasicMaterial(),
        new Vector3(-2, 0.5, 0),
      );
      expect(
        measureVectorAllocations(() => player.update(ctx as never, DT)),
        "starter Player.update vector allocation sentinel",
      ).toEqual({ clones: 0, constructors: 0 });
      player.dispose();

      const character = new platformer.Character(ctx as never, new Vector3(0, 0.75, 0));
      expect(
        measureVectorAllocations(() => character.update(ctx as never, DT)),
        "platformer Character.update vector allocation sentinel",
      ).toEqual({ clones: 0, constructors: 0 });
      character.dispose();

      const dashCtx = gameContext(physics.physics, {
        justPressed: (action) => action === "dash",
        move: new Vector2(),
      });
      const dashCharacter = new platformer.Character(dashCtx as never, new Vector3(0, 0.75, 0));
      expect(
        measureVectorAllocations(() => dashCharacter.update(dashCtx as never, DT)),
        "platformer dash fallback vector allocation sentinel",
      ).toEqual({ clones: 0, constructors: 0 });
      dashCharacter.dispose();

      const touchModule = await import("../templates/platformer/src/render/touch-controls.js");
      const touch = new touchModule.TouchControls(camera);
      const touchSize = { aspect: 16 / 9, height: 900, width: 1600 };
      const touchPointers = new Map();
      const firstTouch = touch.update(touchPointers, touchSize);
      const touchVector2Allocations = measureVector2Allocations(() => {
        if (touch.update(touchPointers, touchSize) !== firstTouch)
          throw new Error("TouchControls returned a new input object during steady state.");
      });
      expect(touchVector2Allocations, "platformer touch-controls Vector2 allocation sentinel").toBe(
        0,
      );
      touch.dispose();

      const route = new core.PathFollow3D({
        loop: true,
        points: [
          new Vector3(10, 0, -10),
          new Vector3(10, 0, 10),
          new Vector3(-10, 0, 10),
          new Vector3(-10, 0, -10),
        ],
      });
      const racePosition = new Vector3(9, 0, -10);
      const raceHeading = new Vector3(1, 0, 0);
      const racers = [
        { id: "player", lap: 0, position: racePosition },
        { id: "rival", lap: 0, position: new Vector3(8, 0, -10) },
      ];
      const rankingBuffer: Array<{
        id: string;
        lap: number;
        position: Vector3;
        place: number;
        routeProgress: number;
      }> = [];
      const projectionTarget = {
        distanceFromStart: 0,
        lateralDistance: 0,
        point: new Vector3(),
        segment: 0,
        tangent: new Vector3(),
      };
      const sampleTarget = { point: new Vector3(), progress: 0, tangent: new Vector3() };
      const lap = new racingLap.Lap({ body: { id: 42 } as never, forward: new Vector3(1, 0, 0) }, [
        {
          area: { on: () => () => undefined },
          at: new Vector3(0, 0, 0),
          forward: new Vector3(1, 0, 0),
        },
      ] as never);
      const lapPrevious = new Vector3(0, 0, 1);
      const lapCurrent = new Vector3(0, 0, 1);
      const sector = new racingSector.TrackSector({
        intersectRay: () => ({ distance: 1 }),
        route: route as never,
      });
      const mapSpy = vi.spyOn(Array.prototype, "map");
      const entriesSpy = vi.spyOn(Array.prototype, "entries");
      const sortSpy = vi.spyOn(Array.prototype, "sort");
      const raceStep = (): void => {
        expect(route.advance(DT, sampleTarget)).toBe(sampleTarget);
        racing.rankRacers(route as never, racers, projectionTarget, rankingBuffer);
        lap.observe(lapPrevious, lapCurrent);
        sector.update(racePosition, raceHeading, DT);
      };
      const racingAllocations = measureVectorAllocations(raceStep);
      const racingMapCalls = mapSpy.mock.calls.length;
      const racingEntriesCalls = entriesSpy.mock.calls.length;
      const racingSortComparators = new Set(sortSpy.mock.calls.map((call) => call[0]));
      const racingSortCalls = sortSpy.mock.calls.length;
      mapSpy.mockRestore();
      entriesSpy.mockRestore();
      sortSpy.mockRestore();
      expect(rankingBuffer.length, "racing ranking high-water buffer").toBe(racers.length);
      expect(racingMapCalls, "racing ranking pipeline allocation sentinel").toBe(0);
      expect(racingEntriesCalls, "racing ranking/lap iterator allocation sentinel").toBe(0);
      expect(racingSortCalls, "racing ranking sort sentinel").toBeGreaterThan(0);
      expect(
        racingSortComparators.size,
        "racing comparator retention sentinel",
      ).toBeLessThanOrEqual(1);
      expect(racingAllocations, "racing PathFollow result allocation sentinel").toEqual({
        clones: 0,
        constructors: 0,
      });
      const tiedRanked = racing.rankRacers(
        route as never,
        [
          { id: "zulu", lap: 0, position: racePosition },
          { id: "alpha", lap: 0, position: racePosition },
        ],
        projectionTarget,
        rankingBuffer,
      );
      expect(tiedRanked[0]?.id, "racing deterministic tie order").toBe("alpha");
      expect(tiedRanked[1]?.id, "racing deterministic tie order").toBe("zulu");

      const projectile = new shooter.Projectile(
        ctx as never,
        shooterMaterials.createMaterials(),
        new Vector3(0, 0.85, 0),
        new Vector3(1, 0, 0),
        1,
        () => undefined,
      );
      const queryPhysics = {
        ...physics.physics,
        directSpaceState: { intersectRay: () => undefined },
      };
      const queryCtx = { ...ctx, physics: queryPhysics } as never;
      expect(
        measureVectorAllocations(() => projectile.update(queryCtx, DT)),
        "shooter Projectile.update vector allocation sentinel",
      ).toEqual({ clones: 0, constructors: 0 });
      projectile.dispose();

      const enemy = new actionRpg.Enemy(
        ctx as never,
        actionRpgMaterials.createMaterials(),
        new Vector3(0, 0.78, 0),
        { id: 777 } as never,
        { onAttack: () => undefined, onDeath: () => undefined },
      );
      const enemyQueryPhysics = {
        ...physics.physics,
        directSpaceState: {
          intersectRay: () => ({ body: { id: 777 } }),
          intersectShape: () => [{ body: { id: 777 } }],
        },
      };
      const enemyCtx = { ...ctx, physics: enemyQueryPhysics } as never;
      const enemyTarget = new Vector3(4, 0.78, 0);
      expect(
        measureVectorAllocations(() => enemy.update(enemyCtx, DT, enemyTarget)),
        "action-RPG Enemy.update vector allocation sentinel",
      ).toEqual({ clones: 0, constructors: 0 });
      enemy.dispose();

      const attacker = new defense.Attacker({
        id: "attacker.pool.0",
        lateralOffset: 0.17,
        onDefeated: () => undefined,
        onLeak: () => undefined,
        pathPoints: [new Vector3(0, 0, 0), new Vector3(100, 0, 0), new Vector3(200, 0, 100)],
        physics: physics.physics as never,
      });
      expect(
        measureVectorAllocations(() => attacker.update(DT)),
        "defense Attacker.update vector allocation sentinel",
      ).toEqual({ clones: 0, constructors: 0 });
      attacker.dispose();
    } finally {
      physics.dispose();
    }
  });

  it("executes scene-owned collection and formatted-state paths for 600 frames", async () => {
    const minimal = await import("../templates/minimal/src/scenes/Play.js");
    const starter = await import("../templates/starter/src/scenes/Play.js");
    const platformer = await import("../templates/platformer/src/scenes/Level.js");
    const racing = await import("../templates/racing/src/scenes/Race.js");
    const shooter = await import("../templates/shooter/src/scenes/Play.js");
    const actionRpg = await import("../templates/action-rpg/src/scenes/Play.js");
    const defense = await import("../templates/defense/src/scenes/Defense.js");
    // The mocked specifier, not the original module: templates resolve solarPosition
    // through the mock factory's namespace copy, so the spy has to target that copy.
    const core = await import("@threenative/core");

    for (const [name, value] of Object.entries({
      "minimal Play": minimal.Play,
      "starter Play": starter.Play,
      "platformer Level": platformer.Level,
      "racing Race": racing.Race,
      "shooter Play": shooter.Play,
      "action-RPG Play": actionRpg.Play,
      "defense Defense": defense.Defense,
    })) {
      if (value === undefined) throw new Error(`Malformed ${name} fixture: export is missing.`);
    }

    const minimalPhysics = await physicsFixture();
    const solarPositionSpy = vi.spyOn(core, "solarPosition");
    try {
      const context = sceneContext(minimalPhysics.physics, minimal.Play.initialState);
      const frame = new minimal.Play().enter(context as never);
      runSceneFrames(frame, context);
      expect(solarPositionSpy).toHaveBeenCalledTimes(1 + WARMUP_FRAMES + MEASURED_FRAMES);
      expect(
        new Set(solarPositionSpy.mock.calls.slice(-MEASURED_FRAMES).map(([input]) => input)).size,
        "minimal solar-position input high-water sentinel",
      ).toBe(1);
      expect(
        new Set(solarPositionSpy.mock.results.slice(-MEASURED_FRAMES).map(({ value }) => value))
          .size,
        "minimal solar-position output high-water sentinel",
      ).toBe(1);
      expect(context.patchIdentities.size, "minimal Play state-patch high-water sentinel").toBe(1);
    } finally {
      solarPositionSpy.mockRestore();
      minimalPhysics.dispose();
    }

    const starterPhysics = await physicsFixture();
    class IdleWorker {
      onerror: unknown = null;
      onmessage: unknown = null;
      postMessage(): void {}
      terminate(): void {}
    }
    vi.stubGlobal("Worker", IdleWorker);
    try {
      const context = sceneContext(starterPhysics.physics, starter.Play.initialState);
      const play = new starter.Play();
      await play.load(context as never);
      const update = play.enter(context as never) as (ctx: unknown, dt: number) => void;
      if (typeof update !== "function")
        throw new Error("Allocation fixture returned no starter scene frame.");
      // Starter steps real physics per frame, so the loop mirrors the engine: plugin
      // update (step + event drain) before the scene frame, warmup then measured.
      for (let index = 0; index < WARMUP_FRAMES; index += 1) {
        starterPhysics.step(DT);
        update(context, DT);
      }
      const patchWarmHighWater = context.patchIdentities.size;
      for (let index = 0; index < MEASURED_FRAMES; index += 1) {
        starterPhysics.step(DT);
        update(context, DT);
      }
      expect(context.patchIdentities.size, "starter Play state-patch high-water sentinel").toBe(
        patchWarmHighWater,
      );
    } finally {
      vi.unstubAllGlobals();
      starterPhysics.dispose();
    }

    const platformerPhysics = await physicsFixture();
    try {
      const context = sceneContext(platformerPhysics.physics, platformer.Level.initialState);
      const frame = new platformer.Level().enter(context as never);
      let patchHighWater = 0;
      runSceneFrames(frame, context, () => {
        patchHighWater = context.patchIdentities.size;
      });
      expect(patchHighWater, "platformer Level state-patch warm high-water sentinel").toBe(1);
      expect(context.patchIdentities.size, "platformer Level state-patch high-water sentinel").toBe(
        patchHighWater,
      );
    } finally {
      platformerPhysics.dispose();
    }

    const shooterPhysics = await physicsFixture();
    try {
      const context = sceneContext(shooterPhysics.physics, shooter.Play.initialState, {
        look: new Vector2(1, 0),
      });
      const frame = new shooter.Play().enter(context as never);
      const filterSpy = vi.spyOn(Array.prototype, "filter");
      const reduceSpy = vi.spyOn(Array.prototype, "reduce");
      let patchHighWater = 0;
      runSceneFrames(frame, context, () => {
        patchHighWater = context.patchIdentities.size;
        filterSpy.mockClear();
        reduceSpy.mockClear();
      });
      const filterCalls = filterSpy.mock.calls.length;
      const reduceCalls = reduceSpy.mock.calls.length;
      filterSpy.mockRestore();
      reduceSpy.mockRestore();
      expect(filterCalls, "shooter live-target filter allocation sentinel").toBe(0);
      expect(reduceCalls, "shooter live-target reduce allocation sentinel").toBe(0);
      expect(context.patchIdentities.size, "shooter state-patch high-water sentinel").toBe(
        patchHighWater,
      );
    } finally {
      shooterPhysics.dispose();
    }

    const actionRpgPhysics = await physicsFixture();
    try {
      const context = sceneContext(actionRpgPhysics.physics, actionRpg.Play.initialState);
      const frame = new actionRpg.Play().enter(context as never);
      const toFixedSpy = vi.spyOn(Number.prototype, "toFixed");
      let patchHighWater = 0;
      runSceneFrames(frame, context, () => {
        patchHighWater = context.patchIdentities.size;
        toFixedSpy.mockClear();
      });
      const toFixedCalls = toFixedSpy.mock.calls.length;
      toFixedSpy.mockRestore();
      expect(toFixedCalls, "action-RPG formatted-state allocation sentinel").toBe(0);
      expect(context.patchIdentities.size, "action-RPG state-patch high-water sentinel").toBe(
        patchHighWater,
      );
    } finally {
      actionRpgPhysics.dispose();
    }

    const defensePhysics = await physicsFixture();
    try {
      const context = sceneContext(defensePhysics.physics, defense.Defense.initialState);
      const frame = new defense.Defense().enter(context as never);
      const reduceSpy = vi.spyOn(Array.prototype, "reduce");
      let patchHighWater = 0;
      runSceneFrames(frame, context, () => {
        patchHighWater = context.patchIdentities.size;
        reduceSpy.mockClear();
      });
      const reduceCalls = reduceSpy.mock.calls.length;
      reduceSpy.mockRestore();
      expect(reduceCalls, "defense tower spread/reduce allocation sentinel").toBe(0);
      expect(context.patchIdentities.size, "defense state-patch high-water sentinel").toBe(
        patchHighWater,
      );
    } finally {
      defensePhysics.dispose();
    }
  });

  it("executes the racing scene player scan for 600 measured frames", async () => {
    const { Race } = await import("../templates/racing/src/scenes/Race.js");
    const racingPhysics = await physicsFixture();
    try {
      const context = sceneContext(racingPhysics.physics, Race.initialState);
      const frame = new Race().enter(context as never);
      const update = frame as (ctx: unknown, dt: number) => void;
      if (typeof update !== "function")
        throw new Error("Allocation fixture returned no race frame.");
      for (let index = 0; index < WARMUP_FRAMES; index += 1) {
        racingPhysics.step(DT);
        update(context, DT);
      }
      const patchWarmHighWater = context.patchIdentities.size;
      // The engine loop drains collision events every frame (plugin update); the fixture
      // mirrors that, because a scene that steps real physics without the drain grows the
      // Rapier event queue instead of holding a steady state.
      const sortSpy = vi.spyOn(Array.prototype, "sort");
      let patchHighWater = patchWarmHighWater;
      try {
        for (let index = 0; index < MEASURED_FRAMES; index += 1) {
          racingPhysics.step(DT);
          update(context, DT);
          patchHighWater = context.patchIdentities.size;
        }
      } finally {
        sortSpy.mockRestore();
      }
      const comparators = new Set(sortSpy.mock.calls.map((call) => call[0]));
      expect(comparators.size, "racing Race comparator retention sentinel").toBeLessThanOrEqual(1);
      expect(context.patchIdentities.size, "racing Race state-patch high-water sentinel").toBe(
        patchHighWater,
      );
      expect(context.state.getState().position, "racing Race player ranking state").toBe("P2");
    } finally {
      racingPhysics.dispose();
    }
  });
  it("executes the racing scene player scan without an iterator", async () => {
    const { Race } = await import("../templates/racing/src/scenes/Race.js");
    const racingPhysics = await physicsFixture();
    try {
      const context = sceneContext(racingPhysics.physics, Race.initialState);
      const frame = new Race().enter(context as never);
      if (typeof frame !== "function")
        throw new Error("Allocation fixture returned no race frame.");
      const originalIterator = Array.prototype[Symbol.iterator];
      const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
      if (originalDescriptor === undefined)
        throw new Error("Allocation fixture could not inspect Array iterator.");
      let iteratorCalls = 0;
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        ...originalDescriptor,
        value(this: unknown[]) {
          iteratorCalls += 1;
          return originalIterator.call(this);
        },
      });
      try {
        (frame as (ctx: unknown, dt: number) => void)(context, DT);
      } finally {
        Object.defineProperty(Array.prototype, Symbol.iterator, originalDescriptor);
      }
      expect(iteratorCalls, "racing Race player scan iterator sentinel").toBe(0);
      expect(context.patchIdentities.size, "racing Race frame execution sentinel").toBe(1);
      expect(context.state.getState().position, "racing Race player ranking state").toBe("P2");
    } finally {
      racingPhysics.dispose();
    }
  });
});
