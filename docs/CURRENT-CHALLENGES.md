# Current challenges

**One place for everything ThreeNative does not yet do well.** Every limitation the project knows
about lives here, with where it stands and what is being done about it — so the README, the
[Charter](architecture/CHARTER.md) and the package docs can describe the framework, and nobody has
to reconstruct the honest picture from a dozen scattered caveats.

Nothing here is hidden elsewhere, and nothing elsewhere contradicts it. If you find a limitation
this file does not name, that is a bug in this file — please
[open an issue](https://github.com/ThreeNativeHQ/threenative/issues).

**Last reviewed:** 2026-09-28.

## At a glance

| # | Challenge | Status | Next step |
| --- | --- | --- | --- |
| 1 | Mobile frame rate on physical hardware | Being measured | Reference workload on a Pixel 8, not a cube ladder |
| 2 | The native platform evidence lane is slow | Green on `develop` 2026-09-23, 2h35m | Cache the SDK/Gradle/Cargo trees and shard the conformance rows |
| 3 | iOS is not a supported target | Owner decision, 2026-09-23 | No public text claims iOS; a later decision needs a device lane and a store-shaped build |
| 4 | Native physics on device | Backend proven, device scenarios open | Run the shared conformance suite on hardware |
| 5 | The agent head-to-head benchmark has never been run | Apparatus built and wired to CI | Execute six repeats against the sealed prompt |
| 6 | Nobody outside the project has played a game for five minutes | Protocol written | Run the stranger test |
| 7 | The API is `0.x` | Alpha, deliberately | Freeze after the criteria in the Charter's §12 are met |
| 8 | The supported envelope is narrower than "any game" | Inventoried below, enforced by failing-closed guards | Keep the inventory true to the guards; name what changes here when one moves |

---

## 1. Mobile frame rate on physical hardware

**Where it stands.** Android runs. The GPU meter now reports from a real phone — a Pixel 8 on
Mali-G715 renders the native smoke scene at 41 fps with a 0.19 ms GPU cost at 1080×2400, which
places the cost on the CPU side of the frame rather than the GPU. What has *not* been measured is
the [Charter](architecture/CHARTER.md)'s reference workload — the unmodified `platformer` template —
on that phone, and that is the number the mobile budget is written against.

**Why it is open rather than done.** An emulator fakes the GPU driver, so an emulator frame rate is
not a frame rate. The project would rather say "unmeasured" than publish a number from a lane that
cannot produce one.

**The plan.** Keep the physical-device lane as the only source of a mobile fps claim, run the
reference workload on it, and record the result in
[`verification/runtime-perf-state.md`](verification/runtime-perf-state.md) — the single performance
record, updated in place. The CPU-side frame cost is already decomposed there, with the host gap
named down to the millisecond.

## 2. The native platform evidence lane is slow

**Where it stands.** The advisory `native-platforms` workflow was red from 2026-09-01 and is green
again: the 2026-09-23 run on `develop` passed every job, including Android emulator parity, desktop
parity and the iOS simulator handoff. The three stacked infrastructure defects are fixed — the lane
check no longer counts a documented, unexpired registry exclusion as a block, the ledger step
imports the shared exit rule instead of re-implementing it, and a single `--target android`
invocation no longer overwrites the web reference. What remains is the run's cost: about 45 minutes
of it is a serial, software-GL conformance comparison.

**The plan.** Cache the Android SDK, Gradle and Cargo trees and shard the conformance rows. The
red-run analysis, with run IDs, stays at
[`verification/native-platforms-red-2026-09-02.md`](verification/native-platforms-red-2026-09-02.md).

## 3. iOS is not a supported target

**Where it stands.** iOS evidence is produced on a hosted macOS runner against the simulator: the
runtime builds, boots, and renders. That lane is a regression signal, not a support claim. The
owner decided on 2026-09-23 that iOS is not a supported target — not in the current preview, not in
the beta, and not in 1.0 — and no public text claims it.

**The plan.** Keep the simulator lane green. If iOS is ever added as a target it needs a
physical-device lane and a store-shaped build, and the Charter's release ladder still refuses to
call a platform ready while its hardware row is open.

## 4. Native physics on device

**Where it stands.** Physics has two backends behind one API: Rapier WASM on the web, and a native
build reached through a coarse typed-array ABI. Both are proven by a single conformance suite that
runs the same scenario against every backend. What is open is running those device scenarios on
physical hardware, which is row 3 of the Charter's release ladder.

**One rule worth flagging.** Rapier is compiled into the native runtime rather than loaded as
WebAssembly. The original reason — that Android used a JS engine with no WebAssembly — no longer
holds, since V8 became the Android default. The rule still stands on its second reason, per-object
call cost, but that reason is unmeasured. Measuring it is an open question, not a settled one, and
it is recorded here rather than asserted in the Charter.

## 5. The agent head-to-head benchmark has never been run

**Where it stands.** The kill switch — *any abstraction that costs more code than vanilla Three.js
gets deleted* — is enforced today by a static LOC comparison that CI publishes on every run. The
larger question, whether an agent builds a better game faster with the framework than without it,
has a complete apparatus: a frozen vanilla control, a hand-ported framework arm, a deterministic LOC
classifier, a sealed prompt with a recorded hash, and blind scoring. The head-to-head itself is
**void** — specified, wired up, not yet executed.

**The plan.** Execute all six repeats against the sealed prompt hash before declaring anything. A
void is neither a win nor a loss, and the project would rather carry a void than a result it cannot
defend. Protocol: [`benchmark/PROTOCOL.md`](benchmark/PROTOCOL.md); the dated status of the run:
[`benchmark/RESULTS-2026-08-02.md`](benchmark/RESULTS-2026-08-02.md).

## 6. The stranger test

**Where it stands.** The Charter's fourth success criterion is that one game is played by a stranger
for five minutes, with a transcript — the one criterion the team that wrote it cannot game. The
protocol is written ([`product/STRANGER-TEST-PROTOCOL.md`](product/STRANGER-TEST-PROTOCOL.md)); the
test has not been run.

## 7. The API is `0.x`

**Where it stands.** Packages publish at `0.x` and the API is still settling. Breaking changes ship
in minor versions and are recorded in [`../CHANGELOG.md`](../CHANGELOG.md).

**The plan.** The Charter's §12 sets the bar for a stable release: the port reads as Three.js and
does not look worse than the vanilla control, one codebase runs on web, desktop and a physical
phone, the native arm is not slower than the browser arm, and a stranger has played it. A `1.0`
follows those, not a calendar.

## 8. What "portable" does not mean

**Where it stands.** ThreeNative is an alpha general-purpose framework with useful game systems, not
a guarantee that every browser library, asset codec, extension, workload or third-party SDK is
portable. The claims this project makes are the games it ran, and **no document claims "any game"**.
The envelope, as the code enforces it today:

- **Targets.** Web (WebGPU, with a WebGL2 path where the render path allows it), desktop hosts for
  Linux, Windows and macOS, and Android `arm64-v8a` / `x86_64`. iOS is not a supported target
  (row 3). None of this is a store-readiness claim: signing, store listings and game-specific SDKs
  stay the developer's.
- **Compressed assets on mobile native.** Android QuickJS and iOS JSC have no WebAssembly engine, so
  Three.js's Basis/KTX2 transcoder, its Meshopt decoder and Draco's WASM decoder cannot run there.
  `threenative build` refuses such a bundle before one exists — `TN_NATIVE_KTX2_UNSUPPORTED`,
  `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED` — and desktop keeps the real decoders. Web is refused by
  `TN_ASSETS_KTX2_UNSUPPORTED` when the renderer supports no compressed format.
  (`packages/runtime-native/AGENTS.md`, `packages/create-threenative/src/build.ts`)
- **Native audio codecs.** Native `decodeAudioData` sniffs the container: `OggS` goes to stb_vorbis
  (Ogg Vorbis), everything else to RIFF/WAVE through SDL. Opus, FLAC, MP3 and AAC are not
  implemented, and an Ogg carrying Opus or FLAC is refused rather than mis-decoded — it arrives as
  the same rejected promise a corrupt WAV produces.
  (`packages/runtime-native/src/audio/audio_context.cpp:911`)
- **Browser globals in the portable graph.** The owned runtime shims the browser globals a game
  reaches for, and a global it does not shim breaks native — which is why the shim list is the
  contract. The portable graph may not reach browser UI at all: `TN_NATIVE_WEB_ONLY_UI` rejects DOM
  or React mounting in `src/game.ts`, and `TN_NATIVE_WASM_ON_MOBILE` rejects WebAssembly imports
  there on Android and iOS. DOM work belongs in `src/main.ts`; web-only WASM needs a
  `threenative-native` conditional backend. See
  [THREEJS-CONSTRAINTS](architecture/THREEJS-CONSTRAINTS.md).
- **Software adapters and virtual displays.** WebGPU reaching SwiftShader, llvmpipe or another CPU
  rasteriser answers normally, so its numbers look healthy while describing software rendering. The
  runner reads `adapter.info`, names the software adapter and refuses the result unless the caller
  opts in (`TN_CAPTURE_SESSION_ADAPTER_REJECTED`, `TN_TRACE_SOFTWARE_ADAPTER`), and a virtual display
  is blocked for frame-rate claims because it has no vsync (`TN_TRACE_VIRTUAL_DISPLAY`). An emulator
  frame rate is therefore not a frame rate (row 1).
- **Workload and artifact limits.** `threenative build` fails closed on an artifact over its size
  budget rather than replacing a good artifact (`TN_BUILD_ARTIFACT_BUDGET_EXCEEDED`). Draw-call and
  texture-memory targets are reported as a verdict by the render-workload advisor and asserted
  through the playtest `performance` assertion — measured against the game, not enforced by the
  framework. See [PERFORMANCE-BUDGETS](product/PERFORMANCE-BUDGETS.md).

**The plan.** The platform claim is the per-target consumer rows this project actually ran — browser
on Linux, Linux x64 desktop, and Android on both a physical Pixel 8 and an emulator, all one game
and one scenario. Keep this section true to the guards, and add the row here whenever a guard moves
in either direction. A limitation missing from this list is a bug in this file.

---

## How this file is maintained

- A limitation belongs here, not in the README, the Charter, or a package doc. Those describe what
  the framework does; this file describes what it does not do yet.
- Every entry states **where it stands** and **the plan**, and links to the run or record that backs
  it. An entry with no evidence link is incomplete.
- Deep technical write-ups stay in their own dated files under [`verification/`](verification/),
  [`bugs/`](bugs/). This file is the index and the summary, not a
  replacement for them.
- When an item is fixed, delete the row and let the release notes carry it. This file tracks the
  present, not the past.
