# PRD-462: Material change notification instead of per-frame polling

**Status:** IN PROGRESS — phase 1 landed and verified 2026-09-28, phase 2 open.
**Date:** 2026-09-28
**Target branch:** `develop`
**Owner request:** close the last row where Godot beats ThreeNative on the PRD-449 scoreboard, the same way a real game benefits.

## Problem

The render projection batches meshes whose materials differ only in colour into one instanced draw (`packages/core/src/projection-uniform.ts`). To honour "the game may change anything at any time", it polls every distinct member material every frame. That costs about 0.69 µs per material, or 2.8 ms at 4,096 materials, and it accounts for all of the remaining can't-batch gap. On the 2026-09-28 scoreboard, L4 ran 7.88 ms for TN against 5.95 ms for Godot at 4,096 cubes, and 2.08 against 1.73 ms at 1,024. A build without the check runs L4 at 4,096 in 2.8 ms. Agent-written games often create one material per object, so this is a real pattern, not a benchmark shape.

## Design (measured in a scratch micro-bench, 2026-09-28)

When a material joins a uniform batch, its watched own properties become accessor pairs that set a dirty bit on write. There is one shared accessor pair per key name, with values kept in a non-enumerable symbol store. The per-frame check becomes: dirty bit, then a component compare of the few object-valued fields (`Color`/`Vector2`/`Euler`), then the `defines` walk. That measured 0.056 µs per material, against 0.69 today. `onBeforeCompile` and `customProgramCacheKey` are watched by name. A material leaving the batch, or the batch being released, restores its plain data properties. The drawn material is the mirror's own plain clone, so three.js's draw path never reads a watched object.

- **Install cost:** about 32 µs per material, or 130 ms for 4,096. Watchers install in slices under a per-frame budget, and a member not yet watched stays on today's exact poll, so detection never lapses.
- **Game-side cost:** a watched material reads in about 24 ns instead of 1.5 ns, and writes in about 110 ns instead of 1 ns. This is off the draw path.
- **Accepted gaps (no guard row covers them today):** `delete material.<watched key>` and `Object.freeze` on a batched material. Both are recorded here and not silently claimed.

### What the implementation measured (phase 1, 2026-09-28)

`pnpm exec vitest run packages/core/__tests__/projection-uniform-batch.spec.ts` reports both costs for the same 4,096 members: **1.04 µs polled, 0.23 µs watched** (0.18–0.36 across runs), so the settled frame's whole job drops from 4.3 ms to 0.9 ms. The install is 33 µs a material and takes 61 frames to cover 4,096 at the 2 ms budget.

Two things the design review did not cost, both found while landing it and both now paid for:

- **A watched material cannot be re-classified by enumerating it.** Installing 71 accessors puts the object in a shape where `Object.keys` costs 1.16 µs against 0.07 µs plain, and one material changing drops the whole plan, so the next frame re-derives every member's signature — 4 µs a material, measured at 16 ms for the scene before and 85 ms with the watch. So a watched material that has *provably not moved* returns the fingerprint it was classified with: one dirty-bit read, the same component compares, the same `defines` walk. The change path is then back to 17–20 ms over two frames, measured identical to `origin/develop`'s.
- **The two hooks are not own properties** — three keeps `onBeforeCompile` and `customProgramCacheKey` on `Material.prototype` — so the poll only ever caught a game shadowing one as a change in how many properties the material has. A watch cannot see a property that appears, so it installs **non-enumerable** own accessors for those two names: the assignment raises the dirty bit, and the material's own property list, its signature, a spread and a `toJSON` are exactly what the game wrote. A hook the game never shadowed is deleted on release; one it did shadow comes back as a plain property holding the game's own function.

**Accepted gaps, restated against the code:** `delete material.<watched key>`, `Object.freeze` on a batched material, and **a property added to a watched material** — the poll caught that as a property-count change, and a watch has no accessor on a name that did not exist when it landed. All three fail towards keeping the material batched; none is a guard row anywhere in the suite.

## Phases

### Phase 1: Change notification with the same guarantees

- [x] Watch, dirty-check and restore in `projection-uniform.ts`, with release on every `projection-apply.ts` exit path (material swap, release, batch dispose, `releaseAll`). proof: the 14 existing `projection-uniform-batch.spec.ts` rows stay green; new rows red→green for `onBeforeCompile` and `customProgramCacheKey` assignment ejecting a member, data properties restored after ejection and after `releaseAll`, and a shared-lane material never watched. — 21 rows green (14 existing + 7 new); the 7 new rows fail on `origin/develop`'s two files and pass here; restore asserted for the value, the plain descriptor, the property count and the game's own `onBeforeCompile` function identity.
- [x] Budgeted, sliced install that falls back to the exact poll for members not yet watched. proof: a spec shows a member edited before its watcher installs is still ejected the same frame, and no frame installs past the budget. — one frame with a 1 ms-per-read clock installs between 1 and 63 of 4,096 and ejects a not-yet-watched member in the same frame; 61 frames cover all 4,096 on a real clock.
- [x] Core suite has no new failures. proof: `pnpm --filter @threenative/core exec vitest run`, compared with the known pre-existing set. — 149 files, 1898 passed, 1 skipped, 0 failed; `pnpm typecheck` and `pnpm lint` exit 0; `pnpm quality` reports no suppression (no `as unknown as`, no ts-ignore added).
- [x] A member that changed does not re-derive the fingerprints of the members that did not. proof: a spec counts `Object.keys` per classification and a 64-member scene re-classifies fewer than 16 after one member drifts; the change path costs 17–20 ms over two frames at 4,096, the same as `origin/develop`.

