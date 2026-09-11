# Execution strategy — moving production-readiness PRDs to `done/` (2026-09-11)

Working document for one day of execution. Not a PRD. It plans *how* the eleven PRDs in this
folder get closed, in what order, on how many lanes; it changes no scope and ticks no box.

**Live progress — measured, each PRD on the branch that carries its work.** Re-run
`pnpm prd:progress <file>` in that branch's worktree; nothing here is hand-counted.

| PRD | Phase boxes | Acceptance | Label | Δ today | Where the work is |
| --- | --- | --- | --- | --- | --- |
| [PRD-374](PRD-374-doctor-predicts-the-requested-build-prerequisite.md) | **9/12** | 0/5 | `prd:75%` | **0 → 9** | PR #198 |
| [PRD-262](PRD-262-the-runtime-native-prebuilt-release-exists.md) | **20/28** | **5/9** | `prd:50%` | 8 → 20 | PR #193 |
| [PRD-078](PRD-078-toolchain-free-consumer-proof.md) | 20/54 | 4/4 | `prd:25%` | — | main |
| [PRD-221](PRD-221-android-v8-is-16kb-clean.md) | **8/18** | 0/5 | `prd:25%` | **0 → 8** | PR #197 |
| [PRD-373](PRD-373-selective-ci-and-develop-promotion.md) | **4/20** | n/a | `prd:25%` | **0 → 4** | PR #199 |
| [PRD-060](PRD-060-promoted-consumer-distribution.md) | 0/24 | 0/5 | `prd:0%` | — | blocked: credentials, a person |
| [PRD-212](PRD-212-published-install-builds-android.md) | 0/18 | 0/5 | `prd:0%` | — | not started (checked: genuinely 0) |
| [PRD-217](PRD-217-webview-ui-layer.md) | 0/30 | 0/5 | `prd:0%` | — | blocked: no Windows/macOS host |
| [PRD-365](PRD-365-consumer-desktop-distribution.md) | 0/18 | 0/5 | `prd:0%` | — | blocked: hosts, signing |
| [PRD-366](PRD-366-one-consumer-game-proves-supported-platforms.md) | 0/18 | 0/5 | `prd:0%` | — | blocked: everything above |
| [PRD-375](PRD-375-release-artifacts-carry-the-game-brand.md) | 0/12 | 0/5 | `prd:0%` | — | not started |

**61 of 232 phase boxes, plus 9 acceptance boxes — 26%, from 28 boxes (12%) at the start of the
day.** Four PRDs moved off zero. None has reached `done/`: every one of the four is held by an
independent review, a device lane or an external blocker, and no box was ticked to make the table
look better.

Merge queue: **#194 and #195 merged**, **#196 closed as superseded** (its one remaining change was
a regression `main`'s own test rejects), **#193 rebuilt on `main` and pushed**. The original
`Measured start state` table this document opened with is preserved below for comparison.

<details>
<summary>Start of day, 2026-09-11 (commit <code>0022cd9af</code>)</summary>

| PRD | Phases | Boxes | Acceptance | Label |
| --- | --- | --- | --- | --- |
| [PRD-262](PRD-262-the-runtime-native-prebuilt-release-exists.md) | 0/2 | 8/12 | 0/5 | `prd:50%` |
| [PRD-078](PRD-078-toolchain-free-consumer-proof.md) | 0/9 | 20/54 | 4/4 | `prd:25%` |
| [PRD-060](PRD-060-promoted-consumer-distribution.md) | 0/4 | 0/24 | 0/5 | `prd:0%` |
| [PRD-212](PRD-212-published-install-builds-android.md) | 0/3 | 0/18 | 0/5 | `prd:0%` |
| [PRD-217](PRD-217-webview-ui-layer.md) | 0/5 | 0/30 | 0/5 | `prd:0%` |
| [PRD-221](PRD-221-android-v8-is-16kb-clean.md) | 0/3 | 0/18 | 0/5 | `prd:0%` |
| [PRD-365](PRD-365-consumer-desktop-distribution.md) | 0/3 | 0/18 | 0/5 | `prd:0%` |
| [PRD-366](PRD-366-one-consumer-game-proves-supported-platforms.md) | 0/3 | 0/18 | 0/5 | `prd:0%` |
| [PRD-373](PRD-373-selective-ci-and-develop-promotion.md) | 0/5 | 0/20 | n/a | `prd:0%` |
| [PRD-374](PRD-374-doctor-predicts-the-requested-build-prerequisite.md) | 0/2 | 0/12 | 0/5 | `prd:0%` |
| [PRD-375](PRD-375-release-artifacts-carry-the-game-brand.md) | 0/2 | 0/12 | 0/5 | `prd:0%` |


Total: 11 PRDs, 41 phases, 236 boxes, 28 of them ticked (12%).

</details>

## Starting a session from this document

Hand a new session this file and one lane. Everything it needs is here or linked from here; it
should not need the conversation that produced it.

