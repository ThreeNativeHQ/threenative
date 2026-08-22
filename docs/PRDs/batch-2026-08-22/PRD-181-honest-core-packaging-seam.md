---
prd_contract: v1
---

# PRD-181 — Core stops shipping a hidden copy of playtest

**Status:** OPEN, 2026-08-22. Filed from the 2026-08-22 area scorecard (finding #12; core scored
70/100). Evidence verified at HEAD `a84f08da`.

Complexity: 4 → MEDIUM mode (small file count; the decision — dependency direction — is the substance).

**Outcome:** a consumer who installs `@threenative/core` alone typechecks and runs against exactly
one implementation of every symbol core exports; the published bundle contains no inlined second
copy of playtest; the version core reports is derived, not hardcoded.

## Context (verified evidence)

1. `packages/core/src/replay.ts:1` value-imports `parseReplayRecording` and type-imports
   `IReplayRecording` from `@threenative/playtest`; `src/playtest.ts` additionally imports
   `@threenative/playtest/three`. Playtest is a **devDependency only**
   (`packages/core/package.json:43`).
2. The leak used to break standalone consumers' declarations; it was masked, not fixed, by
   `packages/core/tsup.config.ts` setting `noExternal: ["@threenative/playtest"]` — the published
   dist **inlines a private duplicate of playtest**, which can skew from any co-installed
   `@threenative/playtest` and misstates the true dependency direction.
3. `packages/core/src/playtest.ts` hardcodes `CORE_VERSION = "0.1.0"` while the package is at 0.2.0.

**Direction decision (made here, so the executor doesn't have to):** flip the dependency. The
neutral replay protocol (`IReplayRecording`, `parseReplayRecording`) moves INTO core; playtest
imports it FROM core. Harnesses depend on engines, never the reverse — and playtest already treats
engine-facing types as its contract surface. Declaring playtest as a real runtime dep of core was
considered and rejected: it couples the engine package to the test harness forever.

## Integration Ledger

| # | New thing | Live caller (`file:line` — fill during implementation) | Replaces | Old path removed? | Negative control |
|---|-----------|--------------------------------------------------------|----------|-------------------|------------------|
| 1 | Replay protocol owned by core (`IReplayRecording`, `parseReplayRecording`) | `core/src/replay.ts` consumes; playtest's recording/driver modules import from `@threenative/core` | playtest-owned definitions | deleted from playtest (re-exported shim at most, removed once no caller needs it) | packed-tarball typecheck with only declared deps fails while any playtest import remains |
| 2 | `noExternal` removed from core's tsup config | core build → dist | inlined duplicate | entry deleted from tsup.config.ts | grep of published dist for inlined playtest code: present before, absent after |
| 3 | Derived core version constant | `core/src/playtest.ts` reads the package version via its single owner | hardcoded `"0.1.0"` | literal removed | bumping package.json without regenerating makes a pinning spec red |

## Phases

#### Phase 1: Move the protocol, flip the imports

**Files (5):** `packages/core/src/replay-protocol.ts` - NEW (the neutral protocol + parser, moved);
`packages/core/src/index.ts` - EDIT (export); `packages/core/src/replay.ts` - EDIT (local import);
playtest's defining module - EDIT (import from `@threenative/core`, re-export deprecated if other
packages import the old path); `packages/physics` or template callers if any import the old path -
EDIT.

**Implementation:**
- [ ] Grep first for every importer of the playtest-side symbols (`Incumbent census`): list them in
      the execution notes before moving anything.
- [ ] Move code verbatim — no behavior change; the parser's fail-closed error codes stay byte-identical
      (specs pin them today).

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| existing replay specs (both packages) | unchanged suites stay green after the move | identical pass counts | n/a — behavior-preservation phase |
| new spec | `should import the protocol from core, not playtest` | source scan: no `from "@threenative/playtest"` remains under packages/core/src | revert one import → red |

#### Phase 2: Unbundle and prove the consumer lane

**Files (2):** `packages/core/tsup.config.ts` - EDIT (drop the `noExternal` entry);
`packages/core/package.json` - EDIT if the devDep can now drop entirely (keep whatever the specs need).

**Verification (the proof this PRD exists for):**
```bash
pnpm --filter @threenative/core build
grep -c "parseReplayRecording\|TN_REPLAY" packages/core/dist/*.js   # protocol present ONCE, own code
pnpm pack --pack-destination /tmp/core-pack                         # then:
# in a scratch dir: npm install <tarball> typescript three --no-workspace; tsc --noEmit a consumer file
```
Expected: dist contains no bundled playtest module ids; the lone-dependency consumer typechecks.
Negative control: run the same consumer typecheck against the CURRENT published shape (pre-change
dist) with playtest absent — record what breaks, so the fix's value is observed, not assumed.

#### Phase 3: One owner for the core version

**Files (3):** `packages/core/src/playtest.ts` - EDIT (consume generated version); NEW tiny
generate step or JSON import per repo idiom (decide by reading how other packages derive version —
if none does, a build-time-generated `version.ts` checked into git is acceptable); spec - EDIT
(pins reported version == package.json version).

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| version pinning spec | `should report the real package version` | equals `package.json` | hand-edit the const stale → red |

#### Verification Plan

1. All replay/game specs green in both packages; paste counts before/after (identical).
2. Packed-tarball consumer typecheck pasted, plus the pre-change negative control.
3. `pnpm publish:check` green.
4. Full gates: `pnpm typecheck && pnpm lint && pnpm test` — pasted.

## Acceptance criteria (consumer-scoped)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | A directory containing ONLY `@threenative/core` (+ its declared deps) typechecks against every export core documents | pasted consumer session |
| 2 | No playtest code ships inside core's dist | pasted grep of dist |
| 3 | Core's self-reported version matches its package.json on the day of release | pasted spec |
| 4 | Zero behavior change: every existing replay/recording test passes untouched | pasted counts |

## Deliberately out of scope

- Any change to the replay wire format or error codes.
- Publishing mechanics themselves (release tags / hosted runs are the consumer-lane work tracked in
  the batch README's strategy section).
