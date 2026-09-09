# PRD-196 phase 5 — installed sandbox package injection

**Evidence date:** 2026-09-08

**Implementation source under test:** `7f24089377cf33ae2e993e9c6a1c8115a79e5d7f`

**Base:** `76321e46d93f8ece59528315e83b17a644b7a77b`

**Status:** NEEDS CORRECTION for phase closure. Local census, packing and scaffold mechanics are
green; public/native acceptance and the required independent review remain open.

## Package census

The framework arm derives its inputs from the workspace manifests rather than a second hardcoded
list. The ten non-CLI packages are `@threenative/assets`, `@threenative/core`,
`@threenative/physics`, `@threenative/playtest`, `@threenative/raw-unreal`,
`@threenative/runtime-native`, `@threenative/ueformat`, `@threenative/ui`,
`threenative-blender-mcp` and `threenative-engine-mcp`; it also packs
`create-threenative`. The vanilla arm remains playtest-only.

## Red then green sandbox control

The first real framework run after introducing the census was intentionally retained as the red
control:

```text
/tmp/threenative-prd196-sandbox.WXcdqX
pnpm pack produced no tarball for: blender-mcp, engine-mcp
```

Cause: the package names did not equal their workspace directories. The implementation was
changed to resolve the actual package entry (`packages/blender-mcp` and `packages/engine-mcp`),
then rerun with the same scenario.

Green command and artifact:

```text
pnpm sandbox --help                         exit 0
pnpm sandbox --genre platformer --arm framework \
  --out /tmp/threenative-prd196-sandbox.zAHu0q --name prd196-game
```

The framework run created `/tmp/threenative-prd196-sandbox.zAHu0q/prd196-game`, installed local
tarballs for all 11 packages, and produced `sweep.json` with:

```text
arm=framework, genre=platformer, template=starter
sourceLines=0
sealed proof SHA-256=7cf3f69edef397bebc0e9eae66794cfb5b1a6306cc97ef9a161a6bc7d1eba26b
sweep.json SHA-256=ea5d72ecc53f22395cf41cab35fc472de5d854e146f5e4b0a7f9c21e436278db
native runtime: packed locally for build --target desktop
capability server: packed locally for engine_search_capabilities
```

The local package set includes `@threenative/runtime-native`, both MCP packages, raw Unreal and
UEFormat. The archive is a local tarball boundary and therefore does not receive public-registry
credit.

## Remaining unexecuted boundary

The sandbox was not awarded native desktop, browser playtest, or real external MCP credit: the
public runtime `linux-x64` prebuilt is missing and the public registry cohort lacks Blender. Those
claims require a new public candidate and a fresh run from the sandbox's installed project.

## Review checkpoint

Independent reviewer decision: **NEEDS CORRECTION**. The local mechanics are ready for review, but
the phase acceptance requires the supported desktop/native and capability operations, plus an
independent reviewer, after the public cohort is repaired.
