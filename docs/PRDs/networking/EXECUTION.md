# PRD-359 execution handoff

**Execution in progress, 2026-09-05.** Tasks 0, 1a and 1a-close passed. Tasks 2a, 2b-streams, 2b-send, 2b-signal, 2b and 2b-proof passed; the live queue/reconnect checkpoint is accepted. Task 2c DNS and Tasks 1b-trust and 1b-fixture passed; verified desktop/browser interoperability is next, including the numeric-IP identity-verification fix. Execute this file in table order.
Read [the PRD](./PRD-359-portable-multiplayer-transport.md) for acceptance and
[PROTOCOL.md](./PROTOCOL.md) for exact API and wire behavior. Do not redesign either.
The approved architecture is a shared protocol/test suite with thin language adapters.
Implement Go only in this PRD; defer Node/Rust adapters and iOS qualification.

## Operating rules

1. Read root and closest AGENTS files. Use an ignored repository-local worktree under
   `.worktrees/` if isolation is needed. Preserve other agents' edits. Search capabilities
   with `engine_search_capabilities`, read every hit with `engine_capability_detail`, and
   record reuse decisions before adding source. If tools are unavailable, restore the
   shipped engine MCP connection before source implementation; do not substitute guessing.
2. Write the named regression first, run it and retain the failure. Implement only its
   task, then run the same test and live proof. A missing prerequisite is not the feature's
   red test. An uncollected test is not a passed test. Never skip a required lane to green.
3. Each row owns at most five files, including generated mirrors. Amend this plan with a
   bounded follow-on row before editing a sixth. Evidence files and this task checklist
   record results; they do not authorize unrelated source changes.
4. After each row, fill actual caller `file:line`, command, exit code, red and green output
   in `docs/verification/prd-359-<task>-<YYYY-MM-DD>.md` and link it from this file. Commit
   the row's files and evidence together. Request a fresh review agent checkpoint for
   wiring, test collection and negative controls; use an available reviewer role instead
   of assuming the skill's `prd-work-reviewer` tool exists. Review is read-only.
5. After three failed fixes stop and name the doubtful assumption. Do not change transport,
   add native server FFI, weaken acceptance, add fallback or remove a non-iOS platform to
   make a gate pass. iOS rows remain `unverified — deferred by owner` and non-blocking.

## File aliases

These aliases are path abbreviations only, not shell variables or new packages.

| Alias | Exact directory |
| --- | --- |
| N | `packages/runtime-native` |
| S | `packages/runtime-native/examples/webtransport/server` |
| G | `examples/native-smoke` |
| C | `packages/core` |
| P | `docs/PRDs/networking` |

`S` does not exist at planning time. Restore that canonical fixture path with Go sources.
Do not create the earlier draft's Cargo.toml, Cargo.lock or Rust main.rs.

## Ordered tasks and owned files

Existing files are marked E; files to create are marked N. A file created by an earlier
row is E in later rows. Check a row only after its required evidence and review pass.

