# FPS friction batch verification

Date: 2026-08-18

The 11 active PRDs in the FPS-friction batch were audited against the current source and
executed gates. This record proves desktop and web only; it makes no mobile or performance-parity
claim.

The defects were classified before repair: pointer input, picking/collapse, animation, physics
construction, playtest execution, documentation contracts and asset inspection are all engine or
tooling defects, and every one of them is fixed in `packages/`. Each fix carries a call site that
exercises it on both targets; those call sites live in `examples/fps-friction` and
`examples/prd140-picking`, not in the sweep archive that motivated them — see the restoration note
below for why. PRD-142 is withdrawn because the benchmark has no `Enemy.#equip` path to rewrite.

## Acceptance evidence

| PRD | Evidence | Result |
| --- | --- | --- |
| 138 | `packages/core/__tests__/input.spec.ts` (27 tests). The call site is `examples/fps-friction`, which reads `ctx.input.vector("look")` behind `ctx.input.captureMouse()` and never touches `document`. Its `look` scenario passes on web — `lookYaw` 0 → −1.91, `rotationDelta` 0.91/1.00/1.05 over three consecutive runs — and on `--target desktop` with `rotationDelta: 1.408`. | DONE |
| 139 | `picking.spec.ts` (11 tests) covers world rays, `far`, `exclude`, `raycastAll` ordering and ambiguity failures. `examples/fps-friction` shoots a world ray past a camera-parented viewmodel narrowed out by `targets`: `raycast` stops on the thin dressing plate and `raycastAll` returns both hits in order, so the solid behind it scores. `allHits` 0 → 2 and `hits` 0 → 1 on web and on `--target desktop`. The example's source contains no `Raycaster`. | DONE |
| 140 | Historical reproduction in [`prd-140-scene-collapse-breaks-picking-2026-08-17.md`](./prd-140-scene-collapse-breaks-picking-2026-08-17.md) records the pre-fix orphaned target. `collapse-picking.spec.ts` passes 3 tests: five annotated meshes remain live/raycastable, 245 unannotated meshes merge, and an unannotated 250-mesh scene still collapses. The 250-mesh picking scenario passes on web and desktop with `meshCount: 250` and `pickedTarget: 0 → 1`. | DONE |
| 141 | `animation.spec.ts` passes 8 tests for once/loop/replay behavior. `examples/fps-friction` plays its death clip with `mode: "once"` and reads `finished`; there is no `ctx.after` freeze and no mixer-stopping hack. `animation-death.playtest.json` passes on web and desktop; `DeathFront` reaches `advancedFrames: 203` and `finished: true`, and the enemy's reported state reaches `dead-finished`. | DONE |
| 142 | `skeleton.spec.ts` passes 5 tests, including non-uniform scale and missing-bone failure. `inspect enemy-terrorist.glb --json` reports the actual `mixamorigRightHand_035` bone. The archived `Enemy` source contains no `#equip`, `findBone`, `handScale` or silent attachment fallback — re-checked against the restored archive — because the enemy GLB already contains its rifle. Adding a new weapon-attachment gameplay path would be speculative, so this PRD is withdrawn; the framework helper remains covered independently. | WITHDRAWN |
| 145 | `rigidbody.spec.ts` passes 5 tests for position-only fixed bodies, object/position ambiguity and the existing object path. `examples/fps-friction` builds its whole yard — floor, back wall, two side walls — from fixed bodies constructed out of a bare `position` and `shape`, with no carrier `Object3D`. A dynamic crate dropped from 3 m settles on that floor: `crateY` 2.55 → 0.2987237870693207 on web and 1.998 → 0.2987237870693207 on desktop. Without the position-only body the crate does not stop, so the number is the assertion. | DONE |
| 146 | The fixed-step parser/runner suites pass; the current E2E suite reports 17 tests, including `holdFrames` and `waitFrames` advancing exactly 8 ticks. `runner/init.ts` emits canonical `holdTicks`. Remaining `holdFrames`/`waitFrames` hits are deliberate compatibility aliases, runner handling or historical fixtures and are enumerated by the existing verification record. | DONE |
| 147 | `scenario.spec.ts` covers `lte`, interval bounds and triviality; the shared numeric-key list is used by all numeric assertion sites. The action-RPG progress scenario now asserts `health` inside a non-trivial `gte`/`lte` interval. The originating call site — the countdown that could previously only be asserted as `changed: true` — is bounded in `examples/fps-friction`'s `fire` scenario as `gte: 50, lte: 59`, observed 59.68 → 57.12 on web and 59.57 → 57.00 on desktop. Negative control: the same scenario with `lte: 40` exits 1 on `resource.state.timeRemaining`, so the bound bites. All seven generated templates pass their gates. | DONE |
| 148 | Repeatable `--scenario`, sorted glob expansion, empty-glob failure, occupied-port failure, managed-server teardown, artifact isolation and empty-suite failure are covered by the runner tests. All seven templates pass `pnpm test` as generated; no template package script contains `4173`. | DONE |
| 149 | `documented-contract.spec.ts` passes 2 tests for the canonical resource id and 100 ms flush interval. Current template playtests use `state`; generated mirrors pass `pnpm sync:agents --check`; the starter documentation describes the throttled `useGameState` path. | DONE |
| 150 | `inspect.spec.ts` passes 9 tests, including missing, non-glTF and corrupt-file failures. The current viewmodel inspection reports `0.573 × 0.392 × 1.394`, clips `Walk, Run, Reload, Shoot, Idle`, and likely-metre units. The enemy inspection reports 9 clips and the real hand-bone names. Both run against the models in the sweep archive and do not require the archive to be installed. The `TN_FPS_ASSETS_LOADED` console line quoted in an earlier revision came from running the archive as a project, which it is no longer; the `inspect` CLI evidence stands on its own. | DONE |

