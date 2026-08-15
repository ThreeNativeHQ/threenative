---
prd_contract: v1
---

# Batch — 2026-08-14

**Status: ASSEMBLED, 2026-08-14. Nothing here has been executed for this document.** The
statuses below are a read of the four PRD files, `docs/strategy/ROADMAP.md`, and the tree at
commit `3603467`. Two facts were checked by running a command and are marked where they appear:
`pnpm round:next` and the presence of `/dev/uinput` on this host. No mobile-readiness, device,
or iOS claim is made anywhere in this batch.

**The subject of this batch is the beta bar.** Three of its five rows are blocked, and the
blocks are not missing features — two are evidence that contradicts itself, one is an experiment
the project calls decisive and has never run. Every PRD here already exists; none is new, and
nothing in this batch proposes new framework surface.

The four PRDs live at `docs/PRDs/` root and are linked in place. They move into this folder only
if the owner wants the root file count reduced; the batch is the plan, not the location.

## The order, and why

| # | PRD | Beta row | The sentence it closes | Runnable on this host? | Estimate |
|---|---|---|---|---|---|
| 1 | [PRD-076 — parity ledger reconciliation](../PRD-076-tier-1-parity-reconciliation.md) | 4 | *"Which of these two files describes the device I actually have?"* | **Yes.** Phase 0 is a read, no run | Phase 0: 1 h · Phases 1–3: 1 day |
| 2 | [PRD-077 — desktop multitouch injector](../PRD-077-desktop-multitouch-injector.md) | 4 | *"The desktop lane is structurally unable to exit `0`."* | **Yes.** `/dev/uinput` exists here — checked 2026-08-14 | Phase 0: 2 h · Phases 1–2: half a day |
| 3 | [PRD-079 Phases 2–3 — Phase 2 exit criteria](../PRD-079-phase-2-exit-criteria.md) | 3 | *"The round loop is stopped and nobody owns restarting it."* | **Needs an owner decision first** | 2 h after the decision |
| 4 | [PRD-080 — the five-minute stranger test](../PRD-080-five-minute-stranger-test.md) | — | *"No stranger has ever touched this."* | **Needs an owner decision and one external person** | Phase 0: 1 h · Phase 1: half a day · Phase 3: one afternoon |

Start at 1. PRD-077 exists to finish the row PRD-076 adjudicates, so running 2 before 1 risks
repairing a lane whose failing cell turns out to be a reporting defect rather than a capability
gap.

## 1 and 2 — beta row 4, and why they are one job

Two tracked verification files describe the same devices on the same day and disagree:

| Target | [`parity-2026-08-10-r2.md`](../../verification/parity-2026-08-10-r2.md) | [`tier-1-2026-08-10.md`](../../verification/tier-1-2026-08-10.md) |
|---|---|---|
| Desktop Linux | `66 / 0 / 1`, exit **`0`** | `65 / 1 / 1`, exit `1` |
| Android emulator | `67 / 0 / 0`, exit `0` | `27 / 40 / 0`, exit `1` |

**One of those cells is impossible without running anything.** `reportExitCode` in
`packages/runtime-native/conformance/run-conformance.mjs` returns `2` whenever
`summary.blocked > 0`, so `66 / 0 / 1` cannot have exited `0`. PRD-076 Phase 0 is provenance —
establishing which run produced which file — and is explicitly not repair.

PRD-077 is the other half. The `desktop-multitouch-input` row is `excluded` in the registry, and
an exclusion is a permanent non-zero exit for that lane. The desktop host already dispatches
`SDL_EVENT_FINGER_*` as multi-contact PointerEvents; what is missing is an injector on the test
side, not a capability on the runtime side. **`/dev/uinput` is present on this host**, so Phase 0's
open question — can this machine inject at all — is answerable today.

## 3 — beta row 3, and what is already done

**PRD-079's engine half shipped as [PRD-081](../done/PRD-081-physics-assertions-a-user-can-write.md)
on 2026-08-12.** Physics now contributes `runtime.physics` and `physicsDebugSeries` through the
plugin seam in `packages/core/src/playtest.ts`, and `packages/core/__tests__/playtest.spec.ts`
holds the package boundary. Do not re-execute PRD-079 Phases 0 and 1; read PRD-081's verification
file first and confirm the seam still holds.

What remains is Phases 2 and 3: rewrite the Phase 2 win criteria with the owner, then run the
rewritten gate once. It is blocked on a decision, not on code, and the loop says so:

```
$ pnpm round:next
stop round 4
Stop condition recorded: kill switch. Resolve it before resuming the round.
```

**The kill switch holds while this is open.** No fifth genre sweep, no rerun of either benchmark
arm, under any reading of this batch.

## 4 — the decision PRD-080 needs before any work starts

