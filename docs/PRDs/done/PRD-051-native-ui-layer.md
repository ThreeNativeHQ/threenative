# PRD-051 — the HUD on native: decide before building

**Status: DONE (2026-08-09). Phase 0 killed candidate A and selected D.** The framework
ships no native HUD abstraction; `@threenative/ui` remains a web-shell package. Evidence:
`docs/verification/PRD-051.md`.

`@threenative/ui` is React DOM. The native host installs `document` and `window` only as
Three.js compatibility stubs — `body.appendChild` is a no-op — so **no React HUD has ever
rendered on native, on any platform.** Until PRD-050 lands, the bundler deletes the HUD from
the build without saying so; after PRD-050 the build fails with `TN_NATIVE_WEB_ONLY_UI` and
points here.

**This PRD exists because the answer is a design decision, not a bug fix.** Getting it wrong
means either a UI framework this project has no business owning, or a permanent write-once
hole in the one thing every game has: a score, a health bar, a pause menu.

**Depends on:** PRD-050 (which makes the gap loud and gives this PRD its error path).
**Blocks:** the claim in `/AGENTS.md` that "a feature that works on web only is an unfinished
feature", applied to the UI package.

**Charter authority:** `CHARTER.md` §11 rule 1 (the 20-line rule), rule 3 (**never own the
look** — anything a screenshot shows ships as generated source in `src/render/`), rule 4
(vocabulary is borrowed, never invented), rule 5 (a package exists only when it carries a
dependency the others must not inherit).

**Complexity: unknown until Phase 0. Do not assign a score to an undecided design.**

---

## 1. The constraint that rules out most answers

Rule 3 is the sharp one. A HUD is the most screenshot-visible thing in a game. **The framework
must not own how it looks.** That eliminates any answer of the form "ship a HUD component
library", however convenient.

What exists on both surfaces today, verified:

| Facility | Web | Native | Notes |
|---|---|---|---|
| Three.js scene, orthographic camera, sprites, TSL materials | yes | yes | the renderer is upstream `WebGPURenderer` on both |
| Canvas 2D — `fillText`, `measureText`, `CanvasTexture` | yes | yes — `packages/runtime-native/src/canvas/canvas2d.cpp:436`, `canvas2d_bindings.cpp:149` | a real implementation, not a stub |
| React DOM + CSS + Tailwind | yes | **no, and not planned** | needs a DOM and a layout/CSS engine; the host has neither |
| DOM events on a real element tree | partial stub | no | `document` exists only for Three.js |

**So the portable surface is Three.js plus Canvas 2D, and the non-portable surface is React
DOM plus Tailwind.** Every candidate below is a different answer to "which one does a game's
HUD live in".

---

## 2. Candidates, with the honest cost of each

| # | Answer | What the author writes | Cost | Rule-3 risk |
|---|---|---|---|---|
| **A** | **Portable HUD in user source.** Draw the HUD into an offscreen Canvas 2D, upload as a `CanvasTexture` on an orthographic overlay quad. Runs unchanged on both surfaces today. React/Tailwind stays for the **web page shell** — landing screen, settings, anything outside the canvas. | `src/render/hud.ts` — generated template source, ~40 lines | low; no package code, no new dependency | **lowest** — the look ships as user source, exactly where rule 3 puts it |
| **B** | **A tiny reconciler**: render the same React tree to Canvas 2D on native. | the same `src/ui/*.tsx` on both | high; a layout engine is the part nobody estimates correctly | high — the framework starts owning layout, which is most of the look |
| **C** | **Widen the host's DOM** until React DOM works. | nothing changes | very high; a DOM + CSS engine inside `runtime-native`, against `AGENTS.md`'s explicit "widening that stub is the wrong fix" | high, plus a 50,000-line native LOC trigger it would blow through |
| **D** | **Declare the HUD web-only, permanently.** Native games render everything through Three.js and ship no HUD abstraction. | `src/render/hud.ts`, hand-rolled per game | zero framework cost | none — but it makes "write once" conditional, which is the product promise |

A and D differ only in whether a template **ships** the portable HUD. That is the real
question, and it is cheap to answer with evidence.

**Working recommendation, to be confirmed or killed by Phase 0: A.** It uses two facilities
that already exist on both surfaces, adds no package code, keeps the look in user source, and
leaves React exactly where it earns its place — the web page around the canvas.

---

