# PRD-216 handoff — React UI on native. Closed 2026-08-24.

**Written 2026-08-23 under a usage cutoff and retained as recovery history. The remaining work was
completed on 2026-08-24; see `docs/verification/prd-216-2026-08-24.md`.**

## Goal, owner's words

> "run on my phone, fps-framework in landscape, I want to see the same react UI that web has, but on native."

## Final state: shipped and proven on the physical device

The recovered branch now contains the React host, pure-TS layout, generated starter integration,
fail-closed diagnostics, device-transport repairs, and Android orientation repair. Browser,
desktop native, and physical Pixel 8 evidence is green. The final Pixel screenshot is 2400x1080,
the UI-update p50/p95 is 2.156/3.655 ms, and iOS is explicitly unproven.

**Phase 0 executed and passed.** `react@19.2.0` + `react-reconciler@0.33.0` mount, update and
unmount under the vendored QuickJS 0.11.0 — **on desktop x86-64 `qjs`, not on a phone**.

| Measure | Result |
| --- | --- |
| bundle | 450.8 KB raw / **71,543 B gzip** |
| mount | 0.274 ms, 7 host nodes |
| 200 state changes | **p50 0.1837 ms**, p95 0.2134 ms |
| 10,000 idle flushes | 4.359 ms total (**~0.4 µs**/frame with no state change) |
| host calls per change | `createInstance 0, appendChild 0, removeChild 0, commitUpdate 7, commits 1` |

Against PRD-214's measured 46.15 ms `renderer.render()` p50 on the device, a 0.18 ms UI update is
noise. **Android runs V8, not QuickJS** (`android/app/build.gradle.kts:16`, `.orElse("v8")`), so
these are the *worst*-case numbers.

## Work in flight — recover it, do not restart

Branch `worktree-agent-a21cccedad3115e91`, **uncommitted**:

```
packages/core/src/react-host.ts          reconciler host config
packages/core/src/react-glyphs.ts        text host nodes
packages/core/src/react-layout.ts        layout
packages/core/src/react.ts               public entry
packages/core/__tests__/react-host.spec.ts
   M packages/core/package.json, tsup.config.ts, pnpm-lock.yaml
   M packages/core/__tests__/constraints.spec.ts
```

Recover with `git -C .claude/worktrees/agent-a21cccedad3115e91 diff` / `status`. Also kept, already
committed on `main`: `docs/verification/prd-216-spike/{host.js,probe.js,prelude.js}` — a working
128-line React 19 host config.

An arm64 `qjs` was cross-compiled at `/tmp/qjs-android/qjs` (NDK 27.1, Android 30) and never used.

## Remaining work, in order

1. **Mount from the portable entry.** `fps-framework`'s `threenative.config.ts` has
   `nativeEntry: "src/game.ts"`; mount the existing `src/ui/` components into `ctx.canvasLayer`
   from there. **Do not touch `src/main.ts`** — web keeps `react-dom`.
2. **Android build → install → launch → screenshot, landscape.** This is the unmet deliverable.
3. Rects/colour so it reads as a HUD, not floating text.
4. Layout subset beyond anchored/absolute.
5. Minimap and TouchOverlay.

## Non-negotiables

- Import `react`, **never `react-dom`**, on the native path. Do not weaken `TN_NATIVE_WEB_ONLY_UI`.
- Mechanism may live in `packages/core`; **appearance ships as generated source**, never in `packages/`.
- **No Yoga** (WASM is refused on mobile), no CSS engine. Layout is pure TypeScript.
- **Tailwind cannot cross.** Approximate styling on native is expected, not a failure.
- A component that cannot render must **fail by name**, never blank the screen.

## React 19 host-config API — already paid for, do not rediscover

`react-reconciler@0.33` has no `flushSync`/`prepareUpdate`. Use `updateContainerSync` +
`flushSyncWork` + `flushSyncFromReconciler`. React 19 **throws at mount** without
`resolveUpdatePriority`, `maySuspendCommit`, `NotPendingTransition`, and a `HostTransitionContext`
object in the host config. Standalone `qjs` lacks `setTimeout`; the real runtime installs
`setTimeout`/`performance`/`console` (`runtime.cpp`), and `prelude.js` (30 lines) covers the gap.

## Device state, left deliberately

Physical Pixel 8, `192.168.1.192:5555` (`shiba`). **Always `-s`** — a USB transport and an emulator
are also attached, and a bare `adb` can silently return an emulator result.

- USB powered, ~29%, 33.3 °C, Thermal Status 0
- `screen_off_timeout` **21600000** (6 h) — **original was `1800000`, RESTORE IT when done**
- `stay_on_while_plugged_in` = 2, keyguard down
- Do not run `KEYCODE_SLEEP`

## Traps that have already cost lanes time today

- Launching onto a locked/dozed screen parks the host in `Waiting for valid ANativeWindow...`
  **forever** — no timeout, no error. The 6 h unlock above is why this is currently safe.
- `TN_ANDROID_SETTLE_MS` defaults to 3000 and **races this device**, surfacing as
  `TN_ANDROID_FOREGROUND_WINDOW: 'android' owns focus` — reads exactly like a locked phone, is not.
  Use `TN_ANDROID_SETTLE_MS=12000`.
- Confirm `topResumedActivity` before any `screencap`; a blind capture returns whatever the screen's
  owner has up.
- `packages/playtest/__tests__/orphan-cleanup.sh` matches **any** Chromium on this machine —
  including `/home/joao/projects/rpg-engine/rpg-client`'s. It reds under concurrent work and is not
  your defect. Run it alone to confirm; complete the suite in two phases if needed.
- The game has a stale `public/assets.manifest.json` (`models/` vs `assets/` path mismatch) that can
  block startup. Move it aside, restore it exactly.

## One open question this PRD does not answer

`docs/verification/core-ktx2-android-2026-08-23.md` justifies the mobile WASM ban as "Android runs
QuickJS, iOS runs JSC without a JIT, so there is no WASM engine at all". **The first half is wrong**
— Android has defaulted to V8 since PRD-130. Whether this Android V8 build carries WASM is
unverified. It does not change PRD-216 (the QuickJS rollback path needs pure-TS layout regardless),
but anyone widening WASM policy must measure rather than cite that sentence.
