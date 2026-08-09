# Native / mobile PRDs — the sequence

**Status (2026-08-09):** Linux and Android-emulator starter artifact parity is proven;
Apple/Windows execution and published prebuilt consumer distribution remain open. PRD-050
closed the native entry and packaged-asset divergences. PRD-051 closed with no native HUD
abstraction; PRD-052 still owns mobile navigation.

**Every Apple row below is blocked on hardware, not on work.** The operator has no Apple
machine as of 2026-08-08 — no Xcode, no `xcrun`, no simulator, no physical device. iOS
implementation still proceeds and merges on its fail-closed contract tests; what waits is
the executed evidence. Linux and Android lanes are unaffected and keep their executed-run
requirement. A blocked row is still an open row: do not move one to the Proven column.

| Proven | Open |
|---|---|
| Desktop framework absorption, 300 frames + screenshot | iOS: no simulator app, launch, log or screenshot |
| Android framework-version parity at catalog Three 0.185.1 | iOS: app/verifier implemented, no Xcode/simulator execution |
| Android device playtest with all fail-closed controls | Windows/macOS desktop lanes never run on a real runner |
| Normal public native physics API: x86_64 emulator + negative controls; both ABIs compile | Published runtime assets/checksum lock and clean-machine consumer build |
| Web CLI parity plus all 25 packed-template scenarios | Physical mobile hardware: no GPU, arm64 execution or frame-rate evidence |
| Scaffolded starter artifact: declared entry, texture + GLB on Linux and Android emulator | — |
| Native HUD decision: no framework abstraction; game-authored Three.js source only | Navmesh pathfinding on mobile remains undecided (PRD-052) |

Evidence: `docs/verification/PRD-047.md`, `docs/verification/PRD-045.md`,
`docs/verification/PRD-046.md`, `docs/verification/PRD-049.md`, and
`docs/verification/PRD-050.md`, and `docs/verification/PRD-051.md`. **Never summarize this
folder as "mobile works" while the right column has rows in it.**

**Roadmap position:** `ROADMAP.md` **Phase 3**, whose gate to start is *"Phase 2 exit gate
green."* Phase 2 is not green — PRDs 033, 035, 036 and 038 are all "partial, release
evidence pending." **Nothing in this folder starts before that.** Phases are gated, not
scheduled.

## The active sequence

```
PRD-047  ──►  PRD-045  ──►  PRD-046  ──►  PRD-048  ──►  PRD-050
absorbed      playtest      native        CLI and       the build
runtime       on device     physics       distribution  tells the truth
                                                            │
                                              PRD-051 ◄─────┴─────► PRD-052
                                              HUD on native         pathfinding
                                              (decide first)        on mobile
```

| # | PRD | What it buys | State |
|---|---|---|---|
| 1 | [PRD-047](PRD-047-mystral-runtime-absorption.md) | The runtime, absorbed as `packages/runtime-native`; render/lifecycle integration | **in progress** — Phases 0–4 closed; Apple/Windows execution open; 6 split out |
| 2 | [PRD-045](blocked/PRD-045-playtest-on-device.md) | The app can be *proven*, not just seen | **blocked** — in `blocked/`; criteria 1–6 and 8 met, only the iOS simulator run is left and no Apple machine exists |
| 3 | [PRD-046](PRD-046-physics-native.md) | Native Rapier behind a coarse host-neutral ABI | **in progress** — web + Android closed; iOS and published consumer proof open |
| 4 | [PRD-048](PRD-048-native-distribution.md) | A user with no C++ toolchain ships a game | **in progress** — web/Linux/source-Android proven; prebuilt consumer + Apple/Windows open |
| 5 | [PRD-049](done/PRD-049-physics-parity-verification.md) | Measured web/host/device agreement through the shared physics API | **done** — browser, linked Rust, and Android x86_64 observable parity proven; broader platform claims remain open |
| 6 | [PRD-050](done/PRD-050-native-build-parity.md) | The native artifact is the game the author wrote, or it refuses to build | **done** — Linux desktop + Android emulator executed; iOS packaging-only |
| 7 | [PRD-051](done/PRD-051-native-ui-layer.md) | A decision on how a HUD reaches native at all | **done** — candidate A failed; D binds, so no native HUD abstraction ships |
| 8 | [PRD-052](PRD-052-navigation-on-mobile.md) | The navmesh gate PRD-046 §255 opened and nobody owned | **proposed** — Phase 0 is a measurement |
| — | [PRD-044](done/PRD-044-native-render-adapter.md) | Superseded React Native host/package proposal | **archived** — do not execute |

**PRD-050 closed the fail-open artifact divergences.** Native builds now use a declared
portable entry, reject unsupported graphs, and stage `public/` on every target. The durable
proof is the scaffolded starter on Linux and the Android emulator, with missing-asset
controls. PRD-051 deliberately closed without a native HUD system; PRD-052 remains open
because this build fix does not invent a Recast port.

**PRD-048 is last in the diagram but not gated behind PRD-046.** It depends on PRD-047
Phases 2 and 5, not on physics. Its Phase 0 — deleting 1,159 lines of dead Mystral demo
tooling — is the cheapest item in this folder and frees native LOC headroom that PRD-046
will need, so it is a reasonable thing to run first regardless of sequence.

**PRD-047 §4 Phase 4 and PRD-046 describe the same native-physics work.** PRD-047 is the
summary and the authority; PRD-046 is the executable spec. If they disagree, PRD-047 wins.

**Why physics is last, not first.** It is the most valuable artifact and the most dangerous
to ship unproven: its failure mode is a subtly wrong simulation, invisible to a screenshot.
PRD-045 builds the instrument before PRD-046 builds the thing that most needs measuring.
PRD-044 §4 took a deliberate, time-boxed exception to the playtest rule because rendering
failures *are* visible, and PRD-047 Phase 2 inherits it; that exception does not extend to
physics.

**Why 0a is not a PRD.** `CHARTER.md:364` — a Phase 0 spike ships "no template, no CLI, no
docs, no framework." It is a throwaway app outside the repo and only its answer merges.
Keeping that framing costs zero charter amendments and zero package slots.

## Decisions now binding

1. **The package boundary.** Private examples are reported separately. **Reversed
   2026-08-08:** the runtime is absorbed as `packages/runtime-native/`, taking framework
   packages 5 → 6. It is the only new package — there is no `@threenative/native`, and the
   ten-package split proposed by the runtime's own PRD is rejected under rule 5. Native
   source is excluded from the 15,000-line framework review trigger and measured against
   its own 50,000-line review trigger.
2. **Web is unchanged.** The runtime serves desktop and mobile only. The browser keeps
   Vite + `three/webgpu`.
3. **No hardware exists (2026-08-08).** Android emulator evidence closes JS/runtime
   plumbing only. Real GPU drivers, arm64 physics and phone performance stay OPEN.
4. **No `@threenative/physics-native`.** Native physics is a build-condition backend inside
   the existing `@threenative/physics` package, with the Rust library compiled into
   `packages/runtime-native`. No additional package is justified, and the transport is a
   host-neutral C ABI, not JSI.
5. **Native LOC has its own review trigger.** `nativeRuntimeLoc: 50,000` covers
   `packages/runtime-native` excluding `third_party/`. Crossing it requires PRD
   justification and a kill-switch pass; tracking any `third_party/` file is a hard failure.

## A note on this folder

This subfolder groups one execution sequence; it does not route around a PRD-count limit.
The Charter defines no numerical documentation or active-PRD budget. `pnpm budgets` reports
the direct `docs/PRDs/` file count for visibility only.
