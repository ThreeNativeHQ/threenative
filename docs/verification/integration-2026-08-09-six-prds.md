# Integration record — PRDs 032, 046, 048, 053, 054, 055 (2026-08-09)

Six lane branches from the 2026-08-09 run, integrated onto `main` as one squash. Three lanes
arrived approved; three arrived with review findings that were repaired here.

## What each lane contributed

| PRD | Lane state on arrival | What happened here |
|---|---|---|
| 032 asset discovery MCP | approved (`6b0c68d`) | Merged. Doc conflicts resolved so the retention decision and the "neither trigger fired" re-check both survive |
| 046 native physics | approved (`9e8de9f`) | Merged unchanged |
| 048 native distribution | approved (`31a56a7`) | Merged unchanged |
| 053 multi-touch input | repair pending | Proof repaired: see below |
| 054 write-once parity | repair pending | Preconditions repaired: see below |
| 055 native HUD | repair pending | Three defects repaired: see below |

`main` had already absorbed most of the 054 and 055 branches — 39 of 45 files on the 054
branch and the whole portable-HUD template layer were byte-identical to `main`. Where the
branch was older than `main` (its registry lacked rows 30 and 31), `main` was kept and the
branch's remaining semantics were applied on top rather than merged backwards.

## The three repairs

**053 — the multitouch proof was latched.** `moved` and `leftGround` persist, so two
sequential one-finger touches satisfied them. The conformance scene now latches
`simultaneous` only when the stick half and the jump half are held in the same frame, and
`conformance/multitouch-proof.mjs` requires that flag plus two pointers still down when the
proof is read. Negative cases are pinned in `tests/conformance-runner.test.mjs`.
**Not executed on an emulator here** — criterion 4 stays open.

**054 — parity assumed a provisioned host.** `--target desktop` now runs the repository's own
`download-deps.mjs` and `native-build.mjs` before a row can fail, and a host that cannot run
them reports every desktop row `blocked` with the command output. `--target android` refuses
physical hardware and reports a missing or uninstalled AVD as a blocked precondition.
`tests/parity-contract.test.mjs` drives those decisions instead of manufacturing a runtime.
Also fixed a fail-open: the Android capture hard-coded `uniform: false`, so a blank device
frame reported a pass. **No clean-machine run was executed here** — criterion 1 stays open.

**055 — three defects.**
1. Row 25 changed only projection numbers, so it passed without a resize. It now resizes the
   real renderer at four viewports and reads back the drawing buffer;
   `assertRenderedSize` throws `TN_CONFORMANCE_RESIZE_NOT_APPLIED` when the resize is removed.
2. The scaffold HUD checks grepped source and watched the React DOM path. Every template's HUD
   now reports the glyph count it pushed to the GPU, and the minimal template's `pnpm test`
   asserts that count changed on the booted project — observed live at `377 → 361` glyphs with
   `trivial: false`. The minimal template gained `playtest()` so the observation is possible
   rather than fail-closed on a missing bridge. The assertion is `changed`, not a floor: the
   runner rejects a floor the warmup value already satisfies as trivial, which is the harness
   being right.

   **Starter and platformer keep only the source-level HUD contract.** Both start at a `boot`
   scene, and `installThreePlaytestBridge` advertises `runtime.components` from a live sample
   (`packages/playtest/src/three/bridge.ts:64`). At the moment the runner calls `describe` the
   boot scene has registered nothing, so the capability is absent and the assertion fails
   `TN_PLAYTEST_CAPABILITY_MISSING` — even though the same run's observations *do* carry the
   HUD: starter's `play` scenario reports `hud.glyphs` moving `366 → 336`. The data arrives;
   the advertisement is taken too early.

   This was not worked around. A test pins the empty-provider behaviour deliberately
   (`packages/playtest/__tests__/three-bridge.spec.ts:156`), so making the capability
   provider-based rather than sample-based is its own decision with its own evidence, not a
   change to smuggle into this integration.
3. The 1,200-line template LOC cap is retired by product-owner decision. `pnpm budgets` still
   reports template LOC; it no longer fails on it.

## Gates run on the integrated branch

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — biome, 390 files |
| `pnpm test` | PASS — 84 files, 624 tests |
| `pnpm budgets` | PASS — 6 framework packages, 3 example workspaces, 6,011/15,000 framework LOC, 4 PRD files. Native runtime LOC trips its review trigger at 61,198/50,000; that trigger predates this change and is owned by the native PRDs |
| `pnpm test:templates` | See the run recorded alongside this file |

## Not run here, and not claimed

- No Android emulator or physical-device execution. PRD-053 criterion 4 and PRD-054's
  Android rows are written, not proven.
- No clean-machine desktop provisioning run. PRD-054 criterion 1 and PRD-048's clean-machine
  build stay open.
- No iOS anything; there is no Apple hardware on this machine.
- `pnpm test:browser` and the native conformance lanes were not part of this integration.

PRD-032 moved to `docs/PRDs/done/` with its lane. PRDs 046, 048, 053, 054 and 055 all still
have open criteria and stay where they are.
