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
