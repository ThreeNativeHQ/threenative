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
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs tests/desktop-container.test.mjs tests/starter-desktop.test.mjs` | **106 passed**, exit 0 (8 new). |
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
- `a successful macOS signature records the signing scheme`: codesign/verify succeed and the manifest
  records `signed: true` / `signingScheme: 'codesign'`.
- `macOS notarization staples and re-archives the signed bundle`: the injected notarytool returns
  `Accepted`, `stapler` runs, and the archive is written twice.

## Review correction

An independent read-only reviewer returned **NEEDS CORRECTION** and found the macOS success path
threw `EISDIR` because `signDesktopArtifact` hashed the `.app` directory, that dependency integrity
records were written before `codesign --deep` rewrote the bundled frameworks, and that the success
and notarize→staple→re-archive paths had no test. Fixed: the darwin branch no longer hashes a
directory; dependency records are written after signing; and the two success-path tests above were
added. The reviewer's notary-binding note is addressed by wording — the integrated path binds the
evidence to the archive it submits, and `assertNotaryEvidence` rejects externally supplied evidence
for a different artifact. Distribution's count is **56 passed** (not the 53 in the reviewer note,
which predated the two success tests).

## Observed red, then restored green

Disabling the artifact-hash check in `assertNotaryEvidence` made the mismatch row fail:

```
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs -t 'notarization evidence for a different artifact'
=> Tests  1 failed | 54 skipped (55)
# restored
=> Tests  106 passed (106) over the three desktop suites
```

## Not run

- **Real signed release**: no Windows/macOS host and no signing credentials ran here, so no
  Authenticode or notarized artifact was produced or assessed. `codesign`, `signtool` and
  `notarytool` are exercised through injected transport only.
- **Notarized/stapled re-archive against Apple**: the sequence is covered through injected transport,
  not executed against Apple's service.
- **Independent reviewer**: the re-review confirmed all three code findings RESOLVED (macOS success
  path no longer throws `EISDIR`; dependency records match post-signing bytes; the notarize →
  staple → re-archive sequence is tested with two archive writes) and returned NEEDS CORRECTION for
  documentation only — the README did not state that the credentialed path is host-bound. That note
  is fixed in the same commit.
