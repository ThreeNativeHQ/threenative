# PRD-359 task 4c boundaries — 2026-09-06

Status: accepted for the bounded client module split.

## Scope

`packages/core/src/net.ts` is now the public typed entry point and delegates
validation to `net-protocol.ts` and connection lifecycle/queues to
`net-session.ts`. The implementation was moved without duplicating the codec.
The published `./net` subpath remains the only public export; no default-index
re-export was added.

The native shim audit found that every browser global read by the networking
modules is already installed by the native host: `AbortSignal`, streams,
`TextDecoder`, `TextEncoder`, `URL`, and timer/standard ECMAScript globals.
`packages/runtime-native/shim-manifest.json` therefore needed no new entry.

## Red / diagnosis

The boundary was temporarily broken by changing the public entry point's
`net-session.js` import to a nonexistent internal module. The required package
typecheck failed at the import boundary:

```text
src/net.ts(59,32): error TS2307: Cannot find module './net-session-missing.js' or its corresponding type declarations.
Exit status 2
```

The import was restored before the green run; the mutation is not committed.

## Green checks

The exact API tests, including `offline import opens no transport`, passed:

```text
pnpm --filter @threenative/core typecheck && pnpm exec vitest run packages/core/__tests__/net.spec.ts
✓ packages/core/__tests__/net.spec.ts (7 tests)
Test Files  1 passed (1)
Tests  7 passed (7)
exit 0
```

The package build produced the `./net` ESM and declaration entries and publint
accepted the packed package:

```text
pnpm --filter @threenative/core build
ESM dist/net.js 24.47 KB
DTS dist/net.d.ts 2.72 KB
All good!
exit 0
```

The packed module imported with `WebTransport` absent, then rejected the actual
connect attempt with `TN_NET_UNAVAILABLE` without opening a transport. A scan
of `packages/core/dist/net.js` found no `node:`, `process`, `Buffer`, or
`require(` references. The native-global checker also passed:

```text
pnpm tsx scripts/check-native-shims.ts
native shim contract passed
exit 0
```

`git diff --check` passed after restoring the controlled mutation.
