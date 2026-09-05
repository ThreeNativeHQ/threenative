# PRD-265 — three lanes the runner graded without observing

**Executed 2026-09-04** on branch `quickwins/2026-09-04-five-closes`. Row 4 of
the `quickwins-2026-09-04` batch. That batch's README is deleted by the commit that closes its
last row, per its own rule; `git log --diff-filter=D -- docs/PRDs/quickwins-2026-09-04/README.md`
finds it, and the outcome table is in that commit's message.

All three sites were re-measured at HEAD before anything was written; the PRD's line numbers are
from `84ca45b3` and have drifted, so each site is named by content below.

## §1 — the default diagnostics policy was vacuously green on device targets

**Found live, not inferred.** Row 1 of this same batch ran `sailing` on `--target desktop` and its
report carried:

```json
{ "id": "diagnostics", "pass": true,
  "details": { "consoleErrors": 0, "networkErrors": 0,
               "policy": { "noConsoleErrors": true, "noNetworkErrors": true,
                           "noRuntimeDiagnostics": true },
               "runtimeDiagnostics": 0 } }
```

A passing network check on a lane where `androidRunner.ts` builds every report with `network: []`.
The scenario never mentioned diagnostics; `resolveDiagnosticsPolicy` defaulted all three channels
on and `evaluateDiagnosticsPolicy` compared `noNetworkErrors` against an empty array.

**Where the fix went, and where it did not.** The first attempt made the runner's
`unsupportedAssertion` read the resolved policy, so an omitted field failed like an explicit one.
That is wrong at two levels and both were measured:

1. It fails **every** device scenario in the repository — sixteen of the seventeen omit the field —
   and the only remedy would be a `diagnostics` block on each. But the assertion registry declares
   `diagnostics` as `supportedOn: ["web"]`, so declaring one on a scenario whose file says
   `"target": "desktop"` is rejected outright with `TN_PLAYTEST_OBSERVATION_UNAVAILABLE`. The
   remedy is not available.
2. The report's `target` is the *scenario file's* field, and it disagrees with the run:
   `examples/native-smoke/playtests/*.json` all say `"target": "web"` and are driven with
   `--target android`.

So the fix went where the green is produced. `resolveDiagnosticsPolicy(policy, target)` now takes
the target the run **executed** on — threaded through `IPlaytestReport.target` from
`config.target` — and on a network-blind lane (`android`, `desktop`, `ios`) the network channel
defaults **off with the reason recorded in the policy the report prints**, rather than defaulting
on and being compared to nothing. An explicit `noNetworkErrors: true` is left exactly as written,
so `androidRunner`'s `unsupportedAssertion` still fails it by name — the honest case stays honest,
and the silent case stops being silent.

The console and runtime-diagnostics channels are untouched: device transports advertise
`browser.console` and `runtime.diagnostics` and genuinely observe both.

**Not one scenario file changed.** An earlier revision of this work edited seventeen of them; that
diff is gone, because a fix that needs every caller updated was a fix in the wrong place.

**The capability gate's six lines** (`assertion-schema.ts`) are also corrected: `browser.console`
and `browser.network` now use `!== false`, matching what `resolveDiagnosticsPolicy` defaults and
what `runtime.diagnostics` on the next line already did. A scenario that declared a diagnostics
block and omitted a field required no capability for it while the evaluator went on asserting it.

## §2 — `waitTicks` silently degraded to animation frames

A step authored in `waitTicks`/`holdTicks` against a bridge that does not advertise
`runtime.fixedStep` fell into `waitFrames(page, Math.max(frames, ticks, 1))`: a different unit,
substituted with no diagnostic, while the report still named the tick count the scenario asked for.

It now throws `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` naming the step and the count.

**The guard found two live cases in this repository's own suite** the moment it shipped — which is
the red for this site, and better evidence than a constructed one:

```
TN_PLAYTEST_UNSUPPORTED_ON_TARGET
Step 'aim-northwest' counts 2 fixed-step tick(s), and this bridge does not advertise
'runtime.fixedStep'.
```

`packages/playtest/__tests__/fixtures/app.html` advertises `runtime.fixedStep` only in `physics`
mode, and `e2e-runner.spec.ts`'s spawn/aim scenario runs against `mode=good`. Its steps — and the
wheel step in `click-step.spec.ts`, which passes no bridge at all — had been counting display
refresh for as long as they existed. Both are now authored in `waitFrames`, which is what they
were actually measuring.

## §3 — `setup.applied` mirrored `requested` instead of a read-back

`applyScenarioSetup` and `applySetupBeforeDescribe` both returned `{ applied: requested, requested }`
— the runner's own request echoed back as though it were an observation. The whole contract rested
on each bridge throwing, and a bridge that partially applied and resolved reported full
application with nothing in the report able to show otherwise.

`applySetup` may now return `IPlaytestSetupConfirmation` — the entity and resource ids it actually
applied. `setupApplication()` turns that into the report's evidence:

- a request the confirmation does not account for throws `TN_PLAYTEST_SETUP_UNAPPLIED` naming it;
- a bridge that returns a confirmation gets `confirmedBy: "read-back"`;
- a bridge that resolves without naming anything gets `confirmedBy: "throw-contract"` — the throw
  contract is real and this repository's own bridge honours it, but the report no longer calls an
  echo a confirmation.

`packages/playtest/src/three/bridge.ts` returns the read-back; it collects each id as it applies it,
so the list cannot drift from what happened.

## The three negative controls

`packages/playtest/__tests__/unobservable-lane.spec.ts`, 10 tests. Each mutation below is the one
the PRD names, run against the shipped controls:

| Mutation | Result |
| --- | --- |
| `noNetworkErrors: policy?.noNetworkErrors ?? true` — revert the target-aware default | **2 failed** — `should waive it on every device lane…`, `should treat 'diagnostics: {}' exactly as an absent block` |
| Delete the `authoredTicks > 0 && !fixedStep` guard from `steps.ts` | **3 failed** — adds `should refuse to substitute display frames for the ticks the step asked for` |
| `const missing: IPlaytestSetupRecord[] = []` — stop comparing the confirmation | **5 failed** — adds `should fail on a bridge that resolves while skipping an entry` and `should reach that failure through the real runner entry point` |
| all three restored | **10 passed** |

The §3 controls include a bridge-double that resolves while applying nothing and names an empty
entity list — the "resolving-but-skipping bridge" the acceptance criterion asks to be detectable —
driven through `applyScenarioSetup`, the real runner entry point, not just the helper.

## Gates

```
$ pnpm --filter @threenative/playtest exec tsc --noEmit -p tsconfig.json    # clean
$ pnpm vitest run packages/playtest/__tests__
 Test Files  84 passed (84)
      Tests  965 passed (965)
```

## The same real run, after the fix

Row 1's `--target desktop` scaffold-and-run was executed again on the changed runner. The chain
assertions still pass, and the row that started this is no longer a green claim about a lane the
target cannot observe:

```json
"policy": {
  "noConsoleErrors": true,
  "noNetworkErrors": false,
  "networkErrorsOptOutReason": "The run target has no network observer; its network observation is hardwired empty, so the default network policy is waived rather than evaluated against nothing.",
  "noRuntimeDiagnostics": true
}
...
"pass": true,
"runtime": "native"

sailing: native playtests passed at /tmp/threenative-sailing-desktop-ATCwXD/sailing
exit 0
```

Before: `"noNetworkErrors": true` with `"networkErrors": 0`, on a report whose `network` array is
built empty by construction. After: the channel is waived, the waiver is in the report, and the two
channels the desktop lane does observe are still asserted.
