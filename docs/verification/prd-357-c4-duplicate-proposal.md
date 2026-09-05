# PRD-357 C4 duplicate canonicalization proposal

Status: applied. The owner approved the canonical-copy plan; all 369 redundant image paths in the
approved 207-group map were removed, and no checkpoint remains pending.

## Exact inventory

[`prd-357-c4-duplicate-inventory-before.json`](prd-357-c4-duplicate-inventory-before.json) keeps
the exact pre-C4 Git-index map. [`prd-357-c4-duplicate-inventory.json`](prd-357-c4-duplicate-inventory.json)
is regenerated from the post-cleanup index with `pnpm tsx scripts/check-evidence-budget.ts
--image-duplicates`. The `.` pathspec means every tracked image in the repository; the budget gate
still reports duplicate bytes per evidence tree separately.

| Scope | Observation |
|---|---:|
| tracked image paths (including unique images) | 819 before / 450 after |
| exact duplicate groups | 207 |
| copies in those groups | 576 |
| redundant files | 369 |
| redundant bytes | 103,754,237 |

These are the PRD's historical measurement exactly: 207 groups, 369 redundant files and
103,754,237 redundant bytes. `git diff --name-status 8df60c0c 853fdee7` prints only
`A docs/PRDs/agent-leverage/PRD-357-the-search-path-is-mostly-noise.md`; there were no image
changes between those commits. The earlier 206-group, 359-file, 101,679,076-byte result was a
root-excluding CLI walk, not historical baseline drift. The before manifest is the complete
repository-wide source map; the current inventory records its zero-group result.

## Proposed canonical copy

The generated map uses this deterministic rule for the current paths:

1. Keep `docs/benchmark/genres/<genre>/reference.png` when a group contains one; this is the sealed
   input read by `scripts/make-sandbox.ts`.
2. For every other group, keep the lexicographically first path.
3. Treat every path in that record's `remove` array as removable only after its consumer references
   are updated; the owner approved this exact map on 2026-09-04.

The `sha`, `size`, `copies`, `redundantBytes`, `files`, `canonical` and `remove` fields make each
byte change reviewable. Each removed path matched its group's SHA and size before deletion; the
cleanup reclaimed exactly `redundantBytes` across the before map.

Two groups required explicit migration or consumer treatment:

- **Template icons (`4350e9cd0e16860eba1c1344e8eaf98d9c38a3c8`).** The existing 5,925-byte blob at
  `packages/create-threenative/templates/action-rpg/public/icon.png` was moved to
  `packages/create-threenative/template-assets/icon.png`. The scaffolder copies that canonical
  asset to `<target>/public/icon.png` after the existing template copy. This retains the fixed
  `public/icon.png` output in all ten scaffolds while removing exactly 53,325 redundant bytes.
  `packages/create-threenative/AGENTS.md`, `__tests__/scaffold.spec.ts` and
  `__tests__/template.spec.ts` distinguish source assets from generated output; the existing
  scaffold path expectations remain.

  The ten current source paths are `packages/create-threenative/templates/{action-rpg,defense,
  minimal,platformer,puzzle,racing,runner,sailing,shooter,starter}/public/icon.png`; each is the
  same 5,925-byte blob. The copy helper fails if the generated destination already exists, just
  like the existing template copy, so every scaffold still ships one fixed-path icon without a
  silent overwrite.
- **Platformer reference (`98c76cc19f936a7a07317d010dd4c6ed46fb061f`).** Keep
  `docs/benchmark/genres/platformer/reference.png` because `scripts/make-sandbox.ts:246-254` and
  `scripts/__tests__/make-sandbox.spec.ts:227-235` resolve and compare that exact path. The fixed
  citations at `docs/verification/PRD-015.md:49` and
  `docs/verification/vector-texture-census-2026-08-22.md:18` now use that canonical.
  The four pre-C4 paths were `docs/benchmark/genres/platformer/reference.png` (canonical),
  `docs/benchmark/sweeps/platformer-2026-08-16/reference.png`,
  `docs/benchmark/sweeps/platformer-2026-08-16-2/reference.png`, and
  `examples/REFERENCE.png`; each is 2,021,836 bytes, so the aliases account for 6,065,508
  redundant bytes. The `docs/PRDs/done/` mentions are historical prose, not runtime consumers; no
  rendered Markdown image link points at this group.

