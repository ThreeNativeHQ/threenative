<!-- schemaVersion: 1 -->

# Parity ledger reconciliation — 2026-08-15

PRD-076 Phase 0. This file records what a code-level adjudication and one new instrument can
say about the two 2026-08-10 parity ledgers, and — separately, and just as importantly — which
lanes were **not** re-executed. It makes no mobile-readiness claim, no iOS claim and no
physical-hardware claim. Phases 1, 2 and 3 of PRD-076 have not started.

Tree under test: `5848aada` (`main`), in the worktree `worktree-agent-a3d20b1a44c917c0e`.

**A Phase 0 that cannot reproduce either ledger is a valid Phase 0 result.** That is the result
here: **no lane was re-executed**, so neither ledger was reproduced, and that is recorded as
the finding rather than dressed up as one. What *was* settled was settled without a lane — by
reading the code that assigns an exit code, and by the reports that happen to have survived on
one machine's disk.

## 1. The verdict on the r2 desktop exit cell

`docs/verification/parity-2026-08-10-r2.md:17` records the desktop lane as
`66 pass / 0 fail / 1 blocked`, exit **`0`**. The runner cannot emit that exit code, and this is
checkable without running a lane.

The r2 ledger was added by commit `c8cdc18c`. At that commit:

```console
$ git show c8cdc18:packages/runtime-native/conformance/run-conformance.mjs | grep -A5 "^function reportExitCode"
function reportExitCode(report) {
  if (report.summary.fail > 0) return 1;
  if (report.summary.blocked > 0) return 2;
  return 0;
}
```

That function is the only thing that sets a lane's exit code — the runner's single assignment is
`process.exitCode = report.supplemental?.androidMultitouch?.status === "fail" ? 1 :
reportExitCode(report)`, and the desktop lane emits no `supplemental` block, so the override
cannot apply. Executing the rule as it existed at that commit, against each cell of both ledgers:

```console
$ git show c8cdc18:packages/runtime-native/conformance/run-conformance.mjs \
    > packages/runtime-native/.runtime/prd076/run-conformance-c8cdc18.mjs
$ node --input-type=module -e "
import { readFileSync } from 'node:fs';
const source = readFileSync('packages/runtime-native/.runtime/prd076/run-conformance-c8cdc18.mjs','utf8');
const body = source.match(/function reportExitCode\(report\) \{[\s\S]*?\n\}/u)[0];
const rule = new Function('report', body + '; return reportExitCode(report);');
for (const [label, summary] of [
  ['r2 desktop 66/0/1', { pass: 66, fail: 0, blocked: 1 }],
  ['tier-1 desktop 65/1/1', { pass: 65, fail: 1, blocked: 1 }],
  ['browser 67/0/0', { pass: 67, fail: 0, blocked: 0 }],
  ['tier-1 android 27/40/0', { pass: 27, fail: 40, blocked: 0 }],
]) console.log(label.padEnd(24), '-> exit', rule({ summary }));
"
r2 desktop 66/0/1        -> exit 2
tier-1 desktop 65/1/1    -> exit 1
browser 67/0/0           -> exit 0
tier-1 android 27/40/0   -> exit 1
```

**Verdict: the r2 desktop exit cell is wrong.** Every other exit cell in both ledgers is
consistent with its own pass/fail/blocked numbers; that one is not. The rule is byte-identical at
`734b2071` (which landed the tier-1 ledger), at `c8cdc18` (which landed r2) and at `HEAD`, so no
runner either ledger could have been written against would emit `0` for that summary.

**The defect is transcription, not fabrication.** The row's own Outcome column reads *"Executed
and green for runnable rows"*, and `0` is what "green" is worth writing down as. Somebody
recorded what the run **meant** instead of what it **returned**, and nothing in the repository
compared the two. `packages/runtime-native/tests/tier-1-ledger.test.mjs` validates the *other*
ledger's schema, which is why an impossible number in this one passed every gate.

## 2. The reports behind the two ledgers

The `.runtime/` and `artifacts/` trees are untracked, so this is a question about what survives
on the operator's disk, not about what is in git. Checked in the operator's main working tree at
`/home/joao/projects/threejs-webgpu`:

| Ledger row | `--out` path named | Report survives? |
|---|---|---|
| both ledgers, Browser | `packages/runtime-native/artifacts/conformance/web/report.json` | **yes**, written 2026-08-11T00:15:58Z |
| r2, Desktop Linux | `packages/runtime-native/.runtime/parity-desktop3/report.json` | **yes**, written 2026-08-11T00:25:44Z |
| r2, Android emulator | `packages/runtime-native/.runtime/parity-android3/report.json` | **yes**, written 2026-08-11T01:03:05Z |
| tier-1, Desktop Linux | `packages/runtime-native/.runtime/prd064/desktop-full/report.json` | **no** — `.runtime/prd064/` contains only `android-main-focused` |
| tier-1, Android emulator | `packages/runtime-native/.runtime/prd064/android-full-2/report.json` | **no** |