## Cross-target commands

The call sites live in `examples/fps-friction`, a workspace example that resolves
`@threenative/*` through `workspace:*`. Its four scenarios are split by what each target
supports: `look`, `fire` and `animation-death` carry only cross-target assertions, and `renders`
is web-only because `visual` requires `browser.screenshot` and `noNetworkErrors` raises
`TN_PLAYTEST_UNSUPPORTED_ON_TARGET` on desktop. Nothing is asserted in fewer places than before;
the web-only assertions moved into a web-only scenario rather than being deleted.

**The web scenarios need `--headed` under a real display.** An earlier revision of this file gave
the web command as `sh scripts/xvfb.sh` plus the WebGPU recipe. That is not reproducible: on this
machine that combination names `swiftshader/google`, and the CPU rasteriser's buffer limits then
raise 33 `Instance dropped in popErrorScope` rejections, so a diagnostics assertion fails. The
recipe's `--enable-features=Vulkan` is necessary but not sufficient — headless Chromium still
falls back. The command that reproduces green, and the adapter it named:

```sh
DISPLAY=:0 node packages/playtest/dist/runner/cli.js \
  --project examples/fps-friction \
  --scenario playtests/renders.playtest.json \
  --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
# capture.json adapter: { vendor: "nvidia", architecture: "turing" }
```

`look`, `fire`, `animation-death` and `renders` each exited 0 that way on 2026-08-18. Only
`renders` carries a capture assertion, so it is the only one whose adapter is read and the only
one `TN_PLAYTEST_SOFTWARE_ADAPTER` can fail closed on.

The desktop target runs the same JSON files against an executable packaged from the example's own
native bundle:

```sh
pnpm --filter fps-friction test          # vite build + src/game.ts native bundle
node packages/runtime-native/scripts/package-desktop.mjs \
  --bundle examples/fps-friction/dist/fps-friction-native.js \
  --runtime packages/runtime-native/build/tn-linux/mystral \
  --output /tmp/tn-ff-desktop

for scenario in look fire animation-death; do
  sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
    --project examples/fps-friction \
    --scenario "playtests/$scenario.playtest.json" \
    --target desktop --executable /tmp/tn-ff-desktop \
    --artifacts "/tmp/tn-ff-dt-$scenario"
done
```

All three exited 0 on 2026-08-18. The first attempt exited 1 on `crateY` because the packaged
bundle predated the crate — the assertion failing closed on a stale build is the harness being
right, and the rebuild is above for that reason.

