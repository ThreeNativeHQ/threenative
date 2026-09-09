# PRD-360 warm-up and cache verification — 2026-09-07

Status: implementation verified; **PRD-360 stays PARTIAL**. The 8-second median and 250 ms
pump-silence criteria are unchanged and still unmet — this record proves the warm-up host turn and
the relaunch hint, not the launch criterion. No physical cache-speed result is claimed because the
phone was unreachable during this follow-up.

## Red and green

The regression test was added before the fix. Against the old `warmUpScene`, the pending compile
case failed because the host yield was never called:

```text
FAIL packages/core/__tests__/warmup.spec.ts > scene warm-up > should yield while waiting for a native compile to settle
AssertionError: expected "vi.fn()" to be called at least once
```

The cache test also failed before the implementation because no cache status was reported:

```text
FAIL packages/core/__tests__/warmup.spec.ts > scene warm-up > should reuse a completed warm-up on the next launch
AssertionError: expected undefined to be 'stored'
```

After the fix:

```text
pnpm vitest run packages/core/__tests__/warmup.spec.ts packages/core/__tests__/warmup-default.spec.ts
✓ packages/core/__tests__/warmup.spec.ts (17 tests)
✓ packages/core/__tests__/warmup-default.spec.ts (4 tests)
Tests 21 passed
```

The game integration output records the behavior that matters:

```text
TN_WARMUP:{"compiled":1,"cache":"stored"}
TN_WARMUP:{"compiled":0,"cache":"hit"}
```

The first launch writes a marker only after a complete warm-up. The second launch skips the compile
walk. A blank key throws `TN_WARMUP_CACHE_INVALID`; storage failures return `cache: "unavailable"`
and continue the ordinary bounded warm-up.

Core typecheck also passed:

```text
pnpm --filter @threenative/core typecheck
exit 0
```

## Physical evidence boundary

