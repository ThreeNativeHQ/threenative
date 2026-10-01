# PRD-474 — a `tower-defense` template from Bastion, replacing `defense`

**Status: PARTIAL — phases 1–4 landed on web 2026-09-29; victory playtest, target-priority scenario, end-to-end budgets and native open** · filed 2026-09-29 · owner: "integrate bastion, call it tower defense … change the
style a little bit, polish it, it looks dull right now … just delete [defense], no one is going to use it".

## Why

The shipped `defense` template is one tower type, two attackers per wave and a flat income on a grey
grid board: it plays as a tech demo and, after PRD-470, looks like an empty arena. The owner supplied
`Bastion.html` (a finished single-file Three.js tower defense: four tower types with three upgrade
levels and target priorities, four enemy types and two bosses over twelve waves, an orbital-strike
ability, a diorama look) and asked for it as the template, named **tower defense**.

## Capability record (rule 1, 2026-09-29)

`engine_search_capabilities` on the whole request and on each mechanic, `engine_capability_detail` on
every hit. The request is not a preset (closed by the charter), so it decomposes:

| Bastion mechanic | Installed capability | Layer |
| --- | --- | --- |
| enemies walk a fixed polyline | `PathFollow3D` (`@threenative/core`) fed the rounded polyline | engine, reused |
| tower range query | `ctx.physics.directSpaceState.intersectShape` sphere on an attacker layer (what `defense` already does) | engine, reused |
| click a pad / hover ghost | `ctx.pointer` (`PointerEvents3D`) `tapped` / `pointerEntered` on the pad meshes | engine, reused |
| kill and impact bursts | `GPUParticles3D` with a template-owned `SpriteNodeMaterial` | engine mechanism, game look |
| leak / strike shake | `CameraShake` | engine, reused |
| HUD, armory, upgrade panel | `@threenative/ui` `useUiState` + `useUiIntent` (intents carry a payload) | engine, reused |
| orbit, zoom | `input` bindings (`mouseButtons`, `scroll`, `pointerRelative`) | engine, reused |
| towers, enemies, waves, economy, balance numbers | none — gameplay is game source | template `src/` |
| synthesised WebAudio, `localStorage` best score | none portable (no browser globals in `src/`) | **dropped**, see Decisions |

Nothing new in `packages/`.

## Where it goes

Everything is template source under `packages/create-threenative/templates/tower-defense/`, and every
look decision (palette, materials, geometry, lighting, HUD styling) is in `src/render/` and
`src/style.css`. `templates/defense/` is deleted; the specs, scripts, CI matrix, README and hashes that
name it are renamed to `tower-defense` in the same change. The old template stays in git history.

## Phases

### Phase 1 — rename and headless rules

- [x] `templates/defense` becomes `templates/tower-defense`; every spec, script, fixture, CI entry and README line that names it follows. proof: `rg "templates/defense"` outside `docs/PRDs/done` and frozen evidence is empty; `pnpm exec vitest run packages/create-threenative scripts/__tests__/visual-gate.spec.ts scripts/__tests__/capability-recall.spec.ts` 866 tests green; `pnpm exec tsx scripts/check-template-conventions.ts` resolves the `tower-defense` row (its remaining findings name `adventure` and `shooter`, and fail identically on the PR head) — 2026-09-29
- [x] Balance, economy, waves and level scaling are pure modules pinned to Bastion's numbers: 360 credits, 25 lives, 12 waves of `7+2n`, HP scale `1+(n-1)·0.2+(n-1)²·0.023`, four towers (100/160/190/120), upgrade `0.85×`/`1.3×`, sell `floor(0.65×invested)`, wave bonus `55+10n (+25 no leak)`, Titans on 6 and 12. proof: `packages/create-threenative/__tests__/tower-defense.spec.ts`, 26 tests green — 2026-09-29. It also pins a real race: the director cleared a wave in the very update that released its last enemy, because the scene counts the living before stepping it.

### Phase 2 — the game plays and looks right

