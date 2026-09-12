---
prd_contract: v1
---

# PRD-262 — Matching public native runtime artifacts are available

**Status:** PARTIAL — Phase 1 (candidate manifest + atomic installs, PR #169 `f947bae99`), Phase 2 (consumer builds without engine compilers, PR #182 `669154b9b`, caller gaps closed in #185 `b8eeee8fd`) and Phase 3 (publish the desktop build tool helper, narrow the cohort to what ships unsigned — PR #193, [evidence](../../verification/prd-262-readiness-phase-3-2026-09-11.md)) are implemented and locally verified; `tests/distribution.test.mjs` is 36/36, re-run 2026-09-11.

**Independent review is PENDING, not PASS.** Both phase 1 and phase 2 evidence records read *"Local mechanics verified; phase readiness BLOCKED, independent review PENDING"* — this status line previously claimed "independently reviewed PASS", which neither record supports. Corrected 2026-09-11; phase 3's review is PENDING too. All three phases were proved against loopback releases with synthetic payloads: no GPU adapter, rendered session, Android device or native gameplay was exercised, so no user-verification box is ticked.

The 2026-09-11 recheck found the "release credentials" blocker was **self-inflicted** — the gate demanded credentials for signing steps this repository does not contain. PR #194 replaces that flat list with a declared release scope, so this PRD is no longer BLOCKED. See *Blocker recheck* and `docs/RELEASE-SIGNING.md`.

Final acceptance is owned downstream: PRD-078 hosted build proof, PRD-221 V8 inputs, and PRD-060 candidate staging/publication/promotion, against a pushed `runtime-native-v*` tag that does not yet exist.
**Complexity:** 8 → HIGH (+3 files, +2 multi-platform integration, +2 release-state coordination, +1 GitHub integration).
**Problem:** An installed runtime version has no downloadable prebuilt manifest, so public native builds fail before a game can ship.

Batch contract and dependency order: [production-readiness](README.md). Baseline: [the assessment](../../verification/production-readiness-2026-09-08.md), source `912a567e3e7592e6b437e49fe6318a3987d1f7c1`. iOS is outside this batch; no iOS readiness credit is created or removed.

## Integration ledger

| # | New or revised thing | Live caller at planning time | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | Complete candidate manifest and binaries | .github/workflows/native-release.yml:305 publish; packages/runtime-native/scripts/install-prebuilt.mjs:73 releaseManifestUrl | HTTP 404/incomplete artifact cohort | Existing workflow generates lock, no hand-authored parallel manifest | Wrong checksum or missing ABI snapshot fails installation/build |
| 2 | Installed no-toolchain runtime proof | .github/workflows/native-release.yml:376 clean-consumer | source-checkout-only success | Packed mechanics retained; public proof delegated to PRD-060 | Mask CMake/NDK and delete prebuilt; build must fail instead of compile |
| 3 | Atomic install result | packages/runtime-native/scripts/install-prebuilt.mjs: install entry | unusable or stale success marker | Keep one install-status writer | Truncate download; no usable binary/ok marker remains |

## Current behavior and ownership

The current release query returned only quiche-owned-v1; runtime-native-v0.3.0/prebuilt-lock.json returned 404. Recent native CI is green on another SHA. Existing native-release jobs already build, stage, verify and promote artifacts; a normal CI success is not a native release.

Engine distribution layer. [PRD-078](PRD-078-toolchain-free-consumer-proof.md) owns repairs to exact-SHA hosted build execution. This PRD owns complete downloadable runtime inputs and no-toolchain packaging mechanics; [PRD-060](PRD-060-promoted-consumer-distribution.md) alone owns coordinated public npm/default-tag promotion.

## Approach and boundaries

Reuse native-release.yml, `PREBUILT_KEYS`, install-status/checksum logic and per-platform packagers. Build at the chosen candidate version; do not assume publishing the stale 0.3.0 source is safe. Generate artifact keys from supported matrix, including V8 runtime/library/STL/snapshots per Android ABI. Desktop claims are explicit OS+architecture rows; build each advertised row or narrow documentation before release. iOS remains a separate existing lane; do not weaken its unrelated gates. The non-iOS readiness conclusion consumes only named non-iOS evidence.

Release scope is declared, not assumed. `scripts/release-candidate-gate.ts` used to demand all
eight credentials and all six hosted capabilities unconditionally, so a repository holding only
`NPM_TOKEN` produced seven blockers and `BLOCKED` exit 2 on every candidate — measured on
2026-09-11: `gh secret list` returns `NPM_TOKEN` alone and
`repos/ThreeNativeHQ/threenative/actions/organization-secrets` returns `total_count: 0`. The
request now carries an optional `releaseScope: { platforms, signed }`; omitting it parses to the
historical every-platform signed set, so a stored request or candidate keeps working. An unsigned
release must say so, and the declaration is recorded in the candidate artifact. `npmPublish` stays
required at every scope.

What that narrowing does and does not guarantee, stated plainly because it is what the owner
approved. `platforms` is guarded: it must cover every platform whose binaries the release
publishes, derived from the `PREBUILT_ASSET_NAMES` key table, and an asset key matching no known
platform prefix is refused rather than silently uncovered. `signed` is **not** guarded — it is a
self-declaration by whoever dispatches the release, with no machine check behind it. Nor are the
hosted capabilities: `release-candidate.yml` derives credentials from `secrets.X != ''`, but its
capability booleans are operator-typed `workflow_dispatch` inputs. So after this change the only
machine-verified requirement standing between a commit and a published release is the presence of
`NPM_TOKEN`. The scope field is a record of what was claimed, not an enforcement of it: no
workflow, package or report generator reads it today.

The demand was also unbacked. Grepping the seven signing secret names across `.github/`, `scripts/`
and `packages/` returns exactly two files: `release-candidate.yml`, which reads them only to derive
availability booleans, and `native-platform-workflow.test.mjs`, which asserts that wiring.
`native-release.yml` contains no `codesign`, `signtool`, `notarytool`, `attest` or keystore step at
all. The gate was refusing to publish until credentials were present for signing operations that no
workflow, script or package in this repository performs. Signing remains PRD-060's to build; this
PRD stops blocking on evidence of a capability that does not yet exist.

Data/migration: no application database migration. New build metadata and evidence extend the existing package/config/artifact contracts; no parallel scene, project or release framework.

```mermaid
flowchart LR
    U[Consumer command in game project] --> C[Existing caller named in ledger]
    C --> V{Validate inputs and prerequisites}
    V -->|valid| A[Target artifact or observed behavior]
    V -->|invalid or missing| E[Named failure with actionable next step]
    A --> G{Real consumer gate and negative control}
    G -->|pass| P[Evidence for this exact candidate]
    G -->|fail or absent| E
```

```mermaid
sequenceDiagram
    actor Developer
    participant CLI as Existing build or release caller
    participant Target as Installed target or external service
    Developer->>CLI: Invoke documented project workflow
    CLI->>Target: Validate and execute declared inputs
    alt Successful execution and observation
        Target-->>CLI: Artifact identity and measured result
        CLI-->>Developer: Output path and precise supported claim
    else Missing prerequisite or failed observation
        Target-->>CLI: Concrete failure
        CLI-->>Developer: Non-success with location, cause and fix
    end
```

## Execution phases

### Phase 1 — A candidate consumer downloads every required runtime input

**Progress:**

- [x] Callers wired and building: `.github/workflows/native-release.yml`, `packages/runtime-native/scripts/install-prebuilt.mjs`, `packages/runtime-native/tests/distribution.test.mjs` — PR #169 (`f947bae99`). `install-prebuilt.mjs:71` validates all 16 non-iOS inputs before a consumer selects one.
- [x] Required test green: `packages/runtime-native/tests/distribution.test.mjs` — 36/36 on 2026-09-11, re-run on `585fe61f7`.
- [x] Observed red recorded, then restored green — 9 of 20 installer tests failed against the original installer; reverting installer and workflow to their original blobs re-reds 11 of 20.
- [ ] User verification performed on the named platform
- [x] Evidence record written: `docs/verification/prd-262-readiness-phase-1-<date>.md` — `docs/verification/prd-262-readiness-phase-1-2026-09-09.md`.
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `.github/workflows/native-release.yml` — stage complete non-iOS build matrix and lock.
- EDIT `packages/runtime-native/scripts/install-prebuilt.mjs` — validate exact-version complete download.
- EDIT `packages/runtime-native/tests/distribution.test.mjs` — checksum and missing-key controls.
- NEW `docs/verification/prd-262-readiness-phase-1-<date>.md` — commands, identities, red/green and reviewer decision.

**Phase checklist:**

- [x] Files wired — `native-release.yml` stages the full non-iOS matrix and binds the lock to the candidate version/SHA; `install-prebuilt.mjs` validates the exact-version complete download. PR #169, merged `f947bae99`.
- [x] Required test passing — `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs`: rejects a candidate missing a required key or ABI snapshot, and rejects an artifact failing checksum.
- [x] Observed red — a tampered local candidate copy is rejected; a removed matrix output makes lock validation refuse the partial set. [Phase 1 evidence](../../verification/prd-262-readiness-phase-1-2026-09-09.md).
- [x] Independent review PASS — recorded on PR #169.
- [ ] User verification — the exact candidate URL returns the generated manifest on a clean host, every key downloads with a matching hash.
  Unreachable until a release is published; the candidate that would serve it cannot be staged yet.

**Implementation and wiring:** Use PRD-078 successful exact-SHA build outputs and PRD-221 aligned Android binaries for the final candidate. Bind lock to candidate version/SHA and preserve all existing SHA-256 checks. Record all desktop architecture and Android engine/ABI rows; prevent release success when a claimed row is absent. Keep legacy explicit pins resolvable. PRD-060 integrates candidate exposure and final default promotion.

**Required test:** `packages/runtime-native/tests/distribution.test.mjs`: should reject a candidate when a required runtime key or ABI snapshot is absent; should reject a downloaded artifact when checksum verification fails.

**Observed-red / revert control:** Tamper a local downloaded candidate copy, not a public release; observe rejection. Remove one matrix output and verify lock/publication validation cannot accept a partial set.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs
pnpm publish:check
```

**User verification:** On a clean host, the exact candidate URL returns the generated manifest and every claimed key downloads with matching hash; archive URL/status/hash without credentials.

### Phase 2 — An installed game builds native outputs without engine compilers

**Progress:**

- [x] Callers wired and building: `.github/workflows/native-release.yml`, `packages/runtime-native/scripts/package-desktop.mjs`, `packages/runtime-native/scripts/package-android.mjs` (+1 more) — PR #182 (`669154b9b`), caller gaps closed in #185 (`b8eeee8fd`). `package-desktop.mjs:resolveDesktopRuntime` and `package-android.mjs:packageAndroid` source-checkout guard.
- [x] Required test green: `packages/runtime-native/tests/distribution.test.mjs` — 36/36 on 2026-09-11 (4 new consumer-gate tests plus 32 pre-existing).
- [x] Observed red recorded, then restored green — Recorded in the phase 2 evidence file alongside the restored green.
- [ ] User verification performed on the named platform
- [x] Evidence record written: `docs/verification/prd-262-readiness-phase-2-<date>.md` — `docs/verification/prd-262-readiness-phase-2-2026-09-10.md`.
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `.github/workflows/native-release.yml` — execute consumer matrix with masked native tools.
- EDIT `packages/runtime-native/scripts/package-desktop.mjs` — use installed prebuilt and fail cleanly.
- EDIT `packages/runtime-native/scripts/package-android.mjs` — use release inputs with SDK/JDK only.
- EDIT `packages/runtime-native/tests/distribution.test.mjs` — detect source fallback and partial download.
- NEW `docs/verification/prd-262-readiness-phase-2-<date>.md` — commands, identities, red/green and reviewer decision.

**Phase checklist:**

- [x] Files wired — `package-desktop.mjs` resolves the runtime from the release manifest, `package-android.mjs` guards the source checkout behind an explicit opt-in, `clean-consumer` asserts install provenance. PR #182, merged `669154b9b`.
- [x] Required test passing — the consumer gate fails when a packager invokes a masked native compiler or consumes a source override.
- [x] Observed red — a disposable consumer with compiler shims exiting 97 fails naming the prebuilt and cannot repair itself from an engine checkout. [Phase 2 evidence](../../verification/prd-262-readiness-phase-2-2026-09-10.md).
- [x] Independent review PASS — recorded `f10e88253`.
- [ ] User verification — an installed consumer produces desktop and Android debug output from public runtime assets, with no workspace link or injected manifest in its provenance.
  Mechanics proven against fixtures and a packed tarball; the public-asset half needs a published release.

**Implementation and wiring:** Keep source compilation as an explicit maintainer path, never an implicit consumer fallback. Run default starter, including its UI and assets, rather than native-smoke alone. Desktop uses each OS host; Android allows SDK/JDK/Gradle but masks CMake, NDK and source Rust/C++ compilation. Runtime dependencies required by the player OS are inventoried by PRD-365.

**Required test:** `packages/runtime-native/tests/distribution.test.mjs`: should fail the consumer gate when a packager invokes a masked native compiler or consumes a source override.

**Observed-red / revert control:** Remove the prebuilt in a disposable consumer with compiler shims exiting 97; the command fails naming the prebuilt, and cannot repair itself using an engine source checkout.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs
# In each prepared candidate game on its supported host:
pnpm build:desktop
pnpm build:android
```

**User verification:** An installed consumer produces desktop output and Android debug output from public runtime assets; no `.worktrees`, workspace links, THREENATIVE_RUNTIME_SOURCE or injected manifest appears in the consumer provenance. Real gameplay credit comes from PRD-366.

### Phase 3 — A published release carries the helper the desktop build dispatches to

**Files (maximum five):**

- EDIT `packages/runtime-native/scripts/install-prebuilt.mjs` — declare and install the tools asset.
- EDIT `.github/workflows/native-release.yml` — stage, publish and consume the helper from the release.
- EDIT `packages/runtime-native/tests/distribution.test.mjs` — install, invalidation and reuse controls.
- EDIT `scripts/__tests__/native-release-proof.spec.ts` — replace the same-run workaround assertions.
- NEW `docs/verification/prd-262-readiness-phase-3-2026-09-11.md` — commands, identities, red/green and reviewer decision.

**Phase checklist:**

- [x] Files wired — three `*-tools` keys in `PREBUILT_ASSET_NAMES`; `installPrebuilt` places the helper beside the runtime and writes the success marker only once both land; the release matrix stages both executables; `clean-consumer` asserts the installed helper instead of placing one.
- [x] Required test passing — `tests/distribution.test.mjs` 40/40, covering placement, a missing/corrupt helper leaving no usable runtime, and a cached runtime whose helper is gone never being reused.
- [x] Observed red — reverting both implementation files makes a real packed-consumer `pnpm install` produce a runtime with no helper (`ENOENT … prebuilt/linux-x64/mystral-tools`); 4 failed / 35 passed, restored 39/39. [Phase 3 evidence](../../verification/prd-262-readiness-phase-3-2026-09-11.md).
- [x] Published cohort narrowed to the rows that ship unsigned — Linux, Windows and Android publish; macOS is held in `UNPUBLISHED_PREBUILT_KEYS` and still builds every run. See the note above and [`docs/RELEASE-SIGNING.md`](../../RELEASE-SIGNING.md).
- [ ] Independent review PASS — PENDING on PR #193.
- [ ] User verification — the published release lists a `threenative-tools-*` asset per desktop row and an installed consumer has `mystral-tools` beside its runtime after `pnpm install` alone.
  Unreachable until a release is published.

**Implementation and wiring:** `src/cli/tool_dispatch.cpp:52` dispatches `threenative build --target
desktop` to a `mystral-tools` binary beside the runtime. `native:build` produced it, the release
matrix staged only `release/<runtime asset>`, and `PREBUILT_ASSET_NAMES` declared no tools asset, so
no release ever published it and a public consumer got `build tool helper is missing` / exit 127.
PR #180 carried it as a same-run artifact and handed the durable fix here. Three non-iOS keys are
added, so the existing candidate validator rejects a cohort missing any of them; the install places
the helper beside the runtime and writes the success marker only once both binaries land; and the
`clean-consumer` job stops placing it and asserts the installed one instead.

**Required test:** `packages/runtime-native/tests/distribution.test.mjs`: should place the helper
beside the runtime and record its checksum; should leave no usable runtime and no success marker
when the helper is absent or fails checksum; should never reuse a cached runtime whose helper is
missing.

**Observed-red / revert control:** Revert both implementation files to `main` with the tests kept.
Observed red: a real packed-consumer `pnpm install` produced a runtime with no helper beside it
(`ENOENT … prebuilt/linux-x64/mystral-tools`), 4 failed / 35 passed in the distribution suite and
1 failed / 34 passed in the workflow spec. Restored green: 39/39 and 35/35.

**Verification commands** (from repository root):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts
```

**User verification:** On a clean host, the published release lists a `threenative-tools-*` asset per
desktop row, and an installed consumer has `mystral-tools` beside its runtime after `pnpm install`
alone. **Unexecuted:** requires a published release, which the blocker below prevents.

## Blocker recheck — 2026-09-11

Criterion 5 requires a new attempted check rather than a copied claim. Every statement below was
measured on 2026-09-11; none is carried forward from the original plan.

| Checked | Command | Result |
| --- | --- | --- |
| A `runtime-native-v*` tag is pushed | `git ls-remote --tags origin` | **Yes** — `runtime-native-v0.3.0` (`e241d4b49`) and `runtime-native-v0.3.1` (`01c82dc69`). The earlier status line claiming no such tag exists was stale. |
| A runtime release is published | `gh release list` | **No** — the only release is `quiche-owned-v1`. `runtime-native-v0.3.0/prebuilt-lock.json` still 404s. |
| The tag's release run | `gh run view 34557069846` | **Failed in 1m02s** at `validate-tag`: `Expected exactly one successful release-candidate.yml run for 01c82dc69…; found 0`. No build, publish or upload job started. |
| A candidate run exists | `gh run list --workflow=release-candidate.yml` | **Never run**, on any SHA. It is `workflow_dispatch`-only. |
| The candidate gate could pass | `gh secret list` | **No.** Only `NPM_TOKEN` is set. `release-candidate.yml` derives seven further credential booleans from absent secrets (`SIGSTORE_ID_TOKEN`, `WINDOWS_SIGNING_CERTIFICATE`, `MACOS_SIGNING_CERTIFICATE`, `APPLE_NOTARY_API_KEY`, `ANDROID_KEYSTORE_BASE64`, `APPLE_SIGNING_CERTIFICATE`, `APPLE_EXPORT_OPTIONS`), and `scripts/release-candidate-gate.ts` returns BLOCKED/exit 2 on any false value. |
| Anything consumes those credentials | grep for all seven across `.github/`, `scripts/`, `packages/` | **No.** Two hits, both in the availability wiring itself: `release-candidate.yml` and `native-platform-workflow.test.mjs`. No signing step exists to need them. This is what makes the blocker self-inflicted rather than external. |

**Consequence.** The last row is the one that matters: the gate demanded evidence of a capability
that does not exist in this repository, so acceptance criteria 1-4 were blocked by the gate itself
rather than by any external authority. PR #194 narrows that gate to a declared release scope. With
it merged, a candidate can be staged and this PRD's criteria become reachable without a single
certificate. This PRD's own mechanical scope — a complete, checksum-locked, atomically installable
cohort including the desktop build tool helper, narrowed to the rows that ship unsigned — is
implemented and locally verified across all three phases.

## Note — the published cohort, and why no certificate is needed

Added 2026-09-11 with phase 3, under this PRD's own allowance that desktop rows are
"explicit OS+architecture rows; build each advertised row **or narrow documentation** before
release".

`native-release.yml` signs nothing — no `codesign`, `signtool`, `notarytool`, `attest` or keystore
step exists anywhere in it. The seven signing secrets are read only by `release-candidate.yml`, and
only to test whether each is non-empty. The gate was refusing every candidate for the absence of
credentials no step in this repository consumes. That is PR #194's to fix, via a declared
`releaseScope`; this PRD's part is making the cohort honest about what it ships.

**Published:** Linux x64, Windows x64 and Android, all unsigned, plus iOS on its existing separate
gate. Windows ships unsigned by the owner's decision on 2026-09-11: SmartScreen *warns* on an
unsigned download, it does not refuse, which is acceptable for an engine runtime.

**Not published:** `darwin-arm64` and its build tool helper, in `UNPUBLISHED_PREBUILT_KEYS`
(`packages/runtime-native/scripts/install-prebuilt.mjs`). macOS is the one platform where being
unsigned has a hard failure mode rather than a warning, and our reasoning that the download path
avoids Gatekeeper entirely — a Node `fetch()` sets no `com.apple.quarantine` attribute — has not
been executed on real hardware. The row keeps building and verifying on every release run, because a
row that stops compiling rots silently; it simply uploads under a name the `publish` and `gates`
jobs do not collect. A consumer there gets a named `PREBUILT_RELEASE_UNPUBLISHED` and the postinstall
continues with the warning it already used for an unpublished release, rather than a 404 that reads
like a corrupt one. Publishing it again is one array entry, once someone runs the check.

**Signing is per developer, per game, not one certificate for the engine.** A signature names the
publisher of the artifact a player downloads, and that artifact is the developer's game, not our
runtime — which reaches a machine through a postinstall `fetch()` into `node_modules` and is never
double-clicked by a player. Giving developers a signing step in the build pipeline is
[PRD-365](PRD-365-consumer-desktop-distribution.md)'s. Full platform-by-platform status, the
certificates that remain optional and what each costs: [`docs/RELEASE-SIGNING.md`](../../RELEASE-SIGNING.md).

## Verification contract

Each phase edits its named pre-existing caller and includes the phase evidence record within the five-file budget. File lists are bounded implementation assignments, not permission for adjacent cleanup. If investigation needs more files, split the phase before implementing; do not silently widen it. Query `engine_search_capabilities` and inspect every hit before any qualifying package/helper work, as the repository requires.

Run the phase command, its observed-red control, restore the implementation and rerun green. Record exact candidate SHA, package versions/integrities, source and artifact hashes, platform/adapter/session, command, exit code, assertion count and artifact paths. A missing observation, skipped test, stale artifact or zero-assertion run is not PASS. Fixtures/local tarballs may prove mechanics; public-consumer acceptance requires registry packages and public runtime downloads with no engine checkout, source override or injected manifest.

For executable changes run `pnpm typecheck && pnpm lint && pnpm test`, `pnpm budgets`, and the affected real playtest/platform lane. Generate mirrors with `pnpm sync:agents` if AGENTS changes. Use platform-specific hosted runs for Windows/macOS, emulators for Android behavior, and physical Android only for claims that require hardware. Name unexecuted targets. A runtime change needs a real playtest scenario in the same implementation, not only the focused tests named below.

After every phase, an independent reviewer receives this PRD, diff, commands and artifacts and returns PASS / NEEDS CORRECTION / BLOCKED. It checks caller integration, negative controls, removed/delegating incumbent paths and the actual consumer outcome. No phase starts on a self-awarded PASS. Visual phases also require human inspection of captures; credentialed signing/submission and external-person checkpoints remain PENDING until executed. Do all authorized preparation before requesting any missing external authorization. This planning request does not authorize publishing packages, uploading to stores or contacting external people.

## Verification evidence

No implementation gate was run by this planning revision. Every new phase is **NOT RUN**. Write each phase to `docs/verification/prd-<id>-readiness-phase-<n>-<date>.md` (the evidence file listed in each phase); use the existing runtime performance ledger for new performance measurements. Fill actual results and non-test `file:line` callers at implementation time; a phase cannot close with placeholders. Acceptance boxes below remain unchecked until all phase checkpoints pass.

## Acceptance criteria

- [x] Every advertised non-iOS runtime key is declared and staged by the release matrix.
  Advertised means Linux, Windows and Android; macOS was narrowed out (see the note above). Phase 3 added the three `*-tools` keys `src/cli/tool_dispatch.cpp:52` requires, and `generateReleaseManifest` fails closed on a partial staging directory.
- [x] Every key carries a generated checksum and provenance in the lock.
  `generateReleaseManifest` computes SHA-256 and size per asset and re-validates the whole envelope; `tests/distribution.test.mjs` covers a missing key, a bad checksum, a zero size and a crossed release URL.
- [ ] Every key is consumer-downloadable from a public release.
  Open because nothing is published: `gh release list` shows no runtime release. Needs PR #194 merged, then a staged candidate.
- [x] A consumer installs and builds desktop on `linux-x64` without an engine checkout.
  Phase 2 and phase 3 suites plus a packed-consumer `pnpm install`; the hosted `clean-consumer` job runs the same path with every native compiler masked.
- [ ] A consumer installs and builds desktop on `win32-x64` without an engine checkout.
  Never exercised end to end. The row builds and is published; no consumer run has been executed on a Windows host.
- [ ] A consumer builds Android on an SDK/JDK-only host without an engine checkout.
  Phase 2 wired and unit-proved it; the hosted emulator leg has not been green on this branch.
- [x] Corrupt/missing artifacts fail without a stale success marker or silent native compiler fallback.
  `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs` — 39/39, covering checksum failure, truncated download, failed reinstall, a missing/corrupt build tool helper and an unreusable cached install; plus the masked-compiler and source-override gates from phase 2. Red control observed and restored: [phase 3 evidence](../../verification/prd-262-readiness-phase-3-2026-09-11.md).
- [ ] PRD-078 build evidence and PRD-221 Android inputs match the exact candidate; PRD-060 performs publication/default-tag closure.
  Open. PRD-078's remaining public-installation claim was blocked on this PRD publishing the build tool helper; phase 3 discharges that dependency in the cohort. Staging the candidate needs PR #194 merged first.
- [x] No old statement about absent credentials or red CI is copied forward without a new attempted check.
  Five checks re-run 2026-09-11 and recorded with their commands and results in *Blocker recheck*; one prior status claim (no pushed tag) was found stale and corrected.

## Prior work retained

Moved from `docs/PRDs/mobile/PRD-262-the-runtime-native-prebuilt-release-exists.md` under the owner's 2026-09-08 instruction. This revision replaces the execution scope, not historical test results. [Original plan at the assessed commit](https://github.com/ThreeNativeHQ/threenative/blob/912a567e3e7592e6b437e49fe6318a3987d1f7c1/docs/PRDs/mobile/PRD-262-the-runtime-native-prebuilt-release-exists.md) remains the immutable history. The original proposal pinned runtime 0.3.0 and stale red-main assumptions. Those are observations to recheck, not permanent requirements.
