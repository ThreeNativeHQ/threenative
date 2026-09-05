---
prd_contract: v1
---

# PRD-361 — Release tests the archives before publishing

**Status:** PROPOSED
**Priority:** 2 — implement today, before the next publication.
**Complexity:** 1 (up to 5 files) + 2 (orchestration state) = **3 → LOW mode**.
**Estimate:** 4–6 engineering hours, plus full golden-path execution.
**Owner layer:** repository release tooling; the defect is in publication sequencing.

## Problem and evidence

`scripts/release.ts:104` packs into a temporary directory and deletes it. Its dry branch calls
that function and returns. The publish branch invokes package publication directly, then runs
`scripts/verify-registry-install.ts` only after the publish loop. A successful dry run therefore
does not prove a consumer can install or run the archives, and a consumer defect can be discovered
after npm has accepted immutable versions.

This is a source-confirmed gap, not a reproduced broken release. No release command or publication
was executed during planning. The [batch README](README.md) records the separate live registry gap.

Inspected: `scripts/release.ts`, `scripts/__tests__/release.spec.ts`,
`scripts/verify-golden-path.ts:759` and `:1149`, root `package.json`, and the existing registry runner.
The golden-path runner already adopts supplied archives through `TN_GOLDEN_PATH_ARCHIVES`, runs
generated consumers, and runs a packed mutation control. Reuse it.

[PRD-119](../done/PRD-119-the-alpha-release-train.md) owns the existing release train;
[PRD-112 repair](../BLOCKED/requires-packed-gate/PRD-112-repair-golden-path-contract.md) owns golden-path
correctness and its outstanding proof. This PRD owns the missing release caller and archive identity,
not a replacement harness. Re-run that gate before assuming its historic blocker still exists.

## Solution and integration ledger

Build and pack once, run the existing full packed golden path against those archives, then publish
those same archives in dependency order. Dry and real release paths share this preparation. Retain
the existing post-publication registry check. `--skip-gates` may keep skipping its existing generic
checks but must not bypass the archive consumer proof. No new public command, package or UI.

| New thing | Live caller / intended wiring | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- |
| Shared pack-and-prove preparation | `scripts/release.ts` → `main`, before dry return and publish loop | Dry-only packing; unproved publish branch | Both delegate in phase 1 | Broken archive fails both paths before any publish call |
| Archive consumer gate | `scripts/release.ts` → existing `verify:golden-path` using `TN_GOLDEN_PATH_ARCHIVES` | No consumer validation before publication | Existing harness reused | Remove gate call: orchestration test fails |
| Publish proved bytes | Existing dependency-ordered publish loop in `scripts/release.ts` | Publishing a package directory that may repack | Replace in phase 1 | Swap archive after proof: identity check fails |

Final implementation supplies exact non-test line anchors. Data change: ephemeral archive identity
manifest (name, version, path, digest), retained for the whole run and cited in its evidence.
Use the existing adopted-archive shape; do not create a competing package-discovery implementation.

## Phase 1 — Dry and real releases share the consumer gate

Files (maximum 5): EDIT `scripts/release.ts`, `scripts/__tests__/release.spec.ts`,
`scripts/verify-golden-path.ts`, `scripts/__tests__/verify-golden-path.spec.ts` only if their existing
adoption API needs adjustment; NEW `docs/verification/release-archives-2026-09-05.md`.

1. Add behavioral orchestration tests using an injected command executor; retain production wiring
   from `main`. Start red by showing the current dry path does not invoke the consumer gate.
2. Retain archive paths from packing, feed the complete set to the existing golden-path adopter,
   and await all configured templates and its mutation control. Propagate nonzero results.
3. Publish explicit proved tarball paths in the existing order with current access/provenance
   behavior. Verify package name/version and digest immediately before each publish. Fail if files
   changed, are missing, or disagree with the intended set. Clean only this run's owned temp root.
4. Execute a real dry run and the existing packed malformed-template control. Do not publish to
   test sequencing: the injected executor proves publish ordering and zero publication on failures.
5. Record command output, archive identities, final caller anchors, and independent checkpoint review.

| Test | Consumer assertion | Mutation that must be observed red |
| --- | --- | --- |
| `should prove archives before either release branch` | Dry and publish use the same gate and archive set | Remove the gate invocation |
| `should publish nothing when consumer proof fails` | Failed child prevents the first publish call | Continue despite gate failure |
| `should publish only the proved bytes` | Publisher receives validated tarball paths in dependency order | Change a staged archive after validation |
| `should keep archive proof mandatory with skip-gates` | Flag never bypasses packed consumer validation | Put proof inside optional generic checks |
| Existing packed mutation control | Real generated project exposes the mutated archive defect | Substitute the unmutated archive and observe identity/control failure |

Focused command: `pnpm exec vitest run scripts/__tests__/release.spec.ts scripts/__tests__/verify-golden-path.spec.ts`.
User verification: `pnpm release` prints the consumer proof and never publishes. If existing
preflight or golden-path failures prevent this, record the exact cause; do not relabel packing as
proof or use a bypass to claim acceptance. Implementation remains incomplete until the dry path runs.

## Completion

- [ ] A malformed packed consumer stops both release paths before their first publish operation.
- [ ] A successful dry run exercises the existing full golden path with recorded archive identities.
- [ ] Publish execution can consume only those proved bytes; post-publish verification remains live.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and independent integration review pass with outputs.
- [ ] The actual golden-path scenarios run; only platforms executed by that gate are claimed.

No package publication is needed to close this implementation. The follow-up public release remains
the existing release workflow's task. PRD-362 separately binds its registry proof to exact versions.

Next action (under 2 minutes): open `scripts/release.ts` at `packReleaseSet` and the dry-run branch.
