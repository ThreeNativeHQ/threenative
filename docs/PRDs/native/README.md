# Native / mobile PRDs — the sequence

**Status:** PRD-047 is IN PROGRESS. Mystral now supplies the answer spike 0a could not:
upstream `three/webgpu` runs outside a browser on desktop and on the Android emulator.
Desktop framework absorption is proven; Android framework-version parity, device playtest,
native physics, iOS and physical-hardware evidence remain open.

**Roadmap position:** `ROADMAP.md` **Phase 3**, whose gate to start is *"Phase 2 exit gate
green."* Phase 2 is not green — PRDs 033, 035, 036 and 038 are all "partial, release
evidence pending." **Nothing in this folder starts before that.** Phases are gated, not
scheduled.

## The active sequence

```
PRD-047  ──►  PRD-045  ──►  PRD-046
external      playtest      physics-native
runtime       on device
```

| # | PRD | What it buys | Cost |
|---|---|---|---|
| 1 | [PRD-047](PRD-047-mystral-runtime-absorption.md) | The runtime, absorbed as `packages/runtime-native`; render/lifecycle integration | in progress |
| — | [PRD-044](PRD-044-native-render-adapter.md) | Superseded React Native host/package proposal | historical |
| 2 | [PRD-045](PRD-045-playtest-on-device.md) | The app can be *proven*, not just seen | open |
| 3 | [PRD-046](PRD-046-physics-native.md) | Native Rapier behind a coarse host-neutral ABI | blocked on 045 |

**Why physics is last, not first.** It is the most valuable artifact and the most dangerous
to ship unproven: its failure mode is a subtly wrong simulation, invisible to a screenshot.
PRD-045 builds the instrument before PRD-046 builds the thing that most needs measuring.
PRD-044 §4 takes a deliberate, time-boxed exception to the playtest rule because rendering
failures *are* visible; that exception does not extend to physics.

**Why 0a is not a PRD.** `CHARTER.md:364` — a Phase 0 spike ships "no template, no CLI, no
docs, no framework." It is a throwaway app outside the repo and only its answer merges.
Keeping that framing costs zero charter amendments and zero package slots.

## Decisions now binding

1. **The package cap.** The cap applies to distributable `packages/*`; private examples
   are reported separately. **Reversed 2026-08-08:** the runtime is absorbed as
   `packages/runtime-native/`, taking framework packages 5 → 6 of 8. It is the only new
   package — there is no `@threenative/native`, and the ten-package split proposed by the
   runtime's own PRD is rejected under rule 5. Native source is exempt from the 15,000-line
   framework cap and bounded by its own 50,000-line cap.
2. **Web is unchanged.** The runtime serves desktop and mobile only. The browser keeps
   Vite + `three/webgpu`.
3. **No hardware exists (2026-08-08).** Android emulator evidence closes JS/runtime
   plumbing only. Real GPU drivers, arm64 physics and phone performance stay OPEN.

## A note on this folder and the PRD budget

`scripts/check-budgets.ts:92-94` counts only `.md` files **directly** in `docs/PRDs/`. Files
in this subfolder do not count toward the 10-PRD cap. That is a real consequence of grouping
them, and it is recorded here rather than quietly enjoyed: `done/` is uncounted because it
holds *finished* work, whereas this folder holds *active* work. If the cap is meant to bound
work in flight, the counter should be made to include this folder.