| Done | Task and files (maximum five) | Implementation and live caller | Required test / negative control |
| --- | --- | --- | --- |
| [x] | **0. Admit the mechanism.** E `docs/architecture/CHARTER.md`, `C/AGENTS.md`, `C/CLAUDE.md` | Add one charter clause permitting optional portable message transport while leaving gameplay/replication outside core. Document `core/net` as proposed until exported. Run sync:agents; generated mirror lands with source. This is required by core's closed ownership list. | `pnpm sync:agents` and primary-docs test. Do not document an unshipped command or package as already available. This policy-only row requires no runtime proof. |
| [x] | **1a. Restore executable Go fixture.** N `S/go.mod`, `S/go.sum`, `S/main.go`, `N/examples/webtransport/client.html`; E `N/tests/webtransport/webtransport.test.ts` | Replace Cargo discovery/build/start logic with Go commands and explicit executable path. Add Go echo server and browser page; server echoes datagrams, bidirectional streams and unidirectional streams. Existing live suite starts this server; browser page invokes real WebTransport. | Existing echo tests first fail for missing Go fixture in required mode, then execute bytes/lifecycle assertions. Preserve this as prerequisite evidence, not a native bug regression. Browser page verifies 64 KiB stream bytes and datagrams. |
| [x] | **1a-close. Settle failed handshake closure.** E `N/src/runtime-scripts/webtransport-polyfill.js`, `N/tests/webtransport_surface_test.cpp`, `N/docs/G1-desktop-host.md` | Required fixture revealed that a transport close before readiness without a separate error event leaves ready pending. Reject both establishment promises from the existing closed dispatcher and retain normal established-session closure. This is the bounded prerequisite part of 2b lifecycle work. | Native surface test injects the real closed-dispatch event before ready and must fail before repair; existing live untrusted-certificate test must reject without an insecure override. Rebuild native and run both. |
| [x] | **2a. Correct datagram surface.** E `N/src/webtransport/webtransport.cpp`, `N/src/runtime-scripts/webtransport-polyfill.js`, `N/tests/webtransport_surface_test.cpp`, `N/tests/webtransport_wire_test.cpp`, `N/tests/webtransport/webtransport.test.ts` | Derive capacity from quiche, subtract session framing, propagate invalid-session/oversize errors, bound queues and count legitimate local drops. Repair existing bindings; do not install a second transport. Existing runtime poll remains caller. | Add `reports negotiated datagram capacity`, `rejects oversized datagram`, `distinguishes closed session from queue drop`. Clamp available capacity to 64 in test; a 65-byte write must fail. Remove repair and observe red. Run live echo again. |
| [x] | **2b-streams. Native stream queue strategies.** E `N/src/runtime-scripts/streams-polyfill.js`, `N/tests/streams-shim.test.mjs`, `N/tests/webtransport_surface_test.cpp`, `N/docs/G1-desktop-host.md`, `N/tests/runtime-next-contract.test.mjs` | The installed stream shim currently ignores queue strategies and reports constant desiredSize. Implement the readable/writable strategy and backpressure behavior required by the existing WebTransport streams, retaining reader cancellation and pending-promise settlement. Do not patch each game around the missing global contract. | Strategy-sized queues report measured desiredSize, reads/writes respect pressure, cancellation settles pending work; remove the repair and observe the regression fail. Run existing stream tests and native surface/live stream proof. Update the existing bootstrap source hash contract only after behavior review; its stale hash must fail before update. |
| [x] | **2b-send. Bound native reliable send admission.** E `N/src/webtransport/webtransport.cpp`, `N/tests/webtransport_wire_test.cpp`, `N/docs/G1-desktop-host.md` | Preserve the existing partial-write pump while limiting queued native reliable bytes per session. The private bridge accepts a whole write or returns an explicit saturation/oversize status; no partial admission can be mistaken for complete success by the current JS caller. Emit bounded capacity-recovery events for the following JS integration row, and report hard stream send failures. | Deterministic quiche stream-send seam: Done, partial send, Done, resume preserves byte order and FIN; saturation refuses without growing buffers, oversized input is refused before copying, hard failure propagates without a local datagram-drop increment. Rebuild both Linux engines and rerun existing real 64 KiB echo. This is a native slice only, not complete backpressure acceptance. |
| [x] | **2b-signal. Cancel a capacity-blocked sink.** E `N/src/runtime-scripts/streams-polyfill.js`, `N/tests/streams-shim.test.mjs`, `N/tests/runtime-next-contract.test.mjs`, `N/tests/webtransport_surface_test.cpp`, `N/docs/G1-desktop-host.md` | Expose the standard writable controller AbortSignal using the installed AbortController and signal abort before waiting for the active sink operation. The transport sink can then cancel its capacity wait without changing standard writer ordering. | Node-reference regression: signal exists and preserves reason; a held write observes abort, rejects, and lets abort/closed settle. Test already-closed and repeated abort. Bootstrap hash remains literal. Rebuild native contracts and rerun live stream proof. |
| [x] | **2b. Streams and shutdown.** E `N/src/webtransport/webtransport.cpp`, `N/src/runtime-scripts/webtransport-polyfill.js`, `N/tests/webtransport_wire_test.cpp`, `N/tests/webtransport_surface_test.cpp`, `N/tests/runtime-next-contract.test.mjs` | Integrate bounded native send admission with JS capacity waits. Apply finite receive bounds and pull credit to native buffers and JS streams; correct close-before-ready, reader cancellation, pending promise settlement and stream errors. Reject non-default unsupported options instead of ignoring them. Keep actual resource counters observable for the following reconnect proof. Refresh the reviewed bootstrap hash. | Deterministic `preserves partial stream writes`, `backpressures stalled receiver`, `settles close before ready`, directional cancellation and shutdown tests. Revert each relevant branch to prove red; rerun existing live 64 KiB byte-identical transfer. Full queue integration remains open through 2b-proof. |
| [x] | **2b-proof. Live queue and reconnect integration.** E `N/tests/webtransport/webtransport.test.ts`, `N/docs/G1-desktop-host.md` | Extend the existing Go/native harness with a real stalled application reader and 100 reconnects in one native process. Observe actual native and JS session/stream/queue baselines; do not restart the process per cycle or replace measurements with constants. | Named `backpressures stalled receiver` observes pressure before releasing the reader and then verifies all bytes; `releases 100 reconnects` checks resource return after each close and final baseline. Preserve live echo and byte-offset coverage. Acceptance closes the 2a/2b queue integration checkpoint, not later platform qualification. |
| [x] | **2c. DNS does not freeze the game.** E `N/src/webtransport/webtransport.cpp`, `N/include/mystral/webtransport/webtransport.h`, `N/tests/webtransport_surface_test.cpp`, `N/tests/webtransport/webtransport.test.ts`, `N/docs/G1-desktop-host.md` | Move blocking name resolution to a bounded worker job; copy results back to the main-thread session owner. Session generation/cancellation guards must discard late results. Try returned IPv4/IPv6 addresses with remaining connection deadline. No JS callback from resolver thread. | Add `renders while DNS is delayed`, `ignores DNS result after close`, `tries second resolved address`. Delay resolver 500 ms with a test seam; frames continue and no stale session is touched. Run address-only IPv4/IPv6 live probes. |
| [x] | **1b-trust. Process-local certificate trust.** E `N/src/webtransport/webtransport.cpp`, `N/tests/webtransport_wire_test.cpp`, `N/tests/webtransport/webtransport.test.ts`, `N/docs/G1-desktop-host.md`, `docs/verification/native-coverage-2026-08-28.md` | TLS preflight found that the packaged quiche did not trust a fixture certificate through SSL_CERT_FILE. Honor that explicit process-local CA file using the existing quiche trust-loading API with peer verification still enabled; reject unreadable or invalid trust inputs. Do not modify OS trust stores or add a certificate bypass. This supplies the isolated trust fixture for 1b. | Run trusted certificate positive, wrong-hostname and untrusted certificate negatives against the real native client; malformed trust path fails explicitly. Preserve the observed preflight rejection as prerequisite evidence and write native trust-loading regression red before repair. |
| [x] | **1b-fixture. Portable executable and expiry fixtures.** E `N/tests/runtime-test-utils.ts`, `N/tests/webtransport/webtransport.test.ts`, `N/docs/G1-desktop-host.md` | Honor an explicit native executable, use shipped desktop preset defaults, and reject blank or missing required overrides. Mint expired and current certificates with portable OpenSSL CA date options and drive the real Go/native fixture. This is a bounded prerequisite of 1b; dependency distribution and browser/platform qualification remain open. | Required missing-executable subprocess fails naming the requested path; expired certificate rejects after exact-endpoint insecure echo; current certificate under the same CA succeeds. Replace expired dates with current dates and the rejection assertion fails. Run the full live suite and existing helper consumers. |
| [ ] | **1b-win32. Windows header compatibility.** E `N/src/webtransport/webtransport.cpp`, `N/tests/webtransport_wire_test.cpp`, `N/docs/G1-desktop-host.md` | The PR Windows desktop core build fails because quiche includes Winsock before NOMINMAX is defined, expanding new std::min calls as a Windows macro. Establish the Windows header guard before the first Windows header without changing transport behavior. | Preserve the real MSVC compile failure; prove the corrected include boundary and rebuild existing native wire/surface/live tests. Rerun the Windows CI build; no Windows runtime qualification is claimed by compilation alone. |
| [x] | **1b-quiche-build. Owned dependency producer.** N `N/scripts/build-quiche-owned.py`, `N/scripts/test-build-quiche-owned.py`, `N/patches/quiche-webtransport-ffi.patch`, `N/patches/quiche-ip-san.patch` | Preserve upstream quiche 0.24.6 and carry reviewed FFI/IP-SAN patches under a distinct owned artifact revision. Require pristine pinned source and actual clean submodules, exact patch hashes, defined exports, native TLS tests and deterministic archive packaging with digests. This producer does not change the installed dependency. | Real Git dirty/ignored/source/submodule negatives fail closed; removed checks turn tests red. Build from fresh pinned Linux source, run six TLS cases and validate the produced archive. Other platform recipes remain open. |
| [ ] | **1b-quiche-ci. Dependency artifact CI.** N `.github/workflows/build-quiche-owned.yml`, `N/scripts/validate-quiche-release.py`, `N/scripts/test-validate-quiche-release.py`, `N/scripts/test-quiche-workflow.py` | Invoke the owned producer on branch CI, validate the exact owned release tag, and publish only intended archive/manifest files after successful checks. Provision explicit target/toolchain inputs. No runtime-release workflow reuse. | Parse the workflow and reject missing tag trigger, missing validator checkout and unguarded publication. Execute Linux producer CI; do not publish an incomplete multi-platform dependency release. |
| [ ] | **1b-quiche-platforms. Remaining dependency targets.** E `N/scripts/build-quiche-owned.py`, `N/scripts/test-build-quiche-owned.py`, `.github/workflows/build-quiche-owned.yml`, `N/scripts/test-quiche-workflow.py` | Add the actual existing MSVC, Apple and Android toolchain recipes for every downloader-consumed target. Preserve iOS implementation while qualification stays owner-deferred. | Produce real per-target artifacts; missing non-iOS targets fail required qualification. Cross-compilation is not runtime proof. |
| [ ] | **1b-quiche-pin. Install published owned artifacts.** E `N/scripts/download-deps.mjs`, `N/tests/webtransport/webtransport.test.ts` | After actual assets and digests exist, change the quiche family URLs/build revision and enforce checksums. Keep upstream version 0.24.6. | Reject a tampered archive; rebuild the normal host and pass trusted numeric IPv4/IPv6 plus all certificate negatives before closing 1b. |
| [ ] | **1b. Verified desktop/browser interoperability.** E `N/tests/runtime-test-utils.ts`, `N/tests/webtransport/webtransport.test.ts`, `S/main.go`, `N/examples/webtransport/client.html` | Remove the live suite's Linux-only assumption using explicit executable override. Add verified certificate/hostname fixture mode; preserve insecure echo as an explicitly separate development test. Run real Chrome and Linux native first, no insecure flag in positive qualification. | `accepts trusted peer`, `rejects wrong hostname`, `rejects expired certificate`, `fails missing required executable`. Record browser/native/backend versions. The Task 1b-trust probe found verified numeric-IP SAN connections fail while localhost succeeds; fix and prove trusted numeric IPv4/IPv6 plus wrong-hostname rejection, without disabling identity verification. After this row, no unresolved handshake/draft incompatibility may remain before continuing. |
| [ ] | **3a. Native artifacts.** E `N/scripts/download-deps.mjs`, `N/CMakeLists.txt`, `N/scripts/install-prebuilt.mjs`, `N/tests/webtransport/webtransport.test.ts`, `N/package.json` | Verify existing quiche artifacts for Windows x64, Linux x64, macOS ARM64/x64 and Android advertised ABIs. Pin checksums. Add a required-WebTransport build mode for qualification; optional offline host builds may keep refusing stubs. Retain iOS integration and record unavailable artifacts as deferred. | Remove quiche artifact: required build/qualification fails naming platform/path. Run real echo per available non-iOS host. Do not fabricate artifact URLs; unavailable non-iOS artifacts remain open dependencies. |
| [ ] | **4a. Go application adapter.** E `S/main.go`; N `S/protocol.go`, `S/protocol_test.go`, `P/protocol-v1-vectors.json` | Implement PROTOCOL.md envelope, HELLO/WELCOME and BIND/BOUND. Factor application adapter into protocol.go, using webtransport-go sessions; no custom reliability. Main exposes `/game` in addition to `/echo` and calls adapter. Add literal shared vectors. | Go tests `TestVectors`, `TestSplitFrames`, `TestMalformedFrame`, `TestDuplicateBind`, `TestChannelMismatch`, `TestNegotiatedLimits`. Corrupt a literal vector and observe test failure. A browser raw client completes HELLO/BIND against live `/game`. |
| [ ] | **4b. Shared client and real caller.** N `C/src/net.ts`, `C/__tests__/net.spec.ts`; E `C/package.json`, `C/tsup.config.ts`, `G/src/game.ts` | Implement exact API and framing in net.ts; add `./net` export and tsup entry. Add an internal opt-in networking proof method to NativeSmoke, initially disabled, that connects, polls in the existing returned frame-update callback and closes in scene exit. Later row 5a wires its configuration. | Tests `matches shared protocol vectors`, `honors typed array offsets`, `rejects invalid options`, `bounds queues`, `settles cancellation`, `polls disconnect once`. Test collection must show these names. Temporarily enable proof for browser/native echo; removal of export breaks game build. Do not call this row integrated until that opt-in flow executes. |
| [ ] | **4c-utf8. Strict portable UTF-8 decoding.** E `N/src/runtime-scripts/fetch-polyfill.js`, `N/src/runtime-scripts/streams-polyfill.js`, `N/tests/fetch-shim.test.mjs`, `N/tests/streams-shim.test.mjs`, `N/tests/webtransport_surface_test.cpp` | Fallback TextDecoder ignores fatal options, so malformed handshake UTF-8 cannot be rejected portably. Implement the standard UTF-8 fatal/error and view-offset behavior needed by the protocol; propagate decoder options through TextDecoderStream. Reject unsupported encodings/options honestly. | Malformed UTF-8 throws with fatal:true, valid split multibyte sequences and typed-array offsets decode correctly, nonfatal decoding uses replacement characters. Record red/green in Node shim tests and compiled native surface execution. |
| [x] | **4c-contract. Refresh reviewed runtime bootstrap hashes.** E `N/tests/runtime-next-contract.test.mjs` | The 4c decoder repair changes two embedded runtime scripts. Refresh only their literal SHA-256 contract after the source behavior and native surface review are green; keep the contract fail-closed for later unreviewed edits. | The stale contract fails before the hash update. After updating both literals, `runtime-next-contract.test.mjs` and the focused fetch/streams shim tests pass. |
| [ ] | **4c. Boundaries and portable type surface.** E `C/src/net.ts`, `C/__tests__/net.spec.ts`, `N/shim-manifest.json`; N `C/src/net-protocol.ts`, `C/src/net-session.ts` | Move framing and session lifecycle into internal modules so public net.ts is a small entry point. Keep the exact implementation; no duplicate codec. Audit every global against shim manifest. Add inventory entries only for actually installed globals. If AbortSignal/streams are absent, fix that owner in a new bounded row before calling the client portable. | Same API tests plus `offline import opens no transport`. Grep live imports: net.ts calls internal modules and the game calls connect. No default-index re-export. Packed client imports cannot require Node globals. |
| [ ] | **4d. Authenticated session fixture.** E `S/main.go`, `S/protocol.go`, `S/protocol_test.go`; N `S/auth.go` | Add loopback-only token issuer, random hashed one-time tokens, expiry and room/player binding. Before readiness deny unauthenticated gameplay. Add --room and compare token room to the configured server room. Task 4e supplies the runtime issuer proxy before any game uses it. Never bake secrets into game bundles. No public unauthenticated issuer. | `TestExpiredToken`, `TestTokenReplay`, `TestWrongRoom`, `TestUnauthorizedGameplay`, `TestOriginAllowlist`; live revoked/bad token never creates a player. Verify logs/artifacts redact tokens. |
| [x] | **4e. Runtime credential delivery.** N `scripts/networking-issuer.mjs`, `scripts/__tests__/networking-issuer.spec.ts`; E `N/tests/webtransport/webtransport.test.ts`, `S/protocol.go` | Implement the issuer proxy and grant staging contract below as a callable module and standalone Node entry. Existing live fixture starts it and obtains credentials through it. It must run before Task 5a; Task 7a later reuses it rather than writing another issuer. The pre-HELLO extra-stream probe is canceled and joined before post-WELCOME BIND streams so the live caller cannot be stolen by the guard. | Tests `rejects missing grant`, `rejects expired grant`, `rejects wrong player`, `redacts credentials`, `cleans staged grants`. Live fixture joins /game with newly issued token. Evidence: [task 4e](../../verification/prd-359-task4e-2026-09-06.md). |
| [ ] | **5a. Example configuration and operator controls.** E `G/vite.config.ts`, `G/package.json`, `G/src/game.ts`; N `G/src/networking-game.ts`, `G/networking.config.example.json` | Add `dev: vite`. Build-time config path env `THREENATIVE_NETWORKING_CONFIG` defaults to disabled. Vite reads JSON and injects `__TN_NETWORKING_CONFIG__`; game code never reads process.env/window/location. Extract proof logic into networking-game.ts and call it from scene enter/update/exit. Render connection state and Retry using existing example mechanisms. | `pnpm --filter threenative-native-smoke test` with networking disabled and enabled. Disabled config opens no socket. Enabled build reaches `/game`; bad config throws during build. Example JSON contains no credential. |
| [ ] | **5b. Authoritative server simulation.** E `S/main.go`, `S/protocol.go`, `S/protocol_test.go`, `G/src/networking-game.ts`; N `S/game_test.go` | Implement the exact reference channel map and JSON schemas from PROTOCOL.md; 60 Hz simulation, 20 Hz snapshots, validated axes, server-owned positions. Game renders local/remote players from per-player snapshot datagrams, discards stale ticks per player and sends numbered actions. | `TestServerOwnsPosition`, `TestStaleInput`, `TestActionDeduplication`, `TestInvalidGameplayPayload`. Two actual clients join, move and receive server action acknowledgements. Dropping input at sender must prevent peer motion. |
| [ ] | **6b. Rejoin and local lifecycle.** E `C/src/net-session.ts`, `C/__tests__/net.spec.ts`, `G/src/networking-game.ts`, `S/game_test.go`, `S/main.go` | Retry obtains a new token and requests a fresh snapshot. Clear pending game actions on disconnect; do not replay. Pause/resume/network loss eventually closes or recovers transport within documented deadlines; game joins cleanly after failure. | `does not replay actions on reconnect`, `releases readers after server restart`, plus server restart/30-second loss/suspend cases on real clients. 100 cycles return resource counts to baseline. |
| [ ] | **7a. Existing scenario reaches both clients.** E `G/src/networking-game.ts`, `G/src/game.ts`; N `G/playtests/networking.playtest.json`, `scripts/run-networking-proof.mjs`, `scripts/__tests__/run-networking-proof.spec.ts` | Implement the runner contract below. Start Go server, reuse Task 4e credential proxy and start partner client; invoke the existing playtest CLI for the subject client. Publish observations through ctx.state. Do not add a new scenario language, fake renderer or pixel-conformance registry row. | Unit tests reject missing server/partner, mismatched identities and zero assertions. Live scenario checks peer motion and action. Kill partner and observe failure. Resource assertions work on browser and native through existing bridge. |
| [ ] | **7wait-a. Bounded resource wait on browser.** E `packages/playtest/src/scenario/schema-base.ts`, `packages/playtest/src/scenario/schema-validate.ts`, `packages/playtest/src/runner/steps.ts`, `packages/playtest/__tests__/scenario.spec.ts`; N `packages/playtest/src/runner/wait-for-resource.ts` | Implement the portable waitForResource step specified below. Browser steps call the shared bounded helper using existing resource observation and tick-control APIs. | Reject missing timeout, malformed path/predicate and mixed action/wait steps. An asynchronously changing resource passes; a permanently false predicate times out with its last observation. |
| [ ] | **7wait-b. Same wait on native.** E `packages/playtest/src/runner/androidRunner.ts`, `packages/playtest/src/runner/wait-for-resource.ts`, `packages/playtest/__tests__/device-playtest.spec.ts`, `packages/playtest/__tests__/ios-device-playtest.spec.ts`, `G/playtests/networking.playtest.json` | Wire the shared helper into the common native scenario path used by Android/desktop/iOS. Use the existing resource bridge, not CDP. If dispatch differs, document its actual caller before modifying another file. | Run same wait-positive and wait-timeout cases on browser and desktop; device transport tests cover missing observations. iOS mocked dispatch may run but live iOS remains deferred. |
| [ ] | **7clock. Monotonic native performance time.** E `N/src/runtime.cpp`, `N/tests/timer-contract.test.mjs`, `N/tests/timer_delivery_test.cpp`, `N/docs/G1-desktop-host.md` | Native performance.now currently uses high_resolution_clock epoch time, which is not guaranteed monotonic. Use a runtime-relative steady_clock origin for the existing global so networking deadlines and clock probes use monotonic milliseconds. | Native contract asserts runtime-relative finite, nondecreasing time; old epoch-based implementation must fail. Source clock contract verifies the monotonic clock choice; run compiled timer contract and existing clock/timer tests. |
| [ ] | **7native. Native transport CPU meter.** E `N/src/runtime.cpp`, `N/tests/host-gap-meter.test.mjs`, `scripts/run-networking-proof.mjs`, `scripts/__tests__/run-networking-proof.spec.ts` | Time the existing webtransport::processEvents call using the host monotonic clock and emit a separately named per-frame WebTransport duration through the existing meter path. Parse it with frame identity in proof runner; do not substitute the whole I/O segment. | Delay that call by 5 ms through a test seam: parsed networking CPU rises and budget fails. Missing or duplicated frame samples cannot pass. |
| [ ] | **7metrics. Measured latency and CPU.** E `G/src/networking-game.ts`, `S/main.go`, `S/game_test.go`, `scripts/run-networking-proof.mjs`, `scripts/__tests__/run-networking-proof.spec.ts` | Implement the clock/metrics method below and channel 4 from PROTOCOL.md. Collect actual samples, apply thresholds, reject missing or excessive clock uncertainty. | Inject 500 ms snapshot delay: state-age gate fails; inject a 5 ms busy loop inside net poll wrapper: CPU gate fails; omit clock samples: result unavailable/nonzero. No literal success metric. |
| [ ] | **7b. Aggregate required lanes.** E `.github/workflows/native-platforms.yml`; N `scripts/verify-networking-matrix.mjs`, `scripts/__tests__/networking-matrix.spec.ts`, `P/qualification-lanes.json` | Add exact platform lane manifest and aggregator contract below; existing native workflow invokes runner on provisioned lanes and aggregator on evidence. Hardware rows can consume separately executed matching evidence. Ordinary CI does not claim a physical device it did not run. | Tests `rejects missing required lane`, `rejects wrong commit`, `rejects empty observations`, `rejects Android deferral`, `reports iOS deferred without passing it`. All required rows need success; no advisory green substitutes for release verdict. |
| [ ] | **7c. Real qualification.** E `P/qualification-lanes.json`, `P/EXECUTION.md` | Execute all PRD non-iOS lanes, workload profiles and adverse cases. Link separate evidence per run. Record resolved OS minimums, exact executables, versions and hashes in lane manifest before runs. No source changes in this evidence row. | Run commands below. Observe human two-client movement and actions on desktop and physical Android. Missing macOS/Windows/browser/hardware remains incomplete; only iOS is exempt. |
| [ ] | **8a. Publish discovery metadata.** E `C/src/net.ts`, `scripts/not-owned-capabilities.ts`, `packages/core/capabilities.json`, `packages/create-threenative/capabilities.json`, `packages/create-threenative/agent-docs/references/capability-reference.md` | Add capability documentation to shipped export; narrow not-owned answer to replication/prediction. Run capabilities:sync; generated outputs land with their source. Search must return the real import and delivery limitations. | `pnpm capabilities:check`; manifest tests. Revert export metadata and intended query must no longer resolve, proving the test depends on new surface. |
| [ ] | **8b. Recall and core instructions.** E `scripts/fixtures/capability-recall/corpus.json`, `scripts/fixtures/capability-recall/budget.json`, `scripts/__tests__/capability-recall.spec.ts`, `C/AGENTS.md`, `C/CLAUDE.md` | Update multiplayer transport queries to owned capability while retaining out-of-scope queries. Document actual subpath, defaults/overrides, no fallback, Go server and iOS unverified status. Regenerate mirror. | `pnpm caps:recall`; named recall test; sync:agents check. Old blanket answer must fail new positive query. |
| [ ] | **8c. Real-process MCP discovery.** E `packages/create-threenative/__tests__/scaffold-mcp.spec.ts` | Extend the existing spawned MCP harness with concrete multiplayer search and same-process capability detail; validate the installed networking import, constraints and overrides. Reuse the existing harness rather than adding a second MCP client. Its workspace symlinks are test setup, not cold-package evidence. | Named networking discovery test must fail when networking metadata is removed. Execute search/detail from the packed core MCP launcher in the S3 sandbox, then build/import the discovered export from installed dist. Record tarball hashes and reject workspace/source/symlink resolution in that cold proof. |

