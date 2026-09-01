<!-- schemaVersion: 1 -->

# A scaffolded starter is black on a Pixel 8 — observed 2026-09-01

This run was meant to answer one question for PRD-304: **the starter's `low` tier renders a blank
frame on this desktop's WebGPU path — is that the tier, or is it this machine's adapter?** A phone
runs `low` by itself, because `isMobile()` is true there, so putting the scaffolded starter on a
Pixel 8 is the cleanest test available.

It did not answer that question. It surfaced a different one, recorded here so the next reader does
not spend the same hour rediscovering it.

Base: `origin/main` at `ba728071`. Device: Pixel 8 (`shiba`), Android over Wi-Fi adb, charging,
`TN_WEBGPU_FEATURES` confirming `timestamp-query: true` on Mali-G715.

## What happened

The scaffolded starter builds and installs cleanly:

```
BUILD SUCCESSFUL in 1m 52s
ThreeNative Android APK: /tmp/prd304-device-.../starter/dist-native/starter.apk   (107 MB)
$ adb install -r -d starter.apk
Success
```

It launches, evaluates its bundle, starts its loop — and then **shows a black screen and says
nothing**:

```
I MystralStdio: [Mystral] Runtime initialized
I MystralStdio: [Mystral] Evaluating script: asset://scripts/main.js (4741708 bytes)
I ActivityTaskManager: Displayed com.threenative.starter/…MystralActivity for user 0: +1s56ms
I MystralStdio: [Mystral] Starting main loop...
   ‹ nothing further from the app ›
```

A screenshot eleven minutes after launch is uniformly black (1080×2400).

**No game-level marker is emitted at all** — not `TN_RENDER_PROJECTION`, not `TN_QUALITY_TIER`, not
`TN_RENDER_CHAIN`, not `TN_FRAME_BUDGET`. The only marker of ours in the whole logcat is
`TN_WEBGPU_FEATURES`, printed by the host at device creation. (`TN_COLD_START`,
`TN_UI_OVERLAY` and friends in that log are Android's own, not ours — a prefix collision worth
knowing about when grepping.)

So the game never reached `setupPost`, which means **this tells us nothing about the `low` tier.**
Whatever stops it happens earlier.

## What it is not

- **Not the device.** The in-repo Android first proof (`examples/native-smoke`) ran on this same
  phone minutes earlier: 300 frames, a rendered quad in the screenshot, `gpuMs 0.19`, clean logs.
- **Not `Bindings initialized (backend: none)`.** That line is suspicious and it is a red herring:
  the native-smoke run that *worked* prints exactly the same line.
- **Not a crash.** The process stays alive (`pidof` returns), the activity stays displayed, and no
  exception, rejection or error reaches logcat.

## What it might be, unverified

The starter loads three assets through `ctx.assets` in `enter()` — a texture, a `.glb` and a `.wav`.
If any of those never settles on native, the loading screen stays up and the scene never enters,
which matches exactly what is observed: a live process, a black frame, and no scene-level output.
**That is a hypothesis, not a finding**; nothing here confirms it, and no error was logged either
way, which is itself the thing worth fixing — a game that cannot load an asset on device should say
so, and this one is silent.

## Consequence

- **PRD-304 stays PARTIAL.** Its open criterion — a game renders visibly cheaper at `tier: "low"`
  than at `tier: "high"` — remains unproven, and the desktop blank frame it depends on is still
  unattributed between "the mobile preset" and "this machine's software adapter".
- This needs its own lane: **a scaffolded template on Android boots to a black screen with no
  diagnostic.** It is a bigger claim than PRD-304's, because "the same source on web and native" is
  the framework's founding sentence and no in-repo gate covers a *scaffolded* game on a phone —
  only `examples/native-smoke`, which is not a template.

## Not executed

- No emulator run, no iOS, no desktop-native run of the same scaffold.
- No attempt to bisect the hang: the next step is instrumenting the loading path, or running the
  same scaffold on desktop native (`pnpm test:native`) to see whether it is Android-specific.
