# Campaign state and HTML dashboard

Generate this on invocation, not when installing the skill. The HTML is the developer's view of
one machine-readable campaign record, not a second manually maintained evidence report.

## Files and updates

Use `<primary>/artifacts/native-performance-loop/<campaign-id>/` with:

- `results.json`: versioned contract, environment identities, workloads, baselines, incumbent,
  experiment history, status, heartbeat, limits and next hypothesis.
- `index.html`: an offline, self-contained dashboard generated from `results.json`.
- `raw/<experiment-id>/`: existing harness output, exit codes, sample data, profiles, screenshots,
  candidate patch/commit reference, build identities and exact reproduction commands.

Reuse a suitable existing report renderer if present. Otherwise generate a small HTML file with
inline CSS, embedded data and minimal browser JavaScript; save the small renderer alongside the
campaign only if needed to regenerate it reliably. No web framework, backend, CDN or new dependency.
It must open with `file://` without fetching JSON. Write JSON and HTML via temporary siblings and
atomic replacement, preserving the last readable snapshot if generation fails.

Create the dashboard before the first benchmark, showing “baseline pending,” never sample wins.
Refresh after each state transition and decision. During long commands, publish a timestamp and
heartbeat at least every 60 seconds using the existing gate status where available. The HTML must
show its snapshot time; when an old snapshot is open, say “reload for current progress” instead of
pretending it is live. If serving locally is already supported, optional refresh must preserve
filters. A stale heartbeat is “stale / check process,” never proof the worker is still active.

Escape benchmark names, descriptions, commands and log content as text. If embedding JSON in an
HTML script element, escape `<` as `\u003c` so data cannot terminate the script. Use textContent for
values, allow only safe local/HTTP(S) artifact links, and never embed secrets or unrelated device logs.

## Information to retain

The exact JSON shape can follow an existing reporter. It must retain these facts:

| Record | Required facts |
| --- | --- |
| Campaign | ID, schema version, status/phase, started/updated timestamps, heartbeat, deadline, owner/worktree/branch, starting revision, original baseline, incumbent, stop reason, next hypothesis. |
| Contract | Mutable paths; evaluator/instrumentation revision; workload and asset hashes; target metrics/units/direction; goals and hard gates; noise rule; warmup/sample/repeat/cache policies; timeouts and authorized targets. |
| Run identity | Source SHA plus dirty patch hash if any; native binary, bundle/package and lockfile hashes; OS/CPU/GPU/driver/JS engine/backend; build mode, render size, quality, refresh/present mode; physical/emulator/software classification; thermal/power state when available. |
| Experiment | ID, hypothesis, bottleneck evidence, changed layer/files, candidate commit/patch, parent incumbent, synthetic/game/sentinel selection, current phase, paired samples and order, scalar summaries and units, before/after absolute and relative deltas, gates, evidence links, duration, decision and reason. |
| Missing or failed evidence | Explicit unavailable reason; malformed/missing samples; timeout/crash exit; unrun platforms; incomparable pairs excluded with reason. Never encode these as zero, empty success, or a passed gate. |

Use experiment decisions `keep`, `reject`, `provisional`, `inconclusive`, or `invalid`. A crash or
timeout is an invalid attempt with its subtype. Keep running phase separate from decision. On
interruption, an unfinished trial stays unfinished until its owned process and artifacts are
inspected; it must not become a kept candidate by default.

## Dashboard layout

1. **Now:** campaign status, target/device/game, active experiment, current phase, last update,
   elapsed/remaining time, original and incumbent revisions, and the next hypothesis. State whether
   evidence is synthetic, gameplay, or both. No invented percentage for an open-ended optimization.
2. **Benchmarks:** rows per workload/platform/metric with baseline, best accepted, current candidate,
   goal, unit, absolute/relative delta, noise margin, sample/repeat count and gate. Show unavailable
   values with a reason. Keep pending/provisional candidates visually separate from accepted wins.
3. **Progress:** accepted metric history with goal lines and gaps for missing observations; separate
   charts for unlike units and unlike hardware. Retain the original baseline when the incumbent
   changes. Include accessible table equivalents and label axes/units.
4. **Experiments:** filter by decision, workload and platform. Show hypothesis, synthetic result,
   real-game result, sentinel result, trade-offs, keep/reject reason, patch and raw evidence links.
   Expand details on demand; keyboard access and text labels must accompany status colors.
5. **Coverage and continuation:** native platforms tested/unavailable, workload families covered,
   unresolved bottlenecks, exact reproduction commands, stop reason and resume instruction.

For a lower-is-better metric, improvement is `100 * (baseline - candidate) / baseline` when the
baseline is positive. Report both the absolute delta and this percent, clearly labeled. A goal
progress bar may use `clamp((baseline - incumbent) / (baseline - goal), 0, 1)` only when the goal is
below baseline; otherwise say “already within target” or “no numeric target.” Mirror the direction
for higher-is-better metrics. Do not show percent improvement for a zero baseline. Do not average
FPS derived from percentiles or average several games into an unqualified performance score.

## Verify and resume

Before handing off an HTML snapshot, open it in a browser when a browser tool is available. Check
that it opens offline, shows actual recorded values, distinguishes missing/provisional data, and
that filters, keyboard controls and evidence links work. A renderer with non-trivial logic needs
one small runnable check covering metric direction, missing values and unsafe text. If no browser
is available, check generated structure and links and mark visual inspection unverified.

On resume, load the contract and history, verify ownership and process state, and reconcile the
worktree with the recorded incumbent before editing. Check executable/workload/environment hashes;
if any comparison dimension changed, create a new series and baseline instead of connecting its
points to the old curve. Preserve all previous decisions. Link to this dashboard in the PRD/PR and
final response rather than copying its experiment log into another report.