Read directly, the three surviving reports say:

| Report | `summary` | exit by the rule | ledger's Exit cell |
|---|---|---:|---:|
| `artifacts/conformance/web` | 67 / 0 / 0 | 0 | 0 (both ledgers) |
| `.runtime/parity-desktop3` | 66 / 0 / 1 | **2** | **0** (r2) |
| `.runtime/parity-android3` | 67 / 0 / 0, `supplemental.androidMultitouch: pass` | 0 | 0 (r2) |

The desktop report's single non-pass row is `90-multitouch-input: blocked` — the registry
exclusion, which is the runner being right. So the r2 ledger's **counts** are all faithful to
their reports. Only its desktop **exit** cell is not.

**This does not settle the desktop question in r2's favour.** The two ledgers disagree about
whether `25-camera-parented-overlay` passes on desktop, and the tier-1 run that says it fails no
longer has a report. Two reports that no longer both exist cannot be ordered against each other,
which is the gap Phase 0 exists to close going forward, not backwards.

## 3. `pnpm parity:ledger`, the new instrument

`scripts/check-parity-ledger.ts` performs two independent checks per ledger row, and fails
closed on both:

- **internal consistency** — recompute `Exit` from the row's own Pass/Fail/Blocked with the
  runner's exported `reportExitCode`. This catches the r2 cell with no report present at all.
- **report agreement** — resolve the row's `--out` the way the runner's `outputLayout` does, read
  the report, and compare every cell. A missing or unreadable report is a hard failure, never a
  skip.

Run against the r2 ledger with **no** reports present (the state of a fresh clone):

```console
$ pnpm parity:ledger docs/verification/parity-2026-08-10-r2.md
FAIL .../docs/verification/parity-2026-08-10-r2.md
  Browser / Command: names --out report .../packages/runtime-native/artifacts/conformance/web/report.json, which does not exist, so no cell in this row is traceable.
  Desktop Linux / Exit: records exit 0, but a summary of 66 pass / 0 fail / 1 blocked exits 2. The runner cannot emit the recorded value.
  Desktop Linux / Command: names --out report .../packages/runtime-native/.runtime/parity-desktop3/report.json, which does not exist, so no cell in this row is traceable.
  Android emulator / Command: names --out report .../packages/runtime-native/.runtime/parity-android3/report.json, which does not exist, so no cell in this row is traceable.
EXIT=1
```

Run again after copying the three surviving reports from the operator's main working tree into
this worktree's untracked `.runtime/` and `artifacts/`, so the ledgers' relative `--out` paths
resolve — the reports are the genuine 2026-08-10 artifacts, only their location was supplied:

```console
$ pnpm --silent parity:ledger docs/verification/parity-2026-08-10-r2.md
FAIL .../docs/verification/parity-2026-08-10-r2.md
  Desktop Linux / Exit: records exit 0, but a summary of 66 pass / 0 fail / 1 blocked exits 2. The runner cannot emit the recorded value.
  Desktop Linux / Exit: records exit 0, but .../packages/runtime-native/.runtime/parity-desktop3/report.json recomputes to exit 2.
EXIT=1

$ pnpm --silent parity:ledger docs/verification/tier-1-2026-08-10.md
FAIL .../docs/verification/tier-1-2026-08-10.md
  Desktop Linux / Command: names --out report .../packages/runtime-native/.runtime/prd064/desktop-full/report.json, which does not exist, so no cell in this row is traceable.
  Android emulator / Command: names --out report .../packages/runtime-native/.runtime/prd064/android-full-2/report.json, which does not exist, so no cell in this row is traceable.
EXIT=1
```

Both ledgers are red, for different reasons, and the reasons are the finding: r2 carries one
impossible cell; tier-1 carries two untraceable rows.

## 4. Provenance in the report

`REPORT_SCHEMA_VERSION` moves `0.2.0` → `0.3.0` and every report now carries a `provenance`
object. `validateReport` requires it, and rejects an unrecognised field at the top level of the
report or inside `provenance` — accepting an unknown key is how a schema stops meaning anything.

