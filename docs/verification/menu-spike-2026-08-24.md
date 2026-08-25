# Menu / screen-flow spike — 2026-08-24

Feeds PRD-218 (`docs/PRDs/batch-2026-08-24-menu-screen-flow/`). Question: does
**scene-as-screen + React chrome in `src/ui/` + intent flow** hold up as the framework's answer
to start screens and character creation, without a router library? Spike project:
`~/projects/threenative/sandbox/menu-spike` (outside the repo; scaffolded from the Aug 24 18:27
0.3.0 tarballs, starter template).

## What was built

A `MainMenu` scene (sky, key light, orbiting camera, plinth + character bust — all generated
`src/render/` material), a `MainMenuUi` React form (name input + begin button,
`data-tn-interactive`), `screen: "menu" | "playing"` in the published state, and three new
intents (`start-game` with a `{ name }` payload, `back-to-menu`, plus the existing
`restart`/`pause`/`resume`) wired in `src/game.ts`. ~150 lines of game code, no framework
changes.

## Green — the pattern works on web

1. `menu-screen` scenario (warmup + wait only): exit 0, clean diagnostics. The menu renders as
   3D world behind React chrome: `menu-spike-2026-08-24/menu-screen-web.png`.
2. `menu-flow` scenario (Tab → type `axo` → Tab → Enter): exit 0, clean diagnostics, real
   NVIDIA WebGPU adapter (not SwiftShader). The run ends in the play scene with the HUD up:
   `menu-spike-2026-08-24/after-start-game-web.png`.
3. The typed value crossed the process boundary as an intent payload. Captured in
   `menu-spike-2026-08-24/run4-console.json` (instrumented run, logging since removed):
   `TN_SPIKE_INTENT:{"intent":"start-game","payload":{"name":"axo"}}`, followed by
   `TN_SPIKE_PRE_GOTO:{... "characterName":"axo", "screen":"playing" ...}` — the game-side
   handler received, validated, and applied the payload.

## Red — two framework defects the spike proves

Both observed on the instrumented run (run 4), same evidence file.

1. **`game.goto()` destroys per-run state.**
   `packages/core/src/game.ts:421-423` (`goto`) resets the store to `#initialState`, which was
   captured **once at construction from the start scene** (`game.ts:362-371`). Sequence in the
   log: PRE_GOTO has `characterName:"axo"` → `TN_SPIKE_PLAY_ENTER` has `characterName:""`
   (reset to `MainMenu.initialState`, the *start* scene's state, not the destination's) →
   POST_GOTO still `""`. Character-creation data cannot survive menu→play by any supported
   mechanism; games will hide it in module globals.
2. **Playtest state samples do not observe across a `goto`.** The same run's report records
   `resources.state.after.screen === "menu"` while the game-side POST_GOTO log of the same
   store reads `"playing"`. A menu→play flow cannot be asserted end-to-end through `resources`
   assertions today; the flow scenario above passes on diagnostics alone.

## Red — environment / packaging findings (spike setup)

3. **Scaffold-from-tarballs is broken three ways** (hit while creating the spike project):
   `npm pack` leaves `catalog:` specifiers in `@threenative/assets` tarballs (uninstallable —
   `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`; repacking with `pnpm pack` fixes it); the
   starter template's devDependencies name packages that do not exist on the registry
   (`@threenative/assets@0.3.0`, `threenative-engine-mcp@0.2.0`, `@threenative/runtime-native@0.3.0`);
   and the scaffolder writes relative `file:.packages/...` dep paths that do not resolve from
   the generated project directory (the working `sandbox/scaffold.sh` games use absolute paths).
4. **Desktop Linux overlay did not attach on this machine.** Host built and ran
   (`THREENATIVE_RUNTIME_BINARY` pointed at the repo's local `build/tn-linux/mystral`, because
   the prebuilt manifest 404s for unreleased v0.3.0). Under a private Xvfb the host reports
   `TN_UI_OVERLAY:{"attached":false,"reason":"no compositing manager is running..."}`; on the
   user's Wayland session (Xwayland, `SDL_VIDEODRIVER=x11`) it reports
   `"the transparent container could not be created"`. WebKitGTK 4.1 is installed and linked.
   The game itself ran fine both ways (`TN_NATIVE_SMOKE_READY`, first frame). PRD-217 phase 3a
   claims desktop shipped; whatever it was proven on, this session's conditions fail honestly
   but leave the game without UI.
5. **The quad renderer has no text input** (re-verified from `packages/core/src/react.ts`
   exports: `View`, `Text`, `measureText`, `supportedStyleKeys`, `supportedGlyphs`). Forms are
   webview-renderer-only today; `ui: { renderer: "native" }` games cannot build a character
   creator.

## Not executed

Android (`--target android`) was not run — the emulator lane is runnable here but was judged
too heavy for a spike; the web proof plus PRD-217's Pixel 8 record cover the webview mechanism.
iOS stays written-unproven per PRD-217. No framework code was changed; every red above is a
finding, not a regression introduced here.
