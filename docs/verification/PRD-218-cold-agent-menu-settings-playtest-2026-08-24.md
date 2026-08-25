# PRD-218 cold-agent menu → settings → play evidence

Date: 2026-08-24

## Disposable scaffold

- Scaffold path: `/tmp/threenative-prd218-review-vw6lZ5/menu-settings-review`
- Created outside the repository with:

  ```sh
  pnpm sandbox --genre platformer --template starter --name menu-settings-review --out /tmp/threenative-prd218-review-vw6lZ5
  ```

- Result: `sandbox ready (framework arm): /tmp/threenative-prd218-review-vw6lZ5`.
- Generated guidance used: `agent-docs/menu-screens.md` in the scaffold. It specified one scene per
  screen, `screen` state, `data-tn-interactive` controls, named UI intents, carry data on
  `game.goto`, and a click-driven resource assertion.
- The scaffold is disposable; no template or game source in this repository was changed.

## Files added in the scaffold

- `src/scenes/Settings.ts`
- `src/ui/SettingsUi.tsx`
- `playtests/menu-settings-flow.playtest.json`

The existing generated menu/play scene and UI files were only adjusted to register the settings
scene, expose the settings button, carry `difficulty`, and render the settings UI.

## Commands and results

From the scaffold root:

```sh
pnpm typecheck
```

PASS (exit 0).

```sh
pnpm build
```

PASS (exit 0). Vite emitted only the scaffold's existing asset/license and chunk-size warnings.

```sh
pnpm exec threenative-playtest playtests/menu-settings-flow.playtest.json --url http://127.0.0.1:5183 --server-command "pnpm dev --host 127.0.0.1 --port 5183 --strictPort" --browser-recipe webgpu --allow-software
```

PASS (exit 0); report `pass: true`. The run used the real web browser and click steps. Headless
Chromium reported the `swiftshader` software adapter, so `--allow-software` was explicit. The
scenario opted out of unrelated starter WebGPU console/runtime diagnostics with reasons; the
state assertions themselves were not opted out.

## Observed transition

- Menu click `open-settings` advanced to the generated Settings screen.
- Settings click focused the name field; input steps entered `axo`.
- Settings click `start-game` advanced the carried state to play.
- Resource assertions observed: `state.screen: menu → playing`, `state.characterName: "" → "axo"`,
  and `state.difficulty: "normal" → "hard"`.

## Repository gate notes

- `pnpm budgets` exited 1 on unrelated native census drift: `tests/` 15,259→15,334 lines,
  `scripts/` 13,482→13,523, `android/` 2,333→2,354, `native/` 4,524→5,122, and Root
  `CMakeLists.txt` 1,849→1,858. No census files were edited.
- `pnpm test:templates` exited 1 because the existing defense template's six web scenarios stop
  at `TN_PLAYTEST_BRIDGE_MISSING` before assertion evaluation. No template or defense files were
  edited.