**Opening prompt for a lane session** — paste it verbatim, swapping the lane line:

> Read `docs/PRDs/production-readiness/EXECUTION-STRATEGY-2026-09-11.md` and follow the repository
> `AGENTS.md` chain. Work lane 1 (PRD-374) to `done/`: every phase box and every acceptance box
> ticked with evidence beside it, one draft PR, the `pnpm prd:progress` label applied on each push,
> and the `git mv` to `docs/PRDs/done/` in the commit that finishes it. Prove each gate locally
> before pushing. Do not tick a box for anything unrun.

Lanes, each independent enough for its own session:

| Lane | PRD | Worktree | State at handoff |
| --- | --- | --- | --- |
| 1 | [PRD-374](PRD-374-doctor-predicts-the-requested-build-prerequisite.md) | `.claude/worktrees/prd374-doctor` (already cut, branch `prd374/doctor-target-prerequisites`) | Defect confirmed: `androidTargetCheck` in `packages/create-threenative/src/doctor.ts:1160` returns `available — …` with status `warn` when the JDK is unusable. No code written yet. |
| 2 | [PRD-212](PRD-212-published-install-builds-android.md) | cut a new one | Not started. Owns `package-android.mjs` after lane 4 hands off. |
| 3 | [PRD-262](PRD-262-the-runtime-native-prebuilt-release-exists.md) | use the open PRs' worktrees | `prd:50%`; PRs #193 and #194 carry the rest. Blocked on decision 2 for its user-verification boxes. |
| 4 | [PRD-221](PRD-221-android-v8-is-16kb-clean.md) | cut a new one | Not started. Phase 3 runs on the local 16 KB AVD. Hands `package-android.mjs` to lane 2 when done. |

**Lanes 2 and 4 must not run at the same time** — they share `packages/runtime-native/scripts/package-android.mjs`
and the shared-file table in [README](README.md) orders them 221 → 212. Lanes 1 and 3 are disjoint
from both and from each other.

Answer the two decisions below before any lane starts: decision 1 determines whether a finished PRD
may move to `done/` at all, and decision 2 determines whether lane 3 can finish.

## Two decisions only you can make

Everything below branches on these. Both are one-word answers.

1. **Per-PRD archive, or batch archive?** This folder's [README](README.md) execution contract rule 5
   says *"Keep this batch together until all included PRDs complete, then move the batch to
   `done/`."* [`docs/PRDs/AGENTS.md`](../AGENTS.md) says *"A PRD that finishes ahead of its siblings
   gets archived on its own."* Under the README rule, **zero PRDs can move to `done/` today** —
   the goal is unreachable by construction, because PRD-060 needs store credentials and an outside
   person. Recommendation: **amend README rule 5 to per-PRD archive** (one line, first commit of the
   day), which is what the filing spec already permits.
2. **Is publishing a candidate authorized today?** PRD-262's four open boxes and most of PRD-078's
   are *public URL* verifications: a candidate npm cohort under a non-default dist-tag plus public
   runtime assets. Every PRD in the lower half of the dependency graph waits behind that one act.
   No authorization exists in these plans ("Nothing here authorizes publication"). If the answer is
   no, the day's ceiling is the local-mechanics half of the graph.

## What is out of reach, and what is already running

Verified on this machine, not assumed. Only the first list constrains today.

**Genuinely unreachable today** — no action at this desk supplies them:

- **No Windows host, no macOS host.** PRD-217 phases 2-4 and PRD-365 phase 2 need real per-OS HUD
  input, DPI, focus and `.app`/ZIP launch.
- **No external OS signing credentials, no outside person.** PRD-365 phase 3, PRD-060 phases 3-4.
- **Desktop playtests are environmentally red here** (GBM), so desktop artifact proof leans on
  packaging and archive assertions, not a rendered session.

**Restored 2026-09-11 — the Android lane is local again.** AMD SVM had been disabled in firmware,
so `/dev/kvm` was missing and the emulator tier read as dead. The owner re-enabled SVM; verified
after reboot: `svm` present in `/proc/cpuinfo`, `kvm_amd` loaded, `/dev/kvm` at mode 666. Two AVDs
now boot headless on KVM in well under a minute:

| AVD | API | `getconf PAGE_SIZE` | What it proves |
| --- | --- | --- | --- |
| `threenative_api35` | 35 | 4096 | PRD-212 install/launch, PRD-375 icon and splash on the targeted SDK |
| `threenative_ps16k` | 36 | **16384** | PRD-221 phase 3 observed 16 KB execution |

The 16 KB AVD is the important one: it removes the assumption that 16 KB execution needed a
developer image flashed onto the phone. It does not — `system-images;android-36;google_apis_ps16k;x86_64`
boots with a 16 KB page size and runs the packaged app.

**Still worth the phone, and only for this:** PRD-375 names physical OEM launcher appearance as a
separately observed fact that emulator pixels cannot stand in for, and PRD-366 wants real hardware
performance. Ask for the Pixel when those lanes come up; never record an unplugged device as a
blocker.

