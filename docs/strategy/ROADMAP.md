# Roadmap — the path from 30 to 80

**Status:** proposal, rewritten 2026-08-07. Supersedes the 2026-08-02 phase plan, whose
Phase 0 table described six PRDs when twenty-eight are now in `docs/PRDs/done/`.
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
| **Costs less** | Fewer user LOC, source bytes and files for the same game? | `pnpm sweep:measure`, `scripts/count-loc.ts` |
| **Does what vanilla can't** | Capabilities that are 0→1, not 15% off | package inventory, reach rate |
| **Survives the platform** | Web, then phone | `CHARTER.md` §7 device matrix |

## Where we are — 30/100

| Axis | Score | Evidence |
|---|---:|---|
| Ships working | **0** | Never measured. `round-2-2026-08-07.md` reads `unmeasured` in every arm row |
| Looks good | **0** | Never measured. Same reason |
| Costs less | **8** | PRD-024: framework 726 user LOC / 7 files vs vanilla 769 / 2 files. A 5.6% win, source bytes a tie (24,065 vs 24,081), N=1 genre |
| Does what vanilla can't | **12** | `physics` (Rapier bindings — vanilla has none) and `playtest` both ship. `playtest` is given away to the vanilla arm by §3, so it wins no comparison |
| Survives the platform | **2** | Web only. §7 resolved the *research* question; neither device spike has run |

**The two zeroes are not failures. They are unrun measurements**, and they are the two
largest available gains. The instruments were built by PRD-019 and PRD-020 and have never
been driven to a conclusion.

**Why LOC cannot get us to 80:** plumbing is ~30% of a game and is already halved
(138 → 68 on the static control). §5b permanently assigns the rest to the user, with
evidence — v1 owned the look and its output scored *worse* than vanilla. The ceiling on
the cost axis alone is roughly 40/100. PRD-024 through PRD-031 collected the last points
of a game that was already mostly won.

## Which roadmap items have PRDs

Most of this roadmap is **measurement of shipped machinery**, not unbuilt features. Only
one item needed a new PRD.

| Roadmap item | PRD | State |
|---|---|---|
| Run round 2 to completion | [PRD-021](../PRDs/PRD-021-the-improvement-round.md) phase 4 | open |
| `round:deletions` — rule 2's executor | [PRD-021](../PRDs/PRD-021-the-improvement-round.md) phase 3 | open, unbuilt |
| Paired arm machinery | `done/PRD-019-paired-arm.md` | shipped |
| Capture, judge, blind bundle | `done/PRD-020-seeing-the-game.md` | shipped |
| Template visual baseline + `pnpm visuals` | `done/PRD-030-visual-baseline-and-gate.md` | shipped |
| Honest LOC instrument | `done/PRD-025-honest-loc-counting.md` | shipped |
| Asset discovery MCP | [PRD-032](../PRDs/PRD-032-asset-discovery-mcp.md) | **new, gated on Gate 0** |
| Build-time asset pipeline | none — deferred | `docs/product/ASSET-PIPELINE.md`, two measured triggers |
| Device spikes 0a / 0b | none — **forbidden** | `CHARTER.md:364`: spikes ship no docs and no framework |

Two items deliberately have no PRD and never will: the device spikes, because the charter
says a spike is a throwaway app whose only output is an answer; and the build-time asset
pipeline, because it is deferred behind triggers that have not fired.

---

## Gate 0 — measure before investing further

**Gate to start:** nothing. This is the current phase, and nothing below it should begin
until it closes.

Run round 2 to completion on `exploration`: both arms, isolated contexts, sealed proofs,
capture, judge, pair. `pnpm round:next` prints the next command at every step.

Then finish [PRD-021](../PRDs/PRD-021-the-improvement-round.md) phase 3 —
`scripts/round-deletions.ts` and `round:deletions`. Rule 2
is the charter's kill switch and it has executed **zero** times; the list of exports no
build ever reached currently sits in a JSON blob nothing reads. That is the shape of the
failure that killed v1 at 790k lines.

**Gate to exit — one of two outcomes, decided by the number, not by preference:**

- **The framework arm passes proofs materially more often, or scores higher blind.**
  The product is real. Proceed to Phase 1.
- **Both arms tie on proofs, visuals and cost.** The framework is not a framework.
  Narrow to `@threenative/physics` and `@threenative/playtest` — two genuinely useful
  Three.js libraries — and delete the rest. This is the kill switch working, not a
  failure.

**Points available: +25** (ships working, looks good), and they are available *only* by
running the instruments. No code change earns them.

---

## Phase 1 — win the two unmeasured axes

**Gate to start:** Gate 0 exits on the first outcome.

1. **Close every gap the round-2 ledger names.** Each gap row gets exactly one
   disposition; a `framework change` disposition names a live caller and a PRD.
2. **Score the visual axis — the templates are already built.** PRD-030 shipped the
   baseline: all three templates carry the same six render entry points (`palette`,
   `camera`, `sky`, `lighting`, `materials`, `postprocessing`), and `pnpm visuals`
   scaffolds each one, captures a headed WebGPU frame under `xvfb-run`, and rejects blank
   frames through the capture guard. See `docs/product/VISUAL-BASELINE.md`.
   **What has never happened is the blind pair against vanilla.** The remaining work on
   this axis is a scoring session, not a template rewrite — no PRD, and no new code.
3. **Widen the pair beyond N=1.** `platformer` and `topdown-action` have pair machinery
   and archives; `endless-runner` has a sealed proof set and no pair.

**Gate to exit:** three genres paired, framework arm ahead on proofs and blind visuals in
at least two, and `pnpm budgets` green with no cap raised (§10 — exceeding a cap is not a
signal to raise the cap).

**Points: +30** → ~60/100.

---

## Phase 2 — capabilities vanilla does not have

**Gate to start:** Phase 1 exit gate green.

This is the axis with the most headroom, because it is the only one where the comparison
is 0→1 rather than a percentage. Vanilla Three.js has no physics, no asset pipeline, and
no way for an agent to verify its own game in a browser.

- **Assets — [PRD-032](../PRDs/PRD-032-asset-discovery-mcp.md).** The legacy tree already
  solved this: `threenative-asset-mcp` v0.5.0 in `../threejs-to-bevy/packages/asset-mcp`,
  10,847 LOC and 25+ tools over Fab, Poly Haven, ambientCG, Smithsonian 3D, Sketchfab,
  itch and a curated game-audio catalog, separating source discovery from license-verified
  direct downloads.

  **It costs zero workspace slots and zero framework LOC.** `check-budgets.ts:56-69`
  counts only `packages/*/src` and workspace members; the server stays external and the
  scaffold declares it in the generated project's `.mcp.json`. Vendoring it would consume
  72% of the 15,000 LOC cap and a ninth package against a cap of eight.

  PRD-032 also records why `docs/product/ASSET-PIPELINE.md`'s deferral does not apply:
  that document defers a *build-time optimization* pipeline on LOC-cap grounds. Discovery
  and licensing is a separate problem that runs beside the agent, not inside the build.
- **Dev loop.** Hot reload with state preservation. Hundreds of vanilla lines nobody
  wants to write, and it does not touch the look.
- **`physics` earns its keep.** It is already the strongest asset and appears nowhere in
  the LOC table. Measure reach rate on a physics-heavy genre and let the number say
  whether it is carrying the framework.

**Gate to exit:** an agent scaffolds a game, finds and licenses a real asset without
leaving the project, and the paired vanilla arm cannot match it inside the same brief.

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
