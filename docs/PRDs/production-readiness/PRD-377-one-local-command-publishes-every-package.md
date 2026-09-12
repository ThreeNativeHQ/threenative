---
prd_contract: v1
---

# PRD-377 — One local command publishes every package and its native runtime

**Status:** NOT STARTED
**Complexity:** 7 → HIGH (+2 six-to-ten files, +2 new module, +2 crosses the npm/native release boundary, +1 GitHub release API).
**Owner:** engine release tooling.
**Problem:** Publishing is two unrelated mechanisms. `pnpm release --yes` already publishes every npm package in dependency order from a workstation, but it then **refuses** because `@threenative/runtime-native` demands a `runtime-native-v<version>/prebuilt-lock.json` that only the multi-runner CI release lane can produce. So a local release cannot make the runtime installable, and a consumer's first `threenative build` fails on an HTTP 404. The owner's ask is one local `pnpm` command that publishes everything, so people can install the cohort and build their games without waiting on CI.

Batch contract and dependency order: [production-readiness](README.md). Baseline: `902ca95e2`. [PRD-262](PRD-262-the-runtime-native-prebuilt-release-exists.md) owns the versioned release's contents; [PRD-221](../done/PRD-221-android-v8-is-16kb-clean.md) owns the Android V8 payload those assets carry; [PRD-060](PRD-060-promoted-consumer-distribution.md) owns public promotion. iOS is out of scope; the CI lane keeps its iOS gate.

## Integration ledger

| # | New or revised thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | Scoped prebuilt manifest — a manifest may declare the exact `requiredKeys` it carries | `packages/runtime-native/scripts/install-prebuilt.mjs` `fetchRelease`/`readRelease`, on every native install | the implicit full-cohort requirement in `validateReleaseManifest` | full-cohort default kept for the official CI release | drop a key from a manifest that declares it; the install fails naming the key |
| 2 | Local payload assembler `scripts/release-native-local.mjs` | `scripts/release-native-local.ts` CLI; `scripts/release.ts` after npm publish | the asset-name literals spread through `native-release.yml` staging steps | CI steps keep their own copies; both read `PREBUILT_ASSET_NAMES` | remove a built input; the assembler fails naming the missing binary |
| 3 | `pnpm release:native` command | root `package.json`; invoked by `scripts/release.ts` | the manual tag + `workflow_dispatch` chain | CI lane retained for Windows/iOS | request a key with no staged asset; the release refuses and publishes nothing |

## Current behavior and ownership

- `scripts/release.ts` (`pnpm release`) validates the cohort, runs `checkPublishState`, builds, and publishes every npm package in dependency order, then verifies a clean-room install. It is already one local command for the npm half.
- `scripts/check-publish-state.ts` blocks that command when `install-prebuilt.mjs` cannot fetch the version's `prebuilt-lock.json`; `--allow-missing-prebuilt` exists only to publish the npm package ahead of the release and leaves consumers with the 404.
- `packages/runtime-native/scripts/install-prebuilt.mjs` downloads the two native binaries (`<platform>-<arch>` runtime and its tools helper) from the GitHub release, and `validateReleaseManifest` requires **every non-iOS published key** by default, so a partial release is refused at install time.
- `generateReleaseManifest` hard-codes the full `PUBLISHED_PREBUILT_KEYS` matrix, and `native-release.yml` stages each asset with its own literals across OS runners.
- Ownership: this PRD amends the manifest contract and adds a local publisher. It does **not** own the official release's contents (PRD-262) and does not replace the CI lane for keys this host cannot build (Windows, iOS).

## Approach and boundaries

