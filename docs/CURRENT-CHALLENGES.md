# Current challenges

**One place for everything ThreeNative does not yet do well.** Every limitation the project knows
about lives here, with where it stands and what is being done about it — so the README, the
[Charter](architecture/CHARTER.md) and the package docs can describe the framework, and nobody has
to reconstruct the honest picture from a dozen scattered caveats.

Nothing here is hidden elsewhere, and nothing elsewhere contradicts it. If you find a limitation
this file does not name, that is a bug in this file — please
[open an issue](https://github.com/ThreeNativeHQ/threenative/issues).

**Last reviewed:** 2026-09-02.

## At a glance

| # | Challenge | Status | Next step |
| --- | --- | --- | --- |
| 1 | Mobile frame rate on physical hardware | Being measured | Reference workload on a Pixel 8, not a cube ladder |
| 2 | Android conformance lane is red on CI | Root-caused, fixes in flight | Land the exclusion-aware lane check |
| 3 | iOS is simulator-only | Evidence lane green, device lane absent | A physical-device run and a store-shaped build |
| 4 | Native physics on device | Backend proven, device scenarios open | Run the shared conformance suite on hardware |
| 5 | The agent head-to-head benchmark has never been run | Apparatus built and wired to CI | Execute six repeats against the sealed prompt |
| 6 | Nobody outside the project has played a game for five minutes | Protocol written | Run the stranger test |
| 7 | The API is `0.x` | Alpha, deliberately | Freeze after the criteria in the Charter's §12 are met |

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

## 2. The Android conformance lane is red on CI

**Where it stands.** The advisory `native-platforms` workflow has been red since 2026-09-01. It is
not a rendering regression — the conformance run itself passes 74 rows. Three stacked infrastructure
defects are responsible, and all three are root-caused:

- the lane check counted a documented, unexpired registry exclusion as an unexpected block;
- the workflow's ledger step re-implemented the exit rule instead of importing it, so the ledger and
  the checker disagreed;
- a single `--target android` invocation also wrote web, desktop and iOS reports, overwriting a good
  web reference.

**The plan.** The exclusion-aware lane check is already on a branch whose run turned desktop parity
green; the ledger step imports the shared exit rule instead of copying it; the target side effect is
being removed. Full analysis, with run IDs:
[`verification/native-platforms-red-2026-09-02.md`](verification/native-platforms-red-2026-09-02.md).

**Also in flight:** the same lane is slow — 45 minutes of it is a serial, software-GL conformance
comparison. Caching the Android SDK, Gradle and Cargo trees and sharding the rows is the fix.

## 3. iOS is simulator-only

**Where it stands.** iOS evidence is produced on a hosted macOS runner against the simulator: the
runtime builds, boots, and renders. There is no physical-device lane and no store-shaped build.

**The plan.** The simulator lane holds the regression line while a device lane is stood up. Until
then the project says "simulator evidence", never "iOS support" — the Charter's release ladder
refuses to call any platform ready while its hardware row is open.

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

---

## How this file is maintained

- A limitation belongs here, not in the README, the Charter, or a package doc. Those describe what
  the framework does; this file describes what it does not do yet.
- Every entry states **where it stands** and **the plan**, and links to the run or record that backs
  it. An entry with no evidence link is incomplete.
- Deep technical write-ups stay in their own dated files under [`verification/`](verification/),
  [`bugs/`](bugs/) and [`audits/`](audits/). This file is the index and the summary, not a
  replacement for them.
- When an item is fixed, delete the row and let the release notes carry it. This file tracks the
  present, not the past.
