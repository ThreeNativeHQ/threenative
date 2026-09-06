# G1 — desktop host

**Milestones:** M0, M1, M2, M4
**State:** Linux PASS from the migrated evidence; Windows and macOS UNEXECUTED.

## Recorded evidence on arrival — 2026-08-08

- Provenance baseline: `841fe379ca1ab23c87c99fac3b901e37487ce8f2` (v0.1.5).
- Linux x64 V8 13.1 + Dawn/Vulkan rendered the upstream Three.js cube and GLTF/GLB
  scenes on an NVIDIA RTX 2080.
- The unchanged `@threenative/core` import-free bundle ran 300 frames and emitted ready
  and first-frame markers on the desktop runtime.
- `tn-linux`, `tn-windows`, and `tn-macos` presets exist. Windows and macOS have not run on
  real runners and do not claim a pass.

Imported screenshots and generated artifacts are deliberately not tracked. A new in-repo
evidence run must record its dated command, log checks, screenshot path, host and GPU here.

## Absorbed-source desktop proof — 2026-08-08

Command:

```sh
SDL_VIDEODRIVER=x11 sh scripts/xvfb.sh \
  packages/runtime-native/build/tn-linux/mystral run \
  examples/native-smoke/dist/native-smoke.js \
  --screenshot packages/runtime-native/artifacts/desktop-core-2026-08-08.png \
  --frames 300
```

- `pnpm native:build`: PASS, 379/379 build steps completed from the absorbed source.
- Runtime: V8 13.1.201.22, Dawn/Vulkan, NVIDIA GeForce RTX 2080.
- Markers: exact `TN_NATIVE_SMOKE_READY:webgpu` and `TN_NATIVE_SMOKE_FIRST_FRAME` present.
- Liveness: 300 frames rendered in 8,986 ms; no WebGPU or JavaScript error was reported.
- Screenshot: 1280×720 RGBA, visually inspected as a nonblank rotating blue cube;
  SHA-256 `d07780b0b89207ed646f25eba3b0268240b49ef9a9f5d4cb227401b72c9bfcfa`.

## Remaining desktop lane wiring — 2026-08-08

`.github/workflows/native-platforms.yml` now contains opt-in macOS 14 and Windows 2025
real-runner jobs. The build and verifier select the matching host preset and retain the
exact 300-frame/log/screenshot gate. Neither job has executed: this checkout is on Linux,
there are no self-hosted runners, and no remote workflow was dispatched. Windows and macOS
remain **UNEXECUTED**, not configured-pass.

## Evidence retention hardening — 2026-08-08

`verify-desktop-core.mjs` now writes the complete runtime log and a JSON report containing
the host architecture, selected preset, exact marker/frame requirements, screenshot
dimensions and screenshot SHA-256. The platform workflow uploads that directory with
`if-no-files-found: error`. The verifier also limits `SDL_VIDEODRIVER=x11` to Linux; carrying
it into the Apple or Windows process environment would invalidate those real-runner lanes.

A fresh Linux x64 run passed 300 frames in 8,779 ms and produced a nonblank 1280×720 PNG with
SHA-256 `52700257102d3105715ce4dfb20e95806c3990b69ad7a9e72d7653f550554335`.
Windows and macOS remain **UNEXECUTED** until the opt-in workflow is present on the remote
default branch and dispatched.

## Scaffolded starter artifact proof — 2026-08-09

The proof subject is a freshly scaffolded `starter`, not `examples/native-smoke`. Its
declared `src/game.ts` entry was bundled with its texture, GLB and existing public assets,
then packaged with the rebuilt Linux host.

```sh
THREENATIVE_RUNTIME_BINARY=$PWD/packages/runtime-native/build/tn-linux/mystral \
  pnpm build:desktop
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs
```

- Runtime: Linux x64, V8 13.1.201.22, Dawn/Vulkan, NVIDIA GeForce RTX 2080.
- Liveness: exact ready, first-frame, asset-loaded and 300-frame markers; 300 frames in
  9,203 ms with no `TN_NATIVE_START_FAILED`, validation error or `TypeError`.
- Asset reads: `native-proof.png` (150 bytes) and `native-proof.glb` (624 bytes) came from
  the embedded bundle with no network fallback.
