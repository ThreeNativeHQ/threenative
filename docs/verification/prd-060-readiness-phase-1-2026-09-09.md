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

**Base:** `66b7ece8e0ee4cec39346597b3e0ed80f65e8c9f` (`origin/main` after PRD-078). The implementation
was verified on branch `linchpin/prd-060-production-readiness-20260908` at HEAD `e694da5dc`, with
the working-tree files listed below. No credentials were consumed and no npm/GitHub release state
was mutated.

## What is implemented

- `scripts/release-candidate-gate.ts` validates a strict `releaseCandidateV1` object. It derives the
  exact public workspace cohort from manifests (`11` packages), the exact GitHub subject set from
  the runtime asset map (`18` subjects: `prebuilt-lock.json` plus `17` assets), and the runtime tag
  from `@threenative/runtime-native`.
- The resolver reads required run metadata through the GitHub API, requires completed successful
  `push` runs on `main` at the requested SHA, downloads the named report artifacts from those runs,
  pins their workflow/artifact/path contracts, and validates strict parity/provenance report schemas.
  Parity requires `web`, `desktop`, and `android` PASS target rows; provenance requires the exact
  runtime asset subject set and SHA-256 values for every subject plus lock/SBOM/license inputs.
  It records each report's byte SHA-256 and source identity.
- It reads npm metadata and downloads each existing exact-version tarball, checking npm integrity,
  raw tarball SHA-256, package metadata, and a normalized sorted file-tree SHA-256. The resolver
  packs the local workspace package after `pnpm build` and requires that normalized tree to match.
  Missing exact versions are recorded as `absent` so the native release can publish the runtime
  release before the package cohort.
- `release-candidate.yml` derives credential booleans from secret presence and accepts hosted
  capability availability as explicit operator inputs. It writes only booleans to the candidate;
  the candidate records `availabilitySource: "workflow-inputs"`. Any false value remains a
  `BLOCKED`/exit-2 result.
- `native-release.yml` selects exactly one successful `workflow_dispatch` candidate run on the tag
  SHA, downloads its SHA-named artifact, and validates its producer run id plus live registry state
  before any build, signing, upload, publish, dist-tag, or finalization job can proceed.

## Observed red controls and restored green results

The first implementation controls were red before their corresponding source existed:

```text
pnpm exec vitest run scripts/__tests__/release-candidate-gate.spec.ts
Error: Cannot find module '../release-candidate-gate.js'
RED_CONTROL_EXIT=1

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs -t 'release side effects require the exact releaseCandidateV1 preflight'
1 failed, 15 skipped
RED_CONTROL_EXIT=1
```

The restored controls below were run against a temporary candidate fixture derived from the current
workspace manifests and runtime asset map. The fixture was outside the repository and no release
workflow or registry mutation ran.

```text
--- candidate-schema ---
FAIL: releaseCandidateV1
FAIL provenance is missing 'subjects'.
FAIL provenance.subjects must contain at least one subject.

--- exact-candidate-ci ---
FAIL: releaseCandidateV1
FAIL requiredRuns.ci.headSha must equal candidateSha.

--- credential-preflight ---
BLOCKED: releaseCandidateV1
BLOCKED credentials.iosSigning is unavailable.

--- restored-green ---
PASS: releaseCandidateV1
Exact candidate, dependency evidence, subject set, and release inputs are ready.
```

The repair controls first reproduced the two review findings before the strict contracts existed:

```text
--- report-contract ---
15 tests collected; arbitrary parity artifact name/path/subject returned PASS
RED_CONTROL_EXIT=1

--- registry-tree ---
resolver returned a candidate when the injected workspace normalized hash differed
RED_CONTROL_EXIT=1
```

The exact validator invocations were:

```sh
GITHUB_SHA="$CANDIDATE_SHA" pnpm tsx scripts/release-candidate-gate.ts validate \
  --candidate "$PRD060_TMP/missing-provenance.json" \
  --repository ThreeNativeHQ/threenative --producer-run-id 103
GITHUB_SHA="$CANDIDATE_SHA" pnpm tsx scripts/release-candidate-gate.ts validate \
  --candidate "$PRD060_TMP/stale-ci.json" \
  --repository ThreeNativeHQ/threenative --producer-run-id 103
GITHUB_SHA="$CANDIDATE_SHA" pnpm tsx scripts/release-candidate-gate.ts validate \
  --candidate "$PRD060_TMP/missing-credentials.json" \
  --repository ThreeNativeHQ/threenative --producer-run-id 103
GITHUB_SHA="$CANDIDATE_SHA" pnpm tsx scripts/release-candidate-gate.ts validate \
  --candidate "$PRD060_TMP/candidate.json" \
  --repository ThreeNativeHQ/threenative --producer-run-id 103
```

The implementation tests are green:

```text
pnpm exec vitest run scripts/__tests__/release-candidate-gate.spec.ts
1 file / 17 tests passed

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs
1 file / 17 tests passed

public package cohort: 11
GitHub subject set: 18

TN_SUITE_EXCLUDE_PACKAGES='@threenative/runtime-native' pnpm test
410 files passed / 2 skipped
4731 tests passed / 8 skipped
suite temporary directory count: before 1, after 1

pnpm --filter @threenative/runtime-native native:coverage
38 native contract targets passed; 2 configured targets blocked; 21997 instrumented lines;
17722 covered; 80.57%

pnpm budgets
budgets ok: 11 framework packages, 16 example workspaces, 62247/15000 framework LOC,
140720/100000 native runtime LOC
```

The phase-1 acceptance boundary is therefore proven locally. The remaining release criteria still
require an exact hosted candidate and owner-supplied external capabilities; no local green result is
promoted to `DONE`.

References: [PRD-060](../PRDs/BLOCKED/requires-release-credentials/PRD-060-promoted-consumer-distribution.md),
[candidate workflow](../../.github/workflows/release-candidate.yml),
[native-release workflow](../../.github/workflows/native-release.yml), and
[phase-1 validator](../../scripts/release-candidate-gate.ts).