The native runtime this executable is packaged against was built with `pnpm native:build` during
the batch; the first synthetic desktop pointer move establishes its baseline and pointer-up at
`(0, 0)` no longer corrupts the next relative delta.

## Audit of 2026-08-18, and three repairs

The batch was re-audited against a clean run of the gates. `pnpm test` was **red**, and two of the
claims above were recorded against a state that no longer reproduced. All three are repaired here.

1. **`pnpm test` failed at `scripts/__tests__/sweep-ledger.spec.ts`** — the FPS ledger recorded 297
   unused framework exports and the live measurement reported 602. Cause: `measureSandbox` preferred
   `node_modules/@threenative` over the archived `framework-types/@threenative`, and this batch left
   a `node_modules/` in the FPS sandbox whose entries are symlinks to the live workspace packages.
   An archived measurement therefore drifted with every rebuild, on whichever machine happened to
   have installed into that sandbox. `measure-sandbox.ts` now prefers the archived snapshot, which
   is what `sweep-archive.ts` writes and what the ledger was measured against; `node_modules/` stays
   as the fallback for a sandbox that has not been archived yet. Covered by a new
   `measure-sandbox.spec.ts` case. That ordering fixed the symptom; the `node_modules/` itself is
   gone as of the restoration recorded below, so no archive on disk carries one.
2. **`packages/playtest/src/runner/bridgeClient.test.ts` was the wrong home for PRD-148's
   evidence.** Three of its five tests duplicated `__tests__/bridgeClient.spec.ts`, and it ran only
   because the batch special-cased `packages/playtest/src/runner/**/*.test.ts` in
   `vitest.config.ts` — which made `packages/playtest/AGENTS.md`'s statement that co-located
   `src/**/*.test.ts` files are not run by `pnpm test` false. The two unique tests (repeatable
   `--scenario`, sorted glob expansion, empty-glob failure) moved into
   `__tests__/bridgeClient.spec.ts`, the duplicate file is deleted, and the include is reverted.
3. **PRD-147's originating call site was never ported.** The ledger row that motivated `lte` was the
   FPS 60-second countdown, asserted only as `changed: true` with direction checked by eye. The FPS
   `debug-fire` scenario now bounds it as `gte: 50, lte: 59` — observed `59.65 → 55.27` on web and
   `59.58 → 55.20` on desktop. Negative control: setting `lte: 40` exits 1 on the desktop target, so
   the bound bites. Those numbers were measured against the sweep archive before it was restored;
   the reproducible bound is now the one in `examples/fps-friction`, quoted in the PRD-147 row.

## Repository gates

These are the gates as re-run on 2026-08-18 after the three repairs and after the archive
restoration recorded below. Every row was executed for this record; none is carried forward:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — exit 0, 215 warn-level diagnostics |
| `pnpm test` | PASS — 143 files / 1,305 tests |
| `pnpm test:templates` | PASS — action-rpg, defense, minimal, platformer, racing, shooter and starter |
| `pnpm budgets` | PASS — 11,747/15,000 framework LOC; 77,053/50,000 native runtime LOC; hard invariants clear |
| `pnpm sync:agents --check` | PASS — 15 CLAUDE.md mirrors in sync |
| `pnpm check:docs` | PASS — 623 relative links across 439 Markdown files |
| `pnpm tsx scripts/count-loc.ts --check` | PASS |
| `examples/fps-friction` web, `--headed` on a named nvidia adapter | PASS — `look`, `fire`, `animation-death`, `renders`; `renders` capture names `{ vendor: "nvidia", architecture: "turing" }` |
| `examples/fps-friction` desktop, `--target desktop` | PASS — `look`, `fire`, `animation-death` |
| `examples/fps-friction` negative control | Exit 1 as required — `fire` with `lte: 40` fails `resource.state.timeRemaining` |
| `pnpm sweep:measure docs/benchmark/sweeps/fps-2026-08-17` | PASS — 1947 user LOC, 1542 authored, 297 unused exports, matching the restored ledger |
| Restored archive against its own sealed tarballs | PASS — copied to `/tmp`, `pnpm install`, `pnpm typecheck`, `vite build` all exit 0; every `@threenative/*` resolves to the `vendor/*.tgz` its `package.json` pins |

