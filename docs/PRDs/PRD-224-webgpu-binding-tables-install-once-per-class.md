---
prd_contract: v1
---

# PRD-224 — WebGPU binding tables install once per class

**Status:** PARTIAL — Phase 2's conversion landed at `47d1adb3` and is contract-proven (red
3 failure(s)/exit 1 with the fast path disabled, green exit 0 restored; both pasted 2026-08-27 in
[`docs/verification/prd-224-binding-tables-once-per-class-2026-08-27.md`](../verification/prd-224-binding-tables-once-per-class-2026-08-27.md)).
Phases 1 (frame pricing), 3 (widen the remaining classes) and 4 (device arm) are NOT STARTED.
Step 1 of the staged plan (`c9941d0a`, GPUCommandEncoder only, measured 78 835 → ~3 820 ns for
`createCommandEncoder`) was PARTIAL BY INHERITANCE at filing time. Filed 2026-08-26 for the night
batch; live at the PRD root since 2026-08-27.

**Complexity:** +2 for the receiver-identity contract change across three engines, +1 for
multi-class surface, +1 for design decisions per class = **HIGH mode**.

## Why this is the highest-value item tonight

The root cause of the parity defect ([PRD-222 reassessment](../verification/prd-222-reassessment-2026-08-26.md),
ROOT CAUSE section): every WebGPU object handed to JavaScript installs its whole method table on
**every call that creates it**, through transactional machinery designed for one-time installation.
Measured per call against Chrome on the same machine:

| Call | Native (red) | Native (after step 1) | Chrome |
| --- | ---: | ---: | ---: |
| `createCommandEncoder` | 78 835 ns | **~3 820 ns** | 919 ns |
| `queue.writeBuffer` (16 B) | 3 249 ns | 2 830 ns | 431 ns |
| `buffer.size` — control | 11 ns | 11 ns | 21 ns |

The frame issues ~3 200 crossings costing 8.16 ms of bridge time; at Chrome's per-call price the
same stream costs ≈1.4 ms. The predicted win crosses the resume criterion's ≥2 ms bar with the
exact caller path named — this is the resume ticket.

**Step 1 proved the falsifier false:** the cost was binding installation, not object construction.
`ensureCommandEncoderClassTable` exists at HEAD; no other class has one (`grep ensure.*ClassTable`
returns one hit).

## Solution (decision recorded here)

Same mechanism as step 1, widened on evidence: one shared prototype per WebGPU class, methods
installed once through the SAME transactional `installBindingTable` (snapshot/verify/rollback run
per class, never per instance), native handles resolved from the receiver's private data.
Engines without method support fall back to the legacy per-call path behind the same entry point —
each conversion is one commit to revert.

Rejected alternative, on the record: wrapper pooling (Lever A) — flat result, removed under the
kill switch. The cost is inside what binding bodies do after entry, not how many wrappers exist.

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | Per-class tables for ≥1 further class | runtime WebGPU bindings | per-call `installBindingTable` on those classes | disable fast path → `threenative-command-encoder-class-table-test`-style executable red, legacy fallback asserts fire |
| 2 | Receiver-aware dispatch through V8/QuickJS/JSC `newMethod()` | all converted handlers | captured-C++-argument closures (`makeCapturedHandler`) | shared-engine contract test with a detached/misresolved receiver fails |
| 3 | Priced widening order | this PRD's verification record | guess-based class order | a class whose measured tax is <2× Chrome's rate is refused conversion |

## Execution Phases

### Phase 1 — Price step 1 at the frame level on a quiet machine

**Files (2):** `verify-desktop-core.mjs` runbook invocation (none added), verification record (NEW).

- [ ] `gpubench.js` rerun on the current build: `createCommandEncoder` ≈ 3.8 µs sustained;
      record current residuals for every class still on the legacy path.
- [ ] Desktop `TN_FRAME_BUDGET` pair against the recorded native render.p50 pair (22.2 ms,
      Chrome 7.6–8.9 ms). Same display lane both arms — Xvfb and `:0` are different meters.
      Expect render.p50 to move materially below 22.2 ms. If it does NOT move, stop: the
      installed tax is real but off the critical path, and widening is refused until that is
      explained.
- [ ] Whole-run averages are banned (see the loading-screen bug's 3× startup swing); frames
      226–899 only.

### Phase 2 — Widen `GPURenderPassEncoder`

`beginRenderPass` costs 154 748 ns per call doing 15 descriptor reads — the largest remaining
single-site tax. It also needs the paired-state ruling (encoder↔pass pairing must resolve from
receiver + argument, lifetime re-derived, not assumed).

- [ ] `gpubench.js` extended to price `beginRenderPass`; green means an order-of-magnitude fall
      (≥10×), pasted.
- [ ] Paired-state rows migrate explicitly; `state->encoderRenderPassMap` ruling written down.
- [ ] Frame pair repeated; delta reported even when small.

### Phase 3 — Widen the rest, ordered by measured tax

- [ ] Every WebGPU class still taking the legacy path gets a per-call price in the verification
      record (constructor sites counted, taxed at measured ns/call).
- [ ] Convert descending by measured tax until the remaining classes are each worth <2 ms/frame
      combined; refuse any class whose tax is <2× Chrome's rate. One commit per class.
- [ ] Cross-engine: QuickJS/JSC lanes exercised, not just compile-checked — name which lane ran
      (preset test, iOS lane, or a stated machine limit; "compiled only" is not verification).

### Phase 4 — Device arm (last, conditional on Phase 1 moving)

By the four-cell table native render.p50 is ~22 ms desktop / ~23 ms phone — the device tracks
desktop here. One capture pair confirms; it does not lead.

- [ ] Cool, discharging Pixel 8 pair (`doctor --device` first); discards startup block.

## Verification

Record `docs/verification/prd-224-binding-tables-once-per-class-<date>.md`.

1. Paste of gpubench.js red→green for every converted class, same file and warm-up protocol.
2. Frame pair table; baseline citations name their revision.
3. Contract executables green (including the shared-prototype regression guard demonstrated red
   at step 1: disabling the fast path produced `2 failure(s)`, exit 1).
4. Known unrelated red left alone and still disclosed:
   `webgpu-bindings-contract.test.mjs`'s over-broad source slice predates this work.

## Acceptance Criteria

- [ ] No WebGPU class whose measured per-call tax exceeds 2× Chrome's rate installs bindings per
      call. (Mutation: remove `ensure…ClassTable` attachment → regression executable fails.)
- [ ] Snapshot/verify/rollback guarantees still execute at install time — at class level.
- [ ] All three engines share the receiver-aware contract or have an explicitly gated fallback;
      cross-engine coverage is named, not implied.
- [ ] Each conversion is independently revertible (one commit).
