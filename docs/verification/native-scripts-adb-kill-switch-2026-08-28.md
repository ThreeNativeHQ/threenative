# Native scripts ADB consolidation kill-switch result — 2026-08-28

## Result

PRD-234 was implemented one adopter per commit, reviewed after each checkpoint, measured, and
reverted. The abstraction failed its binding acceptance criterion: `packages/runtime-native/scripts/`
did not get smaller.

| Measurement | Before (`93eacaed`) | Attempt (`1317a722`) | Result |
| --- | ---: | ---: | --- |
| Raw product-script diff | — | +1,037 / -635 | **+402 lines — fail** |
| `pnpm census`, `scripts/` | 15,926 | 16,330 | **+404 lines — fail** |
| `pnpm census`, total | 108,160 | 109,307 | +1,147 lines |

The raw diff and census count use different inclusion rules; both independently contradict the
PRD requirement that script LOC fall.

## What ran

- Sixteen implementation and evidence commits covered the preflight, measurement, qualification,
  production profile, first-proof, physics-parity, cold-start, launch-inspection, and
  physics-stability adopters.
- Focused tests were run at each adopter checkpoint. Independent high-effort reviews found and
  drove repairs for environment-policy drift, raw-output drift, missing product-path coverage,
  ambient-serial drift, binary corruption, no-serial suppression, transport-error reclassification,
  raw-status drift, typed-error wrapping, and numeric-timeout drift.
- Three reviewed consolidation checkpoints removed 46 product-script lines from the attempted
  design. The remaining +402-line delta made further incremental cleanup non-credible.

## Revert proof

The sixteen commits from `bc36ba28` through `1317a722` were reverted in reverse order, preserving
the five-file checkpoint cap. After the revert:

```text
git diff --quiet 93eacaed..HEAD -- packages/runtime-native/scripts packages/runtime-native/tests \
  docs/verification/native-scripts-adb-2026-08-28.md
exit 0

pnpm census
census ok: already current at 108,160 lines
```

No device result is claimed. The attempted device abstraction is absent from the retained tree.
The narrow Play Protect and post-install-verification behavior repairs found during the trial are
not smuggled into this refactor outcome; they require separately scoped red-green bugfixes.

## Follow-up 2026-08-29 — why the shape was wrong, and what landed instead

The rejection above measured the failure but named it as a size overrun, which reads as "the same
design, done leaner, would pass". It would not. Two measurements say why:

| Question | Answer |
| --- | ---: |
| Real duplicated adb-helper lines across all six scripts | **60** |
| Lines the attempted shared layer added to carry them | **690** (`lib/adb.mjs` 179 + `lib/device.mjs` 511) |

Sixty lines of duplication cannot fund a 690-line library. Worse, the adoption was **additive, not
substitutive**: every adopter kept its own `run()`/`discoverAdb()` and gained a hand-written adapter
to feed the new kernel — `parityAdbClient()` in the parity lane, `createColdStartDevice()` (a
13-line config object replacing 16 lines of concrete code) in cold start. Six scripts grew rather
than shrank: parity +43, qualification +41, physics-stability +29, production profile +19. Any
re-attempt that keeps the generic-client shape reproduces this result.

**The shared device library already existed.** `scripts/device-preflight.mjs` is imported by all
seven device lanes and already held the superset resolver — it alone honoured `ANDROID_SDK_ROOT`
and `ANDROID_HOME` on top of `THREENATIVE_ADB`. PRD-234's goal needed that one function exported,
not a second library beside it.

### Landed instead

- `resolveAdbExecutable(environment, { existsSyncImpl, onMissing })` is exported from
  `device-preflight.mjs`. Lanes that must fail closed pass `onMissing` and keep their own typed
  exit-2 code; the default keeps the PATH fallback. Three private copies were deleted.
- **Bug fixed:** `measure-cold-start.mjs`, `inspect-launch.mjs` and `measure-android-js-engine.mjs`
  read only `THREENATIVE_ANDROID_SDK`, so a machine naming its SDK with the documented
  `ANDROID_HOME` resolved nothing and the lane died as though adb were absent.
- **Bug fixed:** `device-physics-stability.mjs` called `main()` at module scope — importing it ran
  the ten-launch device protocol and exited 64, which is why the file had never been tested. It now
  carries the same entrypoint guard as its siblings.
- **Bug fixed:** the same script hardcoded `execFileSync('adb', …)`, ignoring `THREENATIVE_ADB` and
  every SDK root the other six lanes honour.
- Coverage where there was none: `tests/scripts-adb-resolution.test.mjs` (6) and
  `tests/device-physics-stability.test.mjs` (4).

Net `packages/runtime-native/scripts/` delta: **+16 lines** for three bug fixes, one deduplication
and two new test files — against the rejected attempt's +402 for no behaviour change. The four
orphaned tests from the attempt were *not* restored: they asserted that the shared transport
preserved the old behaviour, so they test the adapter rather than the lane, and have no meaning
without it.
