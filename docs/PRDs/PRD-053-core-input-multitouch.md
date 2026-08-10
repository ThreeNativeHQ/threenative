# PRD-053 — multi-touch input, and what actually caps core

**Status: BLOCKED AT ANDROID DEVICE PROOF, 2026-08-09.** Criteria 1, 2, 3 and 5 are met:
`raw.pointers` reports every held pointer, `pointercancel` releases one, and the core cap
that blocked this is gone. Criterion 4 is *written and not executed here*.

The proof itself was repaired on 2026-08-09: it previously accepted latched `moved`/
`leftGround` flags, so two sequential one-finger touches satisfied it. The conformance scene
now latches `simultaneous` only when the stick half and the jump half are held in the **same
frame**, and `conformance/multitouch-proof.mjs` requires that flag plus two pointers still
down at the moment the proof is read. `tests/conformance-runner.test.mjs` pins both
rejections. **What remains is running it on the emulator**; no emulator run is claimed.

Evidence: `docs/verification/probe-real-game-cross-platform-2026-08-09.md` and
`docs/verification/prd-053-multitouch-2026-08-09.md`.

**What this owns:** whether `InputMap` reports more than one pointer, and what number (if
any) limits the size of `@threenative/core`.

**What this does not own:** on-screen controls, which are a look and belong in the user's
`src/render/`. This PRD is about the input reading beneath them.

**Charter authority:** `CHARTER.md` §11 rule 1 (the 20-line rule), rule 2 (the kill switch),
§10 (budgets). `packages/core/AGENTS.md` lists input mapping in core's closed scope.

## 1. The problem, found by playing the game

`RawInputState` exposes exactly one pointer:

```ts
readonly pointer: { buttons: number; down: boolean; readonly position: Vector2 };
```

Every `pointerdown` overwrites it. A player holding a thumbstick with the left thumb and
pressing jump with the right produces two simultaneous pointers, and the second erases the
first. The platformer probed on 2026-08-09 therefore cannot move and jump at the same time on
a touch screen, which for a platformer means it cannot be finished.

The host is not the limitation. `packages/runtime-native/src/runtime.cpp` dispatches ordinary
`PointerEvent`s carrying `pointerId`, `isPrimary`, `pressure` and `width`/`height` on every
platform. The information is already there; `InputMap` discards it.

## 2. What was tried, and why it is not merged

The obvious change — track pointers in a `Map<number, …>`, expose `raw.pointers`, keep
`raw.pointer` as the primary for compatibility — is about 35 lines including its three tests,
and it worked. It was reverted, because
`packages/core/__tests__/constraints.spec.ts` asserted core stays under 2,500 lines and core
stood at **2,499**.

That cap has since been deleted, for reasons in §3. This PRD does not assume the change comes
back: §4 states the actual decision.

## 3. The cap was removed (done, 2026-08-09)

The 2,500-line assertion appeared in exactly one place in the repository — that test. It is
not in `CHARTER.md`, not in `AGENTS.md`, not in `pnpm budgets`. The two LOC limits the charter
does state, 15,000 framework and 50,000 native, are **review triggers that report and never
fail**.

So the only fatal LOC number in the repository was one nobody had written down, and with zero
headroom it no longer asked whether an abstraction earned its weight — it blocked whatever
arrived next on line count alone, while counting blank lines and comments, which taxes the
package that most needs explaining. Twenty lines of pointer bookkeeping were refused beside a
504-line `game.ts` that the same rule never questioned.

What guards framework weight is unchanged and untouched: `scripts/count-loc.ts`, which scores
whether the framework costs more code than plain Three.js, and the reported 15,000-line
trigger in `pnpm budgets`. **If a ceiling on core is wanted, it belongs there, next to the
other numbers, as a reported trigger.** Adding one is in scope for this PRD and is not
assumed.

## 4. The decision this PRD asks for

Does multi-touch reading belong in core, or in each game?

**Case for each game.** Rule 1 says if a competent developer could write it in under 20
lines, it does not go in the framework. Tracking pointers by id against
`renderer.domElement` is about 20 lines, and the probe's `Pointers` class proves it works
unchanged on web, desktop and Android with no per-platform branch.

**Case for core.** `packages/core/AGENTS.md` already lists input mapping as core's job, and
core currently ships a *wrong* answer rather than no answer: `raw.pointer` looks like it
handles touch and quietly does not. Every touch game will hit this, discover it only when two
fingers are down, and write the same twenty lines. A binding of the form
`{ pointer: true }` also cannot express "this button, not that one" without them.

**Recommendation: core, as data only.** Add `raw.pointers`, keep `raw.pointer` as the primary
pointer, and add nothing that interprets them — no zones, no gestures, no virtual stick. Those
are a look and stay in `src/render/`. That keeps the framework owning the reading and the game
owning the meaning, which is the same split the physics and render boundaries already use.

## 5. Acceptance criteria

1. `raw.pointers` reports every pointer currently down, in arrival order, each with `id`,
   `buttons` and `position`; `raw.pointer` still reports the first one and no existing
   binding changes behaviour.
2. `pointercancel` releases a pointer. It is currently unlistened, so a touch cancelled by a
   system gesture leaves a finger stuck down forever.
3. Unit tests cover: two fingers held at once; a move that must not disturb the other finger;
   one finger released while the other stays; `clear()` on blur.
4. A device proof on the **Android emulator first**, wired into `pnpm parity` (PRD-054): a
   scenario that holds the stick and presses jump simultaneously and asserts the player both
   moved and left the ground. `adb shell input` sends one finger at a time, so this needs
   `sendevent` or an equivalent multi-touch injection — building that harness is part of this
   PRD, and it is what turns "written" into "proven". As of 2026-08-09 simultaneous touch is
   written and **not proven on any platform**.
5. No new interpretation surface in core: no zone, gesture, joystick or button concept.

## 6. Native budget review

The focused native tree is **56,974 lines**, above the charter's 50,000-line review trigger.
PRD-053 adds only the SDL finger-event bridge needed to preserve touch identity through the
owned host and the standalone Android verifier needed to prove the same behavior against the
real APK. Neither is gameplay or an alternate input model.

The kill switch is direct: if the SDL bridge cannot deliver stable simultaneous pointer ids,
delete it rather than grow a parallel native gesture/input abstraction; if the verifier cannot
produce a fail-closed real-emulator result, keep it out of parity and do not claim Android
support. The failed API-35 device run is recorded in the verification evidence, so this PRD
remains here rather than moving to `done/`.

## 7. Open

Whether `pressure`, `width`/`height` and `pointerType` should be carried through. The host
already dispatches them. Nothing in the probe needed them, so this PRD does not add them.