The preserved candidate physical run reached its first frame at **16,020.007 ms** and moved
**2.146719 m** on a Pixel 8. Its host binary and full run artifacts are recorded by the prior
[Bayview repair review](https://github.com/ThreeNativeHQ/threenative/pull/136); that run proves
playability and a visible world. It is a single launch of the package already retained on the
device, not a cold install, so it is not a sample of what PRD-360's criterion measures — and at
16,020.007 ms it misses that 8-second criterion by roughly twice over regardless. One run is also
not the three-sample thermal benchmark the criterion requires. The baseline record retains three
preflight-qualified cold launches with a 49,788.7 ms median; its earlier plugged-in 50,948.7 ms set
is retained as superseded evidence.

The follow-up tried the recorded Wi-Fi device:

```text
List of devices attached
failed to connect to '192.168.1.192:5555': No route to host
List of devices attached
```

Because the device was unavailable, no physical cache-hit timing is reported. The new marker is an
opt-in hint for the platform driver's own persistent cache, not a serialized WebGPU pipeline.

## Corrected object-granularity validation — 2026-09-08

The explicit warm-up caller was temporarily set to `warmUp: { granularity: "object" }` in the
unchanged Bayview source to exercise the existing object path. The engine lane then fixed the
first-use race at `packages/core/src/game.ts:860`, `:1138`, `:1171` and `:1262`: while that explicit
warm-up is pending, the held render path may present the loading layer but cannot start startup
readiness, compute or the world render. The regression is covered by
`packages/core/__tests__/game.spec.ts:545`.

The test was red before the fix because the held frame rendered the world:

```text
FAIL packages/core/__tests__/game.spec.ts > IGame > holds first-use rendering until an explicit warm-up finishes
AssertionError: received ["overlay", "world", "overlay"]; expected ["overlay", "overlay"]
```

The focused test is green after the fix:

```text
pnpm exec vitest run packages/core/__tests__/game.spec.ts -t 'holds first-use rendering until an explicit warm-up finishes'
✓ 1 passed
```

The corrected physical receipt used APK SHA-256
`2a64ede5cf0699580e8e62506b054f0c8e046c7084fb4244f42ea5c6b1394496` on
Pixel 8 `192.168.1.192:5555`. The device stayed qualified throughout: 81% battery, discharging,
thermal status `NONE`, and 33.5 °C to 33.9 °C. The existing movement scenario passed with
**2.146682 m** displacement and zero diagnostics. The raw console and mailbox receipt is retained
in [`android-object-corrected-receipt.json.gz`](android-object-corrected-receipt.json.gz), whose
SHA-256 is `eb5da223f8f97ca4100aec10273dc0e9ad11bb6091414f11c02168ad4aaeb763`.

Its timing markers were:

```text
TN_WARMUP:{"compiled":494,"slices":21,"elapsedMs":11659,"cache":"disabled"}
TN_COLD_START:{"segment":"first_frame","atMs":19629.400}
TN_PUMP_SILENCE:{"observed":true,"maxGapMs":2339.194,"trailingGapMs":5551.419}
TN_PUMP_ENDPOINT:{"requestMethod":"advance","maxGapMs":5560.916}
```

There was one `TN_WARMUP` marker and no `TN_STARTUP_WARMUP` marker, confirming that the race fix
removed the duplicate fallback pass. The object path still misses both budgets, so this is a
corrected validation of the same bounded lever rather than an acceptance sample or a new default.
The temporary sandbox option was removed after the run.

## Follow-up — CI fixture hygiene, 2026-09-07

The `supply-chain` job was red on this branch: gitleaks' `generic-api-key` rule matched the
persistent-cache fixture key in `packages/core/__tests__/warmup-default.spec.ts:115` at entropy
`3.708132`. The value is a test cache key, not a credential. The fixture was renamed to an
obviously non-secret low-entropy string, and the already-published finding was scoped by its exact
commit/file/rule/line fingerprint in `.gitleaksignore`. The fingerprint is necessary because CI
scans every commit in the pull-request range: renaming the value in a later commit cannot remove
the historical finding. No scanner rule or path was suppressed, so any other finding still fails.

Reproduced locally with the same pinned scanner image and `git` mode the workflow uses. The whole
repository was mounted at its host path so the container could resolve the linked worktree's
`.git` pointer:

```text
# before — RED
docker run --rm -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0="$PWD" \
  -v /home/joao/projects/threenative/threenative-engine:/home/joao/projects/threenative/threenative-engine \
  ghcr.io/gitleaks/gitleaks@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb \
  git --redact --verbose --gitleaks-ignore-path "$PWD/.gitleaksignore" \
  --log-opts="origin/main..HEAD" "$PWD"
RuleID:      generic-api-key
Entropy:     3.708132
File:        packages/core/__tests__/warmup-default.spec.ts
Line:        115
Fingerprint: e2e871f1feac6fa0f7dc4d372f30d3cb586a8f72:packages/core/__tests__/warmup-default.spec.ts:generic-api-key:115
WRN leaks found: 1
exit 1

# after — GREEN (renamed fixture plus exact historical fingerprint)
INF 1 commits scanned.
INF no leaks found
exit 0
```

The behaviour the spec proves is unchanged; the key is only an opaque identity. Re-run after the
rename:

```text
pnpm exec vitest run packages/core/__tests__/warmup.spec.ts packages/core/__tests__/warmup-default.spec.ts
✓ packages/core/__tests__/warmup.spec.ts (18 tests)
✓ packages/core/__tests__/warmup-default.spec.ts (4 tests)
Tests 22 passed (22)
```

That is the current count on this branch; the 17/21 figures quoted above were recorded before the
later warm-up test landed and are not re-asserted here.

## Follow-up — target-aware native diagnostics on physical Android

The target-aware diagnostics repair was also exercised through the real Android bridge, rather
than only its unit tests. `target-aware-android.playtest.json` deliberately omits both
`noNetworkErrors` and an authored waiver. With runner source at `c5329f658`, Android supplied the
native-target default, reached the actual assertions, reported zero console/runtime errors, and
moved the player **2.146690 m** against a 0.25 m minimum. The distinct installed subject was
`com.threenative.bayview.manifestfix` on the physical Pixel 8; its APK and embedded bundle hashes
are pinned in `target-aware-android-result.json`. Exit status was 0.

The run discharged from 36% to 35%, so it makes no startup timing or battery-qualified claim. Its
purpose is narrower: omitting a browser-only network observation on a native target no longer
blocks the executable diagnostics and movement assertions before the bridge runs.

A separate explicit-scene warm-up APK build cleared the 74-asset preflight after the three known
models were converted to separate vertex layout. The converted byte hashes exactly match the prior
2,415,843-value semantic comparison. The urgent closeout interrupted native compilation during
`:app:buildNativePhysics`, before any APK was produced, so no result from that candidate is claimed.