## Consumer map

| Evidence path shape | Consumer or reference | Required safety action before removal |
|---|---|---|
| `packages/create-threenative/templates/*/public/icon.png` | `packages/create-threenative/src/index.ts`, `__tests__/scaffold.spec.ts`, `__tests__/template.spec.ts` | Copy `template-assets/icon.png` to the fixed generated path and keep every generated icon byte-identical. |
| `docs/benchmark/genres/*/reference.png` | `scripts/make-sandbox.ts:244-254`, `scripts/__tests__/make-sandbox.spec.ts:227-235` | Keep each genre canonical; update only citations, never the sealed input path. |
| `docs/benchmark/sweeps/*/reference.png` | `make-sandbox.ts` resolves only `docs/benchmark/genres/*/reference.png`; `sweep-proof.ts` reads sealed proof files | Keep every genre input canonical; remove only unneeded committed sweep aliases. |
| `docs/benchmark/sweeps/*/proof-artifacts/**` and `captures/**` | capture indexes, retention scanning and round reveal manifests | Rewrite every affected JSON path to its retained canonical before removal; the fixed capture tests now use the retained platformer capture. |
| `docs/benchmark/rounds/**` | blind-round bundles and `reveal.json` mappings | Preserve bundle labels and update the eight PRD-137 reveal sources to their labeled bundle images. |
| `docs/verification/visuals/**` | `scripts/visual-gate.ts`, `scripts/template-baseline.ts`, `scripts/sweep-judge.ts` and citation scanning | Retain directory baselines; blind bundle manifests may reference only an existing canonical within the repository root, and the judge rejects any outside path. |
| other `docs/verification/**` | citation-bearing PRDs/round ledgers plus `scripts/evidence-citations.ts` | Update every exact path citation; retain rendered Markdown links and rerun retention-index generation. |

The exact-path scan used `git grep -n -I -F` for every entry in the before manifest, followed by a
relative-path walk of all tracked JSON values. It found fixed references in the capture tests,
the PRD-137 reveal, three verification citations, 15 capture indexes and 28 blind bundle
manifests. Those consumers now use the retained canonical paths. A repository-wide Markdown-link
scan found two affected rendered links and rewrote them to the exploration and endless-runner
genre canonicals; it found no rendered link to the platformer duplicate group. The remaining
`examples/REFERENCE.png` hits are historical `docs/PRDs/done/` prose and were not live consumers.

The before JSON is the complete 207-group manifest: each group retains its SHA, size, every tracked
path, one canonical, and its exact removal candidates. Cleanup used that manifest rather than a
filename search. For each removed path, the approved change either kept the fixed consumer on the
canonical path or updated its checked-in manifest/reference to the canonical path. Generated
scaffold icons remain at `public/icon.png`, blind labels remain unchanged, and every rendered
Markdown image link remains on a live canonical path. The post-cleanup JSON reports zero groups and
zero duplicate bytes.

## Applied sequence

After owner approval, the lane captured the three new-base command outputs, added the icon copy
helper and manifest/reference updates, validated all 369 removals by SHA and size, removed only the
before-manifest candidates, regenerated the full-repository inventory, and lowered both per-tree
duplicate caps to the measured residual non-image duplicate bytes: `3,073` for
`docs/verification` and `1,007,187` for `docs/benchmark`. The before and after command outputs are
byte-identical. Final repository, archive and A5 restoration evidence is recorded in
[`prd-357-search-noise.md`](prd-357-search-noise.md).