## 3. Phase 0 — the spike that decides it

Per `CHARTER.md:364`, a Phase 0 spike ships **no template, no CLI, no docs, no framework
code**. It is a throwaway app outside the repo. **Only its answer merges.**

**Question:** can a scoreboard, a health bar and a pause overlay be drawn through Canvas 2D +
`CanvasTexture` in under ~40 lines of game source, and does it look and behave the same on
web and on the desktop native host at the same seed?

**Method:**
1. Take the scaffolded `starter`. Replace its React HUD with a Canvas 2D overlay in
   `src/render/hud.ts`.
2. `pnpm dev` in a browser; `pnpm build:desktop` and run the artifact — both 300 frames,
   same seed.
3. Capture both frames. Compare by eye **and** by a playtest `visual` assertion.
4. Count the lines the author had to write, and record every place the two surfaces diverged
   (text metrics, DPI, colour, timing).

**Answers that kill candidate A** — record them plainly rather than working around them:
- text metrics differ enough that a layout tuned on web is wrong on native
- `CanvasTexture` upload costs more per frame than the HUD is worth on mobile
- the line count lands well past the 20-line rule, meaning the framework is being asked to
  absorb it and rule 3 says it must not

**Deliverable:** an answer appended to this PRD, plus the two screenshots in
`docs/verification/PRD-051.md`. If A survives, the phases that follow are written **then**,
against measured numbers. If it dies, D becomes the recorded decision and this PRD closes
with the product promise narrowed in writing — which is a legitimate outcome, and better than
a UI framework nobody asked for.

---

## 4. Not decided here, deliberately

- **Menus, settings, landing pages.** Outside the canvas, web-only, and probably fine that
  way. A shipped game is a binary on desktop and mobile; its menu can be Three.js too, and
  that is candidate A's problem to demonstrate, not an assumption to bake in now.
- **Whether `@threenative/ui` survives.** If A wins, `ui` keeps carrying the React dependency
  for the web shell — which is exactly why it is a separate package (rule 5). It does not
  gain a native build.
- **Text quality, fonts, i18n.** Downstream of the decision. Naming them now is how a spike
  turns into a framework.

---

## 5. Acceptance criteria for Phase 0 (consumer-scoped)

- [x] The same 40-line HUD source was executed in the browser and desktop artifact at seed
      90210 and captured side by side. The browser rendered all three elements; native did
      not, which is the observed result that killed A.
- [x] The author wrote 40 lines in `src/render/hud.ts` plus three integration lines. This is
      already past the 20-line framework threshold, but rule 3 forbids absorbing the look.
- [x] Every observed divergence is recorded in `docs/verification/PRD-051.md`, with native
      identified as wrong.
- [x] Decision D was recorded before any framework or template implementation. The spike
      remained under `/tmp`; only this decision and its evidence merged.

---

## 6. Phase 0 answer — candidate D

**Decision: D. `@threenative/ui` is web-only; ThreeNative does not ship a native HUD
abstraction or a portable HUD template.** A native game authors its on-canvas interface in
its own Three.js source and proves it on each claimed platform. The product promise is
narrowed accordingly: game and rendering source are shared where the native host implements
their facilities, but React DOM/Tailwind HUD source is not write-once.

Candidate A failed before performance could be measured. The unchanged source built for web
and desktop, but the desktop host created a 1280×720 main-surface Canvas2D context for the
supposed 512×256 offscreen canvas. Three.js then logged
`copyExternalImageToTexture: unsupported source type, width=512, height=256`. Rectangles were
painted at raw surface coordinates, `fillText` produced no visible glyphs, and the Three.js
scene was absent from the captured native frame. The browser frame was readable.

| Measurement | Browser | Linux desktop native |
| --- | ---: | ---: |
| 1280×720 bright text pixels | 1,939 | 0 |
| non-black pixels | 916,243 | 43,896 |
| non-black bounds | full frame | `(18,18)`–`(475,173)` |
| 300-frame execution | captured after five seconds | 18,815 ms |

Candidates B and C remain rejected by the original cost and Charter analysis: both require
the framework to own layout or a DOM/CSS engine. The spike found no evidence that changes
that conclusion. Candidate A is not retained as a future implementation claim; fixing its
host bugs would still leave its measured 43 authored lines on the wrong side of the rule-3
boundary. Reopening this decision requires a new PRD with new evidence.
