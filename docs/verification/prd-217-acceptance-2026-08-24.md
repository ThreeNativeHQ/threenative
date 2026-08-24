# PRD-217 — acceptance criteria, one row at a time

**2026-08-24.** Each row says what executed, or says plainly that nothing did.

| # | Criterion | Status |
| --- | --- | --- |
| 1 | The same `src/ui/Hud.tsx` renders on web and on a physical Pixel 8, indistinguishable to a blind observer | **NOT RUN** |
| 2 | Four touch rules asserted in a `--target android` playtest, each with its mutation named | **PASS** |
| 3 | Pixel frame rate within 5% of the same build with the HUD disabled | **NOT RUN** |
| 4 | `TN_NATIVE_WEB_ONLY_UI` still fires for react-dom in the portable entry | **PASS** |
| 5 | A game that does not opt in ships no WebView and no extra process | **PASS** |
| 6 | iOS is either proven or stated unproven | **PASS** (stated unproven) |
| 7 | Desktop carries its own frame-rate budget, named per platform | **NOT RUN** |
| 8 | No game-visible config, type or doc names `wry`, `cef`, `webview2` or `webkitgtk` | **PASS** |

## 2 — the four touch rules

`docs/verification/prd-217-phase-0-2026-08-24.md`. Android emulator, all seven assertions green,
and the mutation PRD-217 names — clearing the rect registry — turns four of them red.

Desktop gets the same protocol through the X server rather than the view hierarchy, measured
separately in `prd-217-phase-3a-2026-08-24.md`: a click inside a published island answers with the
overlay, a click elsewhere answers with the game window, and publishing no input shape sends every
click to the overlay.

## 4 — the portable-entry guard

`packages/create-threenative/__tests__/build.spec.ts` →
"still refuses react-dom in the portable entry after the UI layer landed". The guard is about the
graph that reaches `THREE.Scene`; the UI ships as a separate bundle the packager stages under
`assets/ui/` and which never passes through that check. Both facts are now asserted, because the
temptation after this PRD is to conclude the guard was superseded.

## 5 — opting out costs nothing

Three independent assertions, because there are three places a game could accidentally pay:

- **No overlay.** `tests/android-packaging.integration.test.mjs` compiles the real activity against
  a probe that counts attaches: a game with no `ui.renderer` attaches none, `"web"` attaches one,
  and an unrecognised value attaches none.
- **No bundle.** `tests/ui-layer-packaging.test.mjs` — Android, desktop and iOS all refuse to stage
  a UI for a `native` game and all refuse to package a `web` game without one.
- **No serialisation.** `packages/core/__tests__/ui-state.spec.ts` →
  "should publish nothing while no overlay is attached". A `native` game on a native host has
  `__tnUiPost` installed and no overlay; the publisher writes nothing at all rather than
  serialising the store ten times a second for a reader that does not exist.

## 8 — the backend is never public API

The public surface is `ui: { renderer: "web" | "native" }`. Checked here, over the game-visible
tree — a game's config, the types it imports, the templates it starts from, and the docs it reads:

```sh
$ grep -rniE "\b(wry|cef|webview2|webkitgtk)\b" \
    packages/core/src packages/ui/src packages/create-threenative/templates \
    packages/create-threenative/agent-docs
(no matches)
```

The names appear only where they are implementation: `packages/runtime-native/native/ui-overlay/`,
the CMake that links it, the C++ that calls it, and the evidence records.

One pre-existing mention survives outside that set and is not this PRD's: `docs/architecture/
NATIVE-RUNTIME.md` names WebKitGTK 2.26.4 as the version JavaScriptCore's Android build is pinned
to. That is about the JS engine, has nothing to do with the UI layer, predates this work, and is a
repository document rather than one a game reads.

## 1, 3 and 7 — not run, and why

Criteria 1 and 3 need a physical Pixel 8 with a real game built against these packages, and
criterion 7 needs the same shape of measurement on each desktop platform. Neither happened. What
exists instead:

- The **compositing** question those criteria were really about was already answered before the PRD
  was written: a transparent WebView over the GL surface measured 16.88 FPS against 18.26 with it,
  at a 0.8 °C lower start temperature — inside run-to-run variance.
- That measurement used a throwaway page. **A HUD driven at 60 Hz from game state will cost more
  than zero**, and nothing here has measured it.
- Desktop has no per-platform frame-rate figure at all. Windows and macOS have not been run in any
  respect.

No row above claims otherwise, and nothing in the repository reports these as done.
