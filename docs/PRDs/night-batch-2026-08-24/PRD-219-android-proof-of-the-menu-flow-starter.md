---
prd_contract: v1
---

# PRD-219 — The starter's menu flow proves itself on Android

**Status:** NOT STARTED — filed 2026-08-24 for the night batch.
**Complexity:** +2 multi-package (playtest, create-threenative), +1 platform seam (webview
pointer transport) = **3 → LOW/MEDIUM**, checkpoint after every phase.

**Depends on:** the three day-batches merged to HEAD (starter `MainMenu`,
`menu-flow.playtest.json`, `goto(name, { carry })`, the `click` step) and PRD-217's proven
webview mechanism.

## Context

PRD-218's menu-flow batch shipped "scenes are the screens" as a convention and named exactly
what it did not verify: *"Android and iOS executions of the template's menu flow."* The house
rule — **a feature that works on web only is unfinished** — applies to today's headline
feature until the same scenario drives the menu→play transition through the native web view.

What makes this non-trivial, all measured or stated in the day's records:

1. The menu flow's load-bearing pieces are exactly the ones no Android lane has driven:
   the `click` step was specced as *"CDP mouse on web; named error on targets without pointer
   transport"* — whether the Android/webview path has a pointer transport at all is open.
2. PRD-217 proved the webview UI layer renders and measures on the **physical Pixel 8**, not
   on the emulator; the emulator lane has parity evidence for the GL surface but no recorded
   webview-menu execution.
3. Touch is the actual user input on this platform: a keyboard-driven Tab/Enter proof would
   not exercise the `data-tn-interactive` hit-region protocol the way a finger does.
4. The emulator (`emulator-5554`) and the physical Pixel are both reachable tonight; the
   emulator runs first so the physical device stays owned by Lane C (night README).

## Solution

- **One scenario, four targets stays true.** The starter's own `menu-flow.playtest.json` must
  pass under `--target android` **unmodified**. Any fork of the scenario for Android is a
  failure of this PRD (the harness rule: an assertion that only means something on one target
  is a fork).
- **Pointer transport first-class, never skipped.** If the Android lane lacks pointer
  injection, this PRD builds it into the existing device transport (the same channel that
  carries `aimAt` setup data); a missing transport fails `TN_PLAYTEST_UNSUPPORTED_ON_TARGET`
  naming the working target — it never silently degrades to browser.
- **The carried name asserts through `resources`.** The transition assertion observes state
  across the `goto` — the exact sampling fix from menu-flow Phase 2, now under a webview.

```mermaid
flowchart LR
    S["menu-flow.playtest.json (unmodified)"] -->|"--target android"| T["deviceTransport"]
    T --> P["pointer inject → webview hit region data-tn-interactive"]
    P --> G["intent start-game { name }"]
    G --> C["goto('play', carry)"]
    C --> A["resources.state.screen === 'playing', characterName carried"]
```

**Data changes:** none.

## Integration Ledger

| # | New thing | Live caller | Replaces | Old path removed? | Negative control |
|---|-----------|-------------|----------|-------------------|------------------|
| 1 | Pointer injection on the device transport (if absent) | `packages/playtest/src/runner/deviceTransport.ts` / `androidRunner.ts`; consumed by the `click` step | named-error-only path for pointer on Android | replaced in place | stub the injector → `click` step errors `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` (never skips; test red) |
| 2 | Emulator execution of the template's own menu scenario | `pnpm test:templates` android row / night verification record | nothing — new execution evidence | n/a | remove `carry` from the starter handler → the device run goes red (same mutation as menu-flow criterion 2, now observed on Android) |

## Phases

#### Phase 0: name the input path

- [ ] Read PRD-217's lane + `runner/androidRunner.ts`: can the runner already deliver a tap to
      the webview (instrumented bridge, `adb shell input tap`, CDP-over-devtools-socket)?
      Write the answer, with the chosen mechanism, into `docs/verification/prd-219-<date>.md`
      before writing code. One paragraph; no implementation yet.

#### Phase 1: pointer transport on the Android target

**Files (max 5):** `packages/playtest/src/runner/deviceTransport.ts`, `runner/androidRunner.ts`,
`__tests__/` red-first; template docs only if the contract changes.

- [ ] Red unit test: a `click` step on `--target android` without a transport fails
      `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` (wrong-typed case still throws at load per house rule).
- [ ] Implement injection through the chosen Phase 0 mechanism; coordinates in viewport pixels,
      same semantics as web.
- [ ] Green: unit test passes; the misspelled-step-kind guard still throws at load.

#### Phase 2: the starter's menu scenario on the emulator

- [ ] Scaffold the starter fresh, build the debug APK (JDK 17 toolchain per the Android lane),
      install on `emulator-5554`.
- [ ] Run `menu-flow.playtest.json --target android` unmodified: green, asserting
      `screen` transition and carried `characterName` through `resources`.
- [ ] Mutation (red control): remove `carry` from the scaffold's start-game handler → the same
      scenario goes red on device; paste both reports.

#### Phase 3: stretch — physical Pixel rung (only if Lane C has released the device)

- [ ] Same scenario, same assertions, physical Pixel 8, `observations.deviceMetrics`
      comparability verdict recorded. Emulator results never upgrade to device claims; each
      run names its lane.

## Acceptance criteria

1. **Unmodified scenario, native target.** The starter's `menu-flow.playtest.json` exits 0
   under `--target android` on the emulator, asserting the screen transition and the carried
   name via `resources`. *Red-green:* remove `carry` → red on device (paste both reports).
2. **No silent degradation.** With pointer transport stubbed off, the `click` step fails
   `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` naming android — never a skip, never a browser fallback
   (unit red-green pasted).
3. **Touch, not keyboard.** Evidence shows the tap arriving through the webview hit-region
   protocol (bridge log or instrumentation), not a focus/Enter shortcut.
4. **House gates stay green:** `pnpm typecheck && pnpm lint && pnpm test`, `pnpm budgets`,
   `pnpm sync:agents --check`.

**Named unverified at proposal time:** iOS (no lane — excluded by standing rule); physical
Pixel execution unless the Phase 3 stretch ran; frame-rate anything (functional assertions
only — the emulator's software GL claims no performance).
