# Native / mobile PRDs — the sequence

**Status:** all three NOT STARTED. The whole group is gated on spike 0a producing an
answer, which it has never done (`docs/spikes/0a-mobile-render.md` §6 records
*"Unresolved / FAIL — 2026-08-02"*, for environmental reasons).

**Roadmap position:** `ROADMAP.md` **Phase 3**, whose gate to start is *"Phase 2 exit gate
green."* Phase 2 is not green — PRDs 033, 035, 036 and 038 are all "partial, release
evidence pending." **Nothing in this folder starts before that.** Phases are gated, not
scheduled.

## The sequence, and why it is this order

```
spike 0a  ──►  PRD-044  ──►  PRD-045  ──►  PRD-046
(no PRD)      adapter       playtest      physics-native
                            on device
```

| # | PRD | What it buys | Cost |
|---|---|---|---|
| — | **spike 0a** | Does `three/webgpu` run outside a browser at all | ~1 wk |
| 1 | [PRD-044](PRD-044-native-render-adapter.md) | `@threenative/native`; five `core` seams de-DOMed | 2–4 wk |
| 2 | [PRD-045](PRD-045-playtest-on-device.md) | The app can be *proven*, not just seen | 1–3 wk |
| 3 | [PRD-046](PRD-046-physics-native.md) | JSI Rapier binding — `CHARTER.md` §7's "crown jewel" | 4–8 wk |

**Why physics is last, not first.** It is the most valuable artifact and the most dangerous
to ship unproven: its failure mode is a subtly wrong simulation, invisible to a screenshot.
PRD-045 builds the instrument before PRD-046 builds the thing that most needs measuring.
PRD-044 §4 takes a deliberate, time-boxed exception to the playtest rule because rendering
failures *are* visible; that exception does not extend to physics.

**Why 0a is not a PRD.** `CHARTER.md:364` — a Phase 0 spike ships "no template, no CLI, no
docs, no framework." It is a throwaway app outside the repo and only its answer merges.
Keeping that framing costs zero charter amendments and zero package slots.

## Two decisions that must be made before any code

1. **The package cap.** `pnpm budgets` reports 7/8, and `scripts/check-budgets.ts:50`
   counts `examples/*` as packages. PRD-044 needs one slot, PRD-046 needs a second — that
   is 9. `CHARTER.md` §9a's own eight-package list contains both, so the list and the
   counter disagree. Resolved in PRD-044 Phase 0, and §10 says exceeding a cap is not a
   signal to raise it.
2. **No hardware exists (2026-08-08).** Everything here runs on the Android emulator. That
   is fully sufficient for PRD-045 and PRD-046's plumbing, and **only partly sufficient for
   PRD-044** — the real GPU driver and the real frame rate stay OPEN. See PRD-044 §0.

## A note on this folder and the PRD budget

`scripts/check-budgets.ts:92-94` counts only `.md` files **directly** in `docs/PRDs/`. Files
in this subfolder do not count toward the 10-PRD cap. That is a real consequence of grouping
them, and it is recorded here rather than quietly enjoyed: `done/` is uncounted because it
holds *finished* work, whereas this folder holds *active* work. If the cap is meant to bound
work in flight, the counter should be made to include this folder.
