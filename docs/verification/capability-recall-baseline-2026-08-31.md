# Capability search recall — PRD-298 floor and not-owned proof, 2026-08-31

Measured against the 58-row PRD-297 corpus and the regenerated 272-entry manifest in this
checkout. The corpus remains repo-only input; no benchmark brief or corpus row is copied into either
shipped `capabilities.json`.

## Relevance-floor sweep

The candidate sweep used the current IDF-weighted matcher before not-owned answer classification.
`recallAtK` is the number of rows whose expected owned symbol is returned; `rejectHits` counts
rows returning a symbol listed in that row's reject set.

| Candidate floor | zero-result rows | zeroResultRate | recalled rows | recallAtK | rejectHits |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0/58 | 0.000000 | 25/58 | 0.431034 | 19 |
| 0.100000 | 7/58 | 0.120690 | 25/58 | 0.431034 | 19 |
| 0.240000 | 7/58 | 0.120690 | 25/58 | 0.431034 | 19 |
| 0.245000 | 8/58 | 0.137931 | 25/58 | 0.431034 | 19 |
| **0.270000** | **8/58** | **0.137931** | **25/58** | **0.431034** | **18** |
| 0.275000 | 8/58 | 0.137931 | 24/58 | 0.413793 | 18 |

`0.27` is the highest tested floor that preserves the PRD-297 recall floor while reducing
`rejectHits`. The next tested candidate loses one recalled row. The constant is
`RELEVANCE_FLOOR = 0.27` in `packages/engine-mcp/src/index.ts`.

## Real save-system query

Command:

~~~sh
pnpm exec tsx -e 'import {searchCapabilities} from "./packages/engine-mcp/src/index.ts"; console.log(JSON.stringify(searchCapabilities("save the player progress","packages/create-threenative/capabilities.json","request"),null,2))'
~~~

Observed output:

~~~json
{
  "guidance": "The framework owns no save/load system. Write a save module in your project's src/ using your own plain state shape (for example, ctx.state), and read agent-docs/gameplay-recipes.md for the template recipe.",
  "results": [],
  "verdict": "none"
}
~~~

The result is an actionable negative answer; it does not hand the authoring agent `Area3D` or
`Heightfield`. The same path covers inventory, NPC dialogue, and networked multiplayer.

## Final corpus measurement

The full corpus replay against the source implementation reported:

~~~text
Capability recall (58 rows)
zeroResultRate: 0.103448 (6 owned rows had zero results; four not-owned rows are actionable answers)
recallAtK: 0.500000 (29/58, including four actionable not-owned answers)
rejectHits: 16
rowCount: 58
~~~

The four measured not-owned rows receive a non-empty `verdict: "none"` guidance answer. The
PRD-297 floor was `recallAtK = 0.431034`; this lane preserves it and lowers `rejectHits` from
19 to 16.

The PRD-297 recall runner and its `pnpm caps:recall` script are not present on this dependency
checkout, so the final numbers above were reproduced with an inline replay against the source and
the committed corpus. Running `pnpm caps:recall` here is therefore blocked with
`Command "caps:recall" not found`; it is not claimed as a green gate.

## Observed negative controls

Each temporary mutation was restored before the positive checks.

| Control | Observed red |
| --- | --- |
| Restore `score > 0` in place of `score >= RELEVANCE_FLOOR` | The floor regression loses its measured `rejectHits` improvement; the no-floor replay reports 19 rejects instead of 18. |
| Set `RELEVANCE_FLOOR = 3` | The navigation regression fails because no result includes `NavigationAgent3D`. |
| Delete the `save-load` row | The save-system guidance regression returns `verdict: "matched"` instead of the actionable `none` answer, so it no longer names the save-module path. |
| Restore a v1 manifest without `notOwned` | The focused suite fails the v2 root contract with `TN_ENGINE_CAPABILITIES_MANIFEST`. |
| Inject an owned situation identical to a not-owned situation | `validateNotOwned` fails with `a mechanic cannot be both owned and not owned`, naming both rows. |
| Set a `notOwned` guidance value to a number | Manifest loading fails with `notOwned 0 is malformed`. |

## Manifest and source hygiene

Both generated copies were rebuilt from the same source:

~~~text
packages/create-threenative/capabilities.json: version 2, 272 entries, 4 notOwned rows
packages/core/capabilities.json: version 2, 272 entries, 4 notOwned rows
~~~

The shipping grep for sealed brief/corpus prose returned no output (exit code 1, expected):

~~~sh
rg -n 'endless runner|firing line|Magazine 30|sealed sweep|brief\.' packages/create-threenative/capabilities.json packages/core/capabilities.json
~~~
