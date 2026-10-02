# Execute this batch

## Agent handoff

```text
Read AGENTS.md, docs/PRDs/AGENTS.md and this folder's README.md.
Work from current origin/develop in an isolated branch/worktree.
Choose the highest-value unblocked item from the execution queue.
For an existing owner, read and update its canonical PRD rather than writing a replacement.
Reconcile the current code, tests and merged/open PRs before treating any older claim as missing.
Search capabilities and inspect the installed Three pin and its patches before adding a system.
Keep appearance in generated game source. Reuse the renderer, mixer, loader and frame lifecycle.
Open one implementation PR for that PRD, not one PR for this entire implementation batch.
Implement the smallest bounded phase, run its named tests and playtest, and update actual results inline.
Do not tick another platform's box from browser proof or a green metadata/build check.
Rebase/reconcile shared files between dependent tasks; do not merge parallel changes blindly.
Stop at a failed admission gate with the measured reason, or complete/archive the PRD honestly.
```

## Proof setup

Each new PRD names future test/scenario paths. Those paths are not claimed to exist today. Add the smallest opt-in fixture to the existing `examples/abyss-framework` example, or reuse a better existing fixture and change the proof path in the canonical PRD. Its normal scene must remain unchanged. Do not create a new engine package merely to hold an example.

`VQ_URL` must point to the built/served fixture. `VQ_NATIVE_EXECUTABLE` must name that same fixture's packaged Linux executable. `VQ_ANDROID_DEVICE` is the chosen online emulator/device serial for VQ-01. Build/serve/package using the repository's existing commands; variables with `:?` deliberately refuse an unset value. Capture the fixture route, exact cohort/commit and adapter with the result. Do not run a scenario against an unrelated default scene and report success.

For new public mechanisms, use the existing capability manifest/MCP and update generated guidance. Inspect the installed pin (`three@0.185.1` at the audit baseline) before using an addon seen in online documentation. An incompatible addon can be declined, scoped down, or introduced through an explicitly qualified upgrade; none licenses an automatic fork of the renderer.

## Checks and progress

Run `pnpm prd:progress <canonical-file>` before work and after each phase. New specs have three phases, six phase boxes and two acceptance boxes, with `proof:` on each. All start at zero; a written plan is not implementation progress. Existing PRDs may need their old checklist shape repaired **without deleting completed work**.

For implementation, use the root AGENTS.md runtime gates and the exact feature playtests. For this documentation-only collection, use the repository's prose lane:

```sh
pnpm check:docs
pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts scripts/__tests__/evidence-budget.spec.ts scripts/__tests__/evidence-citations.spec.ts scripts/__tests__/sync-agent-docs.spec.ts scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts
```

Those commands are required execution guidance, not a claim they were run while filing this collection. No runtime test, new benchmark result or human visual approval is supplied by this planning change.

## Concurrency and shared ownership

| Workstream | Can proceed independently | Serialize or reconcile |
|---|---|---|
| Build/runtime correctness | VQ-01 | Runtime artifact capability contract and loader/cook changes |
| Native output correctness | VQ-02 | `renderer.ts`, output attachments and native replay |
| Temporal/exposure | PRD-269, then PRD-455; PRD-339 after output is reliable | `chain.ts`, `velocity.ts`, `worldEnvironment.ts`, quality source |
| Animation | VQ-04 followed by VQ-05 | One mixer/action owner; do not let both reset action weights |
| World transitions | PRD-460, then proxy/impostor follow-ups | CPU and GPU WorldCells selection, per-instance identity, shadow alpha |
| Lighting | VQ-03 and upstream admission for VQ-06 | Material lighting contribution, probe capture budgets and PRD-457 |
| Optional look work | Decals and material fixture authoring | Shared generated render plumbing and temporal/alpha semantics |

Hardware access, rights to assets and human aesthetic approval are named blockers, not progress boxes. Browser and Linux-native qualification is not a promise of phone frame rate. Release scope is unchanged; this folder does not declare all visual experiments release-critical.
