# PRD-254 crash-handler/resume lane audit — 2026-08-30

## Result

`worktree-agent-a60b0b3f74d66bb64` is already landed. Every file changed by its three commits is
byte-identical at main commit `c3ae3b26`; current main later fixed the black-resume defect the lane
only recorded at `91e93d29`. The stale history was not replayed. This audit repaired one test
blind spot in the current crash-policy contract.

Layer: native-host policy and its test harness. Android owns debuggerd and its tombstone chain;
game code cannot portably observe or replace that platform seam.

## History proof

```text
git diff --stat worktree-agent-a60b0b3f74d66bb64 c3ae3b26 -- <the lane's eight paths>
# no output
```

The original `c3ae3b26` evidence is a physical Pixel 8 same-binary control: leaving Android's
handlers to the platform produced a new symbolized tombstone, while reinstating the old handlers
produced no dropbox entry and the old `SIGNALED status=11` signature. This audit does not relabel
that historical run as a new device execution.

## Current verification

Focused current-main tests:

```text
packages/runtime-native tests/crash-handler-policy.test.mjs tests/lifecycle-pause.test.mjs
Test Files  2 passed (2)
Tests  16 passed (16)

packages/core/__tests__/loop.spec.ts
Test Files  1 passed (1)
Tests  20 passed (20)
```

The crash-policy suite executed the compiled C++ signal-disposition contract. The fresh worktree's
native build stopped before compilation when its ignored Python tools venv failed `ensurepip`, so
the audit copied only the contract executable built earlier this turn from source verified
identical to this lane. Source and copy both hashed
`61b902a4edc12293a81f037592406e286e6eade37e8f4bf0635bcfcf22df6ce4`. Its output included the
Android platform-owned and pre-fix negative-control cases and ended
`native crash-handler policy contract passed`.

## Named mutation and harness repair

The existing source assertion used
`LeaveToPlatform[\s\S]*?return false`, so changing Android's branch from `return false` to
`return true` stayed green by matching the sanitizer branch's later return. The test now slices
only the `LeaveToPlatform` branch and asserts both `return false` and the absence of `signal(`.

With the same wrong-return mutation after that repair:

```text
FAIL Android installs no crash handler, so debuggerd keeps writing tombstones
AssertionError: LeaveToPlatform must report that it installed nothing
Received: ... return true;
Tests  1 failed | 5 passed (6)
```

Restoring `return false` returned the combined 36 focused tests to green. Biome checked the changed
test with no fixes.

## Platform boundary

`adb devices -l` found only `emulator-5554`, model `sdk_gphone64_x86_64`. An emulator cannot replace
the lane's physical-Pixel debuggerd/dropbox evidence, so no new physical-device claim is made. The
detached tarball sandbox protocol is not applicable: this is host signal ownership, not a public
game capability or behavior a generated game can assert.
