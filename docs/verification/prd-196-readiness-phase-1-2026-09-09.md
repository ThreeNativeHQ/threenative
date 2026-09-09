# PRD-196 phase 1 — packed core boundary

**Evidence date:** 2026-09-09

**Implementation source under test:** `c3ed2ce54249de4c7e09c226f68c780ab59e6cfb`.

**Host:** Linux x86_64, Node `v20.19.6`, npm `11.18.0`, pnpm `10.25.0`.

**Status:** LOCAL PACKED BOUNDARY GREEN / PUBLIC COHORT NEEDS CORRECTION. The installed core
tarball excludes the development-only VSM proof and its shipped scripts resolve internally. The
public cohort still cannot be published until package versions move and the runtime prebuilt
release exists.

## Green evidence

The focused publish-state suite packed the current packages and checked the extracted contents:

```text
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts
Test Files  1 passed (1)
Tests  45 passed (45)
```

The core-specific green control was rerun after restoring the manifest:

```text
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts -t "packs only self-contained core scripts and excludes the VSM development proof"
Test Files  1 passed (1)
Tests  1 passed | 44 skipped (45)
```

The packed core includes `scripts/postinstall.mjs`, `LICENSE`, and `gpl/LICENSE.GPL`, excludes
`scripts/vsm-proof/run.mjs` and the rest of that directory, and reports no unresolvable relative
imports.

## Red control and restoration

The mutation was limited to adding `scripts/vsm-proof` to the `files` list in
`packages/core/package.json`. The same core-specific test then failed:

```text
FAIL scripts/__tests__/check-publish-state.spec.ts > pnpm publish:check > packs only self-contained core scripts and excludes the VSM development proof
AssertionError: expected [ 'LICENSE', 'README.md', …(28) ] to not include 'scripts/vsm-proof/run.mjs'
at scripts/__tests__/check-publish-state.spec.ts:795:34
```

The manifest was restored from its pre-test copy, `git diff --check` passed, and the green control
above passed again. This proves the exclusion is enforced by the packed artifact test rather than
by a source-string scan.

## Live publish preflight

```text
pnpm publish:check
Checked 11 package(s): @threenative/assets, @threenative/core, @threenative/physics, @threenative/playtest, @threenative/raw-unreal, @threenative/runtime-native, @threenative/ueformat, @threenative/ui, create-threenative, threenative-blender-mcp, threenative-engine-mcp
9 finding(s). This tree must not be published as it stands.
exit 1
```

The nine findings are eight already-published package versions with later source commits and the
missing `runtime-native-v0.3.0/prebuilt-lock.json`. The exact missing URL is:

```text
https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.0/prebuilt-lock.json
```

This is a release-cohort blocker, separate from the green packed-core boundary. No registry
mutation or public readiness claim was made.

## Review checkpoint

Independent reviewer decision: **PENDING**. The local phase result is ready for review; public
consumer acceptance remains blocked on the new cohort and native prebuilt release, which require
release credentials and an external release artifact.
