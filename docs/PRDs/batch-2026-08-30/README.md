# Batch — decent defaults: the look ships, and it pays for itself, 2026-08-30

**Status: OPEN — filed 2026-08-30 against `728f72e8`. Nothing in this batch has been executed.**

The charter's §1 promise is two clauses that are one rule: **a freshly scaffolded game looks good
before anyone touches it**, and **performance is a shipped default, not a tuning pass the game is
expected to discover**. This tree currently keeps one of them at a time. `starter` has a real
five-stage TSL chain (`src/render/worldEnvironment.ts`, 497 lines, landed `b43b3f87` as PRD-278's
first tranche); the other six templates ship a 14–45 line `postprocessing.ts` that is ACES, an
exposure constant and one bloom. And the one place the chain has been measured, it costs
**12.5 ms of GPU time out of a 14.7 ms frame** — 56.8 fps at 1600×900 on an RTX 2080
(`docs/verification/runtime-perf-state.md`, "Browser WebGPU: a TSL post chain", 2026-08-30).

So the thing that makes the default look good is also the thing that would eat the default frame
budget, and no gate anywhere reads both at once. **That intersection is what this batch is.**

## This batch moves no existing PRD

Per `docs/PRDs/AGENTS.md`, `NOT STARTED` / `PROPOSED` PRDs stay in their owning batch. The five
below are referenced, sequenced and depended on from here; they are not copied and not moved. Only
the two new PRDs live in this folder.

**Filed against a moving tree.** `batch-2026-08-22-charter-performance/` was dissolved into
`performance/` at `3491ad96` while this batch was being written, taking its ordering README with it.
The rows below name where each PRD lives now; re-check a path before citing it.

## Order, and why it is this order

| # | PRD | Where it lives | State | Why here |
| --- | --- | --- | --- | --- |
| 1 | [PRD-278 — every template ships the render chain and says what ran](../PRD-278-every-template-ships-the-render-chain-and-says-what-ran.md) | `docs/PRDs/` | SCOPING | The largest visual-default delta available, and **its stated blocker is stale**: the mined file landed in `starter` at `b43b3f87`. Charter-safe — it ships as generated source, so it needs no owner ruling. Six templates, six integration problems. |
| 2 | [PRD-193](../performance/PRD-193-all-templates-model-allocation-free-frames.md) + [PRD-194](../performance/PRD-194-every-template-carries-a-real-performance-proof.md) | `performance/` | NOT STARTED | The regression net under 1. Adding five TSL stages to seven templates with no per-template performance proof is how a good default silently becomes a 30 fps one. Run **with** 1, not after. |
| 3 | [PRD-287 — the default look holds the phone's budget, or steps down and says so](./PRD-287-the-default-look-holds-the-phones-budget.md) | **here** | OPEN | New. The device arm nothing owns, plus a correction to the tier ladder's selection meter. |
| 4 | [PRD-288 — the first frame is not the compile bill](./PRD-288-the-first-frame-is-not-the-compile-bill.md) | **here** | OPEN | New. `packages/core/src/warmup.ts` compiles the scene and never touches the post chain. |
| 5 | [lighting/PRD-266 — the render chain names the tier it actually ran](../lighting/PRD-266-the-render-chain-names-the-tier-it-actually-ran.md) | `lighting/` | PROPOSED | **Blocked on one owner decision, not on code** — see below. It is fifth in this list only because of that gate; on a yes it becomes the spine of 3 and 4. |
| 6 | [lighting/PRD-270 — no lighting node ships web-only](../lighting/PRD-270-no-lighting-node-ships-web-only.md) | `lighting/` | PROPOSED | The charter calls a web-only feature unfinished. Without it the new default look is a web-only default and the native templates diverge on first `pnpm dev`. |

`mobile/PRD-214`'s unstarted phases 1–2 and `performance/PRD-222` are the Android frame-rate lanes
this batch's PRD-287 measures against. They are not in scope here; PRD-287 consumes their meters and
does not duplicate their levers.

## The one thing only the owner can answer

`lighting/PRD-266` opens with a blocking question and it gates rows 5 and 6, and the framework half
of 3: **`CHARTER.md` lists "post-processing composition" in the *framework must never own* column,
and `packages/core/AGENTS.md` repeats it as "not as code, and not as a `defineGame` option".**
`WorldEnvironment` composes a post-processing order. By name it is the forbidden thing; by the
charter's own veto test — *can the game change the appearance completely without editing package
code?* — it passes, because every stage, strength, colour, exposure and tone curve stays in the
game's source.

The decision has an executable form: landing the planner in `packages/core` fails
`packages/core/__tests__/constraints.spec.ts:62`. **Yes** means that assertion gains an entry and
the tier ladder, capability detection and degradation become mechanism in core. **No** means the
ladder ships as generated source in all seven templates and PRD-287 grades seven copies instead of
one seam. Both are executable; neither is guessable. Row 1 does not wait on it.

## Explicit exclusions

- **`lighting/PRD-268`** (irradiance probe volume, off-screen light) is the largest *quality* jump
  on the table and is deliberately out. It is multi-week and it is pointless before the chain is in
  the templates at all.
- **`lighting/PRD-267`** (SSGI in the templates) folds into PRD-278's per-template tuning; running
  it separately edits the same seven files twice.
- **`nanite-like/`** closed 2026-08-30 — shipped on browser, phases 4 and 5 declined on measured
  headroom. Its open native regression (89 draws, unspread arrival) is that batch's, not this one's.
- No new package, no new dependency. Every node this batch composes is already in `three@0.185.1`,
  which all seven templates pin.

## Filing note

PRD numbers **266, 267, 218, 219, 222 and 254** each exist twice in `docs/PRDs`, in different
folders. Cite them with their folder or the reference is ambiguous. **286** is taken by
`docs/verification/prd-286-virtual-geometry-ships-on-2026-08-30.md`, which is why the two new PRDs
here are 287 and 288.

## Batch acceptance

- [ ] Every PRD in the table above is DONE or explicitly DECLINED with its numbers.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exits 0.
- [ ] `pnpm test:templates` executes all seven generated projects, including each one's
      `performance.playtest.json` on the default path.
- [ ] One physical-device run appears in `docs/verification/`, naming the serial, the thermal
      status and the adapter; an unexecuted target is recorded as UNVERIFIED and not inferred.
- [ ] The batch moves to `docs/PRDs/done/` only when the last PRD closes. A blocked criterion is
      not completion.