Template instructions are five final rows, each owns four existing files: both AGENTS.md
and its generated CLAUDE.md for the named two templates. Execute pairs in this order:
`action-rpg/defense`, `minimal/platformer`, `puzzle/racing`, `runner/sailing`,
`shooter/starter`, under `packages/create-threenative/templates/`. Each source edit
documents optional `core/net`, Go reference example, queue overrides, delivery guarantees
and unsupported-network behavior. Run `pnpm sync:agents` in the same row; no deferred
mirror-only phase. After the last pair, cold-scaffold and import from packed packages.

Tasks 2a, 2b-streams, 2b-send, 2b-signal, 2b and 2b-proof form one queue-bound integration checkpoint: commit each reviewed
slice in table order, but leave Task 2a unchecked until Task 2b-proof proves finite native and JS
queues together. The installed stream shim is the prerequisite for JS pressure; completing
the native capacity/status slice does not prove the full queue requirement.

## Server and fixture commands to implement

Tasks 4b and 5a form one client integration checkpoint: do not mark 4b complete until
5a supplies the actual opt-in caller configuration and the shared game runs live. The
five-file limit applies per task, not permission to claim an uncalled intermediate module
is complete. Likewise authenticate the initial Task 4a game path using per-run random
credentials supplied by the fixture; Task 4d hardens issuance/expiry/replay before game integration. Never expose
a temporary unauthenticated game endpoint outside the isolated fixture.

