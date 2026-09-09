---
prd_contract: v1
---

# PRD-060 phase 1 — exact-candidate preflight

**Status:** `IN PROGRESS` — phase 1 is implemented and locally verified. Phases 2–6 remain
`BLOCKED` because the exact hosted PRD-054/PRD-059 inputs, npm ownership, and signing/notarization
credentials are unavailable. This record does not claim a release, publication, signing, or
promotion.

**Layer:** release orchestration (`scripts/` and `.github/workflows/`). The change protects the
engine's release boundary; it does not change game or renderer behavior.

**Base:** `66b7ece8e0ee4cec39346597b3e0ed80f65e8c9f` (`origin/main` after PRD-078). The candidate
implementation is in the PRD-060 branch and has not consumed credentials or mutated npm/GitHub
release state.

## What is implemented

- `scripts/release-candidate-gate.ts` validates a strict `releaseCandidateV1` object. It binds the
  runtime tag and package cohort to one 40-character candidate SHA, requires successful `CI` and
  native evidence runs on `main`, binds parity/provenance reports to that SHA, checks exact npm
  and GitHub subject sets, and rejects unknown keys where a secret could be supplied.
- Missing credential or hosted-capability booleans return `BLOCKED` with exit 2. Invalid schema,
  stale SHA, failed run, bad subject set, or non-byte-identical existing registry state returns
  `FAIL` with exit 1.
- `.github/workflows/native-release.yml` runs the preflight in `validate-tag` before `gates`,
  exports only the candidate SHA, and makes every later release job depend directly on that output
  and compare it with `github.sha`. A missing candidate file blocks the tag before build or
  release side effects.

## Observed red controls and restored green results

The first implementation run was red because the new module did not exist:

```text
pnpm exec vitest run scripts/__tests__/release-candidate-gate.spec.ts
Error: Cannot find module '../release-candidate-gate.js'
RED_CONTROL_EXIT=1
```

The workflow wiring control was red before the caller was added:

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs -t 'release side effects require the exact releaseCandidateV1 preflight'
1 failed, 15 skipped
RED_CONTROL_EXIT=1
```

The cohort-version control was red before the validator compared each package to
`runtimeVersion`:

```text
pnpm exec vitest run scripts/__tests__/release-candidate-gate.spec.ts -t "require every package cohort version"
1 failed, 7 skipped
AssertionError: expected 'PASS' to be 'FAIL'
Command exit: 1
```

The restored candidate controls execute the named failures against temporary JSON inputs:

```text
CANDIDATE_SCHEMA_RED_EXIT=1
FAIL provenance is missing 'subjects'.
EXACT_CANDIDATE_RED_EXIT=1
FAIL requiredRuns.ci.headSha must equal candidateSha.
CREDENTIAL_PREFLIGHT_RED_EXIT=2
BLOCKED credentials.iosSigning is unavailable.
RESTORED_GREEN_EXIT=0
PASS: releaseCandidateV1
```

The implementation tests are green:

```text
pnpm exec vitest run scripts/__tests__/release-candidate-gate.spec.ts
1 file / 8 tests passed

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs -t 'release side effects require the exact releaseCandidateV1 preflight'
1 test passed / 15 skipped (16 total)
```

The phase-1 acceptance boundary is therefore proven locally. The remaining release criteria still
require an exact hosted candidate and owner-supplied external capabilities; no local green result
is promoted to `DONE`.

References: [PRD-060](../PRDs/BLOCKED/requires-release-credentials/PRD-060-promoted-consumer-distribution.md),
[native-release workflow](../../.github/workflows/native-release.yml), and
[phase-1 validator](../../scripts/release-candidate-gate.ts).