- Add a **scoped manifest**: a manifest may carry `requiredKeys` (the keys it advertises). `validateReleaseManifest` requires exactly those keys when present and still validates every artifact it carries; absent `requiredKeys`, the strict full-cohort default is unchanged, so the official CI release keeps its guarantee.
- Add a **local payload assembler** that stages the binaries this host can actually build — the host desktop runtime and its tools helper, plus the Android payloads when the NDK build output is present — under the canonical `PREBUILT_ASSET_NAMES`, and emits the scoped lock via `generateReleaseManifest(directory, { keys })`.
- Add **`pnpm release:native`** that creates or updates the `runtime-native-v<version>` GitHub release from the staged payload. Dry by default; `--yes` uploads. It refuses when a declared key has no staged asset, so it can never publish a lock advertising bytes that are not there.
- Wire `pnpm release --yes` to run the native release after the npm publish, so the one command that exists already finishes the job. `--allow-missing-prebuilt` stays for the deliberate publish-ahead case.
- Boundaries: no custom renderer of release data, no second installer, no bespoke asset-name table. `PREBUILT_ASSET_NAMES` remains the single owner of file names; the CI lane and the local assembler both consume it.

```mermaid
flowchart LR
    R[pnpm release --yes] --> NPM[pnpm publish cohort]
    NPM --> ASM[Assemble host payload]
    ASM --> LOCK[Scoped prebuilt-lock.json]
    LOCK --> GH[gh release create runtime-native-vX]
    GH --> INST[Consumer install]
    INST --> GAME[threenative build --target desktop|android]
```

## Execution phases

### Phase 1 — A release manifest may advertise exactly the keys it carries

**Progress:**

- [ ] Callers wired and building: `packages/runtime-native/scripts/install-prebuilt.mjs` — `validateReleaseManifest` reads `manifest.requiredKeys`; `generateReleaseManifest` accepts a `keys` subset; `fetchRelease`/`readRelease` pass the manifest through unchanged.
- [ ] Required test green: `packages/runtime-native/tests/install-prebuilt.test.mjs` (or the existing prebuilt spec) covers a scoped manifest that installs its declared key and refuses an undeclared one.
- [ ] Observed red recorded, then restored green — removing a declared key from a scoped manifest fails the install naming that key; restoring it is green.
- [ ] User verification performed on the named platform — a local manifest install (`THREENATIVE_PREBUILT_MANIFEST`) installs the host runtime and tools helper.
- [ ] Evidence record written: the boxes above carry it (command, exit code, key).
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `packages/runtime-native/scripts/install-prebuilt.mjs` — scoped `requiredKeys`, `generateReleaseManifest({ keys })`.
- NEW/EDIT `packages/runtime-native/tests/install-prebuilt.test.mjs` — scoped-manifest acceptance and refusal.
- EDIT `packages/runtime-native/AGENTS.md` if the install contract's prose changes.

**Implementation and wiring:** `validateManifestEnvelope` accepts an optional `requiredKeys` string array; `validateReleaseManifest` uses `options.requiredKeys ?? manifest.requiredKeys ?? PUBLISHED_PREBUILT_KEYS.filter(!ios)`. `generateReleaseManifest(directory, { repository, tag, sourceSha, keys })` requires the exact filenames for `keys` (or the full set when omitted) and sets `requiredKeys` accordingly.

**Required test:** a scoped manifest declares `['linux-x64','linux-x64-tools']`, installs those two, and fails closed naming `win32-x64` when a caller requests it.

**Observed-red / revert control:** remove one declared key from the manifest; the install must fail naming it, not silently skip.

### Phase 2 — The host payload is assembled locally with the canonical asset names

**Progress:**

- [ ] Callers wired and building: `scripts/release-native-local.mjs` is invoked by the `release-native-local.ts` CLI and by `scripts/release.ts`; it reads `PREBUILT_ASSET_NAMES` rather than repeating literals.
- [ ] Required test green: the assembler stages `threenative-runtime-linux-x64` and `threenative-tools-linux-x64` from the built `packages/runtime-native/build/tn-linux/{mystral,mystral-tools}` and returns a scoped manifest.
- [ ] Observed red recorded, then restored green — point the assembler at a missing binary; it fails naming the path and produces no manifest.
- [ ] User verification performed on the named platform — the staged directory contains exactly the declared assets, each non-empty.
- [ ] Evidence record written: the boxes above carry it.
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- NEW `scripts/release-native-local.mjs` — stage host (and Android, when present) assets into a release directory.
- NEW `scripts/release-native-local.ts` — CLI: `--dry-run` (default) and `--yes`.
- EDIT `package.json` — a `release:native` script.
- EDIT `scripts/release.ts` — call the native step after npm publish.
- EDIT `scripts/__tests__/release-native-local.spec.ts` — assembler contract.

