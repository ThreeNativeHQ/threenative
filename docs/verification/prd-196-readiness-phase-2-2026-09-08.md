# PRD-196 phase 2 — clean npm and pnpm install matrix

**Evidence date:** 2026-09-08

**Implementation source under test:** `7f24089377cf33ae2e993e9c6a1c8115a79e5d7f`

**Base:** `76321e46d93f8ece59528315e83b17a644b7a77b`

**Host:** Linux x86_64, Node `v20.19.6`, npm `11.18.0`, pnpm `10.25.0`.

**Status:** NEEDS CORRECTION / BLOCKED on the public cohort and native prebuilt release. The
local install matrix and its failure reporting are implemented; public consumer acceptance is not
green.

## Candidate and supported environment

`create-threenative@0.2.3` now declares Node `>=20.19.0` and pnpm `>=10.0.0`. The verifier uses
private clean-room caches, runs both package managers without `--ignore-scripts`, checks lockfiles
for local `file:`/`link:` entries, then runs scaffold, install, build, test, doctor and native
steps.

## Green and red evidence

The focused verifier suite passed:

```text
pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts
18 tests passed
```

The real public command was run first without an environment override and reproduced the sharp
failure while building against the host's global libvips. The documented repair was then used:

```text
SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm tsx scripts/verify-registry-install.ts
exit 1 overall
```

With the override, both npm and pnpm rows passed `scaffold`, `install`, `lockfile`, `build` and
browser `test`. The npm row reported six high-severity audit findings. The pnpm row reported
ignored `esbuild` and `sharp` build scripts and the normal `pnpm approve-builds` guidance; the
verifier did not bypass package-manager policy.

Both managers then failed the honest external rows:

```text
FAIL npm:doctor — missing prebuilt runtime for linux-x64
FAIL npm:native — build:desktop could not produce the runtime executable
FAIL npm:mcp — registry config lacks threenative-blender
FAIL pnpm:doctor — missing prebuilt runtime for linux-x64
FAIL pnpm:native — build:desktop could not produce the runtime executable
FAIL pnpm:mcp — registry config lacks threenative-blender
```

The native failure names the public URL
`https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.0/prebuilt-lock.json`,
which currently returns HTTP 404. The MCP failure is against the currently published
`create-threenative@0.2.3` / `@threenative/core@0.3.0` cohort, whose generated config has only
three server entries.

## Review checkpoint

Independent reviewer decision: **NEEDS CORRECTION**. A new public cohort, native prebuilt release,
and registry MCP verification are required before this phase can close. The local environment
repair is documented in `packages/create-threenative/README.md`; it is not a claim that all clean
hosts are repaired automatically.
