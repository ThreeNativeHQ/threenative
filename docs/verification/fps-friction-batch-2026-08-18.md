# FPS friction batch verification

Date: 2026-08-18

The 11 active PRDs in the FPS-friction batch were audited against the current source and
executed gates. This record proves desktop and web only; it makes no mobile or performance-parity
claim.

The defects were classified before repair: pointer input, picking/collapse, animation, physics
construction, playtest execution, documentation contracts and asset inspection are engine or
tooling defects; the FPS source owns the raycast and animation call-site rewrites. PRD-142 is
withdrawn because the current benchmark has no `Enemy.#equip` path to rewrite.

## Acceptance evidence

| PRD | Evidence | Result |
| --- | --- | --- |
| 138 | `packages/core/__tests__/input.spec.ts` (27 tests); `look.playtest.json` passed on web and `--target desktop`, with `rotationDelta: 1.408`; the rebuilt native runtime also passed the first-person look path. The FPS look source has no `document` access. | DONE |
| 139 | `picking.spec.ts` (11 tests) covers world rays, `far`, `exclude`, `raycastAll` ordering and ambiguity failures. The FPS `fire()` and `lineOfSight()` now use `ctx.raycast`/`ctx.raycastAll`; `Raycaster` has no source hit. The port is 7 added / 11 removed lines against the previous call sites, and `pnpm tsx scripts/count-loc.ts` exits 0. `debug-fire.playtest.json` passes on web and desktop with shots, score, hit and reload changes. | DONE |
| 140 | Historical reproduction in [`prd-140-scene-collapse-breaks-picking-2026-08-17.md`](./prd-140-scene-collapse-breaks-picking-2026-08-17.md) records the pre-fix orphaned target. `collapse-picking.spec.ts` passes 3 tests: five annotated meshes remain live/raycastable, 245 unannotated meshes merge, and an unannotated 250-mesh scene still collapses. The 250-mesh picking scenario passes on web and desktop with `meshCount: 250` and `pickedTarget: 0 → 1`. | DONE |
| 141 | `animation.spec.ts` passes 8 tests for once/loop/replay behavior. The FPS death path uses `mode: "once"` and `finished`; `ctx.after(1.1, …)` and `#shootFor` are absent. `animation-death.playtest.json` passes on web and desktop; `DeathFront` reaches `advancedFrames: 207` and `finished: true`. | DONE |
| 142 | `skeleton.spec.ts` passes 5 tests, including non-uniform scale and missing-bone failure. `inspect enemy-terrorist.glb --json` reports the actual `mixamorigRightHand_035` bone. The current `Enemy` source contains no `#equip`, `findBone`, `handScale` or silent attachment fallback: the enemy GLB already contains its rifle. Adding a new weapon-attachment gameplay path would be speculative, so this PRD is withdrawn; the framework helper remains covered independently. | WITHDRAWN |
| 145 | `rigidbody.spec.ts` passes 5 tests for position-only fixed bodies, object/position ambiguity and the existing object path. The FPS `staticBody` now constructs fixed colliders from `position` and `shape`; the rebuilt desktop `debug-fire` scenario passes. | DONE |
| 146 | The fixed-step parser/runner suites pass; the current E2E suite reports 17 tests, including `holdFrames` and `waitFrames` advancing exactly 8 ticks. `runner/init.ts` emits canonical `holdTicks`. Remaining `holdFrames`/`waitFrames` hits are deliberate compatibility aliases, runner handling or historical fixtures and are enumerated by the existing verification record. | DONE |
| 147 | `scenario.spec.ts` covers `lte`, interval bounds and triviality; the shared numeric-key list is used by all numeric assertion sites. The action-RPG progress scenario now asserts `health` inside a non-trivial `gte`/`lte` interval. All seven generated templates pass their gates. | DONE |
| 148 | Repeatable `--scenario`, sorted glob expansion, empty-glob failure, occupied-port failure, managed-server teardown, artifact isolation and empty-suite failure are covered by the runner tests. All seven templates pass `pnpm test` as generated; no template package script contains `4173`. | DONE |
| 149 | `documented-contract.spec.ts` passes 2 tests for the canonical resource id and 100 ms flush interval. Current template playtests use `state`; generated mirrors pass `pnpm sync:agents --check`; the starter documentation describes the throttled `useGameState` path. | DONE |
| 150 | `inspect.spec.ts` passes 9 tests, including missing, non-glTF and corrupt-file failures. The current viewmodel inspection reports `0.573 × 0.392 × 1.394`, clips `Walk, Run, Reload, Shoot, Idle`, and likely-metre units. The enemy inspection reports 9 clips and the real hand-bone names. The FPS web playtest artifact contains `TN_FPS_ASSETS_LOADED` in `console.json`. | DONE |

## Cross-target commands

The FPS web scenarios were run through `sh scripts/xvfb.sh` with Chromium's WebGPU recipe and a
named adapter. The desktop scenarios used the same JSON files and the rebuilt native executable:

```sh
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  --project docs/benchmark/sweeps/fps-2026-08-17 \
  --scenario playtests/look.playtest.json \
  --target desktop --executable /tmp/tn-fps-desktop-final \
  --artifacts /tmp/tn-fps-desktop-look-artifacts-final

sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  --project docs/benchmark/sweeps/fps-2026-08-17 \
  --scenario playtests/debug-fire.playtest.json \
  --target desktop --executable /tmp/tn-fps-desktop-final \
  --artifacts /tmp/tn-fps-desktop-fire-artifacts-final

sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  --project docs/benchmark/sweeps/fps-2026-08-17 \
  --scenario playtests/animation-death.playtest.json \
  --target desktop --executable /tmp/tn-fps-desktop-final \
  --artifacts /tmp/tn-fps-desktop-animation-artifacts-final
```

All three desktop commands exited 0. The same look, fire and death scenarios exited 0 on web.
The native runtime was rebuilt with `pnpm native:build`; the first synthetic desktop pointer move
now establishes its baseline and pointer-up at `(0, 0)` no longer corrupts the next relative delta.

## Repository gates

These are the final gates run after the evidence and status edits:

| Gate | Result |
| --- | --- |
| `pnpm typecheck && pnpm lint && pnpm test` | PASS — 144 files / 1,307 tests; runtime-native 48 files / 319 passed / 30 skipped |
| `pnpm test:templates` | PASS — action-rpg, defense, minimal, platformer, racing, shooter and starter |
| `pnpm budgets` | PASS — 11,747/15,000 framework LOC; 77,053/50,000 native runtime LOC; hard invariants clear |
| `pnpm sync:agents --check` | PASS — 15 CLAUDE.md mirrors in sync |
| `pnpm check:docs` | PASS — 621 relative links across 438 Markdown files |
| `pnpm native:verify:desktop` | PASS — one-file native bundle, 300-frame desktop run, physics actuation/query and 14 playtest assertions |
