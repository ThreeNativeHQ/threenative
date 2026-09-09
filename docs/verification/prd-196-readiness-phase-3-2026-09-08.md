# PRD-196 phase 3 — automatic MCP installation

**Evidence date:** 2026-09-08

**Implementation source under test:** `7f24089377cf33ae2e993e9c6a1c8115a79e5d7f`

**Base:** `76321e46d93f8ece59528315e83b17a644b7a77b`

**Status:** NEEDS CORRECTION / BLOCKED by the currently published cohort. Local wiring and
bundles are green; public-registry MCP acceptance is red.

## Implemented contract

`packages/core/mcp/servers.mjs` is the sole table for four servers:

```text
threenative-assets
threenative-sculpt
threenative-engine
threenative-blender
```

`install.mjs` derives host configuration from that table, preserves unrelated user settings,
preserves same-name user servers while reporting conflicts, and fails closed on malformed config.
The core tarball carries both the engine and Blender bundles. Current source package versions are
`@threenative/core@0.3.0`, `threenative-engine-mcp@0.2.0` and
`threenative-blender-mcp@0.1.0`; these are source versions, not a public acceptance claim.

## Green evidence

```text
pnpm exec vitest run packages/core/__tests__/mcp-install.spec.ts
29 tests passed
```

The focused five-file run passed 118 tests, including the registry verifier's initialize,
tools/list, engine capability search/detail, asset, sculpt and Blender-operation checks. Local
tests cover every host shape, malformed tables, reinstall idempotence, user conflicts, bundled
tool surfaces and missing shim files.

## Red controls and public observation

The MCP unit suite contains controlled red fixtures for malformed config, a missing initialize
response, malformed engine capability hits and a server table with a missing entry. Each test
expects a named failure rather than an all-ready result.

The real public verifier reported `MCP configuration is missing required server
'threenative-blender'` for both npm and pnpm. That is the old registry cohort, not a local bundle
failure: a local packed framework sandbox installed the new Blender tarball and generated all four
entries, while the public `create-threenative@0.2.3` scaffold did not.

## Review checkpoint

Independent reviewer decision: **NEEDS CORRECTION**. The public cohort must be republished as a
coherent candidate and re-run through the actual MCP transports. No editor-wide configuration was
modified and no public package was published by this work.