- Screenshot: 1280×720, 49,979 colors and 963 cyan proof-asset pixels; SHA-256
  `9c00d1364e6789bbb5cb28c91a9751f9ef7441c21a8e4fa8600fbef14129d962`.
- Negative control: repackaging the same bundle without `--assets` emitted
  `TN_NATIVE_START_FAILED:...native-proof.png` and never emitted the asset-loaded marker.

The starter's OGG pickup playback was not exercised by this visual gate; the host logged
its pre-existing unsupported-decode path. This row does not claim audio parity. The new
`starter-linux` workflow job rebuilds this same scaffold and retains its log, screenshot and
JSON report.

## Ogg Vorbis decode — 2026-08-23

`decodeAudioFile` was one call to `SDL_LoadWAV_IO`, so RIFF/WAVE was the only container any
native target could read. That is the "pre-existing unsupported-decode path" the starter row
above records, and it is not Android-specific — desktop simply never noticed, because every
audio proof here fed a WAV built inline. PRD-211 Phase 1 vendors `stb_vorbis.c` through
`scripts/download-deps.mjs`, compiles it once in `src/audio/vorbis_impl.c`, and sniffs `OggS`
ahead of SDL.

```sh
pnpm native:build
node scripts/verify-desktop-audio.mjs           # V8, the shipping desktop preset
node scripts/verify-desktop-audio.mjs --dual    # V8 + QuickJS, the Android rollback engine
```

- `threenative-audio-decode-ogg-test` decodes `tests/fixtures/pickup.ogg` — a genuine Ogg
  Vorbis file from this repository, 8,820 frames of mono at 44,100 Hz — through the installed
  `AudioContext.decodeAudioData`, and asserts audible PCM rather than a buffer of silence.
- **Passed on V8 and on QuickJS.** JavaScriptCore is reported skipped, not passed: this build
  carries no JSC, and a build carrying no engine at all fails rather than reporting a pass.
- Negative controls in the same executable: a truncated Ogg and an `OggS` header over corrupt
  bytes both reject with an `Error`, the same loud class an `SDL_LoadWAV_IO` failure produces.
  An Ogg carrying Opus fails the same way — the container is not the codec, and this runtime
  implements Vorbis only.
- `targetSampleRate` was accepted by `decodeAudioFile` and never read, and
  `AudioBufferSourceNode::process` does no rate conversion, so a buffer kept at its own rate
  played at `bufferRate / contextRate` speed. It is now honoured for every container: a
  22,050 Hz asset decoded on a 44,100 Hz context comes back 44,100 frames long instead of
  22,050, proved in the same executable.
- Not claimed: any device. The Android and iOS halves of this decoder are the same source file
  and are compiled by the same lists, but no phone ran it.
  `docs/verification/prd-211-phase1-2026-08-23.md` names what is still open.

## Stability contracts without a display — 2026-08-24 (PRD-210)

`native:verify:desktop` gained a third proof ahead of the display-dependent ones:

```sh
node scripts/verify-desktop-stability.mjs
```

It builds and runs three executables that link the real runtime and open no window, no GPU and
no audio device beyond SDL's dummy driver:

- `threenative-crash-handler-policy-test` — stands a `sigaction`/`SA_SIGINFO` handler in for
  debuggerd, applies each crash policy, and reads the disposition back. The Android policy must
  leave the stand-in in place; the desktop policy must replace it, which is the negative control
  and is exactly what every platform used to do.
- `threenative-wgpu-null-handle-test` — forks a child that hands a NULL encoder to the real
  `wgpuCommandEncoderBeginRenderPass`, reports the signal that killed it, then proves the checked
  path throws to JavaScript naming the operation. Ran on Linux x64 against Dawn: the child died
  with `Segmentation fault (signal 11)`; the checked path threw
  `TN_WGPU_NULL_HANDLE: device.createCommandEncoder returned no handle (label=frame)`.
