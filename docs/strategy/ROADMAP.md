# Roadmap — the path from 30 to 80

**Status:** Gate 0 closed on 2026-08-07; Phase 1 passed on 2026-08-08; Phase 2 is now
active. Supersedes the 2026-08-02 phase plan, whose Phase 0 table described six PRDs when
thirty-one are now in `docs/PRDs/done/`.
**Charter authority:** `CHARTER.md` §3 (win condition), §5b (the ownership boundary),
§7 (mobile), §10 (budgets), §12.

Phases are gated, not scheduled. A phase starts because the previous gate passed, not
because the previous phase ran out of tasks.

## What the score means

"Would I use this instead of vanilla Three.js?" scored out of 100, on five axes of 20.
Every axis is tied to an instrument that already exists, so the score is measured rather
than argued.

| Axis | Question | Instrument |
|---|---|---|
| **Ships working** | Does an agent building with the framework produce a game that passes the sealed proofs more often than one building vanilla? | `pnpm sweep:pair` → `passed/total` |
| **Looks good** | Does the framework arm score higher on the blind visual rubric? | `pnpm sweep:judge`, human blind session |
| **Costs less** | Does the agent write less source above the framework starter than vanilla writes from zero? | `pnpm sweep:pair` → `authoredLoc` (per-file diff against the frozen starter); `scripts/count-loc.ts` remains a framework ratchet |
| **Does what vanilla can't** | Capabilities that are 0→1, not 15% off | package inventory, reach rate |
| **Survives the platform** | Web, then phone | `CHARTER.md` §7 device matrix |

## Where we are — 30/100 baseline plus Gate 0 evidence

| Axis | Score | Evidence |
|---|---:|---|
| Ships working | **measured tie** | Phase 1 corpus: framework and vanilla tie on all 4 sealed genre proofs |
| Looks good | **framework wins 2/4** | Phase 1 v2 blind judges: platformer and exploration win, endless ties, topdown loses |
| Costs less | **wins 2/4** | Phase 1 authored-cost deltas: platformer -187 LOC and topdown -695 LOC; endless +442 and exploration +95 |
| Does what vanilla can't | **12** | `physics` (Rapier bindings — vanilla has none) and `playtest` both ship. `playtest` is given away to the vanilla arm by §3, so it wins no comparison |
| Survives the platform | **2** | Web only. §7 resolved the *research* question; neither device spike has run |

**The two prior zeroes are now measured.** The instruments built by PRD-019 and PRD-020 now
have a fresh exploration result: functional parity, framework visual win, and vanilla
final-source-cost win under the old total-LOC view. That old number is historical. New
rounds report starter LOC plus authored LOC, so the framework arm is charged for what it
wrote and not for the starter it was handed.
The Phase 1 gate still requires a repeatable win across genres before further capability
investment.

**Why LOC cannot get us to 80:** plumbing is ~30% of a game and is already halved
(138 → 68 on the static control). §5b permanently assigns the rest to the user, with
evidence — v1 owned the look and its output scored *worse* than vanilla. The ceiling on
the cost axis alone is roughly 40/100. PRD-024 through PRD-031 collected the last points
of a game that was already mostly won.

## Which roadmap items have PRDs

Most of this roadmap is **measurement of shipped machinery**, not unbuilt features. The
non-done PRD inventory is recorded here so new proposals cannot disappear from the queue.

