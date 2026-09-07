# PRD-360 warm-up and cache verification — 2026-09-07

Status: implementation verified; the original 8-second and 250 ms timing requirements were retired
under the revised PRD acceptance. No new physical cache-speed result is claimed because the phone
was unreachable during this follow-up.

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
playability and a visible world, not the retired 8-second criterion or a three-sample thermal
benchmark. The baseline record retains three cold launches with a 50,948.7 ms median and states
that charging made the preflight unqualified.

The follow-up tried the recorded Wi-Fi device:

```text
List of devices attached
failed to connect to '192.168.1.192:5555': No route to host
List of devices attached
```

Because the device was unavailable, no physical cache-hit timing is reported. The new marker is an
opt-in hint for the platform driver's own persistent cache, not a serialized WebGPU pipeline.