**Prove everything here before pushing.** CI is 67-80 minutes across 45 jobs with 6-18 minute
queue waits, so it is where work lands, not where questions get answered. Every gate in today's
plan — unit suites, playtests, the emulator lanes above, packaging assertions — runs locally
first. This is now a repository rule, in `AGENTS.md` under Verification.

Consequence: **PRD-060, PRD-366, PRD-217 and PRD-365 cannot reach `done/` today** — two hosts, a
credential and a person. **PRD-221 and PRD-375 are no longer device-gated for their emulator-provable
boxes.**

## The four PRDs that can actually close

Ranked by probability of reaching every box ticked today.

1. **PRD-374 — doctor predicts the prerequisite failure.** 2 phases, 12 boxes, pure local
   TypeScript in `packages/create-threenative/src/doctor.ts`, negative controls are synthetic
   (fake HTTP404 + JDK26). No device, no credential, no host. **The one PRD most likely to end the
   day in `done/`.** Its stated dependency on 212/365 mode semantics is a contract read, not a
   handoff wait — it can consume the proposed `--mode`/`--format` names.
2. **PRD-262 — matching public native runtime artifacts.** Already `prd:50%` with both phases
   implemented and CI-green; two open PRs (#193, #194) carry the rest. What blocks `done/` is
   (a) decision 2 above and (b) independent review PENDING on both phases. If publishing is
   authorized, this closes today. If not, it ends at `prd:75%` with named external blockers.
3. **PRD-212 — signed Android release artifacts.** 3 phases, all engine-local: SDK constant bump,
   `--mode release|--format aab` flag parsing, Gradle signing from env properties, manifest-based
   validation of the built artifact. A self-generated test keystore satisfies the signing path; no
   Play account is needed for any box except upload, which belongs to PRD-060. Realistic but full-day.

4. **PRD-221 — the default Android V8 is 16 KB clean.** Promoted out of "labels only" by the
   restored emulator: phases 1-2 (aligned V8 inputs, alignment validation in the packager) are
   local, and phase 3's observed 16 KB execution now runs on `threenative_ps16k` instead of
   waiting for a flashed phone. Its shared-file handoff is the constraint, not the hardware —
   `package-android.mjs` is PRD-221 → PRD-212, so these two lanes serialize.

Everything else moves labels, not files: PRD-373 phases 1-2 (classifier + `ci-required` verdict)
are local and landable, phases 3-5 need repository settings and a `develop` branch; PRD-375's
emulator-provable boxes are open today, its physical-OEM-appearance box needs the Pixel.

## Clear the open PRs before opening any lane

Four PRs are open, and three of them sit on the exact shared files the new lanes need
(`native-release.yml`, `scripts/release.ts`, `tests/distribution.test.mjs`). Opening lanes on top
of them creates the conflict tax this batch's shared-file table exists to prevent.

| PR | PRD | State | First action |
| --- | --- | --- | --- |
| #193 | 262 ph2 | 4 checks failing (`measurement-contract`, `storage-contract`, two patched-cache ABI rows) | Fix the four reds; these are contract tests, not flakes |
| #194 | 262 | mergeable, checks clean | Merge first — it unblocks the release scope for everything else |
| #195 | 059 | mergeable unknown, 3 pending | Let CI finish, then merge |
| #196 | 078 | `budgets` failing, 15 pending | `budgets` needs a built workspace; re-run after a full build |

Merge order: **#194 → #195 → #193 → #196.** Each merge invalidates the next one's base, and CI
here is 67–80 minutes for 45 jobs with 6–18 minute queue waits, so start this at minute zero and
run the new lanes' implementation while it churns.

## Lane plan

Three implementation lanes plus one merge lane. Three is not a compromise — it is the number of
disjoint file sets this batch actually has once the impossible PRDs are removed.

```mermaid
flowchart TD
    M[Lane M: merge queue<br/>#194 → #195 → #193 → #196] --> C{candidate published?}
    L1[Lane 1: PRD-374 doctor<br/>create-threenative/src/doctor.ts] --> D1[done/ today]
    L2[Lane 2: PRD-212 Android release<br/>runtime-native gradle + package-android.mjs] --> D2[done/ today if all 3 phases land]
    L3[Lane 3: PRD-373 ph1-2 selective CI<br/>scripts/ci-change-scope.mjs + ci.yml] --> D3[prd:50%, repo settings deferred]
    C -->|yes| P262[PRD-262 user-verification boxes] --> D4[done/]
    C -->|no| B262[prd:75%, blocker named on each box]
    L2 -.releases package-android.mjs.-> L4[PRD-221 ph1-2 if a lane frees]
    L2 -.releases build.ts mode parsing.-> L1
```

Lane rules:

- **One worktree per lane**, at `.claude/worktrees/<prd-number>/` per the global worktree contract.
  Never two lanes in the primary checkout: the shared checkout is dirty at session start and a
  sibling reset drops uncommitted work.
- **One draft PR per PRD**, opened before phase 1, label applied from `pnpm prd:progress` on every
  push. Not one PR per phase.
- **Shared files are serialized, not merged.** `src/build.ts` is PRD-212 → PRD-365 → PRD-217;
  `package-android.mjs` is PRD-221 → PRD-212 → PRD-262. Lane 2 owns both today, so lane 4 (221)
  starts only when lane 2 hands off, not in parallel.
- **CI is the scarce resource, not attention.** With a 45-job full run, four simultaneous lanes
  pushing on every commit will queue behind each other. Push once per phase, verify locally first
  (`pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm budgets` on a built workspace).

## Definition of done, applied literally

A PRD moves to `done/` in the commit that finishes it, and only when: every phase box ticked,
every acceptance box ticked, the status line says so, and each tick carries its evidence on the
line beside it. Three specific traps this batch sets:

1. **Observed-red controls are boxes too.** Each phase needs a recorded red and a restored green.
   Committing before the control run means the box cannot honestly be ticked.
2. **Independent review is a box.** PRD-262 shows what happens when it is skipped: a status line
   claimed "independently reviewed PASS" that neither evidence record supported, corrected today.
   Each finished phase gets a fresh reviewer subagent, never the implementing one.
3. **Local tarballs are mechanics, not acceptance.** Every PRD here repeats it: public-consumer
   acceptance needs registry packages and public runtime downloads with no engine checkout. A
   sandbox proof does not tick a consumer box.

## Honest forecast

- **Best case (both decisions yes, four merges land, no local surprises): 4 PRDs to `done/`** —
  374, 262, 212, 221 — plus 373 at `prd:50%`.
- **Likely case: 2 PRDs to `done/`** — 374 certainly, then whichever of 212/221 wins the
  `package-android.mjs` handoff — plus label movement on 262, 373, 375.
- **If decision 1 is "batch archive": 0 PRDs to `done/`**, by rule, whatever gets built.

The lower half of the graph (060, 366, 365, 217) is not a today problem. Its gating inputs are a
Windows host, a macOS host, store credentials and an outside person — four acquisitions, none of
them code.

## Next action, under two minutes

Answer decision 1 and decision 2. Then the first command of the day is
`gh pr merge 194 --squash`, with lane 1 (PRD-374) opening its worktree while CI runs.

---

# Session handoff — 2026-09-11, first execution session

Written when the session had to restart (Serena's MCP tools are enumerated only at startup and were
missing). Everything below is *what actually happened*, not what was planned. Resume from here.

## The two decisions are answered

The owner answered both, and `README.md` rule 4 and rule 5 were amended to match in commit
`97d0f5c51` on `main`. **Do not re-ask.**

1. **Per-PRD archive.** A PRD that finishes ahead of its siblings moves to `done/` on its own.
2. **Publishing a candidate is authorized** — an npm cohort under a **non-default dist-tag** plus its
   matching public runtime assets. Store upload and contacting outside people remain unauthorized.

Consequence: the day's ceiling is the best case in *Honest forecast* above, not the "0 PRDs by rule"
floor. PRD-262's public-URL boxes are reachable.

## What landed

| Thing | State |
| --- | --- |
| PR #194 (PRD-262, release scope) | **merged** — `gh pr merge 194 --squash`, 2026-09-11T19:03:56Z. It unblocked the release scope for everything downstream. |
| `main` commit `97d0f5c51` | the two decisions, recorded in this folder's README |
| PR #198 (PRD-374) | **open, draft, `prd:25%`** — phase 1 implemented, locally verified, evidence written |
| PR #197 (PRD-221) | **open** — opened by the lane-4 session; read its own PR body for state |

## Merge queue — where it stands

Order is still **#195 → #193 → #196**, and #194 is done.

| PR | State when the session ended | Next action |
| --- | --- | --- |
| #195 | MERGEABLE, `BLOCKED` (1 check pending) | let CI finish, then merge |
| #193 | MERGEABLE, `BLOCKED` (1 check pending) | the four contract reds named in the plan above appear to have cleared; re-read `gh pr checks 193` before believing that |
| #196 | MERGEABLE, `BLOCKED`, **2 real reds**: `budgets` and `test-native` | `budgets` needs a built workspace; `test-native` is a genuine red, diagnose it |

## Lane 1 — PRD-374, the furthest along

Worktree `.claude/worktrees/prd374-doctor`, branch `prd374/doctor-target-prerequisites`, PR #198.
Commits `c9dd6288a` (implementation) and `9e61a62a6` (PRD + evidence).

**Phase 1 is done except its review.** Five of six boxes ticked with evidence on the line beside
them; `docs/verification/prd-374-readiness-phase-1-2026-09-11.md` carries the full record.

What it does: `threenative doctor --target web|desktop|android|ios [--mode debug|release]`. Naming
the build makes that build's prerequisites decide the report instead of warning beside "available".
Unrequested targets stay in the report with `fail` demoted to `warn`. The unscoped report is
unchanged, pinned by a regression test.

**The exact next two actions, in order:**

1. **Spawn a fresh reviewer subagent** — never the implementing one — on the #198 diff. It is the
   single open box in phase 1. Tick it only on a returned PASS.
2. **Start phase 2** (tool discovery: MCP transport vs. external Blender vs. editor activation vs.
   operation executed). Not started, no code written.

**A contract another lane must honour:** `ANDROID_RELEASE_SIGNING_ENV` in
`packages/create-threenative/src/doctor.ts` spells the four Gradle signing properties
(`ORG_GRADLE_PROJECT_threenativeKeystore`, `…KeystoreAlias`, `…KeystorePassword`, `…KeyPassword`).
PRD-212 phase 3 defines the signing property names and **must read these same four** from
`packages/runtime-native/scripts/package-android.mjs`, or doctor will predict a prerequisite the
build does not use. If PRD-212 picks different names, change them in doctor in the same PR.

## Lanes 3 and 4 — interrupted mid-flight

Both were running as subagents and were told to commit, push and report before the restart. Their
worktrees hold the work either way:

| Lane | PRD | Worktree | Branch |
| --- | --- | --- | --- |
| 3 | PRD-373 phases 1-2 (selective CI) | `.claude/worktrees/prd373-ci` | `prd373/selective-ci` |
| 4 | PRD-221 (Android V8 16 KB) | `.claude/worktrees/prd221-16kb` | `prd221/android-v8-16kb` |

Neither lane reported back before it was cut off, so **nothing in either worktree is verified**.

- **Lane 4** committed `f5c1a4ead`, "feat(runtime-native): census the finished Android APK for 16 KB
  alignment", and opened **PR #197**. Read that PR body for its own account; the lane never
  confirmed what it had proven, and never said whether it ran the `threenative_ps16k` emulator.
- **Lane 3** was still mid-edit. The coordinating session committed its working tree as
  `28e3226c1`, `WIP(PRD-373): lane 3's uncommitted state at the session restart`, and pushed
  `prd373/selective-ci`. Ten files: `scripts/ci-change-scope.mjs`, new `scripts/ci-check-families.mjs`
  and `scripts/ci-required-verdict.mjs` (plus `.d.mts` pairs), both workflow files and three CI
  specs. **Treat all of it as an unread draft.** No PR was opened.

**Check PRD-373 is not already done before touching lane 3 again.** `origin/main` carries PR #190,
"feat(ci): stage selective develop checks and frozen main promotion (PRD-373)", which landed the
staged classifier and the `ci-required` verdict — and the root `AGENTS.md` now documents the
cutover. Lane 3 was cut from a base that already had that, so some or all of its draft may be
duplicate work. Re-read the PRD's boxes against `main` first; the honest outcome may be that
phases 1-2 are already closed and only the repository-settings phases remain.

Lane 4 owns `packages/runtime-native/scripts/package-android.mjs` until PRD-221 is finished; lane 2
(PRD-212) still cannot start until that file is free. That serialization is unchanged.

## Two machine facts worth carrying forward

- **A fresh worktree fails `pnpm test`** with ~18 `runtime-native` failures of the form
  `<path>/build/tn-linux/<target> is not built`, because no C++ host is compiled there. It is
  environmental, and it aborts the run before the root suite's ~2400 tests execute. Run
  `pnpm exec vitest run` from the root separately, or build the natives.
- **`pnpm lint` returned exit 254** — "Linter process terminated abnormally (possibly out of
  memory)" — with three lanes building concurrently. Re-run alone: exit 0. 254 reads like a gate
  failure and is not one; do not chase it.

