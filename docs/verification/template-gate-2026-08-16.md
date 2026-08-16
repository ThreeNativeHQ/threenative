# Template gate — 2026-08-16

**Status: RED.** `pnpm test:templates` was run twice on the current tree under
`sh scripts/xvfb.sh`. Scaffolding, installation, and the `action-rpg` `survives` scenario passed.
The following `action-rpg` `combat` scenario exited `2` before assertions:

```text
TN_PLAYTEST_PAGE_NAVIGATED
runner error: page.evaluate: Execution context was destroyed, most likely because of a navigation
observed: page closed: false; main-frame navigations: 1
scenario: action-rpg-combat-and-line-of-sight
```

The navigation URL was not recorded. The failure is therefore unverified as a game or runner
defect; no source workaround was added during the documentation cleanup. The seven-template gate
must not be described as green until this scenario is rerun successfully.

The repository unit gates remained green independently: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
and `pnpm budgets` all exited `0` on this tree. `pnpm alpha:bar --json` still reports A3 and A6 as
unmeasured.
