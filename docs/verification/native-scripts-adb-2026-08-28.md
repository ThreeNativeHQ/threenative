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

## Phase 2: Android JavaScript-engine measurement

`scripts/lib/device.mjs` now owns the preflight implementation, package-ID resolution from
`app.id`, Play Protect suppression, and post-install `pm path` verification. The old
`device-preflight.mjs` path remains a one-line compatibility re-export. The measurement script uses
the shared ADB client for every device command.

The adopter preserves its prior ADB contract: only `THREENATIVE_ADB` and
`THREENATIVE_ANDROID_SDK` affect discovery before the home-SDK fallback, missing ADB remains exit
2, commands retain their 120-second timeout and 64 MiB buffer, and failed commands retain raw
stderr bytes. The focused suite passed **23/23** tests. The repository-wide installer census now
passes this adopter and stops at the next untouched script, `profile-production.mjs`.

Native coverage remains **34.49%** overall and **36.16%** for `src/webgpu/`; only the source digest
changed to `8adda56f3222e036a2b51b249c95fc0c862ceb2023299c91575124136f4bab9a` because the coverage
record includes runtime scripts and tests. The interim census is **108,488** lines, up 145 from
Phase 1 while the shared surface and its parity tests coexist with unadopted private wrappers. The
batch-level requirement that scripts shrink is evaluated after the remaining adopters delete those
wrappers.

No physical-device result is claimed for this checkpoint.

## Phase 3: physical mobile qualification

`qualify-physical-mobile.mjs` now routes every Android device command through the shared result
adapter. Its regular Android path executes the shared readiness rules, Play Protect suppression,
install, package verification, launch, and telemetry in that order. The adapter preserves the
qualification runner's 16 MiB buffer, 30-second default timeout, 120-second install timeout, and
non-throwing result shape.

The injected production-path test passed through real artifact, prerequisite, lifecycle, telemetry,
and evidence construction and returned the unchanged `TN_QUALIFY_PHYSICAL_PASS` result. Removing
Play Protect suppression made the test red because the required ordered command was absent; the
restored focused suite passed **47/47** tests.

Native coverage remains **34.49%** overall and **36.16%** for `src/webgpu/`; the source digest is
`606dbae743a8dc75f9dbe33b444da3b886ebeaea9cf83ab90d5eedbadd749ced`. The interim census is
**108,760** lines while the new behavior proof coexists with the remaining private wrappers.

No physical-device result is claimed for this checkpoint.
