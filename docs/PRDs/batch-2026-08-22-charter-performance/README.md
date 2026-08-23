# Batch — make the performance-default amendment true, 2026-08-22

**Status:** NOT STARTED. Seven PRDs filed from
`docs/audits/charter-performance-audit-2026-08-22.md`.

The audit found that pooling, batching and culling already hold, but allocation-free ordinary
frames and repository-wide `performance` proof do not. This batch closes every cited HOT path,
the bounded WARM paths that execute each feature frame, six generated-template regressions, and
the missing discoverability/proof contract. The header amendment itself already passes.

## Scope and ownership

| PRD | Outcome | Complexity | Depends on |
| --- | --- | --- | --- |
| [189](./PRD-189-core-ordinary-frame-allocates-nothing.md) | `ctx.input.vector`, `ctx.state.set`, and the fixed loop stop allocating per ordinary frame | 4 → MEDIUM | none |
| [190](./PRD-190-projected-scenes-reuse-their-plan.md) | A projecting scene reuses scan and apply workspaces while preserving same-frame correctness | 3 → LOW | none |
| [191](./PRD-191-physics-feature-frames-reuse-crossing-storage.md) | Area reconciliation and the web Rapier boundary reuse storage | 4 → MEDIUM | none |
| [192](./PRD-192-result-bearing-math-has-reusable-targets.md) | Picking, path following, viewport projection and navigation avoid internal temporaries | 6 → MEDIUM | none |
| [193](./PRD-193-all-templates-model-allocation-free-frames.md) | All seven generated templates model the allocation discipline | 3 → LOW | 189, 192 |
| [194](./PRD-194-every-template-carries-a-real-performance-proof.md) | Every template has bounded browser proof; supported desktop lanes run the same assertion | 3 → LOW | 193 |
| [195](./PRD-195-performance-default-is-discoverable-and-factual.md) | One shared agent rule ships everywhere; stale Charter workload facts are corrected | 3 → LOW | 189–194 |

## Order

1. Run 189, 190 and 191 independently; each removes a measured runtime source.
2. Run 192 before template edits so generated code can consume any target-taking API it adds.
3. Run 193, then measure the cleaned workloads in 194; never budget the pre-cleanup fixtures.
4. Land 195 last so generated instructions never promise a convention the tree still violates.

## Explicit exclusions

- PRD-186 keeps instanced-write and `FrameStats` ownership; this batch does not duplicate them.
- The completed PRD-169 decline cadence remains intact; PRD-190 owns only actively projected frames.
- Result objects a caller explicitly asks to own may allocate; hidden intermediate objects may not.
- Bloom and every other appearance decision stay unchanged under the Charter's look veto.

## Batch acceptance

- [ ] All seven PRDs have dated records in `docs/verification/` with observed red controls.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exits 0.
- [ ] `pnpm test:templates` executes all seven generated projects and their bounded assertions.
- [ ] Desktop/native claims name the executable and adapter actually run; unexecuted targets remain
      explicitly unverified.
- [ ] The batch moves as a whole to `docs/PRDs/done/` only after every PRD is complete.