Task 1a creates Go module `threenative.local/networking-reference`, binary name
`tn-network-server` (`.exe` on Windows). Resolve the latest stable webtransport-go once,
record version/revision, then pin it in go.mod/go.sum. Use its declared supported Go
version, record the toolchain and do not use floating dependency versions in CI. Preserve
the existing quiche pin unless observed draft incompatibility requires an explicit update.
Do not implement legacy wire fallback to hide an incompatible server/client pairing.

The server accepts these flags; they are new example flags, not a new engine CLI:

```text
--listen <host:port>        required; UDP WebTransport bind
--cert <pem-path>          required for verified mode
--key <pem-path>           required for verified mode
--dev-self-signed          explicit alternative to --cert/--key, echo probes only
--admin-listen <host:port>  loopback only; default 127.0.0.1:0
--room <room-id>           served room; default networking-proof
--allow-origin <origin>    repeatable; exact normalized scheme/host/port match
```

Invalid/unknown flags exit 2. Print `LISTENING` with resolved UDP and admin addresses
after both listeners bind; never print private keys/tokens. SIGTERM stops acceptance,
closes sessions and exits within five seconds. `/echo` is transport conformance only;
`/game` requires protocol authentication. Keep both served by one canonical executable.
Admin `POST /token` accepts `{room,playerId}` and returns `{credential,expiresAt}`;
bind strictly to loopback and reject forwarded/nonlocal requests. Test orchestrator
obtains tokens there, then exposes a temporary authorized HTTPS endpoint reachable by
devices. Endpoint authorization is a run-specific secret transferred outside checked-in
config, with bounded issuance; never put that secret or issued credentials in evidence.
Disable the proxy outside proof runs. Deployment of a real issuer is out of scope.

