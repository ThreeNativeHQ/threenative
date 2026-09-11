# PRD-374 phase 1 — doctor predicts the requested build's prerequisite failure

Candidate: branch `prd374/doctor-target-prerequisites`, implementation commit **`9d50cb878`**, based
on `main` at `30f749f12`. Host: linux-x64, Node `process.execPath` from the repo toolchain.
Worktree: `.claude/worktrees/prd374-doctor`.

The gates below were first run against commit `c9dd6288a` on `main` at `97d0f5c51`. That base was
re-applied on `main` under different SHAs, so the branch was rebuilt as the same net diff on current
`main`: `c9dd6288a` → `9d50cb878`, `9e61a62a6` → `4568451c9`, content unchanged
(`backup/prd374-preRebase` keeps the old tip). The suites were re-run on the rebuilt commits and
report the same results: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `doctor.spec.ts` 68 passed at the time of writing and
`cli.spec.ts` 5 passed.

## What changed

`threenative doctor` accepts `--target web|desktop|android|ios` and `--mode debug|release`. A named
target makes that target's prerequisites decide the report: the downloaded runtime's install status,
the Android packager, JDK 17, the `android-35` platform, and — for `--mode release` — the four
`ORG_GRADLE_PROJECT_threenative*` signing properties the game supplies. Unrequested targets stay in
the report with `fail` demoted to `warn`, so an Android request never demands iOS evidence. With no
`--target` the report is unchanged.

`ANDROID_RELEASE_SIGNING_ENV` in `packages/create-threenative/src/doctor.ts` is the single spelling
of the four signing property names. PRD-212 phase 3 (`packages/runtime-native/scripts/package-android.mjs`)
is the consumer that must read the same four; that handoff is **not yet made** — PRD-212 has not run.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts` | 68 passed (7 new), exit 0. **84 passed** after the two independent reviews' fixes; this record describes `9d50cb878`, and the later fixes are `c037860f2` and the second review's blocker fix. |
| `pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts` | 5 passed, exit 0 |
| `pnpm typecheck` | clean, exit 0 |
| `pnpm lint` | exit 0 (696 pre-existing warnings; one biome format error on the new test was autofixed before commit) |

An earlier `pnpm lint` returned 254 — "Linter process terminated abnormally (possibly out of
memory)" — under three concurrent lanes building on this machine. Re-run alone: exit 0. Recorded
because 254 reads like a gate failure and is not one.

## Observed red, then restored green

Both halves are real CLI runs against real projects, not fixtures.

**Red** — `examples/abyss-framework`, which has the Android packager present, no runtime install
status, and JDK 26.0.2 as the machine default:

```
node packages/create-threenative/dist/threenative.js doctor --target android --mode release --text
✗ requested build: not buildable — android release: no install status recorded; JDK 26.0.2 found;
  Android builds support JDK 17 only; release signing inputs are not set:
  ORG_GRADLE_PROJECT_threenativeKeystore, ORG_GRADLE_PROJECT_threenativeKeystoreAlias,
  ORG_GRADLE_PROJECT_threenativeKeystorePassword, ORG_GRADLE_PROJECT_threenativeKeyPassword
exit 1
```

The same run still prints the legacy line `! target android: available — runtime packager
installed; JDK 26.0.2 found; …` at `warn`. That is the defect this phase closes, preserved
deliberately for the unscoped report.

**Green** — same project, same command, with `JAVA_HOME=/usr/lib/jvm/java-17-openjdk` and the four
signing properties exported:

```
✗ requested build: not buildable — android release: no install status recorded
```

Exactly the two supplied prerequisites disappear; the one genuinely missing input remains. This is
the control that matters: the verdict moves per input, not per code path.

**Green, fully buildable** — `examples/engine-load-test`, which has `src/main.ts`:

```
node packages/create-threenative/dist/threenative.js doctor --target web --text
✓ requested build: buildable — web
! target desktop: unavailable — no install status recorded     (demoted from fail to warn)
```

That project still exits 1 on three failures of its own (`capability search`, `playtest`,
`native entry`) which predate this change and are unrelated to targets.

## Not run

- **Independent reviewer: NOT RUN.** No reviewer subagent has seen this diff. The phase's reviewer
  box stays open.
- `pnpm test` aborts in `packages/runtime-native`: 18 failures, all of the form
  `<path>/build/tn-linux/<target> is not built` plus the `pump-silence` suite, because this fresh
  worktree has no compiled C++ host. Environmental, not caused by a TypeScript change confined to
  `packages/create-threenative`. The root suite was not separately completed in this session.
- `pnpm budgets` exit 0 — added after the first independent review found it red on this branch
  (a stale `docs/benchmark/SCREENSHOT-RETENTION.md`, regenerated in `811eae6ef`). Re-run against
  the review fixes: exit 0.
- Phase 2 (tool discovery / Blender / editor activation) NOT STARTED.
