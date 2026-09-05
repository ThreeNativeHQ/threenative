# PRD-357 C4 duplicate canonicalization proposal

Status: owner checkpoint required. This record is an inventory and proposal only; no evidence image
has been deleted.

## Exact inventory

[`prd-357-c4-duplicate-inventory.json`](prd-357-c4-duplicate-inventory.json) is generated from the
Git index with `pnpm tsx scripts/check-evidence-budget.ts --image-duplicates`. The `.` pathspec
means every tracked image in the repository; the budget gate still reports duplicate bytes per
evidence tree separately. Each of the 207 groups has its blob, size, paths, current canonical and
exact `remove` candidates. The current isolated-lane observation at `853fdee7` with C3's index
changes staged is:

| Scope | Observation |
|---|---:|
| tracked image paths (including unique images) | 819 |
| exact duplicate groups | 207 |
| copies in those groups | 576 |
| redundant files | 369 |
| redundant bytes | 103,754,237 |

These numbers match the PRD's historical measurement exactly: 207 groups, 369 redundant files and
103,754,237 redundant bytes. `git diff --name-status 8df60c0c 853fdee7` contains only the added PRD;
there were no image changes between those commits. The earlier 206-group, 359-file,
101,679,076-byte result was an incomplete two-tree walk, not baseline drift. The repository-wide
inventory is the byte-identical source of truth for this proposal.

## Proposed canonical copy

The generated map uses this deterministic rule for the current paths:

1. Keep `docs/benchmark/genres/<genre>/reference.png` when a group contains one; this is the sealed
   input read by `scripts/make-sandbox.ts`.
2. For every other group, keep the lexicographically first path.
3. Treat every path in that record's `remove` array as a candidate only after its consumer
   references are updated and the owner approves the exact map.

The `sha`, `size`, `copies`, `redundantBytes`, `files`, `canonical` and `remove` fields make each
proposed byte change reviewable. Removing a listed path would reclaim exactly `size` bytes; the
group's total reclaim is `redundantBytes`. No path is removed by the generator or this lane.

Two groups need a migration step before their current canonical can be removed:

- **Template icons (`4350e9cd0e16860eba1c1344e8eaf98d9c38a3c8`).** Move the existing 5,925-byte blob at
  `packages/create-threenative/templates/action-rpg/public/icon.png` to
  `packages/create-threenative/template-assets/icon.png`, then remove all ten template
  `public/icon.png` source paths in one approved change. Update `packages/create-threenative/src/index.ts`
  to copy that canonical asset to `<target>/public/icon.png` after the existing verbatim template
  copy. This retains the fixed `public/icon.png` output in all ten scaffolds while reducing this
  group by exactly 53,325 redundant bytes. Update `packages/create-threenative/AGENTS.md`,
  `__tests__/scaffold.spec.ts` and `__tests__/template.spec.ts` so the package instruction and tests
  distinguish source assets from generated output; the existing scaffold path expectations remain.

  The ten current source paths are `packages/create-threenative/templates/{action-rpg,defense,
  minimal,platformer,puzzle,racing,runner,sailing,shooter,starter}/public/icon.png`; each is the
  same 5,925-byte blob. The copy helper must fail if the generated destination already exists, just
  like the existing template copy, so every scaffold still ships one fixed-path icon without a
  silent overwrite.
- **Platformer reference (`98c76cc19f936a7a07317d010dd4c6ed46fb061f`).** Keep
  `docs/benchmark/genres/platformer/reference.png` because `scripts/make-sandbox.ts:246-254` and
  `scripts/__tests__/make-sandbox.spec.ts:227-235` resolve and compare that exact path. Before
  removing the two sweep copies and `examples/REFERENCE.png`, update the fixed citations at
  `docs/verification/PRD-015.md:49` and `docs/verification/vector-texture-census-2026-08-22.md:18`.
  The four current paths are `docs/benchmark/genres/platformer/reference.png` (canonical),
  `docs/benchmark/sweeps/platformer-2026-08-16/reference.png`,
  `docs/benchmark/sweeps/platformer-2026-08-16-2/reference.png`, and
  `examples/REFERENCE.png`; each is 2,021,836 bytes, so the aliases account for 6,065,508
  redundant bytes. The `docs/PRDs/done/` mentions are historical prose, not runtime consumers; no
  rendered Markdown image link currently points at this group.

