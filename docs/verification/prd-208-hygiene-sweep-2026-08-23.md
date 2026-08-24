# PRD-208 hygiene sweep verification

Date: 2026-08-23
Branch: `linchpin/prd-208-tier-four-hygiene-sweep`

## Censuses and consolidations

- Before deletion, `.reparent(` had no callers; `ProjectionCamera` had no references outside its type declaration. The only definition of `AudioBus.reparent` was `packages/core/src/audio.ts:151`.
- The pre-edit stale-anchor census found 15 exact `Extracted verbatim` markers in 12 playtest files. The PRD audit listed 13 in 11 files; the broader current census was used and all exact markers were removed. History was spot-checked with:

  ```sh
  git log --all --oneline -S'Extracted verbatim' -- packages/playtest/src
  ```

  The relevant refactor commits were `edbee19f`, `7304385b`, `65ab4904`, `ba8619d5`, `7460cca`, and `ad191e07`.
- Asset manifest/source constants and `messageOf` now have one owner in `packages/assets/src/asset-utils.ts`. Gesture events have one owner in `packages/core/src/audio.ts:63`. Navigation validation/vector conversion have one owner in `packages/physics/src/navigation/navigation-utils.ts`.
- Script `isRecord` and `freePort` have one owner in `scripts/utils.ts`. The native workload's broader object-only check was left unchanged because it intentionally accepts arrays.
- The three private renderer property-key idioms use `packages/core/src/three-private.ts:5`; the final inline split-string census returned no output. No new package export was added.
- Final zero-result censuses:

  ```sh
  rg -n '\.reparent\s*\(|\bProjectionCamera\b' packages examples scripts
  rg -n -F 'Extracted verbatim' packages/playtest/src
  rg -n '\["ma" \+ "terial"\]|\["mat" \+ "erial"\]' packages/core/src/assets.ts packages/core/src/renderer.ts
  ```

## Negative controls

Each declared control was made red temporarily, then restored:

1. Reverting the hidden-overlay lifecycle caused `does not poll while closed` to fail with `actually been called 10 times` after one second of fake time.
2. Diverging the watch manifest filename caused the changed-input test to fail because the old hashed output remained unchanged.
3. Restoring one inline split-string caused the material census command to exit 1 at `packages/core/src/assets.ts:436`.

## Repair round 1 — shared MCP client contract

The shared `probeMcpServer` client now requires an after-initialize validator. The production
server map supplies `assertSculptResources` for `threenative-sculpt` and an explicit no-op for
the asset server. The existing sculpt validator still rejects missing, empty, and unsafe
resources.

The omitted-validator negative control was made red by temporarily restoring the reviewed bug
(optional callback invocation with no contract guard):

```text
FAIL scripts/__tests__/verify-golden-path.spec.ts > golden path matrix > fails closed when a sculpt probe omits its resource validator
AssertionError: promise resolved "undefined" instead of rejecting
```

After restoring the required callback and guard, the same focused suite was green:

```text
Command: pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts
Result: 1 test file passed, 13 tests passed
```

The committed empty-resource negative control also passes by rejecting with
`threenative-sculpt listed no technique resources.`.

## Verification commands

- `pnpm exec vitest run` — 198 files passed, 1,884 tests passed.
- Focused changed-area suite — 8 files passed, 80 tests passed.
- `pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts` — 12 tests passed.
- `pnpm exec vitest run scripts/__tests__/check-capability-docs.spec.ts` — 7 tests passed.
- `pnpm exec vitest run packages/core/__tests__/constraints.spec.ts` — 4 tests passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed with 292 existing complexity warnings and no errors.
- `pnpm tsx scripts/count-loc.ts` — passed; suggested framework normalized baseline is 432 versus the 441-line current baseline.
- `pnpm budgets` — passed. It reports existing framework LOC review-trigger and native census drift notices; no hard invariant failed.

The exact required chain `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` reached `pnpm test` but was stopped by `@threenative/playtest`'s orphan-process guard. A standalone `pnpm --filter @threenative/playtest test` reproduced the same failure: the guard reported Chromium PIDs after the runner exited. The PIDs were gone on inspection. This is an environment/runner cleanup failure, not a test assertion failure; the direct Vitest suite above is green.

No templates or render sources were changed, so no visual change was expected.

## Acceptance result

- Deleted APIs had zero callers.
- Consolidated symbols have one owner and no twin literals at the audited sites.
- All exact stale anchors are gone and their refactor history was checked.
- A closed `DebugOverlay` performs zero polls, with a regression test that turns red on revert.
- The code diff is net negative: 79 added and 328 deleted tracked lines, plus 233 lines in new helpers/client files, for a net decrease of 16 lines. No public package API was added.
