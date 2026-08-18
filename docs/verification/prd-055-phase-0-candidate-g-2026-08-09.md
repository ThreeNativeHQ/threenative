# PRD-055 Phase 0 / candidate G verification — 2026-08-09

> **Relabelled 2026-08-18 by PRD-155 Phase 2.** The desktop half of this document's capture proof
> came from the runtime's own screenshot path, which copied the surface mid-frame until `473f9f3`.
> The candidate-G scaffold that produced it has been retired, so the desktop row **cannot be
> re-run**. The browser and emulator halves are unaffected — an emulator capture reads the
> composited display. See `docs/verification/prd-155-2026-08-18.md` §2.

**Result: candidate G renders on all three targets; PRD-055 remains blocked by touch
playability and row 25.** No package gained a widget, layout system, style, React dependency,
or browser-only rendering path.

## Candidate G

Minimal, starter, and platformer generate user-owned `src/render/hud.ts`. Each uses one
camera-parented `InstancedMesh` of baked 5-by-7 plane glyphs and shows:

- minimal/starter: `SCORE`, `ITEMS`, `TIME mm:ss`;
- platformer: `HEARTS`, `COINS`, `TIME mm:ss`.

The source imports only Three.js and its template palette. It has no React, framework HUD
API, browser global, `CanvasTexture`, or target branch. A scaffold user authors **0 HUD
lines**. Generated HUD source is disclosed separately: 52 physical lines in minimal, 52 in
starter, and 46 in platformer.

The first scaffold capture exposed that all three HUDs were camera children but their cameras
were absent from the scene; adding `ctx.add(camera)` made them render. Platformer's compact
variant also omitted `renderOrder`, so its depth-disabled glyphs were overwritten by later
world/postprocessing draws. Restoring `renderOrder = 10_000` fixed it while removing one
non-runtime comment kept the hard cap at exactly 1,200 LOC. Platformer uses its existing dark
palette color for better contrast over the pale sky.

Actual 1280×720 captures show the expected three labels on web, desktop, and emulator-5556:

- minimal: `/tmp/tn-prd055-hud-final-minimal/{web,desktop,android}`;
- starter: `/tmp/tn-prd055-hud-final-starter/{web,desktop,android}`;
- platformer: `/tmp/tn-prd055-hud-platformer-readable/{web,desktop,android}`.

The whole-project exact-byte comparison is not claimed green. Starter contains a live `time`
shader and an asynchronous Boot→Play transition, while targets capture at different wall-clock
phases. Three synchronization/tolerance attempts produced unstable mismatch ratios from 0.52
to 0.92 and were reverted. The doubtful assumption is that one unsynchronized screenshot can
be a stable whole-project parity oracle for time-dependent games.

## Phase 0 text proof

Row 30 renders exact `SCORE 1200` from one source on all targets. The source proof requires
161 glyph instances and glyph-space bounds `[0,0,58,6]`. The capture proof independently
requires at least 1,000 bright pixels and no more than one pixel of bounds drift.

Final browser, desktop, and Android results each recorded:

- 2,152 bright raster pixels;
- bounds `[49,56,313,85]`;
- bounds delta `[0,0,0,0]` on native targets;
- non-uniform 1280×720 capture and zero GPU errors.

Candidate E is closed as unnecessary: candidate G reaches readable, cross-target text with
zero user-authored lines, so a package-owned text API would not reduce authored game code.
Row 31 also passes in the complete 66-row matrix and fails closed unless text, instance count,
and matrices all change (`SCORE 1200` → `SCORE 8888`).

## Gates run

| Gate | Result |
| --- | --- |
| template/scaffold focused Vitest | PASS; malformed glyph and missing camera/render-order contracts included |
| `pnpm tsx scripts/visual-gate.ts --build-only` | PASS for all three scaffolds |
| `pnpm budgets` | PASS; largest template exactly 1,200 LOC |
| row-30 browser/desktop/Android execution | PASS; raster metrics above |
| full browser/desktop/Android registry | PASS 66/66 visual rows on each target |
| Android multi-touch supplemental | FAIL; first proof passes, positive scenario observes `maxPointers=0` |

## Remaining blockers

1. **Acceptance criterion 2:** Android is not touch-playable. PRD-053 stopped after three
   rootless injection attempts; raw protocol-B events reach `event2` but do not become
   MotionEvent/SDL touch.
2. **Row 25:** the required two sizes × two orientations proof stopped after three fixes.
   Portrait `readRenderTargetPixelsAsync` buffers pad every row except the last, disproving
   the attempted uniform-stride inference. The prior single-viewport row was restored and
   remains green; no four-viewport claim is made.
3. **Project parity synchronization:** visual HUD presence is captured, but the generic
   project-mode whole-frame metric needs an explicit capture-readiness/state protocol before
   time-dependent projects can produce a stable cross-target verdict.
