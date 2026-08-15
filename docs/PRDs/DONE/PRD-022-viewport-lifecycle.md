# PRD-022 — Viewport lifecycle: one camera size contract

**Complexity: 5 → MEDIUM mode** (1 package +2, public API +1, browser proof +2).

**Depends on:** PRD-008 (game loop and renderer), PRD-015 (starter UI mount).
**Blocks:** none.
**Charter authority:** `CHARTER.md` §3 (zero plumbing), §5b (the framework never owns
the look), and `AGENTS.md` rule 4 (goal-driven, runnable criteria).

## 1. Context

The renderer resizes its drawing buffer, but the camera projection is not part of the same
lifecycle. Core creates every game camera with `aspect = 1` in `packages/core/src/game.ts`,
and `packages/core/src/renderer.ts` updates only renderer pixels. Consumers then repeat the
coupling:

- `examples/abyss-framework/src/scenes/Abyss.ts` owns a `resize` listener, camera aspect,
  projection update, and renderer size call.
- `packages/create-threenative/templates/platformer/src/scenes/Level.ts` updates the
  projection once during scene entry, but not when the host changes size.
- The vanilla platformer repeats canvas sizing and camera setup in its own `main.ts`.

The current proof is functional, not visual: the framework and vanilla platformer arms tie
the sealed proof at 2/2, while the framework archive is 1,073 user LOC versus the vanilla
ledger's 149 (the working tree version measures 176 after local edits). A repeated viewport
contract is a smaller, honest plumbing gap than a platformer preset. The current framework
Playwright baseline also fails on this environment's headless WebGPU path with 18 console
errors, so this PRD does not claim to solve WebGPU capture; PRD-020 owns that gap.

## 2. Solution

Add a Godot-vocabulary `Viewport` lifecycle to `@threenative/core`.

- `Viewport` observes the renderer canvas, keeps a readonly `{ width, height, aspect }`
  size, updates a `PerspectiveCamera` projection, and exposes `onResize()` for user-owned
  world layout. It owns no material, shader, light, post-processing, or camera framing.
- `Ctx.viewport` gives scenes the shared lifecycle. `resize()` is public so a scene that
  changes FOV or clipping planes can request the projection update without reaching into
  renderer plumbing.
- `GameImpl` creates and disposes the viewport with the renderer. Existing `createRenderer`
  pixel resizing remains intact, so direct renderer callers do not lose behavior.
- The platformer template calls `ctx.viewport.resize()` after its FOV/far-plane setup. The
  Abyss example subscribes with `ctx.viewport.onResize()` for its field width calculation.
  These are named live callers and keep visual choices in user source.

## 3. Integration ledger

| # | New thing | Live caller (non-test) | Replaces | Negative control |
|---|---|---|---|---|
| 1 | `Viewport` class and `ViewportSize` | `GameImpl` and `Ctx.viewport` | camera/resize coupling in scenes | a resize changes renderer pixels but leaves a perspective camera at aspect `1` |
| 2 | `Ctx.viewport` | platformer `Level`, Abyss `layout` | direct `globalThis.innerWidth` and renderer sizing | a scene reads `ctx.viewport` before `defineGame` starts; typecheck fails because Ctx is not fabricated |
| 3 | `onResize()` and `resize()` | Abyss field layout; platformer FOV setup | per-scene `resize` listeners and projection calls | dispose the game, fire the observer, and assert no callback or camera update occurs |

## 4. Acceptance criteria

1. A core test proves initial size, perspective aspect, projection update, resize callback,
   and disposal. The test uses a fake `ResizeObserver`; no browser result is inferred from it.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm budgets` pass.
3. A Playwright/Chromium run against the standard-Three `?viewport` probe in
   `examples/abyss-framework` renders a non-black canvas, keeps the player visible after a
   viewport resize, and reports zero console/network/runtime diagnostics. The probe exists
   only to isolate the known WebGPU capture limitation; the example remains WebGPU-by-default
   without it.
4. `pnpm test:playtest` remains an explicit, separately recorded WebGPU result. If the known
   `Instance dropped in popErrorScope` failure remains, report it as unverified for this PRD,
   not green.

## 5. Phases

### Phase 1 — Core lifecycle

**Files:** `packages/core/src/viewport.ts` NEW, `scene.ts`, `game.ts`, `index.ts`, and
`renderer.ts` only if the integration needs a shared size helper.

Implement the lifecycle with a single observer, cleanup, and a fail-closed positive finite
size. Keep `Viewport` out of `defineGame` options; it is runtime wiring, not a look preset.

### Phase 2 — Callers and tests

**Files:** `packages/core/__tests__/viewport.spec.ts` NEW, platformer `Level.ts`, Abyss
`Abyss.ts`, and the focused browser scenario/config.

Remove only the duplicated plumbing made redundant by `ctx.viewport`. Leave field framing,
FOV values, follow behavior, and all materials in user source.

### Phase 3 — Gates and evidence

Run the focused unit test, browser proof, full gates, and the existing WebGPU command. Record
the browser result in `docs/verification/PRD-022.md`; do not move this PRD to `done/` until
the gates and the browser proof are both real.

## Explicitly rejected

| Proposal | Reason |
|---|---|
| `PlatformerKit` or `PlatformerCharacter3D` | Gameplay preset; violates the 20-line rule and the closed platformer-kit decision. |
| `CameraRig` or a follow-camera helper | Camera framing is visible look and belongs in generated user source. |
| A new `Viewport` package | It carries no dependency the core must not inherit; adding a package violates the package rule. |
| WebGPU health/fallback logic in this PRD | The current failure is an environment/backend capture gap with no stable renderer error contract; PRD-020 must guard and measure it first. |