The existing native test file gains `TN_WEBTRANSPORT_EXECUTABLE`,
`TN_WEBTRANSPORT_TEST_URL`, `TN_WEBTRANSPORT_TEST_CERT` and `TN_WEBTRANSPORT_TEST_KEY`
overrides. Default executable remains the current Linux helper path for compatibility.
An explicit missing override fails rather than falling back. Required TLS tests use a
trusted certificate/hostname supplied by the operator or provisioned fixture trust store;
an insecure environment flag cannot satisfy them. Never change a user's trust store
silently. Certificate prerequisites remain named dependencies if unavailable.

## Game config and observations

Task 5a JSON config schema is `{enabled:boolean, endpoint:string, issuerUrl:string,
room:string, playerId:string}`. Disabled config may omit other keys; enabled config
requires HTTPS URLs and nonempty strings. Reject unknown keys. Secrets are excluded.
Both normal browser entry and native build consume the same injected value. The proof
runner supplies per-client config files under ignored artifacts. For runtime-only issuer
authorization, stage `networking-session.json` beside each client's served/packaged assets
with `{issuerAuthorization,expiresAt}`. Read it using the existing portable
`fetch('networking-session.json')` path and validate it; native fetch already supports
relative asset reads. Send `issuerAuthorization` as a Bearer header to issuerUrl; never
as a query string. The grant is random, limited to that run/room/player, expires after
15 minutes and can issue only that player's fresh 60-second join tokens. The proxy
validates the grant before calling loopback `/token` and permits only configured browser
origins. Deploy trusted HTTPS; no TLS bypass. Browser CORS permits the Authorization
header only for those origins.

