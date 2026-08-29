# Native scripts ADB consolidation — 2026-08-28

## Phase 1: device preflight

`scripts/lib/adb.mjs` now owns executable discovery, serial/transport selection, the 120-second
timeout, the 8 MiB output limit, and non-zero exit handling. `device-preflight.mjs` delegates both
its readiness and Play Protect commands to that surface while preserving its named preflight error.

The new transport test first failed because `scripts/lib/adb.mjs` did not exist. After the adoption:

```text
tests/scripts-adb-lib.test.mjs
Tests 4 passed (4)

tests/android-js-engine-measurement.test.mjs
Tests 14 passed (14)
```

The existing repository-wide Play Protect census is already red independently of this adoption. It
names `measure-android-js-engine.mjs` as the first installer missing suppression. That separate
behavior repair is deferred to its own checkpoint, preserving this PRD's one-adopter rule. This
checkpoint does not claim the complete device-preflight file green.

No physical-device result is claimed: no device command is required to prove the transport adapter,
and the configured device lane was not run in this checkpoint.

The fourth library test drives `assertDeviceReady` without its high-level `adb` injection: the
configured fake executable returns a discharging fixture that passes, then a charging fixture that
fails with `TN_DEVICE_PREFLIGHT_CONDITION_FAILED` and names the AC source.
