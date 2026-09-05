# PRD-296 — three gates were hiding behind a permanently red one

**Status: DONE, 2026-09-04.** Items 1 and 2 shipped before this status line was moved — the
re-measurement that found them met, item 3's guard and summary, and their reds are in
[`docs/verification/prd-296-ci-needs-guard-2026-09-04.md`](../../verification/prd-296-ci-needs-guard-2026-09-04.md).
The lasting half is `scripts/__tests__/ci-needs.spec.ts`, which fails when a coverage job is
ordered behind another coverage job; the `run-summary` job reports and never gates.

Filed 2026-08-31 at `c3a0f595`, the day CI went green for the first
time, because that is the day three gates ran for the first time and all three failed.

## What happened

`ci.yml` chained jobs with `needs:`. `native-platforms` needed `test`; `visuals` needed
`golden-path`. Both of those upstream jobs were red on every run this repository has ever
produced, so both downstream jobs were **skipped every single time**. Nobody had seen either fail
because nobody had seen either run.

When the upstream jobs went green, all three of the following surfaced within an hour:

| Gate | First-ever result | Cause |
| --- | --- | --- |
| `native-platforms` | failed, all five legs | `threenative-lifecycle-policy-test` included `<SDL3/SDL.h>` while `mystral-runtime` links SDL3 `PRIVATE`, so it only compiled where SDL3 sat on the default search path |
| `visuals` | failed instantly | the job never built the workspace packages it scaffolds against — `Cannot find module '.../@threenative/assets/dist/index.js'` |
| `visuals`, after that fix | failed again | `page.screenshot: Timeout 30000ms exceeded` — it captures a WebGPU canvas on a runner with no GPU |

The SDL3 defect is the one that mattered most: the release workflow builds on the same hosted
macOS and Windows runners, so it would have failed the native release **after** the tag was spent.

## The rule this is really about

**A gate behind a permanently red gate is not a gate.** It is a job that has never told anyone
anything, accumulating breakage at exactly the rate the code changes. Three of them here, and each
had been broken for as long as it had existed.

Worse, the arrangement is self-concealing: the board looks like nine jobs of coverage and is
actually six, and the three that are not running are the expensive ones nobody wants to re-run by
hand.

## What Done looks like

1. No job in `ci.yml` declares `needs:` on a job whose purpose is *coverage* rather than
   *artifact production*. `needs: build` is legitimate — the downstream job consumes the build.
   `needs: test` as a cost-saving measure is what created this, and the saving was illusory: the
   job never ran, so it never cost anything and never proved anything either.
2. Any job that cannot run on the hosted runner says so in its own file, with the reason, rather
   than being ordered behind something that happens to be red. `visuals` needs a GPU;
   `native-platforms` needs platforms this version does not claim. Both are now their own thing
   with that written down.
3. A check that a skipped job is reported as skipped-and-why in the run summary, so "never ran" is
   visible rather than being indistinguishable from "passed" at a glance.

## What not to do

Do not restore the `needs:` chains to make the board look green. The board was green-looking for
months while three gates did nothing; that is the failure mode, not the fix.

Related: [PRD-295](../native/PRD-295-the-native-platform-lane-has-never-been-green.md), which is
the `native-platforms` half of this.
