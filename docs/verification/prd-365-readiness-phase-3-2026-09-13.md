# PRD-365 phase 3 — signing and notarization adapter (partial, in progress)

Candidate: branch `prd-365/desktop-distribution-phase-1`, starting from `da48d7aaa`, PR
**https://github.com/ThreeNativeHQ/threenative/pull/224** (draft, base `develop`). Host: linux-x64,
Node v20.19.6, pnpm 10.25.0, worktree `.worktrees/prd-365-phase1`. Revised 2026-09-13.

**This record is partial.** It covers the signing/notarization adapter, its fixture failure
contracts and the unsigned-preparation path. Real signed Windows and notarized macOS subjects were
not produced: there are no signing credentials and no Windows/macOS host here, so those gates stay
open and are delegated to PRD-060's credentialed operations.

## What changed

- `packages/runtime-native/scripts/desktop-distribution.mjs`:
  - `signDesktopArtifact` runs the platform's own tool with injectable transport: `codesign`
    (sign + `--strict --deep` verify) on macOS, `signtool` (sign + `/pa` verify, optional `/tr`
    timestamp) on Windows, and a no-op `scheme: 'none'` on Linux, which has no
    Authenticode/notarization. Missing identity/certificate throws
    `TN_DESKTOP_SIGNING_CREDENTIALS_MISSING` and writes nothing.
  - `notarizeArchive` submits the archive through `xcrun notarytool ... --output-format json` and
    refuses a non-`Accepted` status.
  - `assertNotaryEvidence` refuses notarization evidence whose `artifactSha256` does not equal the
    produced artifact and whose status is not `Accepted`.
  - `packageDesktopContainer` signs the staged bundle/executable before the integrity records, adds
    `signed`/`signingScheme` to the manifest, and for macOS notarizes the archive, staples the
    application and re-archives the stapled bundle. Any failure refuses the release and removes the
    archive it just wrote unless one already existed.
- `packages/runtime-native/scripts/package-desktop.mjs`: `desktopSigningFromEnvironment` reads
  non-secret inputs from the build environment (`THREENATIVE_DESKTOP_SIGN`,
  `THREENATIVE_DESKTOP_CODESIGN_IDENTITY`, `THREENATIVE_DESKTOP_NOTARY_PROFILE`,
  `THREENATIVE_DESKTOP_SIGN_CERTIFICATE`, `THREENATIVE_DESKTOP_TIMESTAMP_URL`); secrets stay in the
  OS keychain. Without a request or inputs, release stays unsigned. The container log line names
  signed vs unsigned.
- `packages/runtime-native/README.md`: the signing variables, per-OS tool behavior, and the
  store/depot handoff.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs tests/desktop-container.test.mjs tests/starter-desktop.test.mjs` | **101 passed**, exit 0 (5 new). |
| `pnpm exec biome check <4 changed files>` | exit 0 (warnings only, pre-existing). |
| `scripts/__tests__/primary-docs.spec.ts` + `check-publish-state.spec.ts` | **52 passed**, exit 0. |

### Required tests (phase 3)

- `a signed desktop release is refused when the signing tool fails`: `codesign` exits 1, the build
  throws `TN_DESKTOP_CODESIGN_FAILED` and no archive is left.
- `notarization evidence for a different artifact is refused`: a mismatched `artifactSha256` throws
  `TN_DESKTOP_NOTARY_MISMATCH`; a non-`Accepted` status throws `TN_DESKTOP_NOTARY_FAILED`.
- `a notarization rejection from notarytool refuses the release`: a `status: "Invalid"` response
  throws `TN_DESKTOP_NOTARY_FAILED`.
- `missing signing credentials stay PENDING while unsigned preparation proceeds`:
  `desktopSigningFromEnvironment({})` is `undefined`; `THREENATIVE_DESKTOP_SIGN=1` without
  credentials throws `TN_DESKTOP_SIGNING_CREDENTIALS_MISSING`; `packageDesktopContainer` without
  signing records `signed: false`.

## Observed red, then restored green

Disabling the artifact-hash check in `assertNotaryEvidence` made the mismatch row fail:

```
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs -t 'notarization evidence for a different artifact'
=> Tests  1 failed | 51 skipped (52)
# restored
=> Tests  101 passed (101) over the three desktop suites
```

## Not run

- **Real signed release**: no Windows/macOS host and no signing credentials ran here, so no
  Authenticode or notarized artifact was produced or assessed. `codesign`, `signtool` and
  `notarytool` are exercised through injected transport only.
- **Notarized/stapled re-archive**: the macOS notarize → staple → re-archive sequence is unit-tested
  through seams, not executed against Apple's service.
- **Independent reviewer**: not yet requested for this phase.
