<!-- schemaVersion: 1 -->

# The mobile look was a black screen, on every phone and 7 of 8 templates — 2026-09-01

PRD-304's last open criterion was *a game renders visibly cheaper at `tier: "low"` than at
`tier: "high"`*. It could not be shown because `low` rendered **nothing** — a black frame with the
chain still cheerfully reporting every stage as applied.

That turned out not to be a tier problem, a preset problem, or this machine's adapter. It was one
line of generated render source, and it made **the shipped mobile look of seven templates draw a
black screen on real phones**.

Base: `origin/main` at `ba728071`. Desktop: Chromium under a private Xvfb. Device: Pixel 8
(`shiba`), Android over Wi-Fi adb, charging.

## The symptom, in two places

**Desktop, `tier: "low"` forced:** a uniform frame behind the DOM HUD. `distinctColors 637`,
`luminanceStdDev 0.0181`. The console shows the chain applying its stages and WebGPU refusing the
pipeline:

```
TN_RENDER_CHAIN:{"applied":{"dropped":[],"requested":["sharpen","bloom"],"stages":["sharpen","bloom"],…}}
THREE.WebGPURenderer: Render pipeline creation failed (renderPipeline_MeshStandardMaterial_28):
  Color target has no corresponding fragment stage output but writeMask
  (ColorWriteMask::(Red|Green|Blue|Alpha)) is not zero.
 - While validating targets[1] framebuffer output.
```

**Pixel 8, scaffolded starter:** black screen, and **no game marker at all** — the app evaluated its
bundle, printed `Starting main loop...`, and then said nothing. Not a crash: the process stayed
alive and nothing reached logcat. A phone picks `low` on its own, because `isMobile()` is true
there, so it is the same defect one step earlier — it never got as far as printing
`TN_QUALITY_TIER`.

## The cause

`worldEnvironment.ts` requested four texture nodes **unconditionally**, immediately after the block
that decides whether an MRT is needed at all:

```ts
if (options.ssgiEnabled || options.ssrEnabled || options.gtaoEnabled) {
  scenePass.setMRT(mrt({ output, normal: normalView, metalness, roughness }));
}
const depth = scenePass.getTextureNode("depth");
const normal = scenePass.getTextureNode("normal");     // ← creates the target
const metal = scenePass.getTextureNode("metalness");   // ←
const rough = scenePass.getTextureNode("roughness");   // ←
```

**Asking a pass for `normal` is what creates the extra render target.** At `low` no stage needs one
— the mobile look is bloom and the tone curve — so the pass ended up carrying a colour attachment
no fragment shader writes, and WebGPU refuses that pipeline outright. The frame comes out black
while every report says the chain is fine, which is the worst shape a failure can take.

The corroborating detail: **`sailing` is the one template that never had those four lines**, because
it runs no SSGI and no SSR at any tier. It is also the one template whose mobile look was never
black.

## The fix

The four nodes are requested lazily, through one memoised accessor, so a tier that runs none of the
stages needing them never asks:

```ts
const depth = (): … => textureNode("depth");
```

Seven templates changed; `sailing` needed nothing. No preset, no stage list and no strength moved —
this changes *when* a texture node is requested, not what any tier contains.

## The proof

**Desktop, same scaffold, default twice then forced `low`:**

| capture | tier reported | distinctColors | luminanceStdDev |
| --- | --- | ---: | ---: |
| default (a) | `high mobile=false source=platform` | 15,858 | 0.0655 |
| default (b) | `high mobile=false source=platform` | 15,858 | 0.0655 |
| forced low | `low mobile=false source=override` | **16,312** | **0.0710** |

```
same-code noise band (a vs b): 42.536% of pixels moved; mean |Δ| 0.283/255
the switch        (a vs low):  93.622% of pixels moved; mean |Δ| 2.903/255
```

`low` draws the game — the same scene, flatter, without the screen-space stages — and it differs
from `high` by **10× the same-code noise band**. Before the fix that same capture read
`distinctColors 637`, `luminanceStdDev 0.0181`: a blank.

**Pixel 8, the scaffolded starter, after the fix:**

```
TN_QUALITY_TIER low mobile=true source=platform
TN_RENDER_CHAIN:{"applied":{"dropped":[],"requested":["sharpen","bloom"],"stages":["sharpen","bloom"],…}}
"gpuMs":0.35
```

The phone renders the full scene and HUD, resolves `low` by platform exactly as designed, and
reports GPU time. Before the fix the same device, same APK path, produced a black screen and not one
of those three lines.

## What this was not

- **Not the device.** `examples/native-smoke` rendered on this phone before the fix.
- **Not PRD-304.** A control run against `origin/main`'s templates, forcing the incumbent
  `mobilePreset` with `mobile: true` and no PRD-304 code, produced the identical blank with the
  identical four capture statistics. The defect predates the quality switch; the switch is what made
  it reachable on a desktop and therefore visible.
- **Not `Bindings initialized (backend: none)`.** That line looks like a cause and is not — the runs
  that worked print it too.
- One trap worth knowing when grepping a device log: `TN_COLD_START`, `TN_UI_OVERLAY` and friends
  are **Android's own**, a prefix collision with ours.

## Gates

| Gate | Result |
| --- | --- |
| Pristine scaffold typecheck, all 8 templates | pass |
| `pnpm exec vitest run` | 3181 passed, 1 skipped |
| `pnpm typecheck` / `pnpm lint` / `pnpm budgets` | pass |
| Desktop capture, default and forced `low` | above |
| Pixel 8, scaffolded starter | above |

## Not executed

- No iOS, macOS or Windows run; no emulator run.
- The other six affected templates were not captured individually. They share the identical
  `worldEnvironment.ts` (one md5 across all seven), all eight still typecheck as pristine scaffolds,
  and the starter is proved on two platforms — but *shown* is the starter, and that is what this
  file claims.
