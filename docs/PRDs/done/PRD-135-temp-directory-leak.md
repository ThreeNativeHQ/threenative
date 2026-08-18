---
prd_contract: v1
---

# PRD-135 — The test suite leaks temp directories, and the failure it eventually causes looks like something else

**Status:** COMPLETE, 2026-08-18. Acceptance is recorded in
`docs/verification/prd-135-temp-leak-2026-08-17.md`; the suite-level count stayed unchanged and
the guard and failure-path cleanup controls passed.

**Outcome:** a suite run leaves no `/tmp/threenative-*` directory behind, and a spec that creates
one without registering its cleanup fails the guard rather than the disk.

**Depends on:** nothing.

**Blocks:** nothing. It removes a recurring false diagnosis.

**Complexity: 4 → MEDIUM mode.** One helper, ~68 call-site files, one guard. Mechanical but wide.

**Blast radius: ~70 files**, almost all of them `packages/*/__tests__/*.spec.ts` and
`scripts/__tests__/*.spec.ts`, plus one new shared helper and one guard spec.

---

## 1. Evidence

`mkdtemp` appears at **205 call sites across 68 files** in `packages/`, `scripts/` and
`playwright.config.ts`. Cleanup coverage, counted per file on 2026-08-17:

| Pattern | Files | Example |
| --- | --- | --- |
| Creates and never removes | **~30** | `packages/playtest/__tests__/scenario.spec.ts` — 17 `mkdtemp`, 0 `rm` |
| Removes on the happy path only | ~20 | `packages/create-threenative/__tests__/build.spec.ts` — 6 `mkdtemp`, 1 `rm`, 0 `finally` |
| Cleans up properly | ~18 | `scripts/__tests__/verify-golden-path.spec.ts` — 9 `mkdtemp`, 8 `rm`, 8 `finally` |

`scenario.spec.ts` alone leaks a directory per case, every run, forever.

**The cost is not the disk.** It is the misdiagnosis: round 9 found 146 leaked directories and the
resulting suite failure was read as machine contention twice before the cause was found. A leak
that fails as something else is worse than a leak that fails as itself.

**One correction to the round-9 record, so this PRD does not inherit a wrong number.** The 28
`/tmp/threenative-*` directories present on this machine as of 2026-08-17 — 1.5 GB — carry the
prefixes `hosted-turn` (19), `edit-turn` (6) and `refusal` (3). None of those exist in this
repository; they come from `threenative-live-studio`, which moved out on 2026-08-16. So the
current on-disk pile is **not** this repository's, and this PRD is justified by the call-site
audit above rather than by that number. The engine's own leak is real and structural; it is simply
not what is sitting in `/tmp` today.

## 2. What lands

1. **One helper**, in a test-support module both `packages/*/__tests__` and `scripts/__tests__`
   can import — `makeTempDir(prefix)`, which creates the directory and registers its removal on
   the current test's teardown (`onTestFinished`, so it runs on failure too, not just on pass).
2. **Every call site migrates.** Mechanical: `await mkdtemp(path.join(os.tmpdir(), "x-"))` →
   `await makeTempDir("x-")`. Do the migration in one commit per package so a revert is cheap.
3. **A guard spec** that greps the test tree for `mkdtemp(` outside the helper and fails, naming
   each file. An allowlist is permitted only for `packages/playtest/src/runner/*.ts` and
   `scripts/*.ts` — production code that legitimately creates temp directories at runtime and owns
   its own lifecycle — and each entry needs a one-line reason next to it.
4. **A suite-level assertion**: after `pnpm test`, `/tmp/threenative-*` count is unchanged from
   before it. `packages/playtest/__tests__/orphan-cleanup.sh` already exists and does something
   adjacent; extend it rather than adding a second mechanism.

## 3. Acceptance

| # | Command | Required result |
| --- | --- | --- |
| 1 | `ls -d /tmp/threenative-* \| wc -l`, then `pnpm test`, then the same command | **identical counts** |
| 2 | `pnpm vitest run scripts/__tests__/temp-dir-guard.spec.ts` | pass |
| 3 | add a bare `mkdtemp` to any spec, re-run #2 | **fails**, naming that file |
| 4 | make one migrated spec throw mid-test, run it | its directory is still removed |
| 5 | `pnpm test` | exit `0` |

Step 4 is the one that distinguishes this from the `rm`-at-the-end pattern already present in
~20 files, which is what produced the leak in the first place.

Evidence: `docs/verification/prd-135-temp-leak-2026-08-17.md`, with #1's two counts pasted.

## 4. Do this second, not first

The migration touches ~70 files and will collide with any other work in the test tree. Land the
rest of this batch first, then this, in its own commit. It is the only item here with a wide
diff and no user-visible result.