## Consumer map

| Evidence path shape | Consumer or reference | Required safety action before removal |
|---|---|---|
| `packages/create-threenative/templates/*/public/icon.png` | `packages/create-threenative/src/index.ts:624-645`, `packages/create-threenative/__tests__/scaffold.spec.ts:558-569`, `packages/create-threenative/__tests__/template.spec.ts:343-352` | Copy `template-assets/icon.png` to the fixed generated path and keep every generated icon byte-identical. |
| `docs/benchmark/genres/*/reference.png` | `scripts/make-sandbox.ts:244-254`, `scripts/__tests__/make-sandbox.spec.ts:227-235` | Keep each genre canonical; update only citations, never the sealed input path. |
| `docs/benchmark/sweeps/*/reference.png` | `scripts/sweep-proof.ts:175-181`; `scripts/sweep-evidence.ts:69-88` | Add a checked-in arm-to-canonical manifest with one entry per affected sweep path, update archive/proof classification to resolve the manifest, then remove only aliases. |
| `docs/benchmark/sweeps/*/proof-artifacts/**` and `captures/**` | `scripts/sweep-evidence.ts:69-100`, retention scanning and round reveal manifests | Update manifest/reveal references, then rerun the sweep proof and the relevant round checks. |
| `docs/benchmark/rounds/**` | blind-round bundles and `reveal.json` mappings | Preserve bundle labels and update each reveal source path atomically. |
| `docs/verification/visuals/**` | `scripts/visual-gate.ts:452-459`, `scripts/template-baseline.ts` and citation scanning | Preserve the baseline name or update the visual consumer and rerun the visual gate. |
| other `docs/verification/**` | citation-bearing PRDs/round ledgers plus `scripts/evidence-citations.ts` | Update every exact path citation; retain rendered Markdown links and rerun retention-index generation. |

The exact tracked-text references to duplicate image paths found by `git grep -n -I` are:

`docs/PRDs/done/PRD-137-the-agent-test-on-a-real-game.md`,
`docs/benchmark/rounds/prd-137/reveal.json`,
`docs/verification/PRD-323-phase3-phase4-phase5.md`,
`docs/verification/agent-test-fps-2026-08-17.md`,
`docs/verification/evidence-manifests-2026-08-21.md`,
`docs/verification/round-9-2026-08-15.md`,
`docs/verification/score-physics-puzzle-round-7-2026-08-15.md`,
`packages/playtest/__tests__/capture.spec.ts`,
`scripts/__tests__/capture-guard.spec.ts`, and
`scripts/__tests__/make-sandbox.spec.ts`.

The two fixed icon consumers are the scaffold source copy in `packages/create-threenative/src/index.ts:624-645`
and the generated-output assertions in `packages/create-threenative/__tests__/scaffold.spec.ts:417`
and `:468`; they are not safe to satisfy with a by-name delete. A repository-wide Markdown-link
scan found no rendered link to the platformer duplicate group. The remaining text hits are the
historical `docs/PRDs/done/` records and the current verification citations listed above.

The JSON inventory is the complete 207-group manifest: each group retains its SHA, size, every
tracked path, one proposed canonical, and its exact removal candidates. Cleanup must use that
manifest rather than a filename search. For each removed path, the approved change must either
keep the existing fixed consumer on the canonical path or update its checked-in manifest/reference
to the canonical path, then rerun the consumer's test. Generated scaffold icons remain at
`public/icon.png`, and every rendered Markdown image link remains on a live canonical path.

## Checkpoint sequence

After owner approval of the exact `remove` map: record byte-identical before observations for
`pnpm round:next`, `pnpm round:deletions` and `pnpm alpha:bar`; add the icon copy helper and the
sweep/reference manifest updates; scan every removed path for fixed consumers and rendered Markdown
links; remove only listed candidates; regenerate this full-repository inventory; run those three
commands again and compare the observations; then run the full evidence, archive and repository
gates. The current duplicate cap is deliberately provisional at 15,214,948 bytes for verification
and 80,909,071 bytes for benchmark; it is a growth stop until that checkpoint chooses the
post-cleanup per-tree caps.
