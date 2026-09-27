# Automatic frame-plan selection — PR #275

Status: recorder policy implemented and locally verified; full native/platform qualification remains open.
This addendum supersedes the PRD's historical default-off description. The underlying protocol and
previous native evidence are unchanged; they do not certify the newly automatic policy.

## Default behavior

A game does not need `TN_FRAME_PLANS=1`. An unspecified internal `host.compiledFramePlans` now means
automatic selection. Explicit booleans remain reference arms for transport tests and CPU profiling,
not a new public game option. The legacy environment override may still force the diagnostic arm.

The recorder starts on direct v2. Two consecutive complete frames with equal operation counts and
body sizes qualify for a retained-plan probe when there are at least 128 operations, no more than
128 bytes per operation, and no more than 32 MiB of body data. These are heuristics, not a guarantee
that every scene becomes faster.

A patch must avoid at least half the packet bytes, rewritten bytes and changed operations to count
as useful. The initial capture gets one grace frame; two unprofitable frames switch back to v2.
Upload-heavy, oversized and split frames cause fallback, and failed probes wait 32 complete frames
before trying again. A return to stable rendering can therefore recover automatically. Fallback
releases retained plans, spare captures, dirty records, value snapshots and patch buffers.

Transport changes happen only at complete frame boundaries. Partial readbacks materialize submitted
prefixes once, preserve unfinished encoder tails and retain wire IDs until the real boundary.
Frame-local wrapper epochs remain checked while using direct fallback as well as retained plans.
No native opcode, handle, packet-validation or memory-bound guard was removed.

## Local verification

The 13 new tests in `packages/runtime-native/tests/frame-plan-auto.test.mjs` passed on Node 22.16.0
using the same test bodies with only the `describe`/`it` import switched from Vitest to `node:test`.
Assertions use `node:assert/strict` in both runners. The unmodified default-off recorder failed 9 of
these 13 tests before the policy was implemented. Syntax checks passed for the changed recorder,
new test and new benchmark. This is not a claim that Vitest or the full workspace ran locally.

Coverage includes no-flag promotion, tiny frames, upload-heavy frames, topology churn, dense dirty
payloads, render/compute dispatches, cooldown/recovery, explicit diagnostic arms, stale wrappers,
partial readbacks, an empty final boundary and bodies above the native retained-memory bound.
A 180-frame differential sequence reconstructs each automatic packet and compares it byte for byte
to a fresh forced-v2 recording across topology, uploads, compute, epoch changes and recovery.

Reproduce in a full checkout:

```sh
pnpm exec vitest run packages/runtime-native/tests/frame-plan-auto.test.mjs
node packages/runtime-native/scripts/measure-frame-plan-auto.mjs /tmp/frame-plan-auto.json
```

## CPU-only measurement

Five rounds per scenario, with arm order rotated; each arm warms up for 80 frames and measures 240.
Median of per-round median recorder-plus-drain times, milliseconds, Node 22.16.0 in the Linux task
container. The mock host does not execute native replay or GPU work. These are not frame-rate or
end-to-end results, and timing assertions are intentionally not test gates.

| Scenario | Forced direct | Forced plans | Automatic | Automatic selection |
| --- | ---: | ---: | ---: | --- |
| Tiny | 0.006837 | 0.007640 | 0.007427 | 240/240 direct |
| Stable render, 2000 draws | 0.423568 | 0.150311 | 0.144539 | 240/240 patches |
| Stable compute, 2000 dispatches | 0.282783 | 0.127169 | 0.127594 | 240/240 patches |
| Upload-heavy, 2 MiB | 0.175927 | 0.336074 | 0.176746 | 240/240 direct |
| Changing topology | 0.057394 | 0.044015 | 0.060819 | 240/240 direct |
| All draw payloads changing | 0.059029 | 0.124750 | 0.062461 | 228 direct, 6 captures, 6 patches |

Stable render and compute recording are respectively 65.9% and 54.9% cheaper in this fixture.
The upload-heavy automatic arm is within 0.5% of direct, rather than paying forced capture costs.
Tiny and changing workloads still have measured overhead: about 0.6–3.4 microseconds per frame
(5.8–8.6% of their very small recorder times). The policy is not proven optimal: forced plans were
faster even on the changing-topology fixture. Do not describe this as a universal speedup.

The older two-arm benchmark now sets `compiledFramePlans: false` explicitly for its v2 reference,
so activating automatic selection cannot silently turn both reported arms into plan recording.

## Remaining PRD and release gates

- Run the complete CI/workspace/native replay and visual lanes against this new source, not just
  against the earlier opt-in implementation. No CI gate has been disabled or weakened.
- Run the automatic policy through device recreation and native partial-readback conformance.
- Measure equivalent scenes on physical Android hardware and run the changed path on iOS/JSC.
- Demonstrate an uncapped end-to-end CPU/frame-time improvement and check representative games,
  including tiny/loading/changing scenes. A recorder microbenchmark cannot close this gate.

The PRD must remain PARTIAL until these evidence requirements are satisfied; this change does not
mark unexecuted platform tests as passing or fabricate a 100% completion percentage.