- `threenative-lifecycle-policy-test` — drives the SDL lifecycle transition table, the paused
  flag, the `TN_LIFECYCLE` markers, the `display.backgroundMode` override and the host-side
  AudioContext registry, and pushes a real event through SDL so the watch is exercised on SDL's
  own send path. Since 2026-08-23 it also covers the **surface revalidation** resume queues in both
  modes, and the `debug.threenative.skip_surface_revalidate` control that reinstates the pre-fix
  resume. It was failing at `c3ae3b26` — the retreat to `backgroundMode: "continue"` left the
  default asserted by section 2 disagreeing with the default the reset installs — and passes again
  now that the default is `"pause"`.

All three passed on Linux x64, V8 13.1.201.22, Dawn, preset `tn-linux`. The desktop preset carries
V8 alone, so QuickJS and JavaScriptCore report `SKIP … not compiled into this build` — a skip, not
a pass. Evidence and the open device rows:
[`../../../docs/verification/prd-210-2026-08-23.md`](../../../docs/verification/prd-210-2026-08-23.md).

**Surface revalidation on resume** (2026-08-23). `webgpu::Context::rebuildSurface()` swaps the
`WGPUSurface` against a new native window while keeping the adapter, device and queue, and
`webgpu::detachSurfaceForRebuild()` / `webgpu::republishSurface()` move `g_surface` with it. Both
are named here because the other half of the repository is entitled to rely on them: a present
after a resume reads the republished surface, and nothing else in the host may hold the old one.
Desktop is a deliberate no-op — a desktop window survives a minimize — so this changes nothing
about the desktop gate; it is proven on a physical Pixel 8 in
[`../../../docs/verification/resume-presents-2026-08-23.md`](../../../docs/verification/resume-presents-2026-08-23.md).

## Packed static-light KTX2 consumer — 2026-08-30 (PRD-256)

A tarball-installed sandbox loaded its ordinary compiled GLB and two ETC1S KTX2 textures through
Three's `GLTFLoader`/`KTX2Loader` on Linux x64, V8 13.1.201.22, Dawn/Vulkan, and an NVIDIA RTX 2080.
The native worker wire now copies ArrayBuffers/typed arrays, preserves nested `undefined`, supports
worker event listeners, and blocks on V8's foreground task queue so asynchronous WebAssembly
compilation completes without polling. The WebGPU resource binding maps every desktop BC format
Three may select instead of silently falling back to BGRA8.

The desktop playtest drove 30 ticks, observed `staticLightReady:true` and nontrivial player movement,
and reported zero console, network, or runtime diagnostics. Its inspected 1280x720 capture showed
the baked darker receiver patch; SHA-256
`a7668f6d18591500732c890fc0f9a774b5c1d199fbe0b64c075d9b7039af301c`. Android/iOS are not claimed:
their existing `TN_NATIVE_KTX2_UNSUPPORTED` build guard remains intact.

## PRD-359 failed WebTransport handshake — 2026-09-05

The Linux V8+Dawn host now settles both establishment promises when WebTransport closes before readiness. The compiled surface regression went red then green, and the real Go fixture suite passed 11/11 tests, including self-signed certificate rejection without the insecure override. This does not qualify positive trusted TLS or other platforms. Evidence: [Task 1a-close](../../../docs/verification/prd-359-task1a-close-2026-09-05.md).

## PRD-359 native datagram slice — 2026-09-05

The Linux host now reports negotiated payload capacity, rejects invalid/oversized sends, distinguishes hard transport failures from local backlog drops, and drains bounded native receive backlog on idle frames. The idle-frame regression failed before repair; restoring a hard-error drop increment failed the real session-counter test. Final compiled contracts passed 2/2 and the Go/native live suite passed 15/15. Coordinator and independent review accepted this native slice. JS stream backpressure, positive trusted TLS and remaining platform qualification are still open. Evidence: [Task 2a](../../../docs/verification/prd-359-task2a-2026-09-05.md).

## PRD-359 native stream strategies — 2026-09-05