## Opening prompt for the next session

> Read `docs/PRDs/production-readiness/EXECUTION-STRATEGY-2026-09-11.md`, including the session
> handoff at the end, and follow the repository `AGENTS.md` chain. Both owner decisions are already
> answered there — do not re-ask. Resume lane 1 (PRD-374) at its next action: a fresh reviewer
> subagent on PR #198, then phase 2. Check `.claude/worktrees/prd373-ci` and
> `.claude/worktrees/prd221-16kb` for what lanes 3 and 4 left behind before restarting either.
> Prove each gate locally before pushing. Do not tick a box for anything unrun.

---

# Session log — 2026-09-11, second execution session

Live. Updated as work lands, not at the end. Everything below was executed; nothing is projected.

## Where each lane stands right now

| Lane | PRD | PR | Label | State |
| --- | --- | --- | --- | --- |
| 1 | PRD-374 | [#198](https://github.com/ThreeNativeHQ/threenative/pull/198) draft | `prd:75%` | **Phases 1 and 2 both implemented and locally verified.** Only the two independent reviews are open. |
| 3 | PRD-373 | [#199](https://github.com/ThreeNativeHQ/threenative/pull/199) draft | `prd:25%` | Resolved as a *finding*, not a build: phases 1-2 were already on `main`. 4 of 20 boxes ticked. |
| 4 | PRD-221 | [#197](https://github.com/ThreeNativeHQ/threenative/pull/197) draft | none | Untouched this session. Real code committed, **zero PRD boxes ticked**, `CONFLICTING` against `main`. |
| M | merge queue | — | — | #195 reds cleared and re-run; #193 clean; #196 still has two real reds. |

## What this session did

**Lane 1 — PRD-374, phase 1 rebuilt and phase 2 built.**

The branch was based on a `main` that had since re-applied its base commits under different SHAs,
so it read as 10 commits and `CONFLICTING`. Replaying it would have refought the same conflicts ten
times; instead the net diff of its two real commits was applied to current `main` as two clean
commits. Verified before pushing: `pnpm typecheck` exit 0, `pnpm lint` exit 0, doctor + cli specs
73 passed. The pre-rebase tip is kept as `backup/prd374-preRebase`.

**Phase 2 then landed** (`b8f776966`): tool discovery now reports four facts where it reported one.

| Check | Fact | What it stopped claiming |
| --- | --- | --- |
| `capability search` | each MCP server starts and advertises tools | that any application its tools drive is installed |
| `editor activation` | which of the installer's **seven** project-scoped host configs carry the servers | that an editor loaded one — a CLI cannot observe that, and the report now says so |
| `model conversion` (was `blender`) | Blender is on this machine; separately, that its server's transport is up | that a conversion ever ran |
| `model conversion` detail | what `public/assets.manifest.json` records as converted | anything at all, when there is no manifest |

The old healthy line read *"all three configured MCP servers resolve"* — wrong about the count
since the fourth server landed, and read as a complete authoring toolchain on the strength of four
processes that started. Doctor also consulted `.mcp.json` alone, so a game opened in VS Code, Zed or
opencode was told capability search was ready on the strength of a file that host never reads.

Gates, all run locally: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm check:docs` 0, the whole
`create-threenative` package **656 tests across 38 files**, plus `mcp-install` and `sync-agent-docs`
38 passed. `doctor.spec.ts` went 68 → 75.

Red, then green, in a real project rather than a fixture: renaming the check broke exactly the three
incumbent tests (`3 failed | 65 passed`); then `.vscode/mcp.json` overwritten with `{ not json` and
`threenative-blender` deleted from `.zed/settings.json` gave `5 of 7 host configs are complete`, and
`PATH=/usr/bin:/bin` gave `conversion is unavailable`. Restoring both returned the green text, and
the malformed config was **preserved**, named by exact path, never rewritten.

Evidence: `docs/verification/prd-374-readiness-phase-2-2026-09-11.md`.

**Lane 3 — PRD-373 was mostly already done, and nobody had said so.**

The PRD read 0 of 20 boxes while `scripts/ci-change-scope.mjs` and the `ci-required` verdict it
plans were already on `main`, landed by PR #190 and consumed by both workflows. Lane 3's draft
(`ci-check-families.mjs`, `ci-required-verdict.mjs`) was written from a base predating that and
duplicates it; it is superseded, not merged, and retained as `backup/prd373-lane3-draft`.

Four boxes ticked against the landed code — the wiring for both phases, and 188 tests across the
five CI specs run locally at `30f749f12`. **Four boxes deliberately left open**: no red/green
control was re-executed here, and the real-PR evidence is partial. Run 34622294627 shows
`Change scope` emitting a validated per-job plan and `ci-required` succeeding, but it classified
`selection=full` under the main-target policy — so a *narrowed* selection has still not been seen on
a real PR, and `ci-required` has not been seen going red. Both need the `develop` branch phase 5
creates.

**Merge lane.** #195's two reds were diagnosed and cleared: `build` failed only because
`native-platforms` failed, and that job hit **exit 124 after 2h** when its NDK/V8 cache failed to
restore (`tar` exit 2) and it rebuilt V8 cold. Infrastructure, not the diff — re-run, and it now
reads 50 pass / 0 fail. #193's four contract reds named in the plan above have cleared on their own.
**#196 still has two real reds**, `budgets` and `test-native`, undiagnosed.

## The batch's PRDs were not tracking work that had already merged

Asked to check whether merged PRs already carried this work, and two of the four active lanes turned
out to be recording nothing:

| PRD | What was already on `main` | What the PRD said |
| --- | --- | --- |
| PRD-373 | the classifier and the `ci-required` verdict (PR #190) | 0 of 25 boxes |
| PRD-221 | **phase 1 entirely** — the aligned V8 provisioner, the Gradle staging, the alignment test (PR #167, merged 2026-09-11) | 0 of 23 boxes |

Both are now recorded with evidence, and in both cases a lane was about to rebuild what was already
there. PRD-373's draft did rebuild it. **PRD-221's lane did not** — its work is phase 2, the packager
census, which is genuinely absent from `main`. That was worth checking rather than assuming.

Verified for PRD-221 phase 1, on `main` rather than taken on the merged PR's word:
`download-deps.mjs:31` imports `assertAndroid16KbAlignment` and calls it at `:1019` on every built
`.so`; `build-android-v8.mjs:147` asserts it on the provisioned V8; `build.gradle.kts:35` records
the 3.2.30 bump made for 16 KB alignment; `tests/android-16kb-alignment.test.mjs` passes 34.

The remaining nine PRDs were swept the same way. `gh pr list --search` matches loosely, so its
counts are a lead, not a finding — PRD-060's five "hits" are four PRD-262 PRs and one real one. Each
still needs the per-PRD check the two above got.

## Lane 4 — PRD-221, rebuilt and verified

Rebuilt on current `main` as a net diff, same as lane 1 (old tip at `backup/prd221-preRebase`). Its
code is green and the original lane never reported that: `android-packaging.integration.test.mjs`
with the alignment suite **46 passed**, `distribution.test.mjs` **36 passed**,
`native-consumer.spec.ts` **33 passed**, `pnpm typecheck` 0, `pnpm lint` 0. Now `prd:25%`, 4 of 18
boxes.

One trap worth carrying: `packages/runtime-native/vitest.config.ts` collects `tests/**/*.test.mjs`,
so those run under **vitest from that package**. Run one with `node --test` and it cannot resolve
`test-support/temp-dir.js` and reads like a broken test. It is not.

## The independent review of PRD-374 phase 1 came back FAIL

Worth recording because it caught a real gate, not a style point.

1. **`pnpm budgets` was red on the branch and green on `main`.** Phase 1's own evidence file took
   `docs/verification` to 830 tracked files while `docs/benchmark/SCREENSHOT-RETENTION.md` still
   recorded 829, so `generate-retention-index.ts --check` failed. `budgets` is a retained
   full-coverage required check and the PRD's own contract names it for executable changes; the
   evidence record had listed it NOT RUN and the box was ticked on a narrower gate set. Regenerated
   with the script and committed — `budgets` now exits 0.
2. **The PRD and evidence record cited commit `c9dd6288a`, which the rebuild replaced.** Both now
   cite `9d50cb878` and say why it changed.

The reviewer also mutated `doctor.ts` three ways and confirmed a distinct test catches each, and
reproduced the phase 1 red/green against `examples/abyss-framework` independently. Its remaining
defects and the phase 2 verdict are still outstanding.

## The next actions, in order

1. **The rest of the PRD-374 review.** Defects 3 onward were truncated, and the phase 2 verdict has
   not arrived. Two review boxes are the only thing between #198 and `prd:100%`.
2. **Merge #195** the moment its last two checks finish, then **#193**.
3. **#196's two reds.** `budgets` needs a built workspace; `test-native` is genuinely red.
4. **PRD-221 phase 3** — the `threenative_ps16k` emulator run. Now the single largest unrun thing in
   the batch, and it is runnable at this desk.
5. **Sweep the remaining nine PRDs** for merged-but-unrecorded work, per-PRD, the way 373 and 221
   were done.

## Machine facts this session adds

- **A branch cut before a squash-merge cannot be rebased sanely.** `main` re-applies the base under
  new SHAs, so `git rebase` refights every conflict per commit. Apply the net diff of the lane's own
  commits onto current `main` instead, and keep the old tip as a backup branch.
- **A 2-hour CI job that ends in exit 124 is a cache miss, not a test failure.** Check whether the
  restore step reported `tar` failing before reading anything into the diff.


## The `prd-manager` audit, 2026-09-11

Run across all 405 PRDs. Findings that touch this batch:

**PRD-060 exists twice, and the copy this batch plans from does not know phase 1 shipped.**

| File | Lines | Status | Boxes | Last touched by |
| --- | --- | --- | --- | --- |
| `BLOCKED/requires-release-credentials/PRD-060-…md` | 762 | `IN PROGRESS — PHASE 1 IMPLEMENTED; PHASES 2-6 BLOCKED` | **10 of 68 ticked** | PR #151, merged |
| `production-readiness/PRD-060-…md` | 227 | `PROPOSED` | 0 of 29 | this batch's re-plan |

This is the failure `docs/PRDs/AGENTS.md` names outright — *"Never un-file a finished PRD by
rewriting it… that deletes the ticked boxes and the landed commits that justified them, and the
work reads as never done."* It is the same thing that happened to PRD-264, which this batch already
had to restore. Ten ticked boxes and a merged PR are currently invisible to anyone reading the
batch. **Reconciling two 700-line PRDs is an owner call, not an agent's**, so it is recorded here
rather than done.

**PRD-212 was checked for the same drift and is clean.** Its phase 1 wants the submission SDK at
API 36; `build.gradle.kts:298,304` and `doctor.ts:113` all still read 35, so 0 boxes is honest. The
"PARTIAL" in its status line refers to retained earlier fixes, not to phase work.

Repository-wide, for whenever it is worth a pass: **25 duplicate PRD ids**, **15 files in `done/`
whose status line says `PROPOSED` or `NOT STARTED`**, 3 claiming done while still open, **69 PRDs
with no phase boxes at all** — the shape that stalls them — and 39 acceptance criteria conjoining
independent claims, which can never be ticked.

Reading the board costs ~99% fewer tokens than opening the PRDs. Use
`node ~/.claude/skills/prd-manager/scripts/prd-board.mjs` before touching PRD work, and
`prd-audit.mjs` before a release.


---

# Live status — 2026-09-11, later

| Lane | PR | Label | State |
| --- | --- | --- | --- |
| PRD-374 | #198 draft | `prd:75%` | Both phases built. **Both reviews came back FAIL**; 11 of 14 defects fixed, the rest triaged below. |
| PRD-221 | #197 draft | `prd:25%` | Phase 1 recorded from `main`, phase 2 verified, **phase 3's page-size gate built and observed at 16384**. 8 of 18 boxes. |
| PRD-373 | #199 draft | `prd:25%` | Closed as a finding. 4 of 20 boxes. |
| **#195** | — | — | **MERGED** 20:48Z, after its reds proved to be a 2h cache-miss timeout. |
| #193 | — | — | 51 pass, 4 pending. Next to merge. |
| #196 | — | — | Two real reds, undiagnosed: `budgets` and `test-native`. |

## PRD-221 phase 3 — the lane never wrote down the pages it ran on

Neither `native-platforms.yml` nor `native-platform-workflow.test.mjs` contained the string
`PAGE_SIZE`. "We ran on Android 15" is not "we ran with 16 KB pages": an ordinary image reports 4096
and passes every other check here, so a 16 KB qualification was a claim rather than a measurement.

`packages/runtime-native/scripts/check-android-page-size.mjs` is now one function the workflow and
the tests both call — executable, rather than logic buried in a YAML step. It fails closed: a
**missing** observation is a failure, not a skip. The workflow captures `getconf PAGE_SIZE` as the
first thing inside the emulator script and verifies it on `if: always()` against job-level
`TN_ANDROID_EXPECTED_PAGE_SIZE`, set to `4096` — which is what `api-level: 35` actually is. Pointing
the hosted lane at the 16 KB image is now two values, not code.

Observed on the local `threenative_ps16k` AVD, booted on KVM:

```
getconf PAGE_SIZE  ->  16384          sdk 36, release 16, abi x86_64
fingerprint: google/sdk_gphone16k_x86_64/emu64xa16k:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys
```

Red first, as the rules require: the test asserting the lane records its page size failed on exactly
that regex before the workflow was touched (`1 failed | 40 passed`), and passes after (`41 passed`).
The checker was separately run against the live device (exit 0), a 4096 observation and a missing
file (both exit 1).

**Still open, and said so in the box:** the default starter actually launched on that environment,
with HUD interaction and a background/resume cycle. It needs a compiled native host and a packaged
APK this worktree does not have. The page size is observed; the game running on it is not.

## What the two FAIL verdicts were worth

Fourteen defects across the two phases. Two were bugs a user would hit:

- **A correctly wired Cursor-only project got exit 1.** Only the new check had been widened to seven
  hosts; `mcpConfig` and the probe gate still keyed on `.mcp.json`, so one report read *"no
  .mcp.json"* directly above *"1 of 7 host configs carry the servers (Cursor)"*. Fixed and verified
  on the real CLI against an actual Cursor-only project.
- **Severity was inverted**: corrupting a config *downgraded* `editor activation` from `fail` to
  `warn`, because "some config is broken" was tested before "nothing is wired".

Plus: satisfied prerequisites printed as blockers; a desktop request ignoring the overlay
prerequisite; the requested target reading `available` beside `not buildable`; `--mode release`
forecasting a build path that does not exist; a stale retention index breaking `pnpm budgets`; and
a dead commit SHA cited in two documents.

**One box was unticked.** Phase 2's user-verification claimed the four facts read separately in a
real run. They do not — every real run reports `threenative-blender was not probed`, so the headline
separation is proven by unit fixture only.

Three defects are deliberately not fixed, and each is recorded where it belongs: the requested
target's wording blocks acceptance criterion 1 rather than the implementation (the reviewer's own
call, accepted); `MANUAL_GLOBAL_MCP_HOSTS` cannot be derived because it is prose in the installer,
so a module-load guard now throws if that ever stops being true; and the four non-`mcpServers` host
formats are reported by name presence rather than validated by shape, because reproducing them here
would be a second copy of the installer's `SERVER_FORMATS`.

## Two more machine facts

- **The retention index restales on every evidence edit, not only on a new file.** It records
  tracked *bytes*, so editing an evidence record invalidates it again. Regenerate it as the last
  step before committing anything under `docs/verification/`, or `budgets` goes red one commit later.
- **`packages/runtime-native/tests/` reports 18 failures in a worktree with no compiled host**, all
  `build/tn-linux/<target> is not built`, across `crash-handler-policy`, `pump-silence`,
  `rg11b10-renderable`, `runtime-next-contract` and `timestamp-query`. 994 pass. Environmental.
