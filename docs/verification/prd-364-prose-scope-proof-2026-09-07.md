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
and six focused suites; each run reported 123 tests passed.

| Run | Head | CI run | Native run | CI API result | Native API result |
|---|---|---|---|---|---|
| 1 | `96d5b61cbf942fd42212558564bc6e762a641131` | [34091533460](https://github.com/ThreeNativeHQ/threenative/actions/runs/34091533460) | [34091533511](https://github.com/ThreeNativeHQ/threenative/actions/runs/34091533511) | PASS; 5 executed, 12 skipped of 17 job records; 2m56s | PASS; 1 executed, 7 skipped of 8 job records; 25s |
| 2 | `71ac4c3364111d6160be7cb97692aae0b525a5ba` | [34091983547](https://github.com/ThreeNativeHQ/threenative/actions/runs/34091983547) | [34091983285](https://github.com/ThreeNativeHQ/threenative/actions/runs/34091983285) | PASS; 5 executed, 12 skipped of 17 job records; 2m34s | PASS; 1 executed, 7 skipped of 8 job records; 12s |
| 3 | `bac054baaf58d3eaa638b06ad395f44af5976768` | [34092298051](https://github.com/ThreeNativeHQ/threenative/actions/runs/34092298051) | [34092298040](https://github.com/ThreeNativeHQ/threenative/actions/runs/34092298040) | PASS; 5 executed, 12 skipped of 17 job records; 1m19s | PASS; 1 executed, 7 skipped of 8 job records; 25s |

The baseline-to-probe orchestration comparison is 7m29s for the 32-job full baseline versus
2m56s, 2m34s and 1m19s for probes 1–3. These are GitHub-hosted elapsed times including queueing,
setup and aggregation; they are evidence of the selected board and not a runtime performance claim.

Run 1 and run 2 returned the same CI job topology. Executed records were `Change scope`, `lint`,
`supply-chain`, `golden-path`, and `run-summary`. Skipped records were `build`, `test`, `typecheck`,
`test-browser`, `test-native`, `test-playtest`, `template-nonvisual`, `budgets`,
`golden-path-template`, `performance-contracts`, `test-unit`, and `benchmark`.

Run 1 and run 2 returned the same native topology: `Change scope` passed, while `Commit-keyed web
conformance reference`, `Scaffolded starter desktop artifact`, `${{ matrix.platform }} desktop
core`, `iOS simulator runtime and no-Xcode consumer handoff`, `Android emulator visual parity`,
`Desktop web/native parity`, and `Native collector evidence coverage` were skipped.

The first attempted prose run, [CI 34089387209](https://github.com/ThreeNativeHQ/threenative/actions/runs/34089387209),
correctly skipped the expensive board but failed its summary because it still required the skipped
`performance-contracts` and `native-linux-contract` lanes. PR #131 fixed that workflow condition;
its full CI run [34090119338](https://github.com/ThreeNativeHQ/threenative/actions/runs/34090119338)
passed all 34 jobs before this final probe series began.
