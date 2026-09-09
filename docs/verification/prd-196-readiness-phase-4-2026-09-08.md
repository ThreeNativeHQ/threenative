# PRD-196 phase 4 — guarded release cohort

**Evidence date:** 2026-09-08

**Implementation source under test:** `7f24089377cf33ae2e993e9c6a1c8115a79e5d7f`, superseded by
the lane tip `2f4152b539ef20aa4cef7fbb3d98b7525bf0c5ed`. This record was written at the earlier
commit; [round-196-published-install.md](round-196-published-install.md) re-ran every claim
below at the tip and records what moved.

**Base:** `76321e46d93f8ece59528315e83b17a644b7a77b`

**Status:** NEEDS CORRECTION / BLOCKED. Cohort preparation is guarded and no registry mutation
occurred, but the existing versions are immutable and the prebuilt runtime release is absent.

## Candidate state

The source manifests currently resolve to this 11-package set:

```text
@threenative/assets@0.3.0
@threenative/playtest@0.3.0
@threenative/core@0.3.0
@threenative/physics@0.3.0
@threenative/raw-unreal@0.1.0
@threenative/runtime-native@0.3.0
@threenative/ueformat@0.1.0
@threenative/ui@0.3.0
create-threenative@0.2.3
threenative-blender-mcp@0.1.0
threenative-engine-mcp@0.2.0
```

The guarded release order is dependency-derived and prints the same 11 entries. It does not
publish or republish immutable versions.

## Green and red evidence

```text
pnpm exec vitest run scripts/__tests__/release.spec.ts
8 tests passed
```

The tests cover dependency ordering, exact template pins, the bundled MCP table, a pin outside the
candidate cohort, and a changed package whose already-published version must be rejected.

```text
pnpm publish:check
exit 1 — 9 findings

pnpm release --prepare --skip-gates
exit 1 — TN_RELEASE_PREFLIGHT_RED: pnpm publish:check refused this tree
```

The publish report names eight immutable published versions with later source commits and the
missing `runtime-native-v0.3.0/prebuilt-lock.json`. The guarded release command printed the
dependency order, then stopped before any pack/publish mutation.

The negative controls are both executable: the release tests inject an old template pin and a
changed already-published package, and each expects the preflight to reject it. The live preflight
red is the restored/current-cohort control; the worktree remained clean after the command.

## Review checkpoint

Independent reviewer decision: **NEEDS CORRECTION**. Version bumps, a published runtime prebuilt
manifest, and independent review are required before PRD-060/PRD-262 can receive a candidate.
This phase performed no npm publication, tag move or external release upload.

### Repair round 4 — 2026-09-08

This record was re-checked at the lane tip by
[round-196-published-install.md](round-196-published-install.md). `pnpm publish:check` re-ran at
the lane tip: exit 1, the same 9 findings. This lane deliberately did not bump any version — a
bump belongs with the publish it enables, and would clear eight findings while leaving the ninth
and naming a cohort with no release behind it.

No independent reviewer has signed this phase. PRD-196 is filed `BLOCKED` under
`requires-release-credentials/`: the remaining criteria need an `npm publish` of the candidate
cohort and a `runtime-native-v*` release, neither of which an agent lane can perform.