This grant file is an ignored test-run asset, never a compiled constant, checked-in
example, published package or captured artifact. Stage it independently for each client;
remove it during runner cleanup. A missing/expired file produces a named error, not
anonymous joining. The existing native file-asset resolver must be verified on packaged
Android as part of Task 5a. Do not read browser URL query strings or Node environment in
game code. Real products replace this development authorization asset with their login
flow and supply the resulting credential to connect; core knows nothing of that flow.

Store primitive observations in the existing `ctx.state` surface:

| Field | How to derive it; initial value |
| --- | --- |
| `networkConnected`, `networkPeerObserved` | false; true only after application readiness / snapshot containing a distinct authenticated peer |
| `networkRemoteDistance` | 0; accumulate distance between validated successive remote positions, never local input |
| `networkActionAcks` | 0; count distinct accepted server replies for actions this client actually submitted |
| `networkSessionId`, `networkPeerId` | empty strings; copy only from authenticated welcome/snapshot |
| `networkProtocolErrors`, `networkReconnects` | 0; count real protocol failures / completed rejoin transitions |

Task 7a creates schemaVersion 1 playtest using existing `assert.resources` entries
with `id: "state"`, matching `path`, and equals/gte. Required assertions: connected=true,
peerObserved=true, remoteDistance≥1 metre, actionAcks≥1, protocolErrors=0. Runner also
asserts distinct session/player IDs and cross-checks server logs against both clients.
Run long enough for both clients to join before input steps. A client automation schedule
sends input for two seconds and one action only after observing its peer; subsequent
snapshot/reply drives assertions. The server must not generate fake peer movement. Same-tick snapshots for different
players must all be consumed; add a regression for this and assert that every snapshot
datagram fits its negotiated payload limit in the 32-client soak.

## Proof runner and aggregate contract

Task 7a creates a repository script, invoked with Node, not a public engine CLI command:

```text
node scripts/run-networking-proof.mjs --config <absolute-json> --output <absolute-json>
```

Config specifies `laneId`, `profile`, `server` spawn command/args, `subject` and `partner`
existing playtest CLI argument arrays, `endpoint`, certificate paths and required build
hashes. Use spawn argument arrays, never shell interpolation. The script injects no
success assertions. Use `scripts/networking-issuer.mjs` for authorization/staging, not
a second implementation. Its standalone invocation is `node scripts/networking-issuer.mjs
--config <absolute-json>`; config carries admin URL, HTTPS cert/key paths, bind address,
allowed origins and per-client asset directories. It prints only listener/readiness
metadata, stages per-player grants, and revokes/deletes them on shutdown. Validate config before starting processes, bound every wait, own all
child cleanup and require actual test count/peer observations. Record game artifacts and
server stdout after redacting credentials. For devices use reachable host addresses:
127.0.0.1 on a phone is not the development machine. Provision UDP reachability explicitly.
Impairment is external to the adapter; record the platform-specific command and measured
profile. Only provision impairment in an isolated namespace/test host, not global routes.

Output schema contains `schemaVersion:1`, `prd:359`, `laneId`, `profile`, `commit`,
`clientBundleHash`, `nativeBinaryHash` (null for browser), `serverBinaryHash`, `versions`,
`startedAt`, `finishedAt`, `commandExitCodes`, `assertionCount`, `subjectSessionId`,
`partnerSessionId`, `serverObservedPlayerIds`, `observations`, `metrics`, `artifacts`,
`status:"passed"|"failed"|"unavailable"`. Validate finite metrics and nonempty evidence;
do not accept logs without matching artifact identities. Exit 0 only for passed,
1 for observed failures, 2 for prerequisites/config/process failures.