```console
$ node packages/runtime-native/conformance/run-conformance.mjs --dry-run --out /tmp/dry.json
$ node -e "const r=require('/tmp/dry.json'); console.log(r.schemaVersion); console.log(JSON.stringify(r.provenance,null,2))"
0.3.0
{
  "commit": "5848aada6cdee3fda56c8bef4381b092bec93556",
  "dirty": true,
  "runtimeSha256": null,
  "referenceSetSha256": null,
  "device": null,
  "env": [
    { "key": "ANDROID_HOME", "valueSha256": null },
    { "key": "ANDROID_SDK_ROOT", "valueSha256": null },
    { "key": "DISPLAY", "valueSha256": "19e89348f2a9d5f3d0c5fca8e2a7068d9c5d71687a355f759009a5ed2527eb2c" },
    ... 10 more keys, sorted, values hashed
  ]
}
```

Two design points worth stating, because both were decisions:

- **An unset key is recorded with a `null` digest, not omitted.** "`ANDROID_SDK_ROOT` was not
  set" is precisely the observation that separates the two 2026-08-10 Android commands, so it has
  to survive into the report. A key that is simply missing from the list would be indistinguishable
  from a runner that stopped reading it.
- **Values are hashed, never printed.** A provenance block says two runs saw a different
  `ANDROID_SDK_ROOT` without publishing anyone's home directory. A test asserts the serialised
  block contains no value.

`git rev-parse HEAD` failing is a hard error (`TN_PARITY_PROVENANCE_UNAVAILABLE`), not a
fallback: a run that cannot name its tree should not produce a report a ledger can cite.

## 5. Which lanes executed, and which did not

**None of the three parity lanes were re-executed.** Recorded as **unexecuted** — not as a pass,
not as a red.

| Lane | Status | Why |
|---|---|---|
| Browser (WebGPU) | **unexecuted** | Needs a headed Chromium on the shared GPU. The session coordinator placed a hold on all headed-browser and GPU work for this window: another session is running a headed Chromium gate in the shared tree, and two concurrent headed sets on this GPU already starved a gate into a 15-minute hang today. Reachable in principle; a window has to be arranged |
| Desktop Linux native | **unexecuted** | Needs `pnpm native:build` (opt-in CMake + third-party download; `packages/runtime-native/build/tn-linux` does not exist in this worktree) *and* a GPU-backed X11 run of the conformance lane, which the same hold covers. The compile alone yields no Phase 0 number — the number requires the run |
| Android emulator | **unexecuted** | No emulator is attached. `adb devices -l` lists one **physical** Pixel 8 (`37251FDJH0037Z`) and no `emulator-*` serial, and `--target android` refuses a physical device by design (`assertAndroidEmulator` → `TN_PARITY_ANDROID_EMULATOR_REQUIRED`). The `27/40` versus `67/0` question therefore stays open |

The PRD's `ANDROID_SDK_ROOT` / `ANDROID_HOME` hypothesis for the 40-row Android delta is
**untested**. Both variables are unset in this session's environment — the same shape as the
tier-1 command that produced `27/40`, and the opposite of the r2 command that produced `67/0`.
That is suggestive and nothing more; with no emulator, no run can be made either way. What has
changed is that the next run of either command will record which of the two it was, as two
digests that differ, rather than leaving a reader to infer it from a shell line in a markdown
file.

## 6. Is the reference-set hash behind each 2026-08-10 run recoverable?

**No, and that is the finding.**

No report written before today records a `referenceSetSha256`, which is the whole reason
PRD-076 exists. What survives is a directory:
`packages/runtime-native/artifacts/conformance/web` in the operator's main tree, 68 PNGs, 67 of
them written 2026-08-10 between 17:16 and 17:17 local — after the browser run that produced them
(17:15) and before the desktop run that consumed them (17:38). Hashed today with the new
function, that directory is:

```
referenceSetSha256(artifacts/conformance/web today) = 25599d6ea462ea320326d95e306b5d5093f86e4690213384934b75deb33ac8e5
```

That number is **not** the reference-set hash of either 2026-08-10 run. It is the hash of what
sits on one machine's disk today, and the mtimes are an argument, not a proof — a file can be
rewritten with its own contents, and one of the 68 PNGs is a day older than the rest. Nothing
recorded at the time can confirm the bytes the desktop and Android runs actually compared
against. Recording it here as a datum with that caveat is the honest ceiling; asserting it as
the runs' reference hash would be exactly the failure this PRD is about.

## 7. Negative controls, observed red

Every control below was run and its output is pasted.

| # | Control | Command | Observed |
|---|---|---|---|
| 1 | Delete the provenance requirement from `validateReport` | see below | red: the test that holds the requirement fails |
| 2 | Feed the checker the exact r2 desktop row (`66/0/1`, exit `0`) | `pnpm parity:ledger docs/verification/parity-2026-08-10-r2.md` | red, naming the cell (§3) |
| 3 | Change one digit in a ledger cell | see below | red, naming the cell and both numbers |
| 4 | Point a ledger row's `--out` at a path with no report | see below | red, naming the missing report |

