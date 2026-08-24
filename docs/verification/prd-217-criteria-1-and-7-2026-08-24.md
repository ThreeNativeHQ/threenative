# PRD-217 criteria 1 and 7 — the same HUD on a Pixel 8 and on the web, and what the overlay costs

**Ran 2026-08-24.** Criterion 3 did not run; the reason is at the bottom and it is a device state,
not a result.

## Criterion 1 — the same `src/ui/` on web and on a physical Pixel 8

The artifact is a **scaffolded starter project**, not an in-repo example: the criterion is about
what a user's agent gets, and the templates are the only thing that ships `src/ui/Hud.tsx`.

```sh
node packages/create-threenative/dist/index.js <target> --template starter --no-install <local tarballs>
threenative build --target android   # THREENATIVE_RUNTIME_SOURCE=packages/runtime-native, JDK 17
threenative build --target web
```

Captures, both at 2400x1080, in `docs/verification/prd-217/criterion-1/`:

| arm | how |
| --- | --- |
| Pixel 8 (`shiba`, Android 17) | `adb shell screencap`, app in the foreground |
| web | headed Chromium on the same machine, WebGPU adapter **nvidia turing**, 0 page errors |

The web arm is captured at 914x411 CSS pixels with `deviceScaleFactor: 2.625`, which is the Pixel's
own layout viewport at its own density — that is what makes "identical except for resolution" a
real comparison rather than a difference of layout width.

```
mean absolute difference: 6.66 / 255  (2.6%)
pixels within 8/255 on every channel: 75.7%
HUD region: 90.6% of pixels within 8/255
```

The HUD matches. The residual is the 3D scene, which the two arms captured at different moments of
an animating scene, and antialiasing.

**Headless Chromium cannot take this capture.** Its WebGPU instance dies (`Instance dropped in
popErrorScope`) and the screenshot comes back white while the DOM is correct — `#root` and `main`
both computed `rgb(4, 8, 13)`, canvas 2400x1080. A screenshot lane that had trusted headless would
have reported a blank UI and sent the reader to the UI code.

## What criterion 1 found — three defects, all shipped, none of which failed anything

Each is fixed in `8fe965c5` with a regression test where one exists:

1. **The UI page's asset links pointed outside the served directory.** Vite emits an entry HTML at
   the same path inside `outDir` that it had inside the root; the page was generated two levels
   deep, so `base: "./"` produced `../../assets/index.js`, and moving the file to the output root
   did not rewrite it. Served from `/ui/`, the web view asked for `/assets/index.js` — outside the
   handler — and loaded nothing. **The HUD was absent on Android entirely.**
2. **Every React template had lost `react()` and `tailwindcss()` from its Vite plugins**, collateral
   from `c2c86cf3`, which removed a third plugin from the same line. The imports remained, so it
   type-checked and built, and `@import "tailwindcss"` still emitted theme and preflight with an
   empty `@layer utilities`. **The scaffolded HUD had been unstyled on every target since.**
3. **The UI layer imported a stylesheet that paints `body`.** `src/ui/main.tsx` is what the
   transparent web view loads, so that is an opaque sheet over the game's frame. It was invisible
   only because `@theme` was never processed and `--color-ink` stayed undefined: **fixing Tailwind
   blacked out the game on every native target at once.**

Nothing in the repository failed while all three were true. Phase 0 and Phase 1 proved the overlay
with `examples/native-smoke`, whose page is hand-written HTML built by `esbuild` — the CLI's Vite
path and the templates' Tailwind were never on that route.

## Criterion 7 — the desktop frame-rate budget

Linux/X11 only. Windows and macOS have no desktop host yet and are not claimed.

| arm | median fps | median frame | present p50 |
| --- | --- | --- | --- |
| overlay attached | 59.99 | 16.44 ms | 16.66 ms |
| no overlay | 59.95 | 16.43 ms | 16.65 ms |

**0.07% apart, against a 5% budget.** Read honestly: both arms are vsync-capped at 60 Hz, so this
says the overlay does not cost a frame, not that it costs nothing. The `overlay` phase the runtime
reports is not the overlay's cost — the arm with no overlay attached reports 0.73 ms in the same
field, so it is the phase timer, not the work.

The same comparison on software rendering (`Xvfb`, llvmpipe) is **8.0% apart** — 36.10 against
39.22 fps — because there the X server composites the extra ARGB window on the CPU that is already
drawing the game. That lane fails the budget and is recorded here rather than dropped; it is not
the configuration the criterion is about, and it is what a machine with no GPU would feel.

## Criterion 3 — not run

The Pixel reached **thermal status 1 at 39.8 °C** and **13% battery** while criterion 1 was being
captured, and the criterion requires both arms at thermal status 0. The device also charges more
slowly over USB than the game discharges it, so the run needs a cool, charged phone and — for the
benchmark preflight's discharging requirement — Wi-Fi ADB. Nothing about the result is known.
