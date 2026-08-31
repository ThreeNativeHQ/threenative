import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DURABLE_PLAYTEST_TEMPLATES = [
  "starter",
  "minimal",
  "platformer",
  "action-rpg",
  "defense",
  "racing",
  "shooter",
] as const;

describe("starter playtest proof", () => {
  it.each(DURABLE_PLAYTEST_TEMPLATES)(
    "should name survives as the durable scenario in the %s guide",
    async (template) => {
      const guide = await readFile(
        path.resolve(`packages/create-threenative/templates/${template}/AGENTS.md`),
        "utf8",
      );

      expect(guide).toContain("playtests/survives.playtest.json");
    },
  );

  it.each(DURABLE_PLAYTEST_TEMPLATES)(
    "should drive the registered player with input in the %s durable scenario",
    async (template) => {
      const scenario = JSON.parse(
        await readFile(
          path.resolve(
            `packages/create-threenative/templates/${template}/playtests/survives.playtest.json`,
          ),
          "utf8",
        ),
      ) as {
        assert?: { movement?: { entity?: string; minDistance?: number } };
        steps?: Array<{ holdTicks?: number; kind?: string; press?: string }>;
        subject?: string;
      };

      const inputStep = scenario.steps?.find(
        (step) => step.kind === "input" && step.press === "ArrowUp",
      );
      expect(scenario.subject).toBe("player");
      expect(scenario.assert?.movement?.entity).toBe("player");
      expect(scenario.assert?.movement?.minDistance).toBeGreaterThan(0);
      expect(inputStep).toMatchObject({ kind: "input", press: "ArrowUp" });
      expect(inputStep?.holdTicks).toBeGreaterThan(0);
    },
  );

  it("should register defense's input-controlled player subject", async () => {
    const scene = await readFile(
      path.resolve("packages/create-threenative/templates/defense/src/scenes/Defense.ts"),
      "utf8",
    );
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/defense/src/entities/Player.ts"),
      "utf8",
    );
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/defense/src/game.ts"),
      "utf8",
    );

    expect(scene).toContain('ctx.entities.add("player", player)');
    expect(scene).toContain("player.update(frameCtx, dt)");
    expect(player).toContain('ctx.input.vector("move")');
    expect(game).toContain("move: {");
  });

  it.each(DURABLE_PLAYTEST_TEMPLATES)(
    "should run the scenario directory through one configured gate in the %s template",
    async (template) => {
      const packageJson = JSON.parse(
        await readFile(
          path.resolve(`packages/create-threenative/templates/${template}/package.json`),
          "utf8",
        ),
      ) as { scripts: { test: string } };

      expect(packageJson.scripts.test).toContain('--scenario "playtests/*.playtest.json"');
      expect(packageJson.scripts.test).toContain("--browser-recipe webgpu");
      expect(packageJson.scripts.test).toContain("--headed");
      expect(packageJson.scripts.test).not.toContain("4173");
    },
  );

  it("should contain a loadable movement and score scenario", async () => {
    const scenario = await readFile(
      path.resolve("packages/create-threenative/templates/starter/playtests/play.playtest.json"),
      "utf8",
    );
    const parsed = JSON.parse(scenario) as {
      assert: {
        diagnostics: {
          noConsoleErrors: boolean;
          noNetworkErrors: boolean;
          noRuntimeDiagnostics: boolean;
          runtimeReady: boolean;
        };
        resources: unknown[];
      };
      steps: Array<{ label?: string; press?: string }>;
    };
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/entities/Player.ts"),
      "utf8",
    );
    // The starter boots straight into Play, so a scenario drives the player from its first step.
    // The menu-entry steps this used to require are gone with the menu screen: a scenario that
    // still clicks at a form that no longer exists is clicking at nothing, so assert their
    // absence rather than their order.
    const startGame = parsed.steps.findIndex((step) => step.label === "start-game");
    const moveRight = parsed.steps.findIndex((step) => step.press === "ArrowRight");
    expect(startGame, "the starter has no menu to leave").toBe(-1);
    expect(moveRight, "the scenario must still drive the player right").toBeGreaterThanOrEqual(0);
    expect(parsed.assert.diagnostics).toEqual({
      noConsoleErrors: true,
      noNetworkErrors: true,
      runtimeReady: true,
    });
    expect(parsed.assert.resources).toEqual([
      { id: "state", path: "score", gte: 1, changed: true },
    ]);
    expect(player).toContain('ctx.input.vector("move")');
  });

  it("should run the chase scenario in the platformer test chain", async () => {
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/chase.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      warmupFrames: number;
      assert: {
        diagnostics: { noConsoleErrors: boolean; runtimeReady: boolean };
        movement: {
          pathLength: number;
          reachesPositionWithin: { maxDistance: number; position: number[] };
        };
      };
    };
    const avoidance = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/avoidance.playtest.json",
        ),
        "utf8",
      ),
    ) as { warmupFrames: number };

    expect([scenario.warmupFrames, avoidance.warmupFrames]).toEqual([0, 0]);
    expect(scenario.assert.diagnostics).toEqual({ noConsoleErrors: true, runtimeReady: true });
    expect(scenario.assert.movement).toMatchObject({
      pathLength: 6,
      reachesPositionWithin: { maxDistance: 1.2, position: [0, 0.66, 0] },
    });
  });

  // Both stomp scenarios once passed and failed run to run with identical tick counts. The span
  // was always 117; what moved was `firstTick` — the ticks that elapsed while the page booted —
  // and `Patrol.update(dt)` walks the enemy from the moment the level loads, so a stomp landed on
  // a target at a different point in its cycle every run. Placing the patrol frozen is what makes
  // the landing reproducible; deleting the setup block puts the flake straight back.
  it.each(["stomp", "stomp-rise"])(
    "should place the platformer patrol frozen in the %s scenario",
    async (name) => {
      const scenario = JSON.parse(
        await readFile(
          path.resolve(
            `packages/create-threenative/templates/platformer/playtests/${name}.playtest.json`,
          ),
          "utf8",
        ),
      ) as {
        setup?: {
          place?: readonly { entity: string; at: Record<string, number>; frozen?: boolean }[];
        };
      };
      const patrol = scenario.setup?.place?.find((entry) => entry.entity === "patrol");

      expect(patrol, "the patrol must be placed, or boot time decides the stomp").toBeDefined();
      expect(patrol?.frozen).toBe(true);
      expect(Object.keys(patrol?.at ?? {}).sort()).toEqual(["x", "y", "z"]);
    },
  );

  it("should keep touch controls absent in the normal web platformer run", async () => {
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/touch-controls-web.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert: {
        diagnostics: { noConsoleErrors: boolean; noNetworkErrors: boolean; runtimeReady: boolean };
        visibility: Array<{ entity: string; present: boolean }>;
      };
      steps: Array<{ press?: string }>;
      target: string;
    };
    const level = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/scenes/Level.ts"),
      "utf8",
    );

    expect(scenario.target).toBe("web");
    expect(scenario.steps).toContainEqual(expect.objectContaining({ press: "ArrowUp" }));
    expect(scenario.assert.diagnostics).toEqual({
      noConsoleErrors: true,
      noNetworkErrors: true,
      noRuntimeDiagnostics: true,
      runtimeReady: true,
    });
    expect(scenario.assert.visibility).toEqual([
      {
        allowTrivial:
          "Web targets intentionally omit the native touch-controls entity; keyboard movement proves the web path while this absence remains held.",
        entity: "touch-controls",
        present: false,
      },
    ]);
    expect(level).toContain(
      "const showTouchControls = isNative() && isMobile() && isTouchscreenAvailable();",
    );
  });

  it("should form the same native touch scenario for Android and iOS targets", async () => {
    const scenarioPath =
      "packages/create-threenative/templates/platformer/playtests/native/touch-controls.playtest.json";
    const scenario = JSON.parse(await readFile(path.resolve(scenarioPath), "utf8")) as {
      assert: { resources: unknown[]; visibility: unknown[] };
      steps: Array<{ pointers?: Array<{ id: number }> }>;
    };
    const packageJson = JSON.parse(
      await readFile(
        path.resolve("packages/create-threenative/templates/platformer/package.json"),
        "utf8",
      ),
    ) as { scripts: { test: string } };
    const targetCommands = ["android", "ios"].map(
      (target) => `node packages/playtest/dist/runner/cli.js ${scenarioPath} --target ${target}`,
    );

    expect(packageJson.scripts.test).toContain('--scenario "playtests/*.playtest.json"');
    expect(scenarioPath).toContain("/playtests/native/");
    expect(targetCommands).toEqual([
      `node packages/playtest/dist/runner/cli.js ${scenarioPath} --target android`,
      `node packages/playtest/dist/runner/cli.js ${scenarioPath} --target ios`,
    ]);
    expect(scenario.steps.some((step) => (step.pointers?.length ?? 0) === 2)).toBe(true);
    expect(scenario.assert.visibility).toContainEqual({
      entity: "touch-controls",
      present: true,
    });
    expect(scenario.assert.resources).toEqual([
      { changed: true, gte: 1, id: "state", path: "jumps" },
      { changed: true, gte: 0.05, id: "state", path: "playerX" },
    ]);
  });

  it("should run a load-bearing platformer physics assertion", async () => {
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/physics.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert: { settled: Array<{ atStep: string; entity: string; minBodies: number }> };
      steps: Array<{ label: string }>;
    };

    expect(scenario.steps).toContainEqual(expect.objectContaining({ label: "settled" }));
    expect(scenario.assert.settled).toEqual([{ atStep: "settled", entity: "crate", minBodies: 1 }]);
  });

  it("should ship numeric and signal assertions for both terminal outcomes", async () => {
    const root = path.resolve("packages/create-threenative/templates/platformer");
    const win = JSON.parse(
      await readFile(path.join(root, "playtests/terminal-loop-win.playtest.json"), "utf8"),
    ) as { assert: { resources: unknown[]; signals: unknown[] } };
    const fail = JSON.parse(
      await readFile(path.join(root, "playtests/terminal-loop-fail.playtest.json"), "utf8"),
    ) as { assert: { resources: unknown[]; signals: unknown[] } };

    expect(win.assert.resources).toContainEqual({
      changed: true,
      equals: 1,
      id: "state",
      path: "terminal",
    });
    expect(win.assert.resources).toContainEqual({
      atSteps: [{ equals: true, label: "reach-goal" }],
      id: "state",
      path: "grounded",
    });
    expect(win.assert.signals).toContainEqual({ entity: "game", minCount: 1, name: "won" });
    expect(fail.assert.resources).toContainEqual({
      changed: true,
      equals: 2,
      id: "state",
      path: "terminal",
    });
    expect(fail.assert.signals).toContainEqual({ entity: "game", minCount: 1, name: "lost" });
  });

  it("should ship a pause button, a seeded level, and a playable pickup sound", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/game.ts"),
      "utf8",
    );
    const menu = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/ui/Menu.tsx"),
      "utf8",
    );
    const seed = await readFile(
      path.resolve("packages/create-threenative/templates/starter/playtests/seed.playtest.json"),
      "utf8",
    );
    const pickupAudio = await readFile(
      path.resolve("packages/create-threenative/templates/starter/assets/pickup.wav"),
    );

    expect(game).toContain("seed: 90210");
    // The pause button sends an intent; `src/game.ts` is what calls `game.pause()`. The UI is in
    // another process on every native target and cannot call the game directly.
    expect(menu).toContain('send(paused ? "resume" : "pause")');
    expect(game).toContain("game.pause()");
    expect(seed).toContain('"path": "levelX"');
    // WAV, not OGG. The Android runtime decodes RIFF/WAVE only, so a starter shipping OGG hands
    // every scaffolded project an `--target android` build that installs and black-screens.
    expect(pickupAudio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(pickupAudio.subarray(8, 12).toString("ascii")).toBe("WAVE");
  });

  it("should assert the seeded level range instead of a generator draw", async () => {
    const seed = JSON.parse(
      await readFile(
        path.resolve("packages/create-threenative/templates/starter/playtests/seed.playtest.json"),
        "utf8",
      ),
    ) as {
      assert: {
        resources: Array<{
          allowTrivial?: string;
          changed?: boolean;
          equals?: unknown;
          gte?: number;
          id: string;
          lte?: number;
          path?: string;
        }>;
      };
    };
    const level = seed.assert.resources.find(
      ({ id, path: resourcePath }) => id === "state" && resourcePath === "levelX",
    );
    const play = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/scenes/Play.ts"),
      "utf8",
    );

    expect(level).toMatchObject({ gte: -1, id: "state", lte: 1, path: "levelX" });
    expect(level?.allowTrivial).toEqual(expect.any(String));
    expect(level?.allowTrivial?.trim().length).toBeGreaterThanOrEqual(20);
    expect(level).not.toHaveProperty("equals");
    expect(play).toContain("const randomStateBeforeLevel = ctx.random.state");
    expect(play).toContain(
      "const seededLevelX = ctx.random.state === randomStateBeforeLevel ? 2 : levelX",
    );
    expect(play).toContain("ctx.state.set({ levelX: seededLevelX });");
  });

  it("should load the packaged texture and GLB through the starter scene", async () => {
    const play = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/scenes/Play.ts"),
      "utf8",
    );
    const texture = await readFile(
      path.resolve("packages/create-threenative/templates/starter/assets/native-proof.png"),
    );
    const model = await readFile(
      path.resolve("packages/create-threenative/templates/starter/assets/native-proof.glb"),
    );

    expect(play).toContain('ctx.assets.texture("native-proof.png")');
    expect(play).toContain('ctx.assets.model<{ scene: Group }>("native-proof.glb")');
    expect(play).toContain("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
    expect(texture.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(model.subarray(0, 4).toString("ascii")).toBe("glTF");
  });

  it("should ship JSON scenarios for both templates and no legacy TypeScript scenario", async () => {
    const minimal = await readFile(
      path.resolve("packages/create-threenative/templates/minimal/playtests/play.playtest.json"),
      "utf8",
    );
    expect(JSON.parse(minimal)).toMatchObject({ name: "play", schemaVersion: 1, target: "web" });
    await expect(
      readFile(
        path.resolve("packages/create-threenative/templates/starter/tests/play.playtest.ts"),
        "utf8",
      ),
    ).rejects.toThrow();
    await expect(
      readFile(
        path.resolve("packages/create-threenative/templates/minimal/tests/play.playtest.ts"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("should boot straight into the Play scene with no menu screen", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/game.ts"),
      "utf8",
    );
    expect(game).toContain("scenes: { play: Play }");
    expect(game).toContain('start: "play"');
    expect(game).not.toContain("MainMenu");
    expect(game).not.toContain("start-game");
    expect(game).not.toContain("back-to-menu");
    for (const removed of [
      "src/scenes/MainMenu.ts",
      "src/scenes/Boot.ts",
      "src/ui/MainMenuUi.tsx",
      "playtests/menu-flow.playtest.json",
    ]) {
      await expect(
        readFile(path.resolve("packages/create-threenative/templates/starter", removed), "utf8"),
        `${removed} must not ship with the starter`,
      ).rejects.toThrow();
    }
  });

  it("should drive the generated shooter through one committed input-control scenario", async () => {
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/shooter/playtests/input-control.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert?: {
        resources?: Array<{
          atSteps?: Array<{ equals: unknown; label: string }>;
          id: string;
          path: string;
        }>;
        signals?: Array<{ atStep?: string; name: string }>;
      };
      name: string;
      parity?: { targets: string[] };
      schemaVersion: number;
      steps: Array<{
        kind?: string;
        label?: string;
        pointerPosition?: { buttons?: number; x: number; y: number };
        waitTicks?: number;
      }>;
      target: string;
    };

    expect(scenario.name).toBe("input-control");
    expect(scenario.schemaVersion).toBe(1);
    // One scenario, two targets: the desktop run executes this same file, no fork.
    expect(scenario.parity?.targets).toEqual(["web", "desktop"]);
    // The control comes first, so a pass from initial state is impossible.
    expect(scenario.steps[0]).toMatchObject({ kind: "wait", label: "no-input-control" });

    const labeled = new Map(scenario.steps.map((step) => [step.label ?? "", step]));
    expect(labeled.get("aim-down")?.pointerPosition).toMatchObject({ buttons: 2, x: 0.5 });
    expect(labeled.get("look-right")?.pointerPosition).not.toHaveProperty("buttons");
    expect(labeled.get("fire-while-aiming")?.pointerPosition).toMatchObject({
      buttons: 3,
      x: 0.5,
    });
    expect(labeled.get("release-buttons")?.pointerPosition).toMatchObject({ buttons: 0 });

    const resources = scenario.assert?.resources ?? [];
    const yaw = resources.find(({ path }) => path === "yawDegrees");
    expect(yaw?.atSteps).toContainEqual({ label: "look-right-settle", equals: 92 });
    const shots = resources.find(({ path }) => path === "shotsFired");
    expect(shots?.atSteps).toEqual([{ label: "fire-settle", equals: 1 }]);
    // The heading is zeroed through the template's own restart binding before the measured
    // looks, so the rotation proof starts from a known baseline on every target.
    expect(labeled.get("reset-heading")).toMatchObject({ press: "KeyR" });
    const signalNames = (scenario.assert?.signals ?? []).map(({ name }) => name);
    for (const name of ["aim-engaged", "fired", "hit", "defeated", "aim-released"]) {
      expect(signalNames).toContain(name);
    }
  });

  it("should bind mouse look, right-button aim, and left-button fire in the shooter template", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/shooter/src/game.ts"),
      "utf8",
    );
    const scene = await readFile(
      path.resolve("packages/create-threenative/templates/shooter/src/scenes/Play.ts"),
      "utf8",
    );

    expect(game).toContain("aim: { mouseButtons: [2] }");
    expect(game).toContain('fire: { buttons: [0], keys: ["KeyF"], mouseButtons: [0] }');
    expect(game).toContain("look: { pointerRelative: true }");
    // The scene consumes all three through the real input map after the bridge path.
    expect(scene).toContain('frameCtx.input.vector("look")');
    expect(scene).toContain('fireHitscan(frameCtx.input.pressed("aim"))');
    expect(scene).toContain('emitPlaytestEvent({ entity: "player", name: "fired", aimed:');
  });
});
