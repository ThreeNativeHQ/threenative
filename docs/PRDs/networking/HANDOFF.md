# Networking delivery handoff

Recorded 2026-09-06 UTC. Start in the existing worktree below. **The feature is not finished: 13 of 39 execution rows are accepted; 26 remain open.** This is a continuation packet, not a completion report. The user requested this document so a cheaper AI can take over.

## Start here

~~~sh
cd /home/joao/projects/threenative/threenative-engine/.worktrees/networking-359
git status --short
git log -1 --oneline
gh pr checks 125
~~~

| Item | Authoritative location/state at handoff |
| --- | --- |
| Worktree | /home/joao/projects/threenative/threenative-engine/.worktrees/networking-359 |
| Branch | networking-359 |
| Local HEAD / remote `origin/networking-359` | 80c39b94 (required-mode implementation and executable regression); remote remains cd8fb8208a5857ed120562f890ba10f6c83a58e3 until the pending snapshot is reviewed and pushed |
| PR | [#125](https://github.com/ThreeNativeHQ/threenative/pull/125), OPEN, DRAFT |
| Goal | Execute the complete networking PRD, verify locally, obtain green CI, address review, squash merge, pull main, clean up safely |

Read [README.md](README.md), [EXECUTION.md](EXECUTION.md), [PROTOCOL.md](PROTOCOL.md), [SANDBOX.md](SANDBOX.md), and the linked PRD. The execution ledger contains exact source ownership, acceptance tests, platform requirements, and proof-runner contracts. It outranks this condensed handoff when more detail is needed. Do not substitute the already implemented native transport for the full requested multiplayer feature.

Read the repository AGENTS.md and closest package instructions before edits. Do not edit the main checkout. Do not search other worktrees. Local artifact paths below are relative to this worktree; they are ignored and will not travel with a Git clone. Preserve this machine/worktree until their useful evidence has been recorded in tracked documents.

## User instructions and model routing

1. Use the token-saving-swarm skill at /home/joao/.codex/skills/token-saving-swarm/SKILL.md. The user authorized the complete PR/CI/merge/pull flow and asked to preserve Astra tokens. Keep coordination and final review compact; delegate bounded execution with explicit file ownership.
2. Luna max was requested for bounded work, but the latest Luna worker failed with a usage limit until September 11, 2026, 4:47 PM. Opus medium was allowed, but its latest invocation also hit a session limit. Recheck availability before retrying; do not loop on quota failures.
3. The user explicitly authorized crouter for medium/high-complexity work. /home/joao/.local/bin/crouter wraps Claude Code with meta/muse-spark-1.3-contributor. Two sessions completed successfully below. Verify actual model, is_error, permission_denials, and command evidence; a worker's success paragraph is not acceptance.
4. Networking must be covered by CI and discoverable through the shipped engine capabilities MCP and authoring instructions. Real installed-process/tarball discovery is required, not only a JSON entry or workspace test. Only iOS qualification is deferred; its implementation is still required.
5. Preserve the full scope. Do not ask for approval already granted, bypass hooks, publish incomplete dependency releases, or merge the draft before all required acceptance criteria are proved. The original goal remains active, neither complete nor blocked.

## Next five actions

1. Review the complete uncommitted snapshot, run combined repository gates, refresh evidence, commit and push the reviewed CI/Windows changes. The required-mode slice is committed at 80c39b94 and does not close all of Task 3a. Windows and dependency CI rows remain open until actual CI passes.
2. Review crouter's platform producer candidate, reconcile its manifest change with the release validator, and integrate only accepted work. The candidate reports an actual Android arm64 archive; root has independently checked its hash/layout/source pins, but the patched source checkout is not reusable. The known manifest incompatibility below must be fixed before publication.
3. Expand the owned dependency workflow to all nine targets, produce actual assets, publish only the complete validated release, then update downloader URLs/checksums and rebuild the normal installed host. Re-prove trusted numeric IPv4/IPv6 and certificate negatives against that host.
4. Continue the remaining EXECUTION.md rows through portable client/protocol, actual two-client game, metrics/scenarios, platform qualification, MCP/cold-package authoring proof, final review, green CI, merge and pull. Native transport plumbing alone is not delivery.

## Uncommitted work: preserve and finish

| Paths | Current state / remaining action |
| --- | --- |
| .github/workflows/build-quiche-owned.yml; packages/runtime-native/scripts/validate-quiche-release.py; test-validate-quiche-release.py; test-quiche-workflow.py | Four new integrated files. Fresh review accepted them, including their actual integrated paths. Validator 18/18 and workflow 9/9 pass locally. Actual GitHub workflow has not run because these files are not pushed. |
| packages/runtime-native/tests/webtransport_wire_test.cpp | Six-line NOMINMAX guard before its first quiche include. Reviewed; Linux V8 and QuickJS wire tests pass. Windows CI rerun pending. |
| packages/runtime-native/CMakeLists.txt; packages/runtime-native/tests/native-contract-lane.test.mjs | Committed together in 80c39b94. The regression executes the extracted real decision block for required+missing, optional+missing, required+present, WebTransport-disabled and quiche-disabled modes, plus a neutered-refusal control. Focused Vitest is 9/9. Limitation: `project(NONE)` fixture and dummy artifacts prove configure selection, not linking. |
| docs/PRDs/networking/EXECUTION.md; docs/verification/native-coverage-2026-08-28.md; docs/verification/prd-359-task1b-win32-2026-09-06.md; packages/runtime-native/docs/G1-desktop-host.md; new docs/verification/prd-359-quiche-ci-2026-09-06.md | Ledger, generated coverage, and local proof updates. Final combined gates, census, retention refresh and commit are pending. This HANDOFF.md is also new. |

The last full suite/typecheck/lint/budgets pass belongs to the earlier cd8fb820 precursor snapshot. Do not claim those runs cover the new workflow, new CMake mode, or final wire-test fix. Source/CMake edits after coverage may stale its fingerprint; let budgets identify this and regenerate honestly. The required-mode focused test was independently rerun at 80c39b94; the full combined gates remain pending.

## Windows CI: exact failure and repair

The first pushed fix defined NOMINMAX before quiche.h in production webtransport.cpp. Windows subsequently compiled the runtime successfully, then failed the wire-test translation unit because that test includes quiche.h before textually including webtransport.cpp.

Current failed job: [101433502044, run 34013603832](https://github.com/ThreeNativeHQ/threenative/actions/runs/34013603832/job/101433502044), at HEAD cd8fb820. Local log: /tmp/prd359-win-cd8fb820-failed.log.

~~~text
FAIL threenative-webtransport-wire-test
webtransport.cpp(989): error C2589: '(' illegal token on right side of '::'
webtransport_wire_test.cpp(290): error C2589
~~~

The uncommitted repair adds the same guard at the test's own first include. Evidence:

| Check | Result / log |
| --- | --- |
| V8 wire rebuild and CTest | exit 0, 1/1; /tmp/prd359-win-wire-v8.log |
| QuickJS wire rebuild and CTest | exit 0, 1/1; /tmp/prd359-win-wire-quickjs.log |
| Actual old/new test first-include prefix, clang-cl preprocessing | old exit 1 with macro-leak error, repaired exit 0; artifacts/networking-359/task1b-win32/wire-red.log and wire-green.log |
| Native coverage after wire repair | exit 0; /tmp/prd359-ci-required-coverage.log |

The preprocessor probe uses SDK stand-ins. Its initial missing BaseTsd.h failure was a prerequisite error, not behavioral red. There is no local full Windows SDK proof. Fresh review accepted the include ordering, not a Windows green result. This is the second repair of this include-order issue; do not keep trying blind fixes if the next Windows run fails. Inspect the actual failing translation unit.

To get a completed job's log while the enclosing workflow still runs:

~~~sh
gh api --allow-escape-sequences repos/ThreeNativeHQ/threenative/actions/jobs/101433502044/logs > /tmp/prd359-win-cd8fb820-failed.log
~~~

## Required WebTransport build mode

Source option: TN_REQUIRE_WEBTRANSPORT=ON. It fails if TN_ENABLE_WEBTRANSPORT or MYSTRAL_USE_QUICHE disables transport, or if the selected library/header is missing. Optional mode keeps the existing refusing stub. This is engine qualification plumbing, not a game fix.

Read artifacts/networking-359/task3a-required-mode.md for the exact real configure commands and results. Existing source mirror/build directories under /tmp/prd359-task3a-* are scratch configure fixtures, not Git worktrees. Do not create a new sibling worktree or damage the installed dependency to make a missing-artifact test.

The durable replacement is committed at 80c39b94 and executes the exact extracted quiche decision block. It covers missing header/library, optional mode, present artifacts, `TN_ENABLE_WEBTRANSPORT=OFF`, `MYSTRAL_USE_QUICHE=OFF`, and an observed neutered-refusal control. The `project(NONE)` fixture documents configure-only scope; dummy archives do not pretend to prove linking.

## Owned quiche producer and dependency CI

The committed producer is packages/runtime-native/scripts/build-quiche-owned.py with adjacent test-build-quiche-owned.py and two tracked patches. Its accepted scope is Linux x64 production only. It requires fresh pristine source, actual clean pinned submodules, exact patch bytes, and an external CARGO_TARGET_DIR. **Never reset/clean a caller's source.** A patched checkout cannot be reused as pristine input for another build.

| Identity | Value |
| --- | --- |
| Upstream version / commit | quiche 0.24.6 / 020a43a0a5eed76f57dd3ce5012149aa576c594d |
| BoringSSL | f1c75347daa2ea81a941e953f2263e0a4d970c8d |
| Owned artifact revision / exact tag | quiche-0.24.6-tn1 / quiche-owned-v1 |
| FFI patch SHA-256 | da360ce1274173934421cd283ac6f4faddb9dbb2688b77f5a7aed284d9d2a8be |
| IP-SAN patch SHA-256 | eabe59921bcd42bdd956d256e6a3628d54530a32384aa3023819811ed695b15a |

The existing downloader still uses the old external quiche-0.24.6-3 assets. It has not been switched to an imaginary release. The upstream numeric-IP verifier problem is real: the patch selects BoringSSL's IP-SAN verifier for numeric addresses and retains chain verification. An upstream version bump alone did not fix it. The external library-builder repository was pull-only for this account; the user subsequently authorized the engine-owned producer path.

The committed Linux producer passed 32 tests and a fresh build with six actual IP-SAN TLS tests. Detailed tracked evidence: docs/verification/prd-359-quiche-owned-build-2026-09-06.md. Scratch output: artifacts/networking-359/quiche-owned-build/root-out/. Neither that archive nor the scratch patched host was installed as the normal runtime dependency.

The uncommitted CI workflow installs Rust 1.96.0, Go 1.26.3, CMake 4.4.2, Python 3.12 and PyYAML 6.0.3. It runs all three Python suites, builds Linux once, and uploads only ZIP/manifest. Exact-tag publication validates all nine target pairs and passes an explicit 18-file array to gh release create. **Do not tag/publish with the current Linux-only matrix.**

Three rejected candidate defects were repaired and independently reviewed: Linux-only publish arguments, metadata checked only for mutual consistency rather than producer pins, and missing test/filter wiring. Root also added missing CMake provisioning after a real workflow-test red and removed a candidate-only test that would reject an integrated workflow.

| Integrated check | Evidence |
| --- | --- |
| Release validator 18/18 | /tmp/prd359-quiche-ci-integrated-validator.log |
| Workflow 9/9, including integrated path probes | /tmp/prd359-quiche-ci-integrated-workflow.log |
| Missing CMake pin red; pin green | /tmp/prd359-ci-cmake-red.log; /tmp/prd359-ci-cmake-green.log |
| Real Linux-only upload-shaped distribution rejected, naming all eight missing targets | /tmp/prd359-quiche-ci-actual-linux-only.log; artifacts/networking-359/quiche-ci-local-dist/ |

Synthetic nine-target success proves validator behavior only, not platform builds. Details are in docs/verification/prd-359-quiche-ci-2026-09-06.md.

## Completed crouter platform candidate: review before integrating

The platform worker completed during handoff preparation. Unified exec handle 72780 was polled and returned exit 0. JSON is /tmp/prd359-crouter-platforms-result.json; session UUID is 1f48a30d-8f9f-436b-b33a-e6ed4f81d14d. It reports is_error=false and actual Muse Spark model routing.

Its entire ownership was artifacts/networking-359/quiche-platforms/:

| Artifact | Purpose |
| --- | --- |
| candidate-build-quiche-owned.py | Candidate platform-aware producer; tracked producer was left unchanged |
| test-candidate-platforms.py | Reported 15 tests for target toolchain selection and missing/wrong prerequisites |
| RECIPE-HANDOFF.md | Inputs for MSVC, Apple SDKs, pinned Android NDK 27.1.12297006/API 21 |
| src-android-arm64/, target-android-arm64/, out-android-arm64/ | Reported fresh actual Android arm64 build and archive; cross-target TLS tests explicitly skipped |

**This candidate has not had independent review or root acceptance.** The worker reports an Android arm64 build exit 0, but its terminal JSON also contains three denied Bash invocations from earlier build/diagnostic attempts. Inspect actual build logs, commands, archive hashes, source identity and the final successful execution before promoting that report to tracked evidence. Do not describe this session as having no permission denials or bypass a rejection. No other platform compile/runtime proof follows from those 15 unit tests.

Known integration conflict: the candidate writes target-specific data under manifest.toolchain.target_inputs. The integrated release validator currently requires toolchain to have exactly rustc/cargo/cmake/go string keys. Reconcile the producer/validator schemas deliberately, validate the target inputs, and add mutation tests; merely allowing arbitrary metadata is not enough. Keep each EXECUTION.md slice within its five-source-file bound and update ownership before expanding a slice.

The source recipe map at artifacts/networking-359/quiche-platform-gap.md is useful, but parts predate the integrated workflow. It also says non-iOS validation in its final paragraph; the owned release actually requires all nine artifacts, including iOS artifacts. iOS runtime qualification alone is deferred.

The candidate needs review of Windows CRT/toolchain handling, Apple SDK/architecture selection, Android compiler/linker/CMake variables, old Linux behavior and original 32 producer tests. Android armv7 and x64 were mapped but not compiled; Windows/macOS/iOS were not built locally. Do not confuse producing an armv7 dependency archive with advertising an armv7 game runtime, which the current Gradle configuration rejects.

## Worker/process inventory at handoff

No collaboration worker is running. dns_event_loop_seam errored on quota; native_test_prereqs and review_streams_root_fix completed. crouter platform handle 72780 is terminal. Earlier CI candidate handles 72825 and 91578 are terminal. Native coverage 37607 and QuickJS wire check 15679 were polled terminal exit 0. Do not restart these jobs merely because an old ledger says they are live.

| crouter session | Latest result |
| --- | --- |
| 7d30d710-3090-4ad4-885b-7cb6f0875c80 | CI candidate and repair, accepted after root's CMake fix; /tmp/prd359-crouter-ci-repair-result.json |
| 1f48a30d-8f9f-436b-b33a-e6ed4f81d14d | Platform candidate, completed but unreviewed; /tmp/prd359-crouter-platforms-result.json |

For a bounded follow-up, write a small prompt file with exact ownership, constraints and acceptance criteria, then use the verified CLI route:

~~~sh
crouter -p --resume SESSION_UUID --effort medium --output-format json \
  --tools 'Read,Glob,Grep,Edit,Write,Bash' \
  --allowedTools 'Read,Glob,Grep,Edit,Write,Bash' \
  < /tmp/networking-followup.txt > /tmp/networking-followup-result.json
~~~

Do not recursively spawn workers, allow overlapping writes, or mistake connector/model metadata warnings for terminal failures. Conversely, inspect actual error/denial fields even when is_error is false. The original producer candidate needed three rejected reviews before root took over; do not restart that failed approach. The accepted committed producer is the baseline.

## Verification and shipping sequence

1. Finish and review the meaningful CMake test; independently review the final wire-test and CI snapshot. Run focused Python suites and relevant native checks. A change to runtime behavior also needs the prescribed real playtest, not only unit tests.
2. Run pnpm test. **Only after it finishes**, run pnpm typecheck: the suite removes/rebuilds asset declarations and parallel typecheck can fail spuriously. Run pnpm lint and the required native coverage/census checks. Logs should go to named files; report actual exit codes and summaries.
3. Stage new evidence files before generating retention because it inventories git ls-files. Update citations and run the retention generator after final content. Run pnpm budgets and resolve stale generated records, without weakening floors.
4. Commit coherent reviewed changes and push normally. The pre-push hook runs pnpm ci:fast; do not use TN_SKIP_PREPUSH or equivalent bypasses. Monitor the actual new HEAD and repair failures locally before another push.
5. Complete the full execution ledger and the additional requirements, then perform a requirement-by-requirement audit. Only then mark the PR ready, obtain all required green checks, squash merge, confirm remote merge/main, pull main safely, and remove the clean merged worktree/branch. Never force-remove dirty or unmerged work.

Useful commands, from the worktree:

~~~sh
python3 packages/runtime-native/scripts/test-build-quiche-owned.py
python3 packages/runtime-native/scripts/test-validate-quiche-release.py
python3 packages/runtime-native/scripts/test-quiche-workflow.py
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/native-contract-lane.test.mjs
pnpm test
pnpm typecheck
pnpm lint
CMAKE_BUILD_PARALLEL_LEVEL=4 pnpm --filter @threenative/runtime-native native:coverage
pnpm census
pnpm exec tsx scripts/generate-retention-index.ts
pnpm budgets
~~~

Native live transport command, when a later runtime behavior change requires it:

~~~sh
XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 \
  sh scripts/xvfb.sh pnpm --dir packages/runtime-native exec vitest run \
  --config vitest.config.ts tests/webtransport/webtransport.test.ts
~~~

Use TN_NATIVE_RUNTIME_EXECUTABLE for an explicit host; blank is an error. Never use xvfb-run. Never print .npmrc. Do not silently use workspace/source imports for cold-package qualification. Search engine_search_capabilities and read every returned engine_capability_detail before the AGENTS.md triggers for new package files or substantial helpers. The prior dependency-producer search was completed, but it is not the future multiplayer authoring acceptance proof.

## Full remaining scope and evidence limits

| Area | Still required |
| --- | --- |
| Dependency / native transport | Complete nine-target owned distribution, real digests and normal-host installation; Task 1b interop and all non-iOS platform proof; required-mode/checksum completion in 3a |
| Portable multiplayer implementation | Go protocol vectors, actual core/net subpath and caller, UTF-8/modules/auth/credential proxy, explicit example config, server-owned simulation, actions/rejoin/lifecycle |
| Measurement / harness | Real paired-client scenario/coordinator, bounded browser/native resource waits, native monotonic time, actual networking CPU and latency/clock metrics, required CI matrix aggregator |
| Qualification | Exact browser/desktop/Android lanes, 32 clients for 10 minutes with at least two real games, 100 cycles, clean/impaired network profiles and adverse TLS/network/lifecycle cases, physical-device and human checkpoints; only iOS qualification deferred |
| Authoring / delivery | Metadata and recall, all required template instructions, actual spawned MCP search/detail, installed tarball S1/S2/S2b/S3 proofs, final audit, green PR, merge/pull/cleanup |

The PRD specifies Chrome/Edge/Firefox/Safari desktop plus Android Chrome, Windows/Linux/macOS arm64+x64, physical Android arm64 and emulator x64 with the required engines. Unavailable hardware/browser lanes remain incomplete; do not replace them with mocks, advisory CI, or desktop-only results. Read the exact thresholds and workload definitions rather than guessing them from this table.

Prior browser proof in docs/verification/prd-359-task1b-browser-2026-09-06.md used Chrome 151, isolated trust, and a hostname-scoped private-root QUIC policy override while retaining normal certificate verification. IPv4 numeric and localhost passed; DNS localhost mapped to IPv6 passed. Direct numeric IPv6 browser private-root allowlisting did not pass. Native scratch patched-host IP proof is separately recorded and is not installed-dependency proof. Preserve these limitations.

The ignored artifacts/networking-359/ledger.md and completion-audit.json are useful history but lag recent changes. The audit still requires current evidence review; it is not a completion verdict. Update them after the next accepted snapshot, retaining all ten additional requirements and the entire execution table.

**Current next action:** review and commit the pending CI/Windows snapshot, then push it so the Windows and dependency workflows execute against the actual 80c39b94 baseline.