- [x] Route (rounded polyline), 16 pads and the reactor; enemies pooled on `PathFollow3D`, four kinds, chill, leak and kill rewards. proof: scaffolded playtests `survives` (a wave is fought while a held key pans the camera) and `defeat` (a lone Sentry loses: `status` LOST, `lives` 0, `leaks` ≥ 25 at 3× with auto-send) pass — `verify-one-template.ts tower-defense`, 2026-09-29
- [x] Hitscan, splash shell, chain and chill towers fire; place, upgrade, recycle and the orbital strike work by key and by pointer. proof: scenarios `arsenal` (Mortar, Arc coil and Cryo each `shots ≥ 1`, built by pointer taps after a tap-select-and-recycle of the free Sentry), `placement` (`spent` 260, a refused Arc coil counted in `fundsRejects`), `upgrade-recycle` (credits 260 → 175 → 295), `pointer-placement` (hover reads pad 6; the tap builds on release), `strike` (`kills` ≥ 2, cooldown ≥ 20) — 2026-09-29
- [ ] The HUD's target-priority buttons change what a tower shoots. proof: a scenario that sends the `target` intent and asserts `selMode` and the tower's pick — **open**: `pickTarget` is unit-proven for first / strongest / nearest and the intent path is wired, but no scenario sends it.
- [x] Manual launch, auto-send, 1×/2×/3× speed, lose at 0 lives. proof: `defeat`, `look`, `arsenal`; win-at-12 and the seven-second auto-send are unit-proven on `WaveDirector` — 2026-09-29
- [ ] A full twelve-wave victory played through the real scene. proof: a `victory` scenario asserting `status` WON and `wave` 12 — **open**: nothing scripts a defence that clears all twelve waves, so `WON` is proven only on the director, never in a browser.

- [x] A polished diorama, not a grey grid: layered moss slab, sand road with inlay, warm pads, a forest ring, coloured towers and walkers with emissive accents, sun, hemisphere and rim light, teal void, photo sky as environment only, bloom on glow. proof: `docs/verification/visuals/tower-defense.png` (the `look` scenario's mid-fight frame) and a fresh judge subagent, 2026-09-29: new 7.5/10 for polish and 7/10 for readability against 3/10 and 4/10 for the old `defense` frame, "clearly better, not marginally". It named three defects and the walkers (now twice Bastion's size, fatter health bars), the pads (lighter) and the armory (narrower) were fixed; still open by the judge's reading: the board sits a little left of centre, and shots leave no travelling trail.
- [x] React HUD: top bar, wave bar with progress ticks, armory cards, selection panel, strike button, toasts, help and result modals; orbit, zoom and pan. proof: the captures above and every scenario passing against the built page.

### Phase 3 — gates

- [x] Scaffold hash, the 100-line instruction cap, the palette rule (six roles, one accent), the capability-recall corpus and the render-file gate pass. proof: `scaffold.spec.ts`, `template.spec.ts`, `visual-gate.spec.ts`, `pnpm caps:recall`, `check-template-quality`, `sync-mcp-configs --check` — 2026-09-29
- [ ] `pnpm budgets` end to end. proof: `pnpm budgets` exits 0 — **open**: awaiting the final batch end-to-end budgets rerun.
- [x] The look gallery is current. proof: `/home/joao/Pictures/threenative-aaa-look/` holds a fresh `tower-defense.png` and the stale `defense.png` is gone; sailing, shooter and starter were retaken by hand after the delegated arm timed out on queue contention, the others by the arm — 2026-09-29
- [ ] Native. proof: a `--target desktop` playtest of this template — **open**: none was run; the game adds no helper that needs one (route, pooling and queries are existing installed systems), but nothing here claims a platform it did not run on.

## Decisions

- **2026-09-29: audio and best-score are dropped.** Bastion synthesises sound with WebAudio and stores its
  best score in `localStorage`; both are browser globals a portable `src/` cannot use. Sound comes back
  with the shared audio path when a template has assets for it.
- **2026-09-29: `defense` is deleted, not kept beside it.** Owner instruction; the template has no
  consumers and is recoverable from git.
- **2026-09-29: sparks are CPU-pooled instances, not `GPUParticles3D`.** `GPUParticles3D` is a continuous
  emitter with no burst-at-a-point; kills and impacts need one-shot bursts at a moving position. A pool of 320
  instanced sparks costs one draw and is seeded from `ctx.random`.
- **2026-09-29: the six-colour palette rule is met by roles, not by colours.** `palette.ts` has six
  top-level roles (`world`, `model`, `towers`, `enemies`, `effects`, `accent`); the gate counts roles.
- **2026-09-29: perspective camera, not Bastion's orthographic one.** The shared render chain (AO, SMAA,
  bloom) is tuned for perspective; the elevation and yaw are Bastion's.