Task 7b creates `node scripts/verify-networking-matrix.mjs --manifest <path> --results <dir>`.
Manifest lists expected lane IDs, required profiles, commit/build identity, and required
versus owner-deferred status. Aggregate by exact lane/profile, reject duplicates and
missing required rows, and require common client source revision/protocol version.
Platform-specific binary hashes differ; compare each against that lane's expected hash.
Only iOS-labelled lanes may be deferred. Output required verdict plus explicit deferred
rows; exit nonzero unless every required row passes. Do not use the pixel conformance
registry for this multiplayer orchestration; its existing scene schema is not this format.

## Commands by task

Existing commands below are available today. New source paths/flags become runnable only
after their owning task creates them. Run commands from repository root unless stated.

```sh
# Current baseline: source-contract tests, not live TLS proof.
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/peer-verification-contract.test.mjs

# Task 1a onward: package config is necessary for live tests to be collected.
TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/webtransport.test.ts

# Task 4a onward, cwd packages/runtime-native/examples/webtransport/server:
go test ./...
go test -race ./...
go build -o tn-network-server .

# Task 4b onward:
pnpm exec vitest run packages/core/__tests__/net.spec.ts
pnpm --filter @threenative/core build
pnpm --filter threenative-native-smoke test

# Task 7 onward:
pnpm --filter @threenative/playtest build
pnpm exec vitest run scripts/__tests__/run-networking-proof.spec.ts scripts/__tests__/networking-matrix.spec.ts

# Task 8 and closure:
pnpm capabilities:sync
pnpm sync:agents
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm budgets
pnpm test:playtest
pnpm test:templates
```

Go race tests run on the Linux reference-server lane with its supported race toolchain;
do not substitute a no-race pass. Native C++ tests are built and run through the existing
runtime native contract infrastructure after `pnpm native:build`; check that the named
WebTransport wire/surface tests executed instead of registered blocked tests. For a
failed browser/device prerequisite use the playtest `doctor` commands in root AGENTS.

## Completion record

Do not check task rows at planning time. At implementation closure record every required
row's evidence links, independent review, published caller and negative-control output.
Node/Rust adapters remain deferred product scope; iOS remains owner-deferred verification.
They need no fake passing tests or unresolved required checkbox to archive this batch.
The final verdict may say browser/desktop/Android qualified; never all-platform or iOS
qualified without real iOS evidence. Move the entire networking batch to done only when
required tasks pass, and update any vector consumers and incoming links in that commit.

## Task 7metrics: exact sample producers

Use channel 4 probes from PROTOCOL.md. For client send/receive times c0/c3 and server
receive/send times s1/s2, compute RTT=(c3-c0)-(s2-s1), offset=((s1-c0)+(s2-c3))/2 and
uncertainty=RTT/2. Require all values finite. Reject negative RTT or uncertainty;
allow signed clock offsets because monotonic clock origins differ. For each measurement choose the
minimum-RTT probe from the preceding 10 seconds; no probe means unavailable. Reject
qualification if uncertainty exceeds 100 ms. Snapshot age estimate at application is
clientNow+offset-snapshot.serverMonoMs; store the conservative upper bound
max(0,estimate+uncertainty). The PRD's age thresholds apply to that upper bound. Record
uncertainty too; never claim perfect cross-machine clock synchronization.

At each real game update, measure time spent inside send/poll and message processing
using performance.now. That is JS networking CPU time, not total transport CPU. Native
processEvents is separately measured by Task 7native in the existing host I/O profiling path. Add its measured per-frame time to
JS cost for the native networking budget; reject missing native transport samples.
Browser transport CPU is opaque: report JS CPU separately and require the existing
whole-frame budget, never claim browser QUIC-thread CPU was measured.

For action acknowledgement latency, store local monotonic send time by action ID and
subtract it only on that action's distinct accepted reply. After a 10-second warmup,
collect 60 seconds of samples per profile and at least 100 acknowledged actions; the
load schedule sends two actions per second. Use nearest-rank percentiles on the sorted
samples. Emit sample count, p50/p95/p99, maximum, units and raw-sample artifact hash for
age, action latency and CPU. Runner enforces the PRD's 150/350 ms age p95, 2,000 ms action
p99 and 1 ms native total / browser JS CPU p95 plus whole-frame budget. Missing samples
or unmatched action IDs cannot pass. The 10-minute soak is additional to these windows.

## Required sandbox checkpoint

After the public API is built and before closure, execute [SANDBOX.md](./SANDBOX.md).
The small game at `../sandbox/networking-proof` must pass browser/browser and
browser/native desktop local tests using installed tarballs. An in-repo fixture pass
does not replace it. Record its required evidence link alongside the task rows.

## Portable asynchronous resource wait

Current waitTicks advances simulation and is not a network deadline. Tasks 7wait-a/b
add one generic step, not networking-specific assertions:

```json
{"waitForResource":{"id":"state","path":"networkConnected","equals":true},"timeoutMs":10000}
```

Require a positive integer timeoutMs ≤120000 and exactly one equals/gte/lte predicate.
Disallow mixing this step with input, holdTicks or waitTicks. Validate id/path against
the existing resource-path rules. Read through the existing resource observer. Use a
monotonic wall-clock deadline; when not satisfied, yield to actual I/O for up to 16 ms
before reading again. When the runner owns fixed stepping, advance at most one tick per
poll, paced by that real interval, so the game can consume incoming messages without
fast-forwarding the server's clock. Never busy-spin or replace the deadline with ticks.
Missing resource/unsupported observer fails immediately; a valid but unsatisfied value
waits until timeout and then fails with the predicate, elapsed time and last observation.
It must never time out successfully or ignore malformed conditions.

The networking scenario waits for readiness and peer presence with this step, drives
input, then waits for measured remote distance and acknowledgement. Measurement windows
use monotonic time and run the real networking loop; fast fixed-step ticks cannot count
as elapsed seconds. Negative control: suppress server reply and verify timeout fails on
browser and native. The proof runner still owns multi-client startup and failure injection;
the playtest package gains only this reusable asynchronous wait primitive.

## CI execution requirement

Owner confirmed on 2026-09-05 that networking verification belongs in CI. Task 7b must wire executable networking checks into the existing workflows, including protocol/fixture checks and provisioned browser/native interoperability lanes. Qualification aggregation must fail for missing required evidence; ordinary CI must never imply a physical-device run it did not execute. CI passing, merge and pull remain part of the requested delivery.

## Authoring discovery requirement

