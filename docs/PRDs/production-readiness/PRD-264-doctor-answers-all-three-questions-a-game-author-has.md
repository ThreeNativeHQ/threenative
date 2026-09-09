---
prd_contract: v1
---

# PRD-264 — Doctor reports the actual consumer prerequisites and limits

**Status:** PARTIAL — existing transport/tool probes retained; readiness semantics reopened. Revised 2026-09-08; planning only.
**Complexity:** 7 → HIGH (+2 files, +2 multi-package, +2 target/prerequisite state, +1 external tool probes).
**Problem:** A developer can see a target described as available because its packager exists while downloads, UI, signing or SDK prerequisites prevent the intended build.

Batch contract and dependency order: [production-readiness](README.md). Baseline: [the assessment](../../verification/production-readiness-2026-09-08.md), source `912a567e3e7592e6b437e49fe6318a3987d1f7c1`. iOS is outside this batch; no iOS readiness credit is created or removed.

## Integration ledger

| # | New or revised thing | Live caller at planning time | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | Target-scoped prerequisite diagnosis | packages/create-threenative/src/threenative.ts: runDoctorCommand → diagnoseProject | target availability inferred from installed script | Existing doctor aggregation delegates to same requirements as build | Absent runtime download/JDK makes requested target non-success |
| 2 | Authoring/application prerequisites | packages/create-threenative/src/doctor.ts:427 probeMcpServer; :634 androidToolchainStatus | config-present means all tooling usable | Common server/probe definitions remain sole source | Missing Blender binary with live MCP transport cannot claim conversion ready |

## Current behavior and ownership

Published doctor correctly initialized three MCPs and caught the runtime 404, Linux overlay failure and unsupported JDK. It still described Android as available with a prerequisite warning. Current source adds Blender probing. A successful build-tool probe must not become a store-ready claim.

Engine developer-tool layer. Owns actionable diagnosis only; [PRD-196](../BLOCKED/requires-release-credentials/PRD-196-published-install-is-functional.md) repairs installation, [PRD-217](PRD-217-webview-ui-layer.md) repairs UI, [PRD-212](PRD-212-published-install-builds-android.md) supplies Android requirements and [PRD-365](PRD-365-consumer-desktop-distribution.md) supplies desktop distribution requirements. Doctor never installs external tools, changes keys or fabricates proof.

## Approach and boundaries

Keep `doctor` as the existing CLI command and reuse runtime install status, build/config validation, the common MCP table and playtest doctor delegation. Add **proposed** optional `--target web|desktop|android` and `--mode debug|release` only to scope prerequisite diagnosis to the intended operation. Preserve legacy unscoped output. Report separate installed/configured/probed/buildable/verified facts in existing check details; do not introduce a second release gate or require iOS on a non-iOS task.

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

### Phase 1 — Doctor predicts the requested build prerequisite failure

**Files (maximum five):**

- EDIT `packages/create-threenative/src/threenative.ts` — validate target/mode arguments and pass scoped request.
- EDIT `packages/create-threenative/src/doctor.ts` — derive requirements from build/runtime evidence.
- EDIT `packages/create-threenative/__tests__/doctor.spec.ts` — scoped target failure semantics.
- EDIT `packages/create-threenative/__tests__/cli.spec.ts` — doctor argument validation.
- NEW `docs/verification/prd-264-readiness-phase-1-<date>.md` — commands, identities, red/green and reviewer decision.

**Implementation and wiring:** For the requested target/mode, missing binary, overlay capability, supported SDK/JDK or signing prerequisite must prevent a buildable/ready result. A configured but unexecuted store upload is PENDING evidence, not an install prerequisite failure. Reuse PRD-212/365 mode semantics and preserve debug builds without signing keys. Runtime manifest lookup must retain bounded timeout/error status. Do not edit/read engine source as a consumer requirement.

**Required test:** `packages/create-threenative/__tests__/doctor.spec.ts`: should fail the requested Android release prerequisite check when the JDK or runtime artifact is missing; should not require iOS for an Android request.

