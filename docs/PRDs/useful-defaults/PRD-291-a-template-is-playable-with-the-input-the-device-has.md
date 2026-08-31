---
prd_contract: v1
---

# PRD-291 — a template is playable with the input the device actually has

**Status: OPEN — filed 2026-08-30 against `c064b6a0`. Nothing below has been executed.** Part of
the [useful-defaults batch](./README.md).

**Goal: a scaffolded game opened on a phone can be played on that phone, whether the phone reached
it through the native host or through a browser.** Six of seven templates bind movement to keys
only; the seventh ships touch controls and then hides them from every mobile browser.

## The gap, verified in this tree

`templates/platformer/src/render/touch-controls.ts` (175 lines) and `touch-layout.ts` (63 lines) are
a real, hand-authored on-screen stick and buttons. `templates/platformer/src/scenes/Level.ts:58`
decides when to show them:

```ts
const showTouchControls = isNative() && isMobile() && isTouchscreenAvailable();
```

`isNative()` is false in a browser. So the one template with touch controls does not show them on a
phone's browser — the target a stranger reaches first, and the one every `--browser-recipe` lane
grades. The other six templates contain no touch path at all: `grep -rn 'isTouchscreenAvailable'
packages/create-threenative/templates/*/src/` hits `platformer` and nothing else, and
`templates/shooter/src/game.ts:19` binds movement as `up: ["ArrowUp", "KeyW"]` with no analogue.

The framework side is already built and already portable: `isMobile`, `isTouchscreenAvailable`,
`isNative` and `PointerEvents3D` are exported and in `capabilities.json`, and `publishHitRegions`
exists precisely to *"tell the native input host where a UI's touchable controls are"*. Nothing
here is a missing capability. What is missing is that six templates never call any of it and the
seventh calls it with a predicate that excludes the largest lane.

**Two different problems, and they are fixed in different places.** Deciding *when* a control is
needed is a portable platform fact — framework. Deciding *what the stick looks like and where it
sits* decides how the game looks — generated source, at any size, and the 238 lines already in
`platformer` are the shape the other templates copy from rather than a package export waiting to
happen.

## Scope

**In:** a correct portable predicate for "this device's primary input is touch"; every template
whose gameplay needs continuous movement gaining an on-screen control in its own `src/render/`;
the platformer's predicate corrected; a playtest that drives a template through touch on a browser
lane.

**Out:** a framework-owned on-screen control of any kind — no `VirtualStick` export, no `TouchHud`
component, no preset. Gamepad support. Remapping UI. Haptics. Changing `InputMap`'s binding shape.

## The question Phase 0 answers before anything is built

Two things, measured rather than assumed:

1. **Is each template actually unplayable?** Scaffold all seven, open each on a touch-only browser
   lane, and record for each one whether its core loop can be advanced with touch alone. A
   turn-based or pointer-driven template may already pass; a template that passes is out of scope
   and stays out.
2. **What is the right predicate?** `isTouchscreenAvailable()` is availability, not primacy — a
   touchscreen laptop reports true and wants keys. Phase 0 states the predicate it will use and the
   device classes it gets right and wrong, before any template branches on it.

**If fewer than three templates fail (1), this PRD narrows to the platformer's predicate and the
gate**, and says so with the count.

## Acceptance criteria

- [ ] **AC0 — the playability table.** Seven templates × {touch-only browser, touch-only native},
      each cell pass or fail with the interaction that failed named.
- [ ] **AC1 — the predicate is portable and correct.** One expression decides touch primacy on
      browser and on native, and the platformer's `isNative() &&` clause is gone. *Mutation:*
      restore the `isNative()` clause and the browser touch playtest fails.
- [ ] **AC2 — every failing template gains a control, in its own source.** The control lives under
      that template's `src/render/`, imports no framework component that draws it, and is deletable
      without touching a package. *Mutation:* delete a template's control file and only that
      template's proof fails.
- [ ] **AC3 — it is graded by a playtest, not by a screenshot.** At least one template's scenario
      advances its core loop using touch input on a browser lane and asserts the resulting game
      state, and it runs in `pnpm test:templates`.
- [ ] **AC4 — nothing regresses on a keyboard.** Every template still plays with keys, and the
      control does not appear on a desktop lane. *Mutation:* force the predicate true on desktop
      and a visual assertion fails.
- [ ] **AC5 — native is proven or named.** One physical-device run naming the serial, or
      `UNVERIFIED` with the reason. An emulator run is recorded as an emulator run.
- [ ] **AC6 — the LOC score.** `pnpm tsx scripts/count-loc.ts` records what the seven copies cost
      against a hypothetical shared export, and the batch states plainly whether the duplication is
      accepted on the look rule or is a signal to re-scope. Duplication chosen on principle is
      recorded, not hidden.
- [ ] **AC7 — the record.** One dated file in `docs/verification/` with the Phase 0 table, the
      predicate and its known-wrong device classes, and every command.

## What not to do

- Do not add a `VirtualStick` to `packages/core` or `packages/ui`. It draws; it decides how the game
  looks; it is the veto case, at any size. AC6 exists to make the cost of that decision visible
  rather than to reopen it.
- Do not gate on a user-agent string. `getPlatform()` is the seam and a template reaching for a
  browser global is the thing the framework exists to prevent.
- Do not treat `isTouchscreenAvailable()` as "is a phone" without saying which devices that gets
  wrong. AC1 asks for the predicate *and* its blind spots.
- Do not claim a template is playable because a playtest issued touch events. AC3 asserts the game
  state that resulted.