Owner clarified on 2026-09-05 that authoring discovery specifically means the engine capabilities MCP: execute `engine_search_capabilities` for concrete multiplayer requests, then `engine_capability_detail` on the networking hit, and verify the real installed import, constraints and overrides. Tasks 8a/8b and all five template pairs are required delivery: capability search/detail must expose the installed `@threenative/core/net` API, recall tests must cover concrete multiplayer requests, and core/template instructions must state delivery guarantees, defaults/overrides and failure behavior. Verify the cold tarball sandbox discovers and imports the actual export; metadata alone is insufficient.

## Execution records

- Task 0: [policy admission and primary-docs checks](../../verification/prd-359-task0-2026-09-05.md). Fresh read-only Luna review passed policy/mirror/test collection; missing checklist/link finding resolved here.
- Prerequisites: [isolated workspace/native build and baseline contracts](../../verification/prd-359-build-prerequisites-2026-09-05.md); not multiplayer acceptance.
- Task 1a-close: [failed-handshake promise regression and 11-test live green](../../verification/prd-359-task1a-close-2026-09-05.md); fresh read-only review accepted.
- Task 1a: [Go fixture, native 11-test suite and real Chromium byte proof](../../verification/prd-359-task1a-2026-09-05.md); final read-only review accepted, checklist/link completed.
- TLS prerequisite: [process-local trust preflight](../../verification/prd-359-tls-preflight-2026-09-05.md), observed failure; Task 1b-trust remains open.
- Portability prerequisites: [native globals inventory](../../verification/prd-359-native-globals-preflight-2026-09-05.md); bounded streams/UTF-8/clock rows remain open.
- Task 4c-contract: [reviewed runtime bootstrap hash refresh](../../verification/prd-359-task4c-contract-2026-09-06.md); stale hashes failed before the two literal updates, then the focused decoder and contract suites passed.
- Task 4e: [runtime credential issuer and trusted native `/game` join](../../verification/prd-359-task4e-2026-09-06.md); the first live run exposed a reference-server probe race, then issuer unit tests, Go tests and the real native authenticated join passed.

The existing real-stdio harness is `packages/create-threenative/__tests__/scaffold-mcp.spec.ts`;
it currently exercises initialize, tool listing and search, while detail is covered only by
an in-process server test. Task 8c closes this specific integration gap. Launch the cold
sandbox's `node node_modules/@threenative/core/mcp/engine.mjs`, whose bundled launcher pins
its own installed capability manifest; a tool connected to the primary checkout cannot
prove the worktree or packed result.

- Task 2a native slice: [datagram limits, error classification, bounded native queues and idle-frame regression](../../verification/prd-359-task2a-2026-09-05.md); coordinator and fresh read-only review accepted. Final native contracts 2/2 and live suite 15/15 passed. Full Task 2a queue acceptance remains open through 2b-streams/2b.
- Impairment prerequisite: [disposable Linux namespace/netem preflight](../../verification/prd-359-network-isolation-preflight-2026-09-05.md) executed successfully without changing host networking; game/UDP profile qualification remains open.

- Task 3a prerequisite: [six pinned non-iOS quiche archives and verified digests](../../verification/prd-359-quiche-artifact-preflight-2026-09-05.md) are available; downloader checksum enforcement and platform execution remain open.

Task 2b-streams accepted: [red/green and independent-review evidence](../../verification/prd-359-task2b-streams-2026-09-05.md).
Linux V8 and QuickJS compiled contracts passed 2/2 each, Linux V8 Go live tests
passed 15/15, and typecheck/lint/full test passed. Task 2a remains unchecked
until Task 2b proves finite native and JS transport queues together.

Task 2b integration accepted:
[stream integration evidence](../../verification/prd-359-task2b-2026-09-05.md).
Native V8/QuickJS contracts, live echo, full gates and independent review passed.
The queue-bound checkpoint subsequently passed Task 2b-proof below.

Task 2b-proof accepted:
[live stalled-reader and reconnect evidence](../../verification/prd-359-task2b-proof-2026-09-05.md).
Both negative controls failed as intended and native source was restored. Final
required live tests passed 17/17; full gates passed. Task 2a is now accepted.

Task 2c accepted: [asynchronous DNS evidence](../../verification/prd-359-task2c-2026-09-05.md).
Linux V8/QuickJS contracts passed 2/2 each; required live Go/V8 cases passed 23/23.
Delay, IPv6 authority, input validation and fallback regressions went red before
repair/restoration. Full suite, sequential typecheck and lint passed. Opus medium
is preparing Task 1b-trust; no additional platform qualification is claimed.

Task 1b-trust accepted: [process-local trust evidence](../../verification/prd-359-task1b-trust-2026-09-06.md).
Final required live suite passed 28/28; V8/QuickJS contracts, coverage, full suite,
sequential typecheck and lint passed. Final `pnpm budgets` exited 0
(`/tmp/prd359-trust-budgets-final.log`) after canonical coverage/census/retention
regeneration. Exact-endpoint controls and both verification-disabled mutations
prove the TLS negatives. Numeric-IP SAN verification remains a blocking Task 1b
requirement; no cross-platform/browser qualification is implied by this row.

Task 1b-fixture evidence: [portable executable and expired-certificate fixtures](../../verification/prd-359-task1b-fixture-2026-09-06.md).
The separate [scratch-linked IP-SAN host proof](../../verification/prd-359-ip-san-host-2026-09-06.md) passes Linux/V8 trusted numeric IPv4/IPv6 with the prepared source patch; the installed dependency remains unchanged and Task 1b stays open through owned artifact integration.

Task 1b browser evidence: [Linux Chrome private-CA certificate fixtures](../../verification/prd-359-task1b-browser-2026-09-06.md) pass real bytes and TLS negatives with per-endpoint controls. IPv6 transport is proved through a DNS name mapped to the actual IPv6 listener; direct numeric IPv6 private-root allowlisting remains an explicit failed browser diagnostic. This evidence does not close dependency distribution or any unexecuted browser/platform lane.

Task 1b-win32 evidence: [header-boundary repair and local checks](../../verification/prd-359-task1b-win32-2026-09-06.md); corrected Windows CI compilation remains pending.
Task 1b-quiche-build evidence: [owned Linux producer and exact-source controls](../../verification/prd-359-quiche-owned-build-2026-09-06.md); the producer is locally proved but not yet published or installed.

Task 1b-quiche-ci local evidence: [integrated workflow and release checks](../../verification/prd-359-quiche-ci-2026-09-06.md); actual CI execution and publication remain open.