| Roadmap item | PRD | State |
|---|---|---|
| Run round 2 to completion | [PRD-021](../PRDs/done/PRD-021-the-improvement-round.md) phase 4 | done — `round-2-2026-08-07.md` |
| `round:deletions` — rule 2's executor | [PRD-021](../PRDs/done/PRD-021-the-improvement-round.md) phase 3 | done — 161 candidates reported |
| Paired arm machinery | `done/PRD-019-paired-arm.md` | shipped |
| Capture, judge, blind bundle | `done/PRD-020-seeing-the-game.md` | shipped |
| Template visual baseline + `pnpm visuals` | `done/PRD-030-visual-baseline-and-gate.md` | shipped |
| Honest LOC instrument | `done/PRD-025-honest-loc-counting.md` | shipped |
| Asset discovery MCP | [done/PRD-032](../PRDs/done/PRD-032-asset-discovery-mcp.md) | **void — upstream profile prepared, but npm registry remains 0.4.0 and publish requires auth** |
| Playtest semantic depth | [PRD-033](../PRDs/PRD-033-playtest-semantic-depth.md) | **implementation delivered; browser consumer gate pending on a supported runner** |
| Navigation and pathfinding | [PRD-034](../PRDs/done/PRD-034-navigation-and-pathfinding.md) | **done; review repairs manager-verified; 7 packages, slot unspent** |
| Hot reload with state preservation | [PRD-035](../PRDs/PRD-035-hot-reload-state-preservation.md) | **implementation delivered; browser consumer gate pending on a supported runner** |
| Save/load and deterministic replay | [PRD-036](../PRDs/PRD-036-save-load-and-deterministic-replay.md) | **partial implementation in lane; browser consumer gate pending on a supported runner** |
| Runtime GPU transport and acceleration | [PRD-038](../PRDs/PRD-038-gpu-transport-and-acceleration.md) | **partial implementation in lane; browser consumer gate pending on a supported runner** |
| Animation state machine / blend control | [PRD-039](../PRDs/PRD-039-animation-state-machine.md) | **closed — WONTBUILD** |
| Physics collision layers and masks | [done/PRD-040](../PRDs/done/PRD-040-physics-collision-layers.md) | **done; consumer scenario, review repair, and full gates verified 2026-08-08** |
| DRY the sweep corpus | [done/PRD-041](../PRDs/done/PRD-041-sweep-corpus-dry.md) | **done; implementation gates and review repair verified; n≥10 adoption rerun and browser proof remain environment/evidence gaps** |
| Playtest operator ergonomics | [done/PRD-042](../PRDs/done/PRD-042-playtest-operator-ergonomics.md) | **done; clean package gate, review repair manager-verified; repository-wide red is unrelated dirty proof/worktree formatting** |
| Build-time asset pipeline | none — deferred | `docs/product/ASSET-PIPELINE.md`, two measured triggers |
| Device spikes 0a / 0b | none — **forbidden** | `CHARTER.md:364`: spikes ship no docs and no framework |

The current non-done inventory is PRD-033 through PRD-036, PRD-038, and PRD-039;
PRD-039 is the closed WONTBUILD record, and there is no PRD-037 file in `docs/PRDs/`.

Two items deliberately have no PRD and never will: the device spikes, because the charter
says a spike is a throwaway app whose only output is an answer; and the build-time asset
pipeline, because it is deferred behind triggers that have not fired.

---

## Gate 0 — measure before investing further

**Gate to start:** nothing. This phase is closed; its recorded result unlocks Phase 1.

Run round 2 to completion on `exploration`: both arms, isolated contexts, sealed proofs,
capture, judge, pair. **Complete:** `docs/verification/round-2-2026-08-07.md` records both
`1/1` proofs, guarded captures, the fresh blind judge, pair metrics, and the cost-gap
disposition.

Then finish [PRD-021](../PRDs/done/PRD-021-the-improvement-round.md) phase 3 —
`scripts/round-deletions.ts` and `round:deletions`. **Complete:** the command checked the
current and previous framework archives and reported 161 persistent candidates. Rule 2
is the charter's kill switch and it has executed **zero** times; the list of exports no
build ever reached currently sits in a JSON blob nothing reads. That is the shape of the
failure that killed v1 at 790k lines.

**Gate to exit — one of two outcomes, decided by the number, not by preference: closed.**

- **The framework arm passes proofs materially more often, or scores higher blind.**
  Result: the proofs tie at `1/1`, while the framework scores higher blind (`4/5` vs `3/5`).
  The product is real. Proceed to Phase 1.
- **Both arms tie on proofs, visuals and cost.** The framework is not a framework.
  Narrow to `@threenative/physics` and `@threenative/playtest` — two genuinely useful
  Three.js libraries — and delete the rest. This is the kill switch working, not a
  failure.

**Evidence earned:** the two previously unmeasured axes now have a real result. No code
change earns Gate 0 credit; the round instruments do.

---

## Phase 1 — win the two unmeasured axes

**Gate to start:** Gate 0 exits on the first outcome. **Open now:** widen the pair beyond the
single exploration genre before starting Phase 2.

1. **Close every gap the round-2 ledger names.** Each gap row gets exactly one
   disposition; a `framework change` disposition names a live caller and a PRD.
