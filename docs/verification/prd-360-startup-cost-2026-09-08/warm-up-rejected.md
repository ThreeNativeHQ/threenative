# PRD-360 — turning the warm-up on makes this launch worse

Step 5 of [the handoff](README.md), run as a one-lever A/B on a physical Pixel 8. The lever came
straight out of [the census](pixel-census.md): Bayview's launch runs no warm-up because its loading
surface is a DOM overlay and nothing declares the canvas covered. Declaring it turns the warm-up on.

**The lever is rejected. It is measured worse than doing nothing, twice.**

## Arms

Both APKs were built from the same engine — `@threenative/core` packed from this branch and
installed into the sandbox — and differ in exactly one game-side declaration in
`src/scenes/Play.ts`:

```ts
ctx.canvasLayer.opaque = true;                  // during loading
void ctx.startup.whenReady().then(() => {
  ctx.canvasLayer.opaque = false;               // once the world may draw
  …
});
```

| Arm | APK SHA-256 |
| --- | --- |
| baseline | `6fa87b48ed691b04cfeefd5fbf4146c91704ab4d4cab35ccf9133816d01fe7b9` |
| candidate | `f43c79bba891b3f35ecace9fb093b24a9c031fce39f155549c4c6a7b84c822b4` |

## Result

Cold launch, `am start -W`, logcat with timestamps:

| | baseline | candidate |
| --- | --- | --- |
| `Displayed` | 398 ms | 513 ms |
| scene enter (`sinceNavigation`) | 2,505 ms | 3,296 ms |
| warm-up | `{"skipped":"no-startup-cover","opaque":false}` | ran for **20,988 ms** |
| warm-up outcome | — | `{"compiled":0,"pipelines":494,"abandoned":1,"timedOut":true,"firstUseRendered":false}` |

A second candidate launch earlier the same session reported
`{"compiled":1,"pipelines":494,"elapsedMs":15028,"timedOut":false,"firstUseRendered":true}`. Both
runs are far worse than the baseline's 8,513 ms of synchronous first-frame compilation, and the
20,988 ms run is the failure mode `packages/runtime-native/src/runtime-scripts/install-async-pipelines.js`
already documents in its header: a warm-up that exceeds its budget and compiles nothing.

`firstUseRendered: false` in that run is the coverage seam's own budget guard behaving as designed —
an exhausted budget releases the game rather than spending more of it on a render.

### The game still works; only the launch is worse

The movement scenario passes identically on both arms — `distance 2.1467 m`, `frames 70`,
`pass: true` — so this is a launch-cost rejection, not a correctness one.

## Correction to the census's ranking

[pixel-census.md](pixel-census.md) ranked "no warm-up runs" first, worth *up to* 8,513 ms. That was
an upper bound reasoned from the composition, and the measurement contradicts it: turning the
warm-up on costs **15–21 s**, not 8.5 s saved. The corrected ranking is:

1. **`compileAsync` itself is the problem on this device.** three walks 490 renderables one at a
   time, awaiting each object's pipeline promises and yielding between them
   (`three.webgpu.js:60259`, `:60278`, `:60285`). That walk is slower than letting the first frame
   compile the same 101 pipelines synchronously. This is the handoff's serial-scheduling lever, and
   it is now the only one left.
2. Shadow and output first-use coverage — 986 ms of 8,513 ms, implemented, engaged only behind a
   cover, and worth nothing here until (1) is fixed.
3. Declaring the cover — **rejected**, measured worse.

## What did not change

Nothing was removed to make a number: no assets, shadows, effects or resolution were touched, and
the render configuration is the game's own ACES/exposure with no post chain. The sandbox source,
its installed engine and the phone were all restored to as-found; the reinstalled APK is
`612489275de59ebf4280364aa8c2bcad73215063c4c5b0494e0d0c34947b150e`, byte-identical to the build
that was on the device beforehand.

## Limits

- One cold launch per arm plus one earlier candidate launch. Not three qualified runs, and no
  thermal qualification window was taken — the rejection does not need one, because the candidate
  loses by 7–12 seconds, but an acceptance claim would.
- No first-playable timeline was captured; `Displayed` is the loading surface, not the world.
- PRD-360 remains **PARTIAL** and unmet. Nothing here brings the launch closer to 8,000 ms.