**Implementation and wiring:** the assembler maps each locally built binary to its `PREBUILT_ASSET_NAMES` filename (`build/tn-linux/mystral` → `threenative-runtime-linux-x64`, `build/tn-linux/mystral-tools` → `threenative-tools-linux-x64`; Android assets from the NDK output when `third_party/v8-android` and the staged APK libs exist). Python/Node only — no new dependency.

**Required test:** staging from a fixture build tree yields exactly the declared keys and rejects a missing input.

**Observed-red / revert control:** delete `build/tn-linux/mystral-tools`; the assembler fails naming it and writes no lock.

### Phase 3 — One command publishes the npm cohort and the native release

**Progress:**

- [ ] Callers wired and building: `scripts/release.ts --yes` invokes the native release after the npm publish; `pnpm release:native --yes` runs it alone.
- [ ] Required test green: `scripts/__tests__/release-native.spec.ts` proves the native step is refused when a declared key has no staged asset, and invoked after a successful npm publish.
- [ ] Observed red recorded, then restored green — a declared-but-missing key makes `pnpm release:native --yes` publish nothing and exit non-zero.
- [ ] User verification performed on the named platform — a real `runtime-native-v<version>` release exists and a fresh sandbox install of the published package downloads the runtime and builds the desktop game.
- [ ] Evidence record written: the boxes above carry it (release URL, lock, install log, build exit).
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `scripts/release-native-local.ts` — `gh release create|upload runtime-native-v<version>` from the staged payload.
- EDIT `scripts/release.ts` — native step wiring, `--yes` gating.
- EDIT `scripts/check-publish-state.ts` — accept a scoped lock when the requested key is present.
- EDIT `scripts/__tests__/release-native.spec.ts` — refusal and ordering.

**Implementation and wiring:** `gh release view`/`create`/`upload` via `execFileSync`, idempotent on re-run; the lock is uploaded last so a partial upload leaves an unusable directory, not a lock pointing at missing bytes. The strict full-cohort path used by `native-release.yml` is untouched.

**Required test:** the native step uploads only after every declared key is staged, and a re-run is idempotent.

**Observed-red / revert control:** remove one staged asset; the command exits non-zero and creates no release (or updates nothing).

## Verification contract

Each phase edits its named pre-existing caller and stays within the five-file budget. Run the phase command, its observed-red control, restore the implementation and rerun green. Record exact command, exit code and artifact path on the box. A missing observation, skipped test, stale artifact or zero-assertion run is not PASS. Publishing is irreversible; the local publisher is dry by default and only `--yes` writes to GitHub, so no verification step publishes as a side effect.

## Verification evidence

The phase boxes above are the record. `docs/benchmark/SCREENSHOT-RETENTION.md` is regenerated when an evidence file is added.

## Acceptance criteria

- [ ] **local** — On a Linux workstation with the native toolchain, `pnpm release --yes` publishes every npm package and creates `runtime-native-v<version>` whose scoped lock names the host runtime and tools helper, with each asset's SHA-256 and size.
- [ ] **local** — A fresh sandbox install of that published cohort downloads the runtime and builds and runs the desktop game; the same install requests a key absent from the scoped lock and fails closed naming it.
- [ ] **local** — Dropping a declared key from the staged payload makes `pnpm release:native --yes` refuse and publish nothing; the manifest contract's full-cohort default still rejects a key-dropped manifest on the official CI path.
- [ ] **shared** — The CI `native-release.yml` lane remains the producer for `win32-x64`/`ios-simulator-arm64`; this command does not claim a platform it did not build, and the header names that lane.
- [ ] **local** — `pnpm release` (npm only, no `--yes`) stays a dry run, and `pnpm release --prepare` is unchanged.

## Prior work retained

None. New PRD; it amends the manifest contract introduced by PRD-262 and leaves that PRD's published contents and the CI release lane intact.