**Control 1 — the provenance requirement is what holds the test.** With the single line
`errors.push(...validateProvenance(report.provenance))` commented out of `validateReport`:

```console
$ pnpm exec vitest run --config packages/runtime-native/vitest.config.ts --dir packages/runtime-native packages/runtime-native/tests/conformance-report.test.mjs
 ❯ packages/runtime-native/tests/conformance-report.test.mjs (5 tests | 2 failed) 102ms
   × should reject a report with no provenance commit 15ms
   × provenance fails closed on unrecognised fields and unsorted environment keys 3ms

 FAIL  packages/runtime-native/tests/conformance-report.test.mjs > should reject a report with no provenance commit
AssertionError: a report with no provenance commit must not validate
 ❯ packages/runtime-native/tests/conformance-report.test.mjs:56:10

 FAIL  packages/runtime-native/tests/conformance-report.test.mjs > provenance fails closed on unrecognised fields and unsorted environment keys
AssertionError: The input did not match the regular expression /provenance\.reason is not a recognised provenance field/u. Input: ''

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

The line was restored immediately and the same command then reported `Tests 5 passed (5)`.

**Control 3 — one digit changed in the Browser row's Pass cell (`67` → `66`):**

```console
$ sed '/^| Browser |/s/| 67 | 0 | 0 | 0 |/| 66 | 0 | 0 | 0 |/' docs/verification/parity-2026-08-10-r2.md \
    > packages/runtime-native/.runtime/prd076/r2-one-digit-changed.md
$ pnpm --silent parity:ledger packages/runtime-native/.runtime/prd076/r2-one-digit-changed.md
FAIL .../packages/runtime-native/.runtime/prd076/r2-one-digit-changed.md
  Browser / Pass: records 66, but .../packages/runtime-native/artifacts/conformance/web/report.json reports 67.
  Desktop Linux / Exit: records exit 0, but a summary of 66 pass / 0 fail / 1 blocked exits 2. The runner cannot emit the recorded value.
  Desktop Linux / Exit: records exit 0, but .../packages/runtime-native/.runtime/parity-desktop3/report.json recomputes to exit 2.
EXIT=1
```

**Control 4 — the desktop row's `--out` repointed at a path with no report:**

```console
$ sed 's#--out .runtime/parity-desktop3#--out .runtime/prd076/deleted-report#' docs/verification/parity-2026-08-10-r2.md \
    > packages/runtime-native/.runtime/prd076/r2-deleted-report.md
$ pnpm --silent parity:ledger packages/runtime-native/.runtime/prd076/r2-deleted-report.md
FAIL .../packages/runtime-native/.runtime/prd076/r2-deleted-report.md
  Desktop Linux / Exit: records exit 0, but a summary of 66 pass / 0 fail / 1 blocked exits 2. The runner cannot emit the recorded value.
  Desktop Linux / Command: names --out report .../packages/runtime-native/.runtime/prd076/deleted-report/report.json, which does not exist, so no cell in this row is traceable.
EXIT=1
```

## 8. Gates

| Gate | Exit | Result |
| --- | ---: | --- |
| `pnpm test` | 0 | Passed. Root Vitest 142 files / 1,255 passed / 35 skipped (twice — once through `@threenative/playtest`, once as the final root run), runtime-native Vitest 43 files / 248 passed / 37 skipped, physics parity Vitest 24 passed, Rust parity 1 passed. |
| `pnpm typecheck` | 0 | Passed across the root project and all twelve workspace projects. |
| `pnpm lint` | 0 | Passed; Biome checked 819 files, 215 warnings, no errors. |
| `pnpm budgets` | 0 | Passed the hard invariants. Both review triggers reported, neither silenced: framework LOC 15,077 / 15,000 (untouched by this change) and native runtime LOC 71,401 / 50,000. |

This change moves the native runtime census by **+348 lines** — `conformance/` +198 for the
`provenance` block, `tests/` +150 for its contract test. The census table in
`docs/verification/PRD-116-native-physics-actuation.md` is updated to match, with the delta
attributed to PRD-076, because `pnpm budgets` fails closed when the recorded census stops
equalling the measured LOC. Kill-switch pass on what was added: the question those 348 lines
answer is whether a parity number can be traced to the run that produced it, and today it cannot
— that is exactly the defect adjudicated in §1. They stay.

**One `pnpm test` failure on a clean `5848aada` is pre-existing and belongs to another lane.**
`scripts/__tests__/sync-agent-docs.spec.ts > should keep the repository mirrors in sync` reports
`docs/benchmark/sweeps/physics-puzzle-2026-08-15-6/CLAUDE.md` as drifted, because commit
`b10db823` added that directory's `AGENTS.md` without running `pnpm sync:agents` to generate its
mirror. It was confirmed pre-existing by stashing every change in this branch and re-running the
spec against a pristine `5848aada`:

```console
$ git stash push -u -m prd076-wip
$ pnpm exec vitest run scripts/__tests__/sync-agent-docs.spec.ts packages/create-threenative/__tests__/build.spec.ts
   × should keep the repository mirrors in sync 285ms
 FAIL  scripts/__tests__/sync-agent-docs.spec.ts > sync-agent-docs > should keep the repository mirrors in sync
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ "docs/benchmark/sweeps/physics-puzzle-2026-08-15-6/CLAUDE.md" ]
 Test Files  1 failed | 1 passed (2)
