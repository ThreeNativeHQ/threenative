---
prd_contract: v1
---

# PRD-134 — `pnpm check:docs` is red on a sentence describing its own bug, and no gate runs it

**Status: REDUCED TO ITS SECOND HALF, 2026-08-17.** Defect 1 below — the parser reading code as
prose — was fixed while closing
[PRD-125](../done/PRD-125-docs-and-readme-overhaul.md), whose criterion 1 required it. `pnpm
check:docs` now exits 0, the fixed checker found and repaired five real broken links, and three
tests cover inline spans. Evidence:
[`prd-125-docs-and-readme-2026-08-17.md`](../../verification/prd-125-docs-and-readme-2026-08-17.md).

**What remains is defect 2, and it is the one with the longer half-life: nothing runs the
checker.** `check:docs` is still a hand-run root script, absent from `pnpm test` and from the CI
chain. §3 items 3 and 4 are the live scope; §3 items 1 and 2 are done.

**Outcome:** the documentation link checker stops reading fenced code as prose, the repository's
links are green, and `check:docs` runs inside a gate that blocks — so the next broken link is
caught by CI rather than by somebody running the script by hand two weeks later.

**Depends on:** nothing.

**Blocks:** nothing, but PRD-136 and every doc change in this batch land under it.

**Complexity: 2 → LOW mode.** One parser fix, one wiring change, one spec.

**Blast radius: 4 files.** `scripts/check-doc-links.ts`, `scripts/__tests__/check-doc-links.spec.ts`,
`package.json`, `.github/workflows/` (one line).

---

## 1. The failure, and why it is funny in a way that matters

`pnpm check:docs` on 2026-08-17:

```
Malformed Markdown link in docs/PRDs/batch-26-08-16/PRD-125-docs-and-readme-overhaul.md:
missing closing ')'
```

The line it is choking on is `PRD-125-docs-and-readme-overhaul.md:315`, which reads:

> **Skip fenced code blocks.** A shell snippet inside ``` fences can contain `](` — this very
> document does.

PRD-125 specified the fenced-code skip. The checker was landed without it, and the first thing it
found was the sentence saying it would do this. The requirement was written down, the
implementation did not honour it, and nothing compared the two.

## 2. Two defects, not one

1. **The parser reads fenced and inline code as prose.** A ``` fence, a `~~~` fence, and a
   backtick span are all link-free by construction and must be stripped before the link scan.
2. **Nothing runs the checker.** `check:docs` is a root script reachable only by hand. It is not
   in `pnpm test`, and the CI chain (`install → typecheck → lint → test → scaffold-smoke →
   visuals`) never calls it. A gate nothing runs is not a gate.

Defect 2 is the one with the longer half-life. Fixing the parser without wiring it in produces a
green run today and an unnoticed red in a week.

## 3. What lands

1. Strip fenced blocks (``` and `~~~`, any info string) and inline backtick spans before scanning,
   in `check-doc-links.ts`. Track fence state line by line; do not regex across the whole file.
2. Re-run, and fix whatever real broken links remain. PRD-125 counted 18 at the time it was
   written; the current number is unknown until #1 lands, and this PRD does not predict it.
3. Add `pnpm check:docs` to the root `test` script, or to the CI chain immediately after `lint` —
   **owner's call, and the reason belongs in the commit message.** `test` is the honest home
   (a broken link is a repository defect like any other); CI-only keeps the local loop faster.
4. A spec asserting the parser skips code: a fixture containing `](` inside a fence, inside a
   `~~~` fence, and inside a backtick span, all of which must pass, plus a genuinely malformed
   link outside any fence, which must fail.

Point 4 is the fails-closed half. A parser that skips too much is the same defect as one that
scans too much, pointing the other way, and only the negative fixture catches it.

## 4. Acceptance

| # | Command | Required result |
| --- | --- | --- |
| 1 | `pnpm check:docs` | exit `0` |
| 2 | `pnpm vitest run scripts/__tests__/check-doc-links.spec.ts` | pass, including the negative fixture |
| 3 | add a link to `docs/does-not-exist.md` in any doc, re-run #1 | **fails**, naming file and target |
| 4 | `pnpm test` | exit `0`, and `check:docs` visible in its output *if* §3.3 chose `test` |

Evidence: `docs/verification/prd-134-doc-links-2026-08-17.md`, with #1's full output and the count
of links checked. **The count is the point** — an exit `0` from a checker that scanned nothing is
exactly the failure this repository exists downstream of, so print how many links were verified
and paste that number.

## 5. What this does not claim

Not that the documentation is correct. A link that resolves can still point at the wrong file, and
no checker reads meaning. This closes syntax and existence only.
