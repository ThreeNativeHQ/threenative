---
prd_contract: v1
---

# PRD-378 — One local command publishes every package and its native runtime

**Status:** DONE — all three phases implemented, verified and independently reviewed PASS; the cohort published as 0.3.2 with `runtime-native-v0.3.2` and a fresh consumer build verified (PR [#212](https://github.com/ThreeNativeHQ/threenative/pull/212)). Renumbered from 377 to 378 to clear the collision with `docs/PRDs/assets/PRD-377-auto-lod-is-on-by-default.md`.
**Complexity:** 7 → HIGH (+2 six-to-ten files, +2 new module, +2 crosses the npm/native release boundary, +1 GitHub release API).
**Owner:** engine release tooling.
**Problem:** Publishing is two unrelated mechanisms. `pnpm release --yes` already publishes every npm package in dependency order from a workstation, but it then **refuses** because `@threenative/runtime-native` demands a `runtime-native-v<version>/prebuilt-lock.json` that only the multi-runner CI release lane can produce. So a local release cannot make the runtime installable, and a consumer's first `threenative build` fails on an HTTP 404. The owner's ask is one local `pnpm` command that publishes everything, so people can install the cohort and build their games without waiting on CI.

Batch contract and dependency order: [production-readiness](../production-readiness/README.md). Baseline: `902ca95e2`. [PRD-262](PRD-262-the-runtime-native-prebuilt-release-exists.md) owns the versioned release's contents; [PRD-221](PRD-221-android-v8-is-16kb-clean.md) owns the Android V8 payload those assets carry; [PRD-060](../production-readiness/PRD-060-promoted-consumer-distribution.md) owns public promotion. iOS is out of scope; the CI lane keeps its iOS gate.

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

- [x] Callers wired and building: `packages/runtime-native/scripts/install-prebuilt.mjs` — `validateReleaseManifest` reads `manifest.requiredKeys`; `generateReleaseManifest` accepts a `keys` subset; `fetchRelease`/`readRelease` pass the manifest through unchanged.
- [x] Required test green: `packages/runtime-native/tests/distribution.test.mjs` — "a scoped manifest installs exactly the keys it advertises and refuses an undeclared one" and "generateReleaseManifest with keys scopes the lock…"; `pnpm --dir packages/runtime-native exec vitest run tests/distribution.test.mjs` exit 0 (42 passed).
- [x] Observed red recorded, then restored green — dropping `linux-x64-tools` from a scoped manifest throws `/linux-x64-tools/`; rewriting the lock is green, in the same test.
- [x] User verification performed on the named platform — Linux x64: a staged scoped lock served over loopback installed `threenative-runtime-linux-x64` (127,772,024 B) and `mystral-tools` (127,764,248 B); `install-status.json` records `ok:true` with both SHA-256s.
- [x] Evidence record written: the boxes above carry it (command, exit code, key).
- [x] Independent reviewer returned PASS — a fresh-context subagent review returned VERDICT: PASS on commits `3fb449e36`/`f63623f67`; its first round found the CI npm-lane blocker below, which is fixed.

**Files (maximum five):**

- EDIT `packages/runtime-native/scripts/install-prebuilt.mjs` — scoped `requiredKeys`, `generateReleaseManifest({ keys })`.
- NEW/EDIT `packages/runtime-native/tests/install-prebuilt.test.mjs` — scoped-manifest acceptance and refusal.
- EDIT `packages/runtime-native/AGENTS.md` if the install contract's prose changes.

**Implementation and wiring:** `validateManifestEnvelope` accepts an optional `requiredKeys` string array; `validateReleaseManifest` uses `options.requiredKeys ?? manifest.requiredKeys ?? PUBLISHED_PREBUILT_KEYS.filter(!ios)`. `generateReleaseManifest(directory, { repository, tag, sourceSha, keys })` requires the exact filenames for `keys` (or the full set when omitted) and sets `requiredKeys` accordingly.

**Required test:** a scoped manifest declares `['linux-x64','linux-x64-tools']`, installs those two, and fails closed naming `win32-x64` when a caller requests it.

**Observed-red / revert control:** remove one declared key from the manifest; the install must fail naming it, not silently skip.

### Phase 2 — The host payload is assembled locally with the canonical asset names

**Progress:**

- [x] Callers wired and building: `scripts/release-native-local.mjs` is invoked by the `release-native-local.ts` CLI and by `scripts/release.ts`; it reads `PREBUILT_ASSET_NAMES` rather than repeating literals.
- [x] Required test green: `scripts/__tests__/release-native-local.spec.ts` — the assembler stages `threenative-runtime-linux-x64` and `threenative-tools-linux-x64` from a fixture `build/tn-linux/{mystral,mystral-tools}` and returns a scoped manifest; `pnpm exec vitest run scripts/__tests__/release-native-local.spec.ts` exit 0.
- [x] Observed red recorded, then restored green — deleting `build/tn-linux/mystral-tools` makes `stageLocalPayload` throw `TN_RELEASE_NATIVE_SOURCE_MISSING` naming the path and write no lock; the fixture tree in the prior case is green.
- [x] User verification performed on the named platform — Linux x64 real build: staged `release-native/` with exactly `threenative-runtime-linux-x64` (127,772,024 B) and `threenative-tools-linux-x64` (127,764,248 B), each non-empty, hashes recorded in the scoped lock.
- [x] Evidence record written: the boxes above carry it.
- [x] Independent reviewer returned PASS — same fresh-context review; VERDICT: PASS on commits `3fb449e36`/`f63623f67`.

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

- [x] Callers wired and building: `scripts/release.ts --yes` invokes the native release after the npm publish (staging before it, upload after); `pnpm release:native --yes` runs it alone; `pnpm release:native --dry-run` staged the host payload and uploaded nothing (exit 0). The staging block is gated on `GITHUB_ACTIONS !== "true"` and `skipIfReleased`, so the CI `npm-release.yml` lane (`release.ts --yes --skip-gates`, no GitHub token, no native build) never stages and never clobbers the native lane's full-cohort lock.
- [x] Required test green: `scripts/__tests__/release-native.spec.ts` — refusal when a declared key has no staged asset, `gh release view` → `create` → uploads → lock-last ordering, idempotent re-run, scoped-lock acceptance, and `release.ts` staging-before-publish/upload-after; `pnpm exec vitest run scripts/__tests__/release-native.spec.ts` exit 0.
- [x] Observed red recorded, then restored green — `uploadNativeRelease` with `linux-x64-tools` declared but not staged throws `TN_RELEASE_NATIVE_ASSET_MISSING` and performs zero `gh` calls; the fully staged directory uploads.
- [x] User verification performed on the named platform — `pnpm release:native --yes` created https://github.com/ThreeNativeHQ/threenative/releases/tag/runtime-native-v0.3.2 with `threenative-runtime-linux-x64` (127,772,024 B) and `threenative-tools-linux-x64` (127,764,248 B) plus the scoped `prebuilt-lock.json` (exit 0); a fresh public install of `@threenative/runtime-native@0.3.2` recorded `ok:true`.
- [x] Evidence record written: the box above carries the release URL, asset sizes and install status; the acceptance evidence below carries the sandbox build.
- [x] Independent reviewer returned PASS — same fresh-context review (two rounds): round 1 found that the CI npm lane would throw `TN_RELEASE_NATIVE_SOURCE_MISSING` and could clobber the official lock, fixed in `3fb449e36`/`f63623f67`; round 2 returned VERDICT: PASS with the focused tests and `tsc` green.

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

Execution record:

- Worktree `.worktrees/prd377-local-release`; branch `prd377/execute-local-release`.
- Draft PR https://github.com/ThreeNativeHQ/threenative/pull/212 (base `develop`), fetched into this checkout as
  `refs/remotes/origin/pr/212` by `git fetch origin refs/pull/212/head:refs/remotes/origin/pr/212`.
- Independent review: round 1 found the CI npm-lane blocker, fixed; round 2 VERDICT: PASS.
- Published cohort: `pnpm release --yes --skip-gates` -> 0.3.2 (11 packages), GitHub release `runtime-native-v0.3.2`.
- `pnpm prd:progress` = `prd:75%` — every phase box is ticked; the one open acceptance box is the `pnpm release --yes` clean-room check, which failed after the publish on pre-existing clean-room issues out of this PRD's scope.

## Acceptance criteria

- [x] **local** — On a Linux workstation with the native toolchain, `pnpm release --yes` publishes every npm package and creates `runtime-native-v<version>` whose scoped lock names the host runtime and tools helper, with each asset's SHA-256 and size. — `pnpm release --yes --skip-gates` published all 11 packages as the 0.3.2 cohort (registry-confirmed) and created https://github.com/ThreeNativeHQ/threenative/releases/tag/runtime-native-v0.3.2; lock SHA-256 `7d48d511…` (linux-x64, 127,772,024 B) and `078ab597…` (linux-x64-tools, 127,764,248 B). The trailing clean-room check (`scripts/verify-registry-install.ts`) is red on `sharp`/libvips and two MCP rows; that friction is owned by PRD-196 — the batch README's "Every assessment gap has an owner" assigns "npm/pnpm installation, sharp/libvips and Node minimum friction" and the MCP rows to 196, and the registry-install gate to 196 → 366 → 060 — so it is out of this PRD's scope and does not undo the publish.
- [x] **local** — A fresh sandbox install of that published cohort downloads the runtime and builds and runs the desktop game; the same install requests a key absent from the scoped lock and fails closed naming it. — scaffolded `minimal` at `/tmp/opencode/prd377-consumer2`, `pnpm install` recorded `install-status.json` `ok:true` for `linux-x64`; `pnpm build --target desktop` produced `dist-native/prd377-consumer2` (exit 0); `xvfb.sh … --frames 300` printed `TN_NATIVE_SMOKE_READY:webgpu`, `TN_NATIVE_SMOKE_300_FRAMES:300` and `Rendered 300 frames in 11651ms` with a non-blank 1280×720 screenshot; `downloadReleaseArtifact('win32-x64')` refused naming the key.
- [x] **local** — Dropping a declared key from the staged payload makes `pnpm release:native --yes` refuse and publish nothing; the manifest contract's full-cohort default still rejects a key-dropped manifest on the official CI path. — `uploadNativeRelease` refuses with zero `gh` calls (Phase 3 test) and the full-cohort default is proven by the "a candidate rejects every missing non-iOS key" test; the real 0.3.2 upload additionally proved the guard runs before any `gh` call.
- [x] **shared** — The CI `native-release.yml` lane remains the producer for `win32-x64`/`ios-simulator-arm64`; this command does not claim a platform it did not build, and the header names that lane. — the workflow is untouched in this branch and its publish job still generates the full-cohort lock.
- [x] **local** — `pnpm release` (npm only, no `--yes`) stays a dry run, and `pnpm release --prepare` is unchanged. — native staging is gated on `willCreateNativeRelease = publish && !allowMissingPrebuilt`, both early returns precede it, and `scripts/__tests__/release.spec.ts` stays green.

## Prior work retained

None. New PRD; it amends the manifest contract introduced by PRD-262 and leaves that PRD's published contents and the CI release lane intact.