### Phase 2: Prove it on the GPU and on a real game

- [ ] L4@4,096 does not regress in the native arm. proof: `tn-desktop` runs B A B A B A with source hashes in each JSON, and L3 does not regress.
  **Not met, and the number is the finding.** Six paired runs (`tn-notify-{before,after}-{1..6}-2026-09-28.json`, every one carrying `identity.sourceSha`: BEFORE `9afc61e0d7be`, AFTER `2c4324898561`, the sha256 of the two changed files, recomputable with `cat packages/core/src/projection-{uniform,apply}.ts | sha256sum`).
  Paired `after − before`, p50 frame ms: **L3@1,024 +0.02** (L3 has one shared material, and the shared lane is never watched, so this rung cannot move), **L3@4,096 +0.12**, L4@1,024 −0.30, **L4@4,096 +1.88** — 5 of 6 pairs positive. The same JSONs' own `collapseMs` (the projection's slice of the frame) reads +1.46, split +2.20 over the install window and +1.05 in the settled tail; drop the one pair whose run degraded monotonically under a load spike and the settled tail is +0.02, a wash.
  So: **the settled reconcile is a wash in the arm and the install makes a 200-frame window worse.** The premise this PRD was filed on — 0.69 µs a material, 2.8 ms at 4,096, "all of the remaining can't-batch gap" — does not survive contact with the arm, where the poll is cheaper in situ than in a micro-bench because the objects it reads are already hot for the rest of the reconcile, and the watch trades a bulk copy for dictionary lookups that miss. The isolated numbers (1.04 µs polled → 0.22 µs watched, 4,096 members) are real and are in `projection-uniform-batch.spec.ts`; they are simply worth ~0 ms inside a real frame.
  The machine could not settle either: load average went 3.98 → 8.4 → 102.6 during the session (another lane's Chromium and four node processes at ~290% CPU), and the same BEFORE build read 8.34 / 11.18 / 16.35 ms p50 across three of its own runs. An effect of 1–2 ms cannot be resolved on that, and nothing here claims it can.
- [x] Projection on/off pixel match for L4. proof: `examples/engine-load-test` projection-conformance `?rung=uniform&count=4096` compared within the registry tolerance. — **`compareCaptures` 0 pixel mismatch, ΔE 0, byte-identical** on the RTX 2080 (`adapter.vendor nvidia, architecture turing`, WebGPU, 1280×720), both at the shipped one-tick scenario and at a 140-tick settle where all 4,096 member materials are watched. The registry's tolerance is 0.01 / 3.0. The mirror drawn from watched materials and the authored scene drawn unwatched are the same picture, so the notification is invisible to the draw.
- [ ] Real-game holdout shows no regression. proof: racing and shooter template before/after, as in PRD-449. — not run: the machine load above made a frame-time holdout unreadable, and PRD-449's own result for these two templates is that the projection declines below its 200-mesh floor at 96 and 100 renderables, so the uniform lane is never entered on either and the change cannot be the cause of anything there. What is left is the numbers, when the machine is quiet.
- [ ] Scoreboard rerun. proof: `pnpm bench:scoreboard <tag>` on a quiet machine, with the can't-batch row verdicts recorded here. — not run. `uptime` read 10.81, then 73.78, then 102.61 across three attempts spread over ten minutes, all above the 10 the instruction sets as the bar. A scoreboard taken at load 100 would publish a verdict the machine did not produce.

## Acceptance criteria

- [ ] The can't-batch rows are no longer Godot wins on the scoreboard, and every other row stays a TN win or tie. proof: the scoreboard JSONs and the report banner. — **not met, and not reachable by this change as landed.** The A/B above is the same measurement the can't-batch row is made of, and it says the poll was not what that row was losing to. The remaining gap on that row is whatever is in the ~7 ms L4@4,096 frame that is not the projection's own 7.4 ms of reconcile work, and it needs its own attribution, not a cheaper drift check.

## Decisions

**Site page waits for this PRD — owner, 2026-09-28.** The public benchmarks page on threenative-site ships once TN beats Godot on the can't-batch row, with charts and a "run it yourself" guide.

**The notification stays landed; the perf claim does not — owner rule, 2026-09-28.** Every guarantee the poll had is now proved by a spec row instead of by a per-frame scan (21 rows, the 14 originals among them), the classification no longer re-derives 4,096 fingerprints when one member moves, and the draw is byte-identical. What it does not do is make the frame faster, and the PRD's own acceptance is the frame. Rather than delete the mechanism, this PRD stays open with the number on it, and the next step is attributing the L4 frame that the number points at.
