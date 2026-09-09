# PRD-196 phase 1 — packed core boundary

**Evidence date:** 2026-09-08

**Implementation source under test:** `7f24089377cf33ae2e993e9c6a1c8115a79e5d7f`

**Base:** `76321e46d93f8ece59528315e83b17a644b7a77b`

**Status:** NEEDS CORRECTION. The local packed-core boundary is green, but the current public
cohort is not publishable and this record has not received the required independent review.

## Green evidence

Command:

```text
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts
```

Result: 40 tests passed. The suite packs the current runtime-native package, extracts package
contents, checks relative imports, rejects catalog/workspace protocols, and verifies that the
core tarball ships its supported `dist`, `mcp`, install scripts, patches, capabilities manifest and
README. `scripts/vsm-proof` is excluded from `packages/core/package.json` because it reaches
development-only sibling source.

The implementation was also covered by the five-file focused run at this source commit:

```text
5 test files passed; 118 tests passed
```

## Red controls

The same test command contains controlled failing fixtures for a packed script whose relative
import is absent, a relative import that escapes the tarball, a missing packed manifest, and an
unresolved workspace protocol. These assertions pass only when the checker throws and names the
bad path; they are the phase's packed-content negative controls, not source-string checks.

The real publish preflight was red:

```text
pnpm publish:check
exit 1 — 9 findings
```

The findings were eight already-published versions with source commits after publication
(`@threenative/assets`, `core`, `physics`, `playtest`, `runtime-native`, `ui`,
`create-threenative`, `threenative-engine-mcp`) and no public
`runtime-native-v0.3.0/prebuilt-lock.json`. This is the release-cohort blocker, not an unresolved
import in the packed core.

## Review checkpoint

Independent reviewer decision: **NEEDS CORRECTION**. No reviewer has independently signed the
phase, and public release must first use a new coherent cohort with the runtime prebuilt release.
No public package was published by this work.
