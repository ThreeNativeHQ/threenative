# PRD-374 phase 1 — doctor predicts the requested build's prerequisite failure

Candidate: branch `prd374/doctor-target-prerequisites`, implementation commit **`9d50cb878`**, based
on `main` at `30f749f12`. Host: linux-x64, Node `process.execPath` from the repo toolchain.
Worktree: `.claude/worktrees/prd374-doctor`.

The gates below were first run against commit `c9dd6288a` on `main` at `97d0f5c51`. That base was
re-applied on `main` under different SHAs, so the branch was rebuilt as the same net diff on current
`main`: `c9dd6288a` → `9d50cb878`, `9e61a62a6` → `4568451c9`, content unchanged
(`backup/prd374-preRebase` keeps the old tip). The suites were re-run on the rebuilt commits and
report the same results: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `doctor.spec.ts` 68 passed at the time of writing (89 now) and
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
| `pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts` | 68 passed (7 new), exit 0 **at `9d50cb878`, which is the commit this record describes**. Measured now: **89 passed**. The growth is the five review rounds' regression tests, added in `c037860f2`, `6d3b1b4e8`, `7cc0b1890`, `6fc5e50db`, `3b33d026c`, `3513ee8ad` and `6f4b344f4`. |
| `pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts` | 5 passed, exit 0 |
| `pnpm typecheck` | clean, exit 0 |
| `pnpm lint` | exit 0. **697 pre-existing warnings measured now**; the 696 this row used to carry was overtaken by the review rounds' tests, which the fifth review caught. One biome format error on the new test was autofixed before commit. |

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
! target desktop: unavailable — no install status recorded     (already warn here — see below)
```

That project still exits 1 on three failures of its own — `capability search`, `playtest` and
`editor activation` — which predate this change and are unrelated to targets. (Corrected by the
fifth review: this line used to name `native entry`, which is `!` and not `✗` under a web request,
because `6fc5e50db`/`3513ee8ad` demote it; and it omitted `editor activation`, which does fail.)

## Not run

- **Independent reviewer: five rounds have run, every one returning FAIL.** This bullet used to
  read "NOT RUN", which the file itself contradicted two sections below; the fifth review caught it.
  Round 1 found `pnpm budgets` red on the branch (stale retention index) and a dead commit SHA.
  Round 2 found the requested target line naming only satisfied facts. Round 3 confirmed that fix
  and found three phase-2 defects. Round 4 found the same "available beside not buildable" bug
  surviving on `--target desktop`, and an annotation claiming a demotion that never happened — see
  "Correction, third independent review" and "Correction, fourth independent review" below. Round 5
  found the six documentation defects corrected in this revision and no code defect: *"the
  implementation passes every check I could devise"*. The box stays open until a round returns PASS.
- `pnpm test` aborts in `packages/runtime-native`: 18 failures, all of the form
  `<path>/build/tn-linux/<target> is not built` plus the `pump-silence` suite, because this fresh
  worktree has no compiled C++ host. Environmental, not caused by a TypeScript change confined to
  `packages/create-threenative`. The root suite was not separately completed in this session.
- `pnpm budgets` exit 0 — added after the first independent review found it red on this branch
  (a stale `docs/benchmark/SCREENSHOT-RETENTION.md`, regenerated in `811eae6ef`). Re-run against
  the review fixes: exit 0.
- Phase 2 (tool discovery / Blender / editor activation) NOT STARTED.

## Correction, third independent review — the demotion was never observed here

The annotation above originally read `(demoted from fail to warn)`. It was wrong, and the reviewer
proved it by running both forms: `examples/engine-load-test`'s desktop target is
`unknown — no install status recorded`, which is **already** `warn`, so the scoped and unscoped
reports print the identical line. The mechanism is real and unit-covered (`unrequestedTarget`,
`doctor.spec.ts`), but this project could never demonstrate it.

Observed instead in `../sandbox/prd221-16kb-starter`, a real scaffolded game whose runtime prebuilt
404s, so its desktop target genuinely fails:

```
unscoped        ✗ target desktop: unavailable — linux-x64: Prebuilt release manifest fetch failed
                  for 'linux-x64' at …/runtime-native-v0.3.1/prebuilt-lock.json: HTTP 404.
--target web    ! target desktop: unavailable — linux-x64: … HTTP 404.
                ✓ requested build: buildable — web
```

Same project, same line, `✗` to `!` — a web request stops a broken desktop runtime voting on the
exit code, without hiding it.