Four tracked documents call it the decisive test and describe two different experiments: a
*player* who finishes five minutes (`METRICS.md`) and an *adopting developer* who installs the
framework and asks for a device build (the Tier 2 trigger in `ROADMAP.md`). They are not variants
of one test. Phase 0 is choosing, and nothing after it is worth starting until that choice exists
in writing.

The two choices also have different technical preconditions, which is why the choice is not a
formality:

- **Player.** Needs one hosted static web build a stranger can open. Free hosting covers it.
- **Adopting developer.** Needs the published-artifact path, which is beta row 5 and is blocked
  outside this repository — the release lane dies on a GitHub runner missing a Vulkan ICD
  ([PRD-078](../night-watch-26-08-12/PRD-078-toolchain-free-consumer-proof.md)).

**A pilot of the adopter route ran on 2026-08-14 and is recorded in
[`adopter-pilot-2026-08-14.md`](../../verification/adopter-pilot-2026-08-14.md).** It closes
nothing in PRD-080 — the subject was an agent that has read this repository, not a stranger — but
it found that `./scaffold.sh` cannot install today: the templates pin `@threenative/studio` and
`create-threenative` as registry dependencies and neither is published. An adopting-developer
session would end in its first two minutes on that. **Fix the template dependency set before
scheduling the adopter half.**

Neither route runs through hosted Studio. **Signup stays shut.**
[PRD-103](../studio-hosting/PRD-103-sandbox-boundary.md) has never booted a microVM, so two
sessions still share a kernel and a sandbox can still reach the control plane;
[PRD-105](../studio-hosting/PRD-105-production-lane.md)'s deploy half needs accounts that do not
exist. Opening signup to run the stranger test would trade the experiment for the security
property the hosting series was written to protect.

## Not in this batch, and why

| Item | Why it is out |
|---|---|
| [PRD-065](../PRD-065-ios-evidence-lane.md) — iOS evidence lane | Runs only on the hosted `macos-15` runner; CI minutes are scarce on this plan |
| [PRD-078](../night-watch-26-08-12/PRD-078-toolchain-free-consumer-proof.md) — beta row 5 | Blocked on a missing runner ICD, outside this repository |
| [PRD-103](../studio-hosting/PRD-103-sandbox-boundary.md), [PRD-105](../studio-hosting/PRD-105-production-lane.md) | Need a machine API and hosting, storage, and domain accounts that do not exist |
| [PRD-088](../starter-kits/PRD-088-physics-spatial-queries.md) and the rest of `starter-kits/` | Blocked at its own Phase 0 ABI criterion, and the batch is mid-flight |
| [`asset-pipeline/`](../asset-pipeline/README.md) | Proposals only; **neither deferral trigger has fired** and none of them may begin before both do |

## Stop rules

- **Never claim a gate you did not run.** Paste the failure. "Unverified" is an acceptable
  result; "verified" without a run is not.
- **A negative control that was not observed red does not count.** Each PRD names its controls; a
  phase whose control was skipped is not done.
- **Name the layer before the fix.** Engine bug → `packages/`. Game bug → the example or the
  template. PRD-076 Phase 1 is filed as an engine bug in the resize path; if it turns out to be a
  harness bug, say so and stop rather than patching the game.
- **PRD-076 Phase 0 is provenance, not repair.** Phases 2 and 3 are authorised by a Phase 0
  number. No number, no phase.
- **Do not edit `ROADMAP.md` Phase 2, the beta bar, or any gate wording** outside PRD-079 Phase 2,
  which is the one place that decision is owned.
- **WebGPU on this host needs `xvfb-run -a -s '-screen 0 1600x900x24'`.** Headless Chromium
  renders the canvas blank while the page still loads, so a blank screenshot reads as a styling
  bug rather than a GPU failure. A run that never reached its assertions exits `2` and is
  recorded as **unmeasured** — never a pass, never a red.
- **Validate on the local Android emulator, not by pushing to CI.** No tags, no registry
  publishes, no workflow triggers from this batch.
- **Do not touch `examples/abyss-vanilla/`.** It is the frozen benchmark control.

## Done means

For each PRD that lands: `pnpm typecheck && pnpm lint && pnpm test` green, the phase's playtest
or conformance gate green, every negative control observed red with its command, a dated file in
`docs/verification/`, and the PRD's status line updated with what was executed and what was not.
A PRD finished end to end gets `git mv`'d to `docs/PRDs/done/` in the same commit that finishes
it; this folder is archived with `git mv docs/PRDs/batch-2026-08-14/ docs/PRDs/done/batch-2026-08-14/`
only once every PRD in it is complete.

A report that says *"PRD-076 Phase 0 adjudicated the Android cell, PRD-077 Phase 0 found
`/dev/uinput` unusable under this kernel's permissions, PRDs 079 and 080 untouched pending the
owner"* is a good result. A report claiming four closures without four verification files is not.