**Observed-red / revert control:** Give doctor a present packager but HTTP404 runtime status and JDK26, then restore supported inputs. Verify non-success followed by correct buildable status; substitute absent signing for release-only red.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts packages/create-threenative/__tests__/cli.spec.ts
# PROPOSED, in the installed game after this phase:
pnpm exec threenative doctor --target android --mode release --text
```

**User verification:** The user receives one concrete cause/path/fix for the intended target. It does not advise pointing at an installed runtime package as a source checkout or imply a warning is a successful release.

### Phase 2 — Tool discovery explains external applications and editor setup

**Files (maximum five):**

- EDIT `packages/create-threenative/src/doctor.ts` — separate MCP transport and tool prerequisites.
- EDIT `packages/create-threenative/__tests__/doctor.spec.ts` — Blender/config/script-policy controls.
- EDIT `packages/create-threenative/README.md` — document exact game-only repair actions.
- NEW `docs/verification/prd-264-readiness-phase-2-<date>.md` — commands, identities, red/green and reviewer decision.

**Implementation and wiring:** Keep real transport probing from earlier work. Derive current required servers from core table. Distinguish server installed, config loaded by a supported editor, external Blender executable present, and operation executed. Show commands for missing prerequisites without modifying global configuration or silently installing applications. Preserve malformed/unwritable config and report the exact file. Document hosts that need manual global setup.

**Required test:** `packages/create-threenative/__tests__/doctor.spec.ts`: should report conversion unavailable when the Blender MCP starts but Blender is missing; should preserve malformed user config while reporting a repair location.

**Observed-red / revert control:** Remove Blender from the probe path while keeping its server bundle and remove one declared MCP entry separately; diagnostics must change and not claim a complete authoring toolchain.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts
# In the installed game:
pnpm exec threenative doctor --text
```

**User verification:** Run in the game root with and without Blender; inspect actual editor tool discovery through PRD-196. Tool package installation and external app installation remain distinct.

## Verification contract

Each phase edits its named pre-existing caller and includes the phase evidence record within the five-file budget. File lists are bounded implementation assignments, not permission for adjacent cleanup. If investigation needs more files, split the phase before implementing; do not silently widen it. Query `engine_search_capabilities` and inspect every hit before any qualifying package/helper work, as the repository requires.

Run the phase command, its observed-red control, restore the implementation and rerun green. Record exact candidate SHA, package versions/integrities, source and artifact hashes, platform/adapter/session, command, exit code, assertion count and artifact paths. A missing observation, skipped test, stale artifact or zero-assertion run is not PASS. Fixtures/local tarballs may prove mechanics; public-consumer acceptance requires registry packages and public runtime downloads with no engine checkout, source override or injected manifest.

For executable changes run `pnpm typecheck && pnpm lint && pnpm test`, `pnpm budgets`, and the affected real playtest/platform lane. Generate mirrors with `pnpm sync:agents` if AGENTS changes. Use platform-specific hosted runs for Windows/macOS, emulators for Android behavior, and physical Android only for claims that require hardware. Name unexecuted targets. A runtime change needs a real playtest scenario in the same implementation, not only the focused tests named below.

After every phase, an independent reviewer receives this PRD, diff, commands and artifacts and returns PASS / NEEDS CORRECTION / BLOCKED. It checks caller integration, negative controls, removed/delegating incumbent paths and the actual consumer outcome. No phase starts on a self-awarded PASS. Visual phases also require human inspection of captures; credentialed signing/submission and external-person checkpoints remain PENDING until executed. Do all authorized preparation before requesting any missing external authorization. This planning request does not authorize publishing packages, uploading to stores or contacting external people.

## Verification evidence

No implementation gate was run by this planning revision. Every new phase is **NOT RUN**. Write each phase to `docs/verification/prd-<id>-readiness-phase-<n>-<date>.md` (the evidence file listed in each phase); use the existing runtime performance ledger for new performance measurements. Fill actual results and non-test `file:line` callers at implementation time; a phase cannot close with placeholders. Acceptance boxes below remain unchecked until all phase checkpoints pass.

## Acceptance criteria

- [ ] The requested build target/mode cannot appear ready when a required download, SDK/JDK, UI runtime or signing prerequisite is missing.
- [ ] Doctor shares the build/config/runtime sources of truth and remains useful without engine source.
- [ ] MCP transport success is distinguished from external Blender availability, editor activation and actual operation proof.
- [ ] Unscoped doctor remains compatible; non-iOS target checks do not demand iOS evidence.
- [ ] Malformed inputs and missing observations fail honestly; documents name only flags implemented by these phases.

## Prior work retained

Moved from `docs/PRDs/done/PRD-264-doctor-answers-all-three-questions-a-game-author-has.md` under the owner's 2026-09-08 instruction. This revision replaces the execution scope, not historical test results. [Original plan at the assessed commit](https://github.com/ThreeNativeHQ/threenative/blob/912a567e3e7592e6b437e49fe6318a3987d1f7c1/docs/PRDs/done/PRD-264-doctor-answers-all-three-questions-a-game-author-has.md) remains the immutable history. The original completed transport/toolchain probes are retained. Only target/readiness semantics and the current four-server consumer experience need additional work.

Historical evidence: [doctor-2026-08-29](../../verification/doctor-2026-08-29.md).
