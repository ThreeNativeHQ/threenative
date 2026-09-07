# PRD-364 prose-scope proof — 2026-09-07

This record proves the hosted behavior of the narrow prose-only CI scope. The final probe series
uses three sequential pushes to this inert Markdown record. Each merge-base diff contained only
this file. The CI-summary repair landed separately in [PR #131](https://github.com/ThreeNativeHQ/threenative/pull/131)
after the first probe exposed that skipped performance lanes were still treated as required.

## Baseline

The PRD's baseline sample contains eight full CI pull-request runs with created-to-updated elapsed
times from 6m36s to 12m06s, median 8m08s. The latest green baseline, run
[34068539162](https://github.com/ThreeNativeHQ/threenative/actions/runs/34068539162), reported 32
jobs and took 7m29s. Its job API output is summarized in the PRD.

## Hosted probe

The scope job reports `selection=prose` and the reason `all 1 changed path(s) are inert Markdown
under docs/PRDs or docs/verification`. The CI workflow executes only scope, lint, supply-chain,
golden-path and run-summary. The native workflow executes only its scope job; compilation, parity,
starter artifact and collector coverage jobs are skipped. The lint prose lane runs `pnpm check:docs`
and six focused suites; run 1 reported 123 tests passed.

| Run | Head | CI run | Native run | CI API result | Native API result |
|---|---|---|---|---|---|
| 1 | `96d5b61cbf942fd42212558564bc6e762a641131` | [34091533460](https://github.com/ThreeNativeHQ/threenative/actions/runs/34091533460) | [34091533511](https://github.com/ThreeNativeHQ/threenative/actions/runs/34091533511) | PASS; 5 executed, 12 skipped of 17 job records; 2m56s | PASS; 1 executed, 7 skipped of 8 job records; 25s |
| 2 | pending | pending | pending | pending | pending |
| 3 | pending | pending | pending | pending | pending |

Run 1's CI job API returned these records:

| Executed | Skipped |
|---|---|
| Change scope; lint; supply-chain; golden-path; run-summary | build; test; typecheck; test-browser; test-native; test-playtest; template-nonvisual; budgets; golden-path-template; performance-contracts; test-unit; benchmark |

Run 1's native job API returned `Change scope` as successful and skipped `Commit-keyed web
conformance reference`, `Scaffolded starter desktop artifact`, `${{ matrix.platform }} desktop
core`, `iOS simulator runtime and no-Xcode consumer handoff`, `Android emulator visual parity`,
`Desktop web/native parity`, and `Native collector evidence coverage`.

The first attempted prose run, [CI 34089387209](https://github.com/ThreeNativeHQ/threenative/actions/runs/34089387209),
correctly skipped the expensive board but failed its summary because it still required the skipped
`performance-contracts` and `native-linux-contract` lanes. PR #131 fixed that workflow condition;
its full CI run [34090119338](https://github.com/ThreeNativeHQ/threenative/actions/runs/34090119338)
passed all 34 jobs before this final probe series began.
