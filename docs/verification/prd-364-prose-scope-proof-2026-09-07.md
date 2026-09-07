# PRD-364 prose-scope proof — 2026-09-07

This record is an inert Markdown change used to exercise the hosted PRD-364 prose-only lane.
The final record will retain the job API output for three sequential pushes, the native workflow
output, and the before/after timing comparison. The probe PR changes no executable or configuration
file.

## Baseline

The PRD's baseline sample contains eight full CI pull-request runs with created-to-updated elapsed
times from 6m36s to 12m06s, median 8m08s. The latest green baseline, run
[34068539162](https://github.com/ThreeNativeHQ/threenative/actions/runs/34068539162), reported 32
jobs and took 7m29s. Its job API output is summarized in the PRD.

## Hosted probe

Run 1 is intentionally recorded after the first commit completes. Runs 2 and 3 will be generated
by two sequential edits to this same inert record. Each run must classify the complete merge-base
diff as `prose`; the CI job list must contain no build, typecheck, browser, native, playtest,
benchmark, budget, or template execution; and the native workflow must omit compilation and parity
jobs.

| Run | Head | CI run | Native run | Result |
|---|---|---|---|---|
| 1 | pending | pending | pending | pending |
| 2 | pending | pending | pending | pending |
| 3 | pending | pending | pending | pending |