The installed Streams shim now measures readable/writable queue sizes and signals
pressure, serializes asynchronous pulls/writes, and preserves active sink results
while deferring abort teardown. Root review rejected incorrect in-flight-write
expectations and added Node-reference regressions for abort, ready rejection and
size-callback reentrancy. The current unit suite passes 19/19, including close during an erroring stream. Compiled networking
contracts pass 2/2 on Linux V8 and 2/2 on Linux QuickJS; real Go/native transport
checks pass 15/15 on Linux V8. Independent review passed after the close-ordering and duplicate-close corrections.
Typecheck, lint and the full test suite passed; this prerequisite row is accepted. Hard transport queue bounds remain Task 2b work; no Android,
Windows, macOS or iOS execution is claimed here. Evidence:
[Task 2b-streams](../../../docs/verification/prd-359-task2b-streams-2026-09-05.md).

## PRD-359 native reliable send admission — 2026-09-05

The Linux V8+Dawn host now bounds reliable stream admission at 1 MiB per session,
preserves exact quiche partial-write progress and FIN ordering, releases drained
buffer storage, and reports hard stream send failures through distinct
`streamWriteError` events. A session-wide `writable` event is coalesced and reset
when the existing event pump pops it. The wire regression drove a real quiche
`Session` through Done, short-write, resume, saturation, oversized input, FIN,
closed/failed states, and injected hard errors; its required negative mutations
went red before restoration. The focused Linux V8 build and WebTransport ctests
passed 2/2. The QuickJS build and contracts also passed 2/2; the coordinator
ran the real Go/Linux V8 fixture, passing 15/15. This is the native send slice
only; JavaScript stream integration and other platforms remain open.

Evidence: [Task 2b-send](../../../docs/verification/prd-359-task2b-send-2026-09-05.md).

## PRD-359 writable controller abort signal — 2026-09-05

The installed writable-stream shim now exposes a stable
`WritableStreamDefaultController.signal` backed by the host's existing
`AbortController`. `writer.abort(reason)` signals synchronously before it waits
for a held sink start or write, preserves the signal's first reason, and re-reads stream
state after signal listeners run. A listener that calls `controller.error()` can
therefore settle the stream without an extra `sink.abort()` call. Terminal
closed/errored streams resolve a later abort, while a pending abort remains
coalesced until its active operation settles.

The focused shim tests pass 23/23, the bootstrap hash/loader contract passes
29 tests with 2 existing skips, and the compiled Linux V8 WebTransport surface
and wire contracts pass 2/2. Rebuilt Linux QuickJS contracts also pass 2/2,
with the source hash unchanged across the build. The surface test holds a native writable operation,
aborts it, and awaits write rejection plus `closed` settlement; it does not use a
constant probe. A no-signal mutation failed 3 tests and was restored. The
recorded Chromium 151 reference for synchronous `controller.error()` during
abort reports `abort='listener-error'`, `closed='listener-error'`, one signal
event, and no sink abort; Node 20's crash for that reentrant case is not used as
passing evidence. The explicit native 64 KiB echo probe also passed with exact
bytes and FIN after this build. The required existing Go/native fixture suite
also passed 15/15 after the build. Typecheck, lint and the full suite passed;
the evidence records an initial timestamp-test failure and passing rebuilt replay.
This is the signal prerequisite only; native
capacity retry integration, receive bounds, positive trusted TLS and other
platforms remain open.

Evidence: [Task 2b-signal](../../../docs/verification/prd-359-task2b-signal-2026-09-05.md).

## PRD-359 native WebTransport stream integration — 2026-09-05

Task 2b is committed as `2dc42fcc`. The JS adapter retries bounded native send
admission, observes abort while waiting for capacity or FIN, keeps read/write
shutdown independent, and grants receive credit from the readable queue. Native
reads have per-tick work bounds, resume on idle sockets, reject foreign session
headers and retain completed streams until their readable data drains. Local
close settles outstanding operations and clears retained queues. Actual native
and JS resource counters are exposed through `__wtResourceStats`; absent native
observations fail instead of being counted as zero.

Rebuilt Linux V8 and QuickJS wire/surface contracts passed 2/2 each. The final
required Go/V8 suite passed 15/15, and a separate deterministic 65,536-byte echo
compared every byte and read to FIN. Native negative controls failed after each
of five safeguards was removed and passed after restoration. The full suite,
typecheck and lint passed; the [Task 2b evidence](../../../docs/verification/prd-359-task2b-2026-09-05.md)
records exact counts and review corrections. These runs use the explicit
self-signed development fixture; positive trusted TLS remains unverified.

