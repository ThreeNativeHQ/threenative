# Batch — mobile stability on a physical Pixel 8, 2026-08-23

**Status:** NOT STARTED. Six PRDs filed from `docs/bugs/mobile-stability-2026-08-23.md` and its
evidence record `docs/verification/mobile-stability-2026-08-23.md`, with root causes re-proven or
upgraded by the investigation session of 2026-08-24 (device attached over USB throughout).

Bugs **1** (`36831d96`) and **11** (`d6e21511`) were already fixed and have no PRD here.
The "not a bug" items (landscape orientation) are likewise absent.

## Scope and ownership

| PRD | Outcome | Bug doc items | Complexity | Depends on |
| --- | --- | --- | --- | --- |
| [209](./PRD-209-portable-screen-space-text.md) | Framework ships portable screen-space text; spike may close it as G-only | #2 | 4 → MEDIUM | none |
| [210](./PRD-210-native-host-survives-backgrounding-and-crashes.md) | Tombstones return; NULL wgpu handles throw; the loop pauses off-screen | #4, #9 | 6 → MEDIUM | none |
| [211](./PRD-211-android-asset-lane-boots-from-repo-assets.md) | Ogg decodes natively; preflight claims derive from the build they ship with | #5, #10 | 5 → MEDIUM | none |
| [212](./PRD-212-published-install-builds-android.md) | Tarballs are self-contained and substitution-clean; clean-room Android builds | #6, #7 | 5 → MEDIUM | PRD-196, PRD-078 (release milestone) |
| [213](./PRD-213-gpu-memory-is-accounted-and-bounded.md) | The 393→849 MB gap is attributed; game-side sky split; honest ceilings documented | #8 | 4 → MEDIUM | none (feeds 210's repro) |
| [214](./PRD-214-render-js-owns-the-mobile-frame.md) | three.js render owns ~88% of the device frame; bisect, then levers + permanent budget | #3 | 7 → HIGH | none |

## Root causes this batch established beyond the bug doc

- **Bug 4 reframed:** the missing tombstones were self-inflicted — `runtime.cpp:191-206` installs
  signal handlers that sever debuggerd. Proven by the Aug-21 dropbox tombstone that predates
  handler install. Six SIGSEGV exits now recorded, not three.
- **Bug 5 deepened:** there is no Vorbis decoder on *any* native target, not an Android quirk;
  desktop never noticed because its test feeds WAV fixtures.
- **Bug 6 gained a new strand:** HEAD's tarball would break independently
  (`asset-preflight.mjs` missing from `files`).
- **Bug 9 shaped:** SDL3-on-Android queues background events then blocks the pump — poll-based
  pause handling is structurally impossible; `SDL_AddEventWatch` is the only correct mechanism.
- **Bug 3 attributed:** steady-state windows put `renderer.render()` at p50 49.42 ms of a
  54.44 ms rAF; engine plumbing measured innocent (`hostGap` p50 1.42 ms); `worstMs: 27489`
  explained as one tagged hitch; substep-per-markFrame caveat confirmed (`substepsPerRaf` p50 3);
  ~~shadows refuted as the lever~~ — **withdrawn 2026-08-23**: that refutation compared a
  shadows-off build against itself. The bundle the 20:18 measurement ran from already disabled
  `shadowMap` and cleared `castShadow` on every light before the window opened, and no pre-kill
  capture survives. Shadows are **untested**; PRD-214 Phase 0 carries a shadows-ON baseline (R0)
  and shadows-off as an explicit rung (R1).

## Order

1. **211 Phase 2 and 212 Phase 1 first** — small, unblock everything else's proof lanes
   (preflight honesty, self-contained tarballs).
2. **209 Phase 0 spike** in parallel — its outcome decides whether package code exists at all.
3. **210 Phases 1–2** (crash observability) before any long device campaign: every hour spent
   reproducing unnamed crashes is wasted until tombstones return.
4. **213 Phase 1 attribution** next; its output shrinks 210's memory-pressure variable.
5. **214 Phase 0 bisect**, then its levers — the player-feeling blocker, but honest sequencing
   needs the lanes above green.
6. **212 Phase 2's real-release milestone** waits for PRD-078 going green; do not fight the
   release lane's self-deleting cleanup here.

## Explicit exclusions

- No `@threenative/ui` widening; no widget/layout/style ever enters `packages/` (209).
- No ffmpeg-binary assumption anywhere in the asset pipeline (211).
- No speculative wgpu fork or patch; regression versions are measurement only (213, 214).
- No per-game workaround for bugs whose fix layer is `packages/` — the sandbox Bayview tree is
  evidence and consumer, not the fix site (exception: 213's sky split is genuinely game-side).
- iOS claims stay out of every acceptance criterion until a physical lane exists (210, 214).

## Batch acceptance

- [ ] Every PRD has a dated record in `docs/verification/` with observed red controls pasted.
- [ ] Device claims name their lane (physical Pixel 8 vs emulator) and never claim a platform
      that did not execute.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exits 0 after each PRD's phases.
- [ ] The temporary instrumentation named in the bug doc (`sandbox/fps-framework/src/gpuMemoryProbe.ts`
      and its registration) is deleted by whichever PRD supersedes it (214).
- [ ] The bug doc's status column is updated as each numbered item lands, and the batch moves
      whole to `docs/PRDs/done/` only when all six complete.
