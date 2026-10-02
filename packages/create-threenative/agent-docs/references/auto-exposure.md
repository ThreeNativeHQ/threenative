# Optional eye adaptation

`src/render/exposure.ts` owns the metric, luminance floor/clamp, spatial weight, target grey,
exposure limits, asymmetric response rates, cut thresholds and marker cadence. It is game source,
not engine configuration. `enabled: false` is the qualification default; no shipped picture changes
merely because these files exist. Browser fixture pixels have been captured; native parity and the
full transition/cold-boot acceptance remain unqualified.

`autoExposure.ts` reduces the existing unexposed colour texture in 4×4 blocks and adapts in log2
space on separate 1×1 ping-pong targets. Odd-sized edge blocks are masked rather than repeated.
There is no extra scene draw, tonemapper, or render loop. Wire it ahead of bloom and the output
transform; never multiply both its absolute exposure and the old constant. `applyExposure` scales
RGB and preserves alpha: multiplying a whole vec4 darkens low-exposure output again when the
browser composites its reduced alpha onto the page.

For an existing WorldEnvironment chain, its `baseColour` callback already supplies the world pass:

```ts
const settings = qualityPreset("high");
let eye: AutoExposureNode | undefined;
const world = new WorldEnvironment({ ...settings, exposure: 1 });
const applied = world.apply(renderer, scene, camera, {
  baseColour(worldPass) {
    const colour = worldPass.getTextureNode("output");
    eye = new AutoExposureNode(
      colour,
      { ...exposureSettings, enabled: true },
      settings.exposure ?? 1,
    );
    return applyExposure(colour, eye.exposureNode);
  },
});
// On scene exit, release both owners; do not recreate eye for a viewport resize.
applied.dispose?.();
eye?.dispose();
```

Import the classes/functions from this game's `src/render/` files. If a baseColour composition
already exists (for example aerial perspective), meter that scene-referred composition using its
existing texture; do not create a second scene pass. Keep the existing chain's output cleanup.

- `eye.setEnabled(false)` keeps measuring and tracking the hypothetical adaptation while returning
  exactly the supplied constant. The graph must remain attached, so quality opt-out never silences
  measurement. `quality.ts` decides when to apply the convention; this file decides its look.
- `eye.reset()` adopts the next measured target; `eye.reset(value)` seeds a known cut. Reset only
  for an authored cut/level load. Resizing changes meter targets but preserves the 1×1 history.
- `eye.getObservation()` and `TN_AUTO_EXPOSURE` report actual GPU luminance, applied stops, target
  stops, settled state and `applied`. Before the first readback, or on invalid readback, `measured`
  is false; it never fabricates a zero reading. Diagnostic readbacks are bounded to one in flight.
- A replaced chain owns a replaced node. Dispose the old pair; do not leave a second history graph
  alive. Continuous quality-rebuild history transfer is not yet integrated with `setupPost`.

Qualify an authored policy using the same camera in dark and bright poses, cuts in both directions,
known resets, viewport/resolution changes and disabled measurement. Inspect actual canvas captures
and the named adapter. A software-adapter image proves pixels, not native support or hardware cost.
