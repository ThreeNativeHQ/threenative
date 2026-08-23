# Honest core packaging seam — PRD-181 — 2026-08-22

Lane: lane-hygiene (packaging/consumer). PRD:
`docs/PRDs/batch-2026-08-22/PRD-181-honest-core-packaging-seam.md`.

## Incumbent census (taken before anything moved)

| Symbol | Consumers found |
| --- | --- |
| `parseReplayRecording`, `IReplayRecording` | `packages/core/src/replay.ts:1` (the leak); playtest's own index re-export. Zero callers in templates, examples, hosting, physics or any other package; zero playtest-internal callers. |
| `IReplayRecordingSample`, `ReplayPointer` | playtest index re-export only. |
| `measureThreePose`, `posedBounds` (+ their option/result types) | **Not named in the PRD's evidence** — discovered by this lane's scan guard: `packages/core/src/grounding.ts:1` value-imported them from `@threenative/playtest/three`, and `grounding.ts` exports `GroundSnap`, a documented BASE export of core reachable by every lone consumer. One external consumer only (core itself); zero playtest-internal or template/example callers. |

Because no caller existed outside core for either group, the ledger's conditional resolved to
deletion without a shim — and `@threenative/playtest` keeps the zero-ThreeNative-dependency
stance its AGENTS.md declares as a product decision.

## Phase 1 — protocol and measurement move into core (commit 69a09f6e)

Moved verbatim, no behavior change: `src/replay-protocol.ts` (replay parser; `TN_REPLAY_*`
error codes byte-identical) and `src/pose-measure.ts` (playtest's three/pose.ts, 387 lines,
three-only imports). `replay.ts` and `grounding.ts` import locally; index.ts exports
`parseReplayRecording`, `IReplayRecording(+Sample)`, `ReplayPointer`, `measureThreePose`,
`posedBounds` + types. Playtest drops its dead re-exports (`git rm src/replay.ts`,
`git mv three/pose.ts`), and its two behavioral pose specs moved with the implementation
(`packages/core/__tests__/posed-bounds.spec.ts`, `three-pose.spec.ts`).

Red first: packaging.spec.ts failed against the pre-move tree (missing `replay-protocol.ts`
anchor + offender `replay.ts`). Green after the move. The scan also caught my own header
comment containing the literal package name — rewritten; the guard scans text, so prose counts.

## Phase 2 — unbundled dist, proven consumer lane

Negative control against the CURRENT published shape (pre-change dist snapshot, lone consumer
with every declared dependency installed — tarball-less stand-in, `typescript@5.9.3`,
`three@0.185.1`, `@types/three@0.185.3`, `zustand@5.0.14`):

```
node_modules/@threenative/core/dist/index.d.ts(6,34): error TS2307: Cannot find module
'@threenative/playtest' or its corresponding type declarations.
```

One error, and it is the undeclared dependency — exactly the breakage `noExternal` was masking.
The old dist also carried the protocol inline: 4 occurrences of
`parseReplayRecording|TN_REPLAY_INVALID` in the base `index.js`.

After removing `noExternal` and declaring the relationship honestly
(`peerDependencies["@threenative/playtest"] = ">=0.2.0 <0.3.0"`, optional — a required peer
would let npm auto-install the harness for every core consumer, recreating the coupling the PRD
rejected):

```
$ pnpm --filter @threenative/core build            # exit 0
$ grep -c "parseReplayRecording\|TN_REPLAY_INVALID" packages/core/dist/*.js
  hot.js:0   playtest.js:0   index.js:5        # protocol present ONCE, own code
$ grep -l "@threenative/playtest" packages/core/dist/*.js *.d.ts
  playtest.js, playtest.d.ts only                # base export graph is clean
```

Consumer session from the packed tarball (`pnpm pack` → fresh dir → npm install tarball +
declared deps above): a file importing `createReplayDriver`, `GroundSnap`,
`measureThreePose`, `parseReplayRecording`, `posedBounds` and the recording/pose types passes
`tsc --noEmit --strict` with zero errors, and a runtime smoke from the same dist prints
`parsed ticks: 2` then `fail-closed: TN_REPLAY_INVALID: bad header`.

## Phase 3 — one owner for the version

No package derived its version, so per the PRD's allowance: `scripts/generate-version.mjs`
writes `src/version.ts` from package.json (checked in, wired as the build's first step).
`playtest.ts` and `replay.ts` consume it — note `replay.ts` also *gates* replays on it, so both
stamping and acceptance now use the real version. Pinning spec `version.spec.ts`:

- green when generated;
- RED under the negative control (hand-edited stale const `0.1.0` vs manifest `0.2.0`);
- green again after regeneration.

`random.spec.ts`'s fingerprint expectation pinned the hardcoded lie and now imports
`CORE_VERSION` instead of the literal.

## Verification plan results

1. Suites identical before/after: core 38 files / 332 tests, all pass; playtest 41 files / 419
   tests, all pass. (One transient: generated-shooter-input.spec flaked once under full-suite
   load and passes consistently in isolation — browser-driving timing, untouched by this work.)
2. Packed-tarball consumer typecheck pasted above; pre-change negative control pasted above.
3. `pnpm publish:check`: the unreadable-peer-range error this work would have introduced is
   gone; the six remaining FAILs are batch-wide release hygiene predating this lane (every
   published package needs a version bump after this batch; engine-mcp missing from the release
   workflow) — integration-level, not this PRD's.
4. Scoped gates: core+playtest tsc exit 0; biome 0 errors on touched files (pre-existing
   complexity warnings elsewhere). Full `pnpm test` not claimed by this lane.
