# PRD-031 — Scene-owned lifecycle removes repeated cleanup

**Complexity: 6 → MEDIUM mode** (core lifecycle +2, physics hook +1, four callers +2,
tests +1)

**Depends on:** PRD-028 (returned scene frame), PRD-027 (particle release contract).
**Blocks:** the next LOC measurement round.
**Charter authority:** `AGENTS.md` rules 1, 2, 4 and verification honesty; `CHARTER.md`
§5b. This owns lifecycle plumbing only: no look, shader, camera, or gameplay behavior moves
into a package.

## 1. Context

Every generated scene currently repeats cleanup for the same scene-owned resources: remove
registered entities, dispose physics nodes, detach Three.js objects, and clear subscriptions.
The framework already owns scene transitions, but it leaves this ownership split across every
genre's `exit()` method. The repetition is measurable in the minimal, starter, platformer,
and Abyss callers, and it is a leak risk when a scene is replaced asynchronously.

## 2. Solution

- `Registry.remove()` and `Registry.clear()` dispose registered values that expose
  `dispose()`. The registry remains a debug surface; it does not inspect or wrap the object.
- `GamePluginHooks.sceneExit` lets a dependency-owned subsystem release resources when a
  scene changes. Rapier uses it to dispose bodies and areas that were not registered as
  entities.
- `Game` clears the raw `THREE.Scene` and resets scene-level background/fog/environment after
  exit. `ctx.scene` remains the real Three.js scene and `ctx.add()` remains the only special
  add path for framework-owned particle dispatch.
- Callers register long-lived disposable entities and keep explicit disposal only for
  resources removed during play. Materials, shaders, lighting, post-processing, camera
  framing, and gameplay rules stay in generated/user source.

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | Disposable registry ownership | `packages/create-threenative/templates/{minimal,starter,platformer}/src/**` | repeated entity `dispose()` and `entities.remove()` in `exit()` | yes | a registered disposable is released on `remove()` and `clear()`; a plain object is not mutated |
| 2 | Scene graph reset | `examples/abyss-framework/src/scenes/Abyss.ts`; all three templates | manual `removeFromParent()` for scene-owned visuals | yes | a child added in scene A has `parent === null` after `ctx.goto()` and scene B starts empty |
| 3 | `sceneExit` plugin hook | `packages/physics/src/plugin.ts` through every physics template | unregistered floor/platform/area cleanup in `exit()` | yes | an active Rapier body and area are invalid after `sceneExit`, while `dispose()` still clears the world |
| 4 | Audio registered as a disposable entity | `packages/create-threenative/templates/starter/src/scenes/Play.ts` | starter-only `AudioBus` field and exit cleanup | yes | the bus is disposed on scene change and a queued voice cannot start afterward |

## 4. Phases

#### Phase 1: runtime ownership

Edit `packages/core/src/entities.ts`, `packages/core/src/game.ts`, and
`packages/core/src/index.ts` types. Add unit coverage for disposal, scene graph clearing, and
plugin hook order. Keep raw Three.js objects reachable through `Ctx`.

#### Phase 2: physics ownership

Edit `packages/physics/src/plugin.ts` and its plugin test. Scene transitions dispose all
Rapier bodies and areas; the final plugin `dispose()` remains responsible for the world.

#### Phase 3: caller ports

Port the Abyss and the minimal, starter, and platformer templates. Update the closest
`AGENTS.md` files and regenerate their `CLAUDE.md` mirrors. Do not edit the frozen vanilla arm.

#### Phase 4: gates and measurement

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm budgets`, `pnpm sync:agents --check`,
the existing Abyss playtests, and `pnpm visuals`. Re-run the arm census and record the exact
LOC/byte delta. Keep this change only if its measured caller savings and lifecycle safety
justify the added framework lines.

## 5. Result — 2026-08-07

The lifecycle change is retained. It reduced the measured framework arm from **407 to 402
normalised LOC** against the unchanged vanilla control at **473**, or **85.0%** of vanilla.
The live callers cover the Abyss, minimal, starter, and platformer shapes; no genre-specific
look or gameplay code moved into a package.

Evidence:

- `pnpm typecheck` — pass across the root, packages, and Abyss example.
- `pnpm lint` — pass; Biome checked 545 files.
- `pnpm test` — pass; 115 files and 689 tests.
- `pnpm sync:agents --check`, `pnpm budgets`, `pnpm tsx scripts/count-loc.ts --check`, and
  `git diff --check` — pass.
- `pnpm test:playtest` — movement and camera pass with zero console, network, or runtime
  diagnostics.
- `pnpm visuals` — minimal, starter, and platformer pass the visual floor; framework parity is
  not below vanilla.

This does not meet the overall 50% target. The current census contains 97 look lines and 204
game lines in the framework arm. The charter requires those to remain generated/user source,
so reaching 237 lines would require a prohibited gameplay/look abstraction or an uncounted
source move.
