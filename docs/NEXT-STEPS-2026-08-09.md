# Next steps — agent handoff, 2026-08-09

You are picking up after `fd92899`. Everything below is executable on this machine. Detail and
evidence: [verification/unblocked-2026-08-09-android-touch.md](verification/unblocked-2026-08-09-android-touch.md).

**TL;DR — one fix unblocks three PRDs.** Android touch coordinates are scaled by the SDL
window (`1080x2400`) instead of the canvas (`2400x1080`), so every finger lands in the left
half. Fix that and PRD-053 closes, PRD-055 criterion 2 becomes reachable, and PRD-054's
aggregate parity stops failing.

## Before you start

```sh
export THREENATIVE_JAVA_HOME=/usr/lib/jvm/java-17-openjdk   # default JDK 26 is rejected
export PATH="$HOME/Android/Sdk/platform-tools:$PATH"
~/Android/Sdk/emulator/emulator -avd threenative-prd050 \
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot &
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 5; done
```

Use **`threenative-prd050`**. `threenative_api35` has a stale `wm size 1280x720` override and
renders near-blank. `adb emu event send` prints `OK` for events it silently drops — verify
injection changes with `adb shell getevent -lt /dev/input/event2`, never the exit status.

## Step 1 — fix the touch orientation mismatch

**File:** `packages/runtime-native/src/platform/input.cpp`, `processTouchEvent`.

It does `data.clientX = event.x * width` with `width` from `getWindowSize()`. With a
`landscape`-locked activity on a portrait display, SDL's window stays `1080x2400` while the
canvas is `2400x1080`, so contacts at normalized `x = 0.2 / 0.8` arrive at canvas x
`216 / 865` — both under the `1200` half-width.

Scale by the canvas/surface the runtime actually presents, or rotate window-space into
surface-space. Do not paper over it in the scene.

**Verify:**

```sh
pnpm --filter @threenative/runtime-native native:verify:android:multitouch --device emulator-5554
```

**Done when** it exits `0`. It ships a one-pointer negative control, so a pass is not vacuous.
Expect `maxPointers: 2`, `movedWithTwoPointers: true`, `leftGroundWithTwoPointers: true`,
`currentPointers: 0`. Today the first two already pass and the third does not.

## Step 2 — close PRD-053

Only criterion 4 is outstanding; 1, 2, 3 and 5 are met in `main`. When step 1 is green,
`git mv docs/PRDs/PRD-053-core-input-multitouch.md docs/PRDs/done/` **in the same commit**
that turns it green, and record the run in the PRD. Leave section 7 alone — `pressure`,
`width`/`height` and `pointerType` are a deliberate non-goal.

## Step 3 — PRD-055 criterion 1 on the emulator

Independent of step 1; can be done in parallel. The portable geometry HUD already ships in all
three templates and the emulator lane runs. What is missing is an executed capture showing
hearts-or-score, a counter and a clock rendering on the emulator with no user-authored HUD
code. Record it in the PRD.

## Step 4 — template touch controls, then PRD-055 criterion 2

`grep -rn touchControls packages/create-threenative/templates` returns nothing today.
Criterion 2 allows either shipped controls or "the framework's input surface plus twenty
lines". Either way it belongs in the user's `src/render/` — **never** in a package (Rule 3).
Needs step 1 first, or the controls will register in the wrong half.

## Step 5 — PRD-054 Phase 4, the CI emulator lane

Also independent of step 1. The lane is proven runnable locally, so write and exercise it here
rather than pushing to CI — this repo is on a free plan and minutes are scarce.

## Step 6 — PRD-054 aggregate parity

Only meaningful after step 2. Row `90-multitouch-input` is `implemented` in the registry and
fails until PRD-053 closes.

## Rules that will get your change rejected

- **Never claim a gate you did not run.** Paste the failure. "Unverified" is acceptable;
  "verified" without a run is not.
- **Fail closed.** A check that cannot run must fail, never skip. Do not delete an assertion
  to get green.
- Add the test with the change, in the same commit.
- `pnpm typecheck && pnpm lint && pnpm test` before calling anything done. `pnpm budgets` too
  if you touched package or template layout.
- Editing `examples/native-smoke/src/game.ts` changes the SHA embedded in the generated
  Android bundle; `tests/runtime-next-contract.test.mjs` fails until you regenerate it by
  re-running the multitouch verifier.

## Out of scope — do not attempt

iOS, physical devices, clean-machine builds, registry release runs, PRD-056. No Apple hardware
and no arm64 device on this machine; the owner stated on 2026-08-09 that these are validated
separately. PRDs 046 and 048 are already closed on that basis.
