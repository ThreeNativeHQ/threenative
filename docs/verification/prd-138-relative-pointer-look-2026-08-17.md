# PRD-138 relative pointer look — verification

Date: 2026-08-17

The engine now exposes raw relative mouse motion and pointer capture through `InputMap`. The FPS
game reads `ctx.input.vector("look")`; its source no longer reaches `document`. Native capture uses
SDL window relative-mouse mode, while the existing SDL `xrel` → `mousemove.movementX/Y` seam stays
in place.

## §2 seam evidence

### Baseline captured before implementation

Command:

```sh
grep -n "requestPointerLock\|SetWindowRelativeMouseMode\|SDL_SetRelativeMouseMode" packages/runtime-native/src/runtime.cpp packages/runtime-native/src/**/*.cpp
```

Observed result: no output, exit 1. Native pointer-lock equivalent did not exist before this
change.

### Current native pointer-lock surface

Command:

```sh
grep -n "requestPointerLock\|SetWindowRelativeMouseMode\|SDL_SetRelativeMouseMode" packages/runtime-native/src/runtime.cpp packages/runtime-native/src/**/*.cpp
```

Observed output:

```text
packages/runtime-native/src/runtime.cpp:3568:        jsEngine_->setProperty(canvas, "requestPointerLock",
packages/runtime-native/src/runtime.cpp:3569:            jsEngine_->newFunction("requestPointerLock", [this, canvas](void*, const std::vector<js::JSValueHandle>&) {
packages/runtime-native/src/runtime.cpp:3571:                if (window == nullptr || !SDL_SetWindowRelativeMouseMode(window, true)) {
packages/runtime-native/src/runtime.cpp:3714:                if (window == nullptr || !SDL_SetWindowRelativeMouseMode(window, false)) {
packages/runtime-native/src/runtime.cpp:3568:        jsEngine_->setProperty(canvas, "requestPointerLock",
packages/runtime-native/src/runtime.cpp:3569:            jsEngine_->newFunction("requestPointerLock", [this, canvas](void*, const std::vector<js::JSValueHandle>&) {
packages/runtime-native/src/runtime.cpp:3571:                if (window == nullptr || !SDL_SetWindowRelativeMouseMode(window, true)) {
packages/runtime-native/src/runtime.cpp:3714:                if (window == nullptr || !SDL_SetWindowRelativeMouseMode(window, false)) {
```

Native pointer lock now exists as `SDL_SetWindowRelativeMouseMode(window, true/false)`.

The pre-existing relative-motion seam was also observed:

```text
packages/runtime-native/src/platform/input.cpp:367:        data.movementX = event.xrel;
packages/runtime-native/src/platform/input.cpp:385:        data.movementX = event.xrel;
packages/runtime-native/src/runtime.cpp:4251:        jsEngine_->setProperty(event, "movementX", jsEngine_->newNumber(e.movementX));
packages/runtime-native/src/runtime.cpp:4285:        jsEngine_->setProperty(event, "movementX", jsEngine_->newNumber(e.movementX));
```

## Acceptance results

1. **Focused input test — pass.**

   ```text
   pnpm vitest run packages/core/__tests__/relative-pointer-look.spec.ts
   Test Files  1 passed (1)
   Tests       2 passed (2)
   exit 0
   ```

   It covers two-event accumulation, tick zeroing, the sampled `vector("look")` value, and
   capture/release state.

2. **Web playtest — pass.**

   ```sh
   sh ../../../../scripts/xvfb.sh node ../../../../packages/playtest/dist/runner/cli.js \
     playtests/look.playtest.json --url http://127.0.0.1:4175 \
     --browser-recipe webgpu --headed \
     --server-command "pnpm dev --host 127.0.0.1 --port 4175 --strictPort"
   ```

   Exit 0. The `camera` assertion passed for `camera.main`; `movement.rotation` passed with
   rotation delta `0.374313223259616`; the observed player yaw changed from `0` to
   `-0.3740000000000001`; diagnostics were empty.

3. **Desktop-target playtest — pass.**

   The same `playtests/look.playtest.json` was run through the repository's existing native
   desktop mailbox runner (`runDevicePlaytest`, target `desktop`) using the temporary working
   verification launcher `artifacts/prd138-desktop-playtest.mjs`.

   Exit 0. The `camera` assertion passed for `camera.main`; `movement.rotation` passed with
   rotation delta `2.198521847666383`; the observed player yaw changed from `0` to `-2.112`;
   diagnostics were empty. The final desktop artifact was rebuilt with `pnpm run build:desktop`.

4. **Native runtime/render smoke — pass.**

   `pnpm native:build` completed all `382/382` native targets. The rebuilt FPS executable rendered
   60 frames under `scripts/xvfb.sh`, saved a non-blank screenshot, and reported an NVIDIA GeForce
   RTX 2080 Vulkan adapter.

5. **No browser-global look code — pass.**

   After `pnpm run build:web`:

   ```sh
   grep -rn "typeof document" docs/benchmark/sweeps/fps-2026-08-17/src
   ```

   Observed result: no output, exit 1 (no hits).

6. **Required repository-wide gate — not green in this lane.**

   `pnpm typecheck` exited 0. `pnpm lint` exited 0 with warning-only cognitive-complexity
   diagnostics. The combined command `pnpm typecheck && pnpm lint && pnpm test` exited 1 because
   two out-of-scope recorded-measurement assertions failed; the suite otherwise reported 132
   passed files and 1,213 passed tests:

   ```text
   scripts/__tests__/sweep-ledger.spec.ts
   expected 1947 to be 1908

   packages/physics/__tests__/actuation.spec.ts
   expected native census rows with src/ 38082, received 38095
   ```

   Those measurement fixtures were not edited because they are outside this PRD's lane.