`pnpm native:verify:desktop` was not re-run in this audit; its 2026-08-18 result above stands
unverified against the current tree.

## The sweep archive was restored, and the call sites moved

This batch used `docs/benchmark/sweeps/fps-2026-08-17` as its workspace. That was the wrong home
and it left the archive in a state that only resolved on this machine: `node_modules/@threenative/*`
were symlinks into the live workspace, `vendor/threenative-physics` held a symlink whose name did
not match its target's hash, and the `package.json` pinned that non-existent name. Underneath the
plumbing problem was a larger one — the archive's `src/` had been rewritten onto APIs that did not
exist when the run happened, two of the builder's scenarios had lost `noNetworkErrors`, and the
ledger's measurement fields had been rewritten to match the edited source.

Re-vendoring would have fixed the resolution and kept the corruption. A sweep archive records the
API as it was on the day the evidence was taken, so the archive was reverted to the state the cold
session submitted, and the ported call sites moved to `examples/fps-friction`, which is allowed to
track the live framework and is gated by `pnpm test` like any other workspace package. What
changed:

- `docs/benchmark/sweeps/fps-2026-08-17/` is byte-identical to its sealed state again — `src/`,
  `AGENTS.md`, `CLAUDE.md`, `package.json`, `pnpm-lock.yaml`, `framework-types/@threenative/physics`
  and the six builder scenarios. The two scenarios this batch added are gone from it.
- Its `node_modules/`, `dist/` and `artifacts/` are deleted and the phantom physics tarball symlink
  with them. The archive now has the same shape as the other twelve: tracked sources plus a
  `framework-types/` snapshot, and no install. **No archive under `docs/benchmark/sweeps/` is
  installable from a clean clone** — `vendor/` is gitignored repository-wide — so the archive is a
  record to measure, never a project to run.
- The restoration was checked the only way that means anything: the archive was copied to `/tmp`,
  installed with `pnpm install` — which resolved `@threenative/core`, `physics`, `ui` and
  `playtest` from its own `vendor/` tarballs, the exact filenames its `package.json` pins — and
  then typechecked and built. Both exit 0. The copy is what carries the `node_modules/`; the
  archive does not.
- `docs/verification/sweep-fps-2026-08-17.md` was re-measured against the restored source:
  `User source LOC` 1898 → 1947, `Authored LOC` 1493 → 1542, unused exports 602 → 297. The 602
  figure came from measuring against the symlinked live workspace, which is why it contained
  minified names like `a0` and `$`.

Because that archive is no longer a runnable project, the `debug-fire`, `survives`, `look` and
`animation-death` runs recorded against it in earlier revisions of this file are not reproducible.
Their replacements are the four `examples/fps-friction` scenarios above, all re-run from scratch on
2026-08-18.

## Open, and not claimed here

A scenario with no capture or visual assertion never reads `adapter.info`, so
`TN_PLAYTEST_SOFTWARE_ADAPTER` cannot fire on it and it will run to green on a CPU rasteriser. That
is a harness gap this batch did not create and does not close. `examples/fps-friction` works around
it rather than fixing it, by keeping one scenario that does carry a capture assertion.

`examples/fps-friction` is a fixture, not a game. It proves the four APIs answer their call sites
on both targets; it does not re-prove that a whole FPS is pleasant to build on them. The evidence
for that remains the sweep's own friction ledger, and the next cold run against the fixed framework
is what would settle it.

`docs/benchmark/sweeps/fps-2026-08-17/sweep.json` records `frameworkVersion: 0.1.0` while its
`package.json` pins 0.2.0 tarballs. That disagreement predates this batch, is inside the sealed
manifest, and was left alone.

`scripts/__tests__/sweep-ledger.spec.ts` failed once on 2026-08-18 with `Required field Archive is
blank` in a fixture that writes a `mkdtemp` path into an `Archive:` line. `field()` rejects any
value matching `/TBD/i`, and roughly one `mkdtemp` suffix in 8,000 contains those three letters in
some case. The failure did not recur in 43 further runs, so the mechanism is inferred from the code
rather than reproduced, and no fix is claimed here.
