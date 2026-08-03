# Spike 0a — rendering on device

**Status:** unstarted. **Charter authority:** `CHARTER.md` §7 "Phase 0", §3 criterion 3.
**Background:** [`../architecture/NATIVE-RUNTIME.md`](../architecture/NATIVE-RUNTIME.md) —
the path and the physics verdict. This document is only the executable plan for 0a.

**Not a PRD.** `CHARTER.md:364` says both Phase 0 spikes ship "no template, no CLI, no
docs, no framework." This is a throwaway app in a directory outside the repo. Nothing it
produces is merged; only its answer is.

## 1. The question

Does `three@0.185.1`'s WebGPU path run outside a browser at all?

Three.js assumes six host globals that React Native does not have: `document`,
`HTMLCanvasElement`, `Image`, `fetch`, `TextDecoder`, `requestAnimationFrame`
(`CHARTER.md:369-371`). `react-native-webgpu` supplies a GPU device; it does not supply
these. The spike measures how much shimming stands between the two.

**Why it gates everything:** if 0a fails, ThreeNative is a web framework, §7's mobile
promise is deleted, and §3's third win criterion ("Ships to iOS") loses its only
mechanism. That is a charter amendment, and it is cheaper to learn it in a day than after
the platformer slice hardens around it.

## 2. Cost and target

| Dimension | Commitment |
| --- | --- |
| Budget | ~1 day. Abandon at 2 and record the failure — that is a result, not a loss |
| Target | Android emulator `threenative_api35` (already on this machine, `~/.android/avd/`) |
| Scene | One spinning cube. Ugly, unstyled, no lighting, no assets, no physics |

**Emulator is sufficient for a negative, not for a positive.** The six globals are a
JS-environment question, and the emulator tests that exactly as well as hardware does — a
failure there is a real failure. A pass still owes a physical-device run before it is
written into `docs/verification/`, because the emulator fakes the GPU driver. Run with
`-gpu host`; the default `swiftshader_indirect` is a software Vulkan path whose result
means nothing either way.

```sh
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
emulator -avd threenative_api35 -gpu host &
```

## 3. What the spike must actually exercise

Not just "a cube renders." These are the specific places `packages/core` assumes a browser,
and each is a separate way 0a can fail:

| Assumption | Evidence | Why it may break |
|---|---|---|
| `RendererLike.domElement` is an `HTMLCanvasElement` | `packages/core/src/renderer.ts:6` | RN's surface is not a DOM node; the type is a lie on device |
| Resize goes through `ResizeObserver` | `renderer.ts:46-55` | No `ResizeObserver` in RN — resize must come from RN layout events |
| `webgpuFactory` override is the seam | `renderer.ts:17,73-74` | If the RN adapter needs more than a factory, `createRenderer` needs a real change, not an override |
| Loop drives `requestAnimationFrame` | `packages/core/src/loop.ts` | RN's `requestAnimationFrame` exists but is not vsync-locked to the GPU surface |

The spike does **not** import `@threenative/core`. It reproduces the four assumptions by
hand against raw `three/webgpu`, so a failure is attributable to three.js or RN rather than
to our wrapper.

## 4. Pass / fail — fail closed

0a **passes** only if all four hold, observed on a running device:

1. A `three/webgpu` `WebGPURenderer` constructs and renders a cube for 300+ consecutive
   frames without a crash or a lost device.
2. The cube visibly rotates — proof the loop advances, not a single frame that happened
   to land.
3. A measured frame rate is recorded. Any number is acceptable; **an unmeasured pass is a
   fail.**
4. Every shim written to get there is listed in §5, with its line count.

**Anything unobserved is a fail.** A pass claimed from a build that compiled, from logs
without a rendered frame, or from the Metro bundler starting, is the exact failure mode
`AGENTS.md` "Verification honesty" names. "0a unresolved" is an acceptable answer.

## 5. What to record, either way

Write the result back here as a `## 6. Result` section, dated, containing:

- The four criteria, each PASS or FAIL with what was observed.
- **The shim inventory** — every global polyfilled, and its cost in lines. This is the
  number that decides whether the RN adapter is a factory (`renderer.ts:17`) or a fork.
  A fork is a §11.5 packages-cap problem and a much larger decision.
- Versions pinned: `three`, `react-native-webgpu`, RN, the emulator system image.
- On failure: which of the six globals or four assumptions killed it, and whether it is
  fixable or structural.

A structural failure triggers a `CHARTER.md` §7 amendment. Propose it in the same commit
as the result — do not leave the charter claiming a promise the spike just deleted.

## 6. Result

Unstarted.
