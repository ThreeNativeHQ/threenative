# PRD-353 — the eleven-way fail-closed throw now has a gate

**Executed 2026-09-04** on branch `quickwins/2026-09-04-five-closes`, cut from `8df60c0c`.
Row 2 of the `quickwins-2026-09-04` batch. That batch's README is deleted by the commit that closes its
last row, per its own rule; `git log --diff-filter=D -- docs/PRDs/quickwins-2026-09-04/README.md`
finds it, and the outcome table is in that commit's message.

## The measurement the PRD claimed, re-run at HEAD

Ten in-repo templates, one span hash, every copy carrying the throw — as filed:

```
$ for f in packages/create-threenative/templates/*/src/render/quality.ts; do
    awk '/^export type QualityTier/,0' "$f" \
      | awk '1; /^  return request\.mobile === true/{exit}' | md5sum | cut -c1-12; done | sort -u
7f4a7f8f4ccf
$ grep -L "throw new Error" packages/create-threenative/templates/*/src/render/quality.ts | wc -l
0
$ ls packages/create-threenative/templates | wc -l
10
```

The eleventh copy, `sandbox/wildwood`, is in another repository and out of scope (AC4).

## Phase 0 — the red, before the gate existed

`racing`'s fail-closed `throw` replaced by `return "high";`, then the shipped gate run:

```
$ pnpm tsx scripts/check-template-quality.ts
template quality: 10 templates ship src/render/quality.ts, read it, and document it
exit=0
```

A template that silently returns `"high"` for an unknown tier passed `pnpm budgets`. That is the
defect: `scripts/template-quality.ts:104` checks the three tier names are present and `:172` checks
each is named in prose; nothing compared the implementations and nothing asserted the throw.

## What shipped

`scripts/template-quality.ts` gains four exported functions and one report field:

- `qualityContractSpan` — delimits the shared span **structurally**, from `export type QualityTier`
  to the closing brace of `export function resolveQualityTier` at column 0. Not a line range (a
  growing doc comment moves it) and not a marker comment (that would put gate machinery into
  source whose first line promises the game "ordinary Three.js; ThreeNative does not read this
  file"). It throws when the span cannot be delimited, so an unreadable template is a finding
  rather than a skipped row.
- `contractSpanHash` — sha256, first 12 hex.
- `contractSpanThrows` — asserts the fail-closed behaviour itself, because eleven copies that all
  lost the throw agree with each other perfectly.
- `contractDriftFindings` — names every template outside the largest group, and the group it left.

The span deliberately **stops above the presets**. `high`, `medium`, `low` and `qualityPreset` are
the game's look and differ on purpose; hashing them would freeze exactly the variation the
framework exists to allow.

## Acceptance criteria

### AC1 — drift fails, naming the template

`puzzle`'s narrower changed to `.includes(value.toLowerCase())`:

```
$ pnpm tsx scripts/check-template-quality.ts
TEMPLATE_QUALITY_INCOMPLETE: 1 problems
- puzzle: quality.ts's fail-closed tier contract drifted (698c70f27e53) from the 9 templates that agree (bbb998efac02, e.g. action-rpg)
exit=1
```

### AC2 — a lost throw fails, on its own terms

`racing`'s `throw` replaced by `return "high";` — the same mutation Phase 0 ran green:

```
$ pnpm tsx scripts/check-template-quality.ts
TEMPLATE_QUALITY_INCOMPLETE: 2 problems
- racing: quality.ts's resolveQualityTier does not throw on an unknown tier — a silent fallback here looks exactly like a tier that turned out to have no effect
- racing: quality.ts's fail-closed tier contract drifted (97aca2e2938e) from the 9 templates that agree (bbb998efac02, e.g. action-rpg)
exit=1
```

The first line is the one that matters: the unit spec
`should see a lost throw even when every copy lost it together` proves the assertion fires when
the hashes still agree, which is the drift a hash alone cannot see.

### AC3 — look divergence stays legal

`sailing`'s `high` preset `bloomStrength: 0.38` → `0.71`, confirmed applied by `git diff --stat`
(`1 file changed, 1 insertion(+), 1 deletion(-)`):

```
$ pnpm tsx scripts/check-template-quality.ts
template quality: 10 templates ship src/render/quality.ts, read it, and document it; all agree on the fail-closed tier contract (bbb998efac02)
exit=0
```

An earlier attempt at this control used an anchor that did not exist in `sailing`, so the mutation
never applied and the green proved nothing. It is recorded here because the re-run above is the
one that counts.

### AC4 — Wildwood is not gated

The walk is rooted at `packages/create-threenative/templates`. The spec
`should gate only what this repository generates, never a sandbox game` writes a drifted
`sandbox/wildwood/src/render/quality.ts` into the fixture root and asserts no drift finding and an
unchanged contract hash.

### AC5 — gates

```
$ pnpm typecheck   # Done, all packages
$ pnpm lint        # 578 warnings, 0 errors, exit 0
$ pnpm vitest run scripts/__tests__/check-template-quality.spec.ts
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

`pnpm test` and `pnpm budgets` for the whole batch are recorded in the batch's closing commit.

## Clean-tree baseline

```
$ pnpm tsx scripts/check-template-quality.ts
template quality: 10 templates ship src/render/quality.ts, read it, and document it; all agree on the fail-closed tier contract (bbb998efac02)
exit=0
```