Task 2b-proof completed the live queue checkpoint: all 17 required Go/Linux V8
cases passed, including a stalled application reader followed by byte-exact 32 MiB
delivery/FIN and 100 reconnects in one native process. Each reconnect exercised a
datagram and bidirectional echo, then required all observed native/JS resources to
return to zero. Removing receive credit made the pressure test fail; retaining a
closed native session made the first reconnect fail. Source was restored and the
final required suite, full repository suite, typecheck and lint passed. The
[Task 2b-proof evidence](../../../docs/verification/prd-359-task2b-proof-2026-09-05.md)
records exact observations. Task 2a/2b queue integration is accepted; no additional
platform, trusted TLS or broader load/soak qualification is claimed here.

## PRD-359 asynchronous DNS — 2026-09-06

Linux V8 and QuickJS wire/surface contracts pass 2/2 each, including actual
animation callbacks during a delayed lookup and cancellation before worker
completion. The Go/Linux V8 required suite passes 23/23: OS hostname lookup,
delayed lookup, close before completion, IPv6, candidate fallback and malformed
fixture controls join the existing queue/reconnect cases. Removing fallback or
validation makes the corresponding live case fail. Numeric IPv4 and IPv6 each
also returned exact 64 KiB stream bytes plus FIN.

The resolver uses two process-lifetime workers with 64-job admission and up to
16 address candidates under one 30-second connection deadline. Session, socket,
quiche and JS access stay on the game thread. Active OS getaddrinfo calls cannot
be interrupted; cancelled results are discarded, and pool state remains owned
through process teardown. Two permanently stuck OS lookups prevent subsequent
hostname resolution but do not freeze game frames. These Linux proofs do not
qualify other platforms or trusted TLS. Final repository-gate acceptance is
recorded in [Task 2c evidence](../../../docs/verification/prd-359-task2c-2026-09-05.md).

## PRD-359 process-local certificate trust — 2026-09-06

Linux V8 and QuickJS wire/surface contracts pass 2/2 each. An explicit
`SSL_CERT_FILE` is loaded through the packaged
`quiche_config_load_verify_locations_from_file` after the existing peer-verification
decision, so the variable names *which* anchors are trusted and never *whether* the
peer is verified. Unset leaves quiche's own default verify paths untouched; an empty
value, an unreadable path and a file that is not certificates each abort the candidate,
stop candidate iteration and reject establishment with a named stderr diagnostic.

The Go/Linux V8 required suite passes 28/28. Five of those are new: a real trusted
certificate accepted with `verify-peer` on and no development override anywhere, a
trusted certificate refused for the wrong hostname, an untrusted peer refused while a
trust file is set, and unreadable and malformed trust files refused. Replacing the
load helper's body with `return true` makes the native wire contract fail five named
checks; the pre-existing development self-signed cases are unchanged and set no
`SSL_CERT_FILE`.

Each secure negative is preceded by a development-mode control against the identical
URL, DNS mapping and listening peer: it asserts a byte-exact datagram echo with
`MYSTRAL_WEBTRANSPORT_INSECURE=1`, so the rejection that follows is TLS refusing that
endpoint rather than a dead port or an unresolved name. The controls are explicitly
insecure and are not used by the trusted positive. Temporarily forcing
`quiche_config_verify_peer` false makes both negatives fail — `FAIL: accepted the wrong
hostname` and `FAIL: accepted an untrusted certificate`, exit 1 each — while the controls
still pass; the source was restored to an identical hash and the rebuilt binaries hash
identically to the recorded ones.

Measured and not accepted as final: an IP-literal authority is refused by this quiche
build even when the loaded anchor carries the matching `IP Address` SAN, while the same
certificate and anchor verify through `localhost`. That is server-name checking, not
trust loading, and it is carried into Task 1b as a blocking requirement with the
certificate/hostname fixture work. These Linux proofs qualify no
other platform, no browser, and do not claim the loaded file replaces quiche's default
roots. The [Task 1b-trust evidence](../../../docs/verification/prd-359-task1b-trust-2026-09-06.md)
records the exact commands, exits and binary hashes.
