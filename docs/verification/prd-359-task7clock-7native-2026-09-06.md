# PRD-359 tasks 7clock and 7native — 2026-09-06

Both native measurement rows are accepted. The runtime clock is relative to a
`steady_clock` origin, and WebTransport work is recorded as a separate,
frame-keyed host-gap segment.

## Red/green

The source contract was red before the monotonic-clock change:

```text
/tmp/prd359-red-clock.log
Test Files 1 failed (1); Tests 1 failed, 11 skipped (12)
```

After the clock repair, the source contract passed 12/12. The native coverage
build then compiled and ran both timer executables; each printed its required
pass marker and exited cleanly:

```text
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/timer-contract.test.mjs tests/host-gap-meter.test.mjs
Test Files 2 passed (2); Tests 13 passed (13)

pnpm --filter @threenative/runtime-native native:coverage
Executed 33 native contract targets; exit 0
native timer delivery contract passed
native engine-first timer delivery contract passed
```

The host-gap source contract also has a negative mutation: removing the
`periodMicros` assignment fails the test. The proof parser rejects missing or
duplicate frame identities.

## Delay seam proof

The compiled Linux coverage host was run with the explicit environment-only
seam `TN_NETWORKING_TEST_PROCESS_EVENTS_DELAY_MS=5`. The delay is inside the
measured `kWebTransport` segment, immediately around
`webtransport::processEvents`; it is not read by game code.

```text
TN_NETWORKING_TEST_PROCESS_EVENTS_DELAY_MS=5 sh scripts/xvfb.sh \
  packages/runtime-native/build/tn-linux-coverage/mystral run \
  examples/native-smoke/dist/native-smoke.js --frames 60

parseNetworkingCpuSamples(/tmp/networking-359-host-gap-delay5.log)
count=2100 p50=5.057ms p95=5.060ms max=5.079ms exceedsBudget=true
```

The process was stopped after the host emitted the frame-keyed report; the
report contained 2,100 unique samples. The 5 ms sample therefore raises the
native networking p95 above the 1 ms budget, and the focused proof test covers
the same parser/threshold path. No platform beyond this Linux native host is
claimed here.
