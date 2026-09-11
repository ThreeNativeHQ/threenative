# Execution strategy — moving production-readiness PRDs to `done/` (2026-09-11)

Working document for one day of execution. Not a PRD. It plans *how* the eleven PRDs in this
folder get closed, in what order, on how many lanes; it changes no scope and ticks no box.

Measured start state (`pnpm prd:progress`, this commit `0022cd9af`):

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

**Before resuming either, check what is actually there** — `git -C <worktree> log --oneline -5` and
`git -C <worktree> status --short`. A WIP-prefixed commit means the lane stopped mid-change. Lane 4
opened PR #197; read that PR body for its own account of state. Lane 3 had not opened a PR.

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