```

`docs/benchmark/sweeps/**` is owned by another session in this window and is not edited here.
Something in the test run itself regenerates the mirror on disk, which is why the green
`pnpm test` above no longer shows the failure — the file is present and untracked in this
worktree and is deliberately **not** part of this commit. The lane that owns that path still owes
`git add docs/benchmark/sweeps/physics-puzzle-2026-08-15-6/CLAUDE.md`, and until it lands, a fresh
clone of `main` is red on this spec.

One further failure appeared in the first full `pnpm test` of this branch —
`packages/create-threenative build.spec.ts > delegates byte-identically to the same Vite binary
for every template`, on `.mcp.json` missing `threenative-sculpt`. It did **not** reproduce on
the second full run, and the spec passes in isolation both with and without this branch's
changes. Recorded as a flake, not attributed to this change and not explained away either.

**`pnpm test` on this host is load-sensitive, and a red under load is not a result.** Verifying
this commit, the full suite failed twice on a single test:

```console
FAIL packages/core/__tests__/build.spec.ts > core package build >
     should bundle a usable import-meta declaration for the hot subpath
Error: Test timed out in 15000ms.
```

That test passes in isolation in **10.4s** against its 15s budget. The failure was proved
environmental rather than attributed by argument: `main` was checked out detached at `5848aada`
and the full suite re-run under the same load, producing the identical single failure. The load
average at the time was **52 on 24 cores** — three concurrent Claude sessions, a golden-path
gate and a full suite on one machine. Re-run at load 14, the same commit reports `pnpm test`
exit **0**. Nothing about the margin is comfortable: a 10.4s test with a 15s budget will keep
failing whoever is unlucky, and that is worth a PRD in the lane that owns `packages/core`, not a
silent bump here.

## 9. Scope note

PRD-076 Phase 0 lists five files. Nine were touched. Two of the extras are the budget census this
change moves — `docs/verification/PRD-116-native-physics-actuation.md` and its hard-coded mirror
in `packages/physics/__tests__/actuation.spec.ts`, which both fail closed when the recorded census
stops equalling the measured LOC (see §8). Neither is a judgement call: `pnpm budgets` and
`pnpm test` are red until the arithmetic matches. The other two are
`packages/runtime-native/tests/parity-contract.test.mjs` and
`packages/runtime-native/tests/conformance-runner.test.mjs`, which each build a synthetic report
with a hard-coded `schemaVersion: "0.2.0"` and assert it validates clean. Bumping the schema
necessarily breaks them, and their failure was observed before they were updated — it is the
revert check for the requirement, arriving early:

```console
 × execution reports have only pass, fail, and blocked states
 × Android reports fail closed when multitouch supplemental evidence is missing
 Test Files  2 failed (2)
      Tests  2 failed | 46 passed (48)
```

Each was updated by adding `provenance: buildProvenance()` and the new schema version, and
nothing else.

## 10. What this does and does not license

- The r2 desktop exit cell is **adjudicated wrong** on code evidence and on its own surviving
  report. Phase 3 will mark it superseded and name the cell; this document does not edit either
  predecessor ledger.
- Which ledger's **desktop merit result** is right — does `25-camera-parented-overlay` pass — is
  **not** settled here. The tier-1 report that recorded the failure no longer exists.
- The Android `27/40` versus `67/0` split is **not** settled here and no lane was re-run.
- No Tier 1 claim, no beta row 4 or 5 change, and no update to `ROADMAP.md` or
  `VALUE-PROPOSITION.md` — those are Phase 3, and Phase 3 is not authorised by a Phase 0 that
  re-executed nothing.
