# Budgets decommission — 2026-08-22 (PRD-188)

Evidence for PRD-188, which deleted the framework LOC attribution machinery (Phase 1) and
re-pinned the native runtime LOC review trigger from 50,000 to 100,000 (Phase 2). Commands ran in
the `prd-188` lane worktree against main at `8235d7f8`. Numbers differ slightly from the PRD's §1
spike because that spike measured the `audio-voice-pooling` tree (framework LOC 14,702 / native
79,753); this lane measures main (framework LOC 14,455 / native 79,760).

**Landing note:** while this lane worked, a sibling lane landed the asset pipeline series
(PRD-094…099) on main (`95c079b4`), including additive texture-bytes reporting in
`scripts/check-budgets.ts`. An early squash swing built on the stale base was caught by the CAS
guard and reverted within seconds; both phases were then cherry-picked onto `95c079b4`
(resolution: my deletions plus their texture additions — one CLI-block hunk) and every gate below
was re-run green on the composed tree: typecheck/lint/test 190 files, 1789 tests, temp-dir count
unchanged.

On the composed tree `pnpm budgets` exits 0 with **no native trigger line** (79,887/100,000) and
the attribution grep stays empty. One trigger this PRD does not own now fires on main: the
**framework** 15k review trigger (17,379, +2,379) — the sibling series added `packages/assets`
and crossed it. PRD-188 declares the framework trigger a non-goal; the crossing is the asset
pipeline PRDs' to justify, per the trigger's own instruction.

## Pre-removal coupling — observed red (Phase 1 negative control)

The attribution verifier was invoked explicitly with the snapshot hidden, before any code
changed. It failed closed, which is what proved the machinery was load-bearing on exactly one
manual invocation:

```
$ mv docs/verification/loc-attribution-2026-08-20.md /tmp/loc-attribution-backup.md
$ pnpm tsx scripts/check-budgets.ts --verify-framework-loc-attribution; echo "exit=$?"
framework LOC attribution is missing: <root>/docs/verification/loc-attribution-2026-08-20.md
exit=1
$ mv /tmp/loc-attribution-backup.md docs/verification/loc-attribution-2026-08-20.md && echo restored
restored
```

The PRD's §1 spike had also captured the verifier red on the untouched tree:
`recorded framework LOC attribution total disagrees with measured framework LOC:
recorded 12936, measured 14702`.

## Phase 2 mutation — observed red

`LIMITS.nativeRuntimeLoc` reverted to `50_000` via sed, full budgets spec run:

```
 FAIL  scripts/__tests__/budgets.spec.ts > budget gate > should fire the native runtime trigger past 100k lines without charging framework LOC
AssertionError: expected 'native runtime LOC review trigger: 10…' to contain 'native runtime LOC review trigger: 10…'
Expected: "native runtime LOC review trigger: 100002 lines (trigger 100000"
Received: "native runtime LOC review trigger: 100002 lines (trigger 50000, +50002). Justify in the owning PRD and run the kill switch over what was added."
 Test Files  1 failed (1)
      Tests  2 failed | 28 passed (30)
```

The two failures are exactly the boundary fixtures (`...past 100k...`, `...stay silent at the
pinned native trigger`); the other 28 stay green under the mutation.

## Phase 2 restore — green

```
$ sed -i 's/nativeRuntimeLoc: 50_000,/nativeRuntimeLoc: 100_000,/' scripts/check-budgets.ts
$ pnpm vitest run scripts/__tests__/budgets.spec.ts
 Test Files  1 passed (1)
      Tests  30 passed (30)
```

## Phase 1 revert check — predicted mechanism does not hold; recorded as observed

PRD-188 Phase 1 verification step 5 predicted that restoring a deleted symbol without its spec
section would fail typecheck/lint via no-unused rules. It does not: this repository configures
neither `noUnusedLocals` (tsconfig) nor `noUnusedVariables` (biome). With
`FRAMEWORK_LOC_ATTRIBUTION` resurrected verbatim:

- `pnpm biome lint scripts/check-budgets.ts` — zero diagnostics naming the const
  (only the pre-existing tolerated complexity warnings).
- `pnpm tsc --noEmit -p tsconfig.json` — zero diagnostics naming the const.

The guards that actually hold, and were observed: typecheck fails on surviving *callers* of the
deleted exports (there are none), and the acceptance grep below proves zero survivors.

## Acceptance greps

```
$ grep -rn "frameworkLocAttribution\|readFrameworkLocAttribution\|verifyFrameworkLocAttribution\|loc-attribution-2026-08-20" scripts packages docs/architecture
(no output) — exit 1, zero matches
```

References to the deleted snapshot remain in two historical records outside the PRD's kill scope,
both repaired as links-only so `check:docs` passes while the history stays truthful:

- `docs/PRDs/done/batch-26-08-19-night/PRD-165-the-framework-counter-crossed-its-own-trigger.md`
  — link replaced by prose naming the deletion and this record.
- `docs/verification/loc-attribution-2026-08-19.md` — superseded banner now names the deletion
  in plain text instead of linking to the removed file.

## Gates at the closing state

```
$ pnpm budgets
capability docs: 42 public class/function exports documented in 7 templates
native census drift: tests/ recorded 10,482, measured 10,488 — run `pnpm census` to regenerate the Lines column
budgets ok: 7 framework packages, 8 example workspaces, 14455/15000 framework LOC, 79760/100000 native runtime LOC, 11 PRD files, largest template 2349 LOC
(exit 0; no "review trigger" lines printed)
```

`pnpm typecheck && pnpm lint && pnpm test`: all packages typecheck Done; lint clean within the
chain; suite totals pasted below.

```
$ pnpm test   # serial run with no sibling lane active
 Test Files  181 passed (181)
      Tests  1699 passed (1699)
suite temporary directory count unchanged: 58
```

Two earlier full-chain attempts produced reds worth attributing honestly:

1. `check:docs` failed twice — first on the two historical links into the deleted snapshot
   (real breakage, repaired above), then on my own replacement link in the archived PRD-188
   written one directory level too shallow (`../verification/` instead of `../../verification/`).
2. One run failed the suite's `/tmp/threenative-*` hygiene tripwire (`before 58, after 61`)
   while a **sibling agent's lane was running vitest concurrently** against
   `packages/runtime-native` in the primary checkout — its temp directories land under the same
   prefix the tripwire counts. With lanes idle the identical tree passes with the count
   unchanged. The tripwire did not observe a leak in this change.

## What did not run

- Playtest lanes and native device lanes: the change touches only repo tooling and docs; no
  game-runtime behaviour changed.
- `pnpm census`: not regenerated. The drift line above predates this lane (main already measured
  10,488 vs recorded 10,482 at lane start); PRD-188 declares census fatality a non-goal.
- The historical `loc-attribution-2026-08-19.md` was edited only in its superseded banner; its
  measurement tables are untouched.
