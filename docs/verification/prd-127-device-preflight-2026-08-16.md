# PRD-127 device preflight — 2026-08-16

**Implementation status:** code and fixture tests are landed in this lane. **Physical-device
status: UNVERIFIED.** No Android measurement or condition preflight was run against the listed
ADB serial, so this note makes no physical-device claim.

## What changed

- `packages/runtime-native/scripts/device-preflight.mjs` is the shared gate. It parses battery and
  charging state, thermal status, and screen state; it throws before measurement when a declared
  bar fails and returns the observed condition block when it passes or is explicitly overridden.
- The engine-load Android runner and the three runtime-native measurement scripts all reach the
  shared gate. Reports carry `deviceCondition` and `provisional`; comparison paths reject
  provisional or condition-less device evidence.
- `docs/product/PERFORMANCE-BUDGETS.md` now states that a device number without this block is not
  evidence.

## Fixture evidence

`pnpm --dir packages/runtime-native exec vitest run tests/device-preflight.test.mjs tests/android-js-engine-measurement.test.mjs tests/physics-parity-verifier.test.mjs`
passed 3 files and 35 tests.

The tests observed red for low battery, charging, thermal throttling, screen off, no device,
emulator serial, and unparseable `dumpsys` input. The preflight failures carry non-zero exit code
2 in their error objects. They also prove that the three runtime-native callers and the
engine-load runner still reference the shared gate, that stripping `deviceCondition` is rejected,
and that a provisional comparison is rejected.

## Deliberately open

- No physical Pixel run, low-battery lane run, charging lane run, thermal lane run, or report write
  was executed here. Those criteria remain **UNVERIFIED**, not passed.
- The charged PRD-118 retake remains a separate physical-device action. An ADB listing alone does
  not establish the required device, charge, thermal, charging, or screen conditions.
