<!-- schemaVersion: 1 -->

# Studio problem-recovery mutation ledger — 2026-08-13

- Subject: the inline Problems recovery affordance in `packages/studio/src/client/components/ChatPanel.tsx`
- Check under test: `flow.agent.turn` in `scripts/studio-probe.ts`
- Host: Linux x86_64, headless Chromium under `xvfb-run -a -s '-screen 0 1600x900x24'`
- Command: `pnpm studio:probe --browser`

A passing check proves nothing until it has been watched to fail. This ledger records the
mutations run against the fixed build to establish that `flow.agent.turn` reports on the
behaviour it names rather than passing by construction.

## Runs

| Build | Mutation | Passed | `flow.agent.turn` | Failing term |
| --- | --- | ---: | --- | --- |
| Fixed | none | 33/33 | PASS | — |
| Mutation 1 | `revealPanel` reverted to `set({ activePanel })` | 32/33 | FAIL | dock stayed collapsed after the click |
| Mutation 2 | `markProblemsSeen` reduced to a no-op | 32/33 | FAIL | `recoveryStaysRetiredOnceReviewed: false` |
| Restored | none | 33/33 | PASS | — |

Each mutation reproduces exactly one of the defects the change fixed, and each failure
diagnostic localises to that defect. Mutation 1 left all four banner-lifecycle sub-assertions
`true`, so the only failing terms were the post-click dock visibility and Problems selection.
Mutation 2 flipped `recoveryStaysRetiredOnceReviewed` alone, leaving the other three `true`.

## What is proved, and what is not

Proved: the reveal path and the retire-once-reviewed path both fail closed when their
implementation is removed, driven through the real built Studio over HTTP with Playwright.

Not proved by these runs: the geometry assertion for the jump-to-latest button was never
mutated. It is not unexercised — it failed on its first authoring run with an evaluated-function
`ReferenceError`, and the overlap it now guards was measured at 595–618px against a composer
occupying 555–700px before the fix — but it has not been watched to fail against a build whose
only defect is the old `bottom:82px` anchor.