2. **Score the visual axis — the templates are already built.** PRD-030 shipped the
   baseline: all three templates carry the same six render entry points (`palette`,
   `camera`, `sky`, `lighting`, `materials`, `postprocessing`), and `pnpm visuals`
   scaffolds each one, captures a headed WebGPU frame under `xvfb-run`, and rejects blank
   frames through the capture guard. See `docs/product/VISUAL-BASELINE.md`.
   **The exploration blind pair is now recorded.** The remaining work on this axis is to
   widen the scoring session, not rewrite templates — no PRD, and no new code.
3. **Widen the pair beyond N=1.** `platformer`, `topdown-action`, `endless-runner`, and
   `exploration` now have paired archives and blind v2 polish evidence. The four-genre
   record is [phase-1-2026-08-08.md](../verification/phase-1-2026-08-08.md).

**Gate to exit — passed 2026-08-08:** four genres are paired on the same sealed
specifications; framework proof results are equal in every genre; framework blind polish is
strictly higher in two; authored LOC delta is non-positive in two; no genre loses both proof
and polish; and `pnpm budgets` is green with no cap raised (§10 — exceeding a cap is not a
signal to raise the cap). Full evidence is [phase-1-2026-08-08.md](../verification/phase-1-2026-08-08.md).

**Points: +30** → ~60/100.

---

## Phase 2 — capabilities vanilla does not have

**Gate to start:** Phase 1 exit gate green — passed 2026-08-08.

This is the axis with the most headroom, because it is the only one where the comparison
is 0→1 rather than a percentage. Vanilla Three.js has no physics and no way for an agent
to verify its own game in a browser.
- **Dev loop.** Hot reload with state preservation. Hundreds of vanilla lines nobody
  wants to write, and it does not touch the look.
- **`physics` earns its keep.** It is already the strongest asset and appears nowhere in
  the LOC table. Measure reach rate on a physics-heavy genre and let the number say
  whether it is carrying the framework.

**Gate to exit:** one of the remaining Phase 2 capabilities — hot reload/state preservation
or physics reach — ships with consumer-scoped proof that the paired vanilla arm cannot match
inside the same brief. The voided asset-discovery PRD is not part of this gate.

**Points: +15** → ~75/100.

---

## Phase 3 — the platform question

**Gate to start:** Phase 2 exit gate green. Runs last because §7's research question is
resolved but both spikes are unrun, and a failed spike deletes a charter promise rather
than a phase.

**These get no PRD, and that is a charter rule, not an oversight.** `CHARTER.md:364` says
both Phase 0 spikes ship "no template, no CLI, no docs, no framework" — they are throwaway
apps outside the repo, and only their answer is merged. `docs/spikes/0a-mobile-render.md`
says so in its own header: *"Not a PRD."*

- **0a — rendering on device (~1 day). Already executed, and unresolved.**
  `docs/spikes/0a-mobile-render.md` records the run: **no device render observed.** The
  spike plan exists and the answer does not. Re-running it is the first task of this phase.
- **0b — physics on device (~1–2 weeks).** JSI binding to Rapier's Rust, enough to drop a
  cube on a plane. §7 already ruled WASM Rapier non-viable on device. Not started.

**If 0a fails:** ThreeNative is a web framework and §7's mobile promise is deleted from
the charter. That is a legitimate outcome, and cheaper to learn in a day than in a year.
**If 0b fails:** mobile ships without physics, or not at all.

**Points: +5–20** → 80/100 with web-only honesty, higher if the device path holds.

---

## Not on the roadmap

A foundation model · a Blender replacement · visual scripting · a multiplayer backend ·
console export · an open plugin marketplace · a second renderer with feature parity · a
universal app-store game player · blank-prompt generation without templates · support for
every Three.js example and add-on · **a hosted Studio or Cloud tier before a stranger has
played a ThreeNative game for five minutes** (`CHARTER.md` §12 criterion 3, which v1 never
did once).

Each of those can absorb the entire company.

## What this roadmap deliberately does not do

**It does not chase the LOC ratio.** `docs/benchmark/PROTOCOL.md` now describes the
static `abyss` comparison as a regression ratchet rather than the win condition, because
it scores agent-written source against frozen hand-written human source, and because
`CHARTER.md` §3 fixes the addressable surface at the plumbing column. The win condition
is the paired arm. Framework plumbing is already 49.3% of the control's; there is no
meaningful remaining gain on that axis and pursuing it has been capping this project's
ambition.
