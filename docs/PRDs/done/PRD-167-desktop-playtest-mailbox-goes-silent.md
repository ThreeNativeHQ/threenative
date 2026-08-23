---
prd_contract: v1
---

# PRD-167 — The desktop playtest mailbox goes silent after a replay

**Status:** COMPLETE, 2026-08-22. Filed from an observed flake, not from a theory. Diagnosed and
repaired the same day: the silence was a use-after-free in the native host's DOM-event dispatch
(setupDOMEvents captured document/window handles by value; frame cleanup freed them), fixed by
`25b5a194`, and the mailbox now names every failure mode it can hit instead of going quiet
(`TN_PLAYTEST_MAILBOX_POLL_STALLED` app-side watchdog, `TN_PLAYTEST_HOST_EXITED` runner-side,
existing `TN_PLAYTEST_OPERATION_TIMEOUT` for live-host stalls). Evidence:
[desktop-mailbox-2026-08-22.md](../../verification/desktop-mailbox-2026-08-22.md) — reproduction
with the frame pump observed, gdb stack, red/green for the diagnostics, and ten consecutive
passing desktop runs (`stateHash = 1884960806`) after the repair and a fixture regeneration
forced by core's version constant moving to the generated package version.

**Outcome:** the desktop `--target desktop` playtest either answers every operation it is sent, or
fails with a named diagnostic that says what stopped answering. A gate that passes half the time is
not evidence, and a gate that hangs without a cause is worse than one that fails.

## 1. What was observed

`examples/prd162-replay/playtests/replay-desktop.playtest.json` was run four consecutive times on
the desktop host during PRD-162
([phase-2-2026-08-20.md](../../verification/phase-2-2026-08-20.md)). Two runs exited `0` with
`pass: true`. Two exited `2` with:

```text
TN_PLAYTEST_OPERATION_TIMEOUT: Device mailbox operation '5' exceeded 5000ms.
```

In both failing runs the host console still contained
`[PRD162] replay-consumed ... stateHash=1884960806`, so the application was alive and the capability
under test had already executed. The runner simply stopped receiving responses.

## 2. Where to look first, without assuming the answer

`packages/playtest/src/three/device.ts` polls the native mailbox from
`globalThis.requestAnimationFrame(poll)`. Anything that stops the host's animation frames stops the
bridge with no error on either side: the app is running, its loop is not pumping, and the runner
waits out its 5-second operation timeout. `dispatch()` already converts a thrown operation into an
error response, so a *thrown* bridge call would surface as a diagnostic rather than a hang — which
argues the frames themselves stop.

The observed runs freeze the game (`frozen: true`) inside a `setTimeout` callback immediately after
`createReplayDriver`'s 24 fixed steps. Whether the host's frame pump survives that is the open
question; do not fix anything until a run reproduces it with the frame counter observed.

## 3. Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | The cause is named at a `file:line`, not guessed | pasted reproduction with the frame pump observed |
| 2 | The mailbox reports a named diagnostic when it stops polling, instead of going silent | pasted red before the fix |
| 3 | Ten consecutive desktop runs of the PRD-162 scenario pass | pasted output of all ten |
| 4 | `pnpm typecheck && pnpm lint && pnpm test` green | pasted output |

## 4. Deliberately out of scope

- The Android and iOS mailbox lanes, unless the same root cause is proved to reach them.
- Re-opening PRD-162's gate result. Its evidence records this flake; the two are separate.
