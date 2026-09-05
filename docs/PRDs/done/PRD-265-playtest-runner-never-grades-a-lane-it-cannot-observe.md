---
prd_contract: v1
---

# PRD-265 — the playtest runner never grades a lane it cannot observe

**Status: DONE — 2026-09-04.** All three sites are guarded, each with the negative control its
acceptance criterion names, in `packages/playtest/__tests__/unobservable-lane.spec.ts`. The
reds, the greens, and the live desktop report that showed §1 before and after are in
[`docs/verification/prd-265-unobservable-lanes-2026-09-04.md`](../../verification/prd-265-unobservable-lanes-2026-09-04.md).
§1 is fixed in `resolveDiagnosticsPolicy`, which now takes the target the run executed on,
rather than in the scenarios: the record explains why the first attempt — one that needed a
`diagnostics` block on every device scenario — was a fix in the wrong place.

Filed 2026-08-29, measured at `84ca45b3`. Found by a test-gap sweep of
`packages/playtest` (fail-closed audit, four explorer passes); all three sites re-verified by hand
at HEAD before filing. Not a scan item from
[the 2026-08-23 tech-debt scan](./README.md) — the two fail-open holes that scan found
in the schema layer were closed by PRD-199 and PRD-204; these three are in the *runner semantics*
layer, which that scan did not open.

**Goal: a playtest report never carries a green row computed from evidence the target
structurally cannot produce.** The harness's founding rule is fail closed — "a missing observation
fails". All three sites below invert it in the same shape: a default that asserts, a transport
that cannot observe, and a report that passes anyway.

**Complexity:** three runner branches, each with a named negative test = **3 → LOW**. No schema
change, no cross-package dep.

## The problem, measured at `84ca45b3`

### 1. The default diagnostics policy is vacuously green on device targets

`packages/playtest/src/assertion-report.ts:74-75` — `resolveDiagnosticsPolicy` defaults
`noConsoleErrors` and `noNetworkErrors` to `true` when the scenario says nothing. The evaluator
applies that default on every run. But on the android/desktop/ios lanes the network observation is
hardwired empty (`packages/playtest/src/runner/androidRunner.ts:428`, `network: []`), and
`unsupportedAssertion` (`androidRunner.ts:663`) fires only when the scenario *spells out*
`noNetworkErrors: true` — the same condition the evaluator silently assumes. So:

- A scenario that writes `noNetworkErrors: true` on a device lane → correctly fails
  `TN_PLAYTEST_UNSUPPORTED_ON_TARGET`.
- The same scenario with the field omitted → the evaluator "passes" a network check against an
  observation lane that cannot observe anything.

The capability gate has the same asymmetry in six lines: `assertion-schema.ts:517-518` adds
`browser.network`/`browser.console` only on `=== true`, while line 519 correctly uses `!== false`
for `runtime.diagnostics`. Every fixture in `__tests__/device-playtest.spec.ts` writes
`noNetworkErrors: false` explicitly, so the default-on-device path has zero coverage.

**Acceptance criterion:** a device-lane scenario with no `diagnostics` block (or `diagnostics: {}`)
produces a failing diagnostics row naming the unobservable network/console lane, or
`TN_PLAYTEST_UNSUPPORTED_ON_TARGET` — never a green diagnostics row. *Mutation:* revert the new
default-on-device handling in the evaluator and the new negative-control scenario goes green with
a passing diagnostics row it could not have earned.

### 2. `waitTicks` silently degrades to animation frames on bridges without `fixedStep`

`packages/playtest/src/runner/steps.ts:330-336` — a step authored in `waitTicks`/`holdTicks`
against a bridge that does not advertise `runtime.fixedStep` falls into
`waitFrames(page, Math.max(frames, ticks, 1))`. The determinism rule is that steps count
fixed-step ticks, never wall-clock; this fallback makes them count display refresh, with no
diagnostic and no report field naming the substitution. Every existing tick fixture uses a
fixedStep bridge, so the wrong-target case has no spec.

**Acceptance criterion:** tick steps against a bridge without `runtime.fixedStep` produce a named
diagnostic (the `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` class), or an explicit report marker naming
the frame-substitution — never a quiet rAF wait. *Mutation:* delete the new guard and the
new wrong-target scenario runs green again.

### 3. `setup.applied` mirrors `requested` instead of a read-back

`packages/playtest/src/runner/steps.ts:252` — `applyScenarioSetup` returns
`{ applied: requested, requested }`. The contract ("an overridden spawn must be visible in
diagnostics, never green-with-silence") rests entirely on each bridge implementation throwing from
`applySetup`; a bridge that partially applies and resolves reports full application, and
`applied === requested` always. The only enforcer is `packages/playtest/src/three/bridge.ts` — one
implementation, unguarded by anything the report could show.

**Acceptance criterion:** the report's setup evidence distinguishes *what the runner asked for*
from *what the bridge confirmed*, or the runner documents and tests the throw-on-miss contract as
the single enforcer with a bridge-double test proving a resolving-but-skipping bridge is
detectable. *Mutation:* make the bridge-double swallow an entry; the run must still fail or mark
`applied != requested`.

## Non-goals

Not a diagnostics-policy redesign and not a new assertion kind: the three fixes are guards and
report fields inside the existing runner semantics. Template scenarios and the schema registry are
touched only to add the negative-control fixtures the criteria name.
