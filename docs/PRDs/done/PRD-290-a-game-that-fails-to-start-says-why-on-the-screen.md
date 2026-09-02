---
prd_contract: v1
---

# PRD-290 — a game that fails to start says why, on the screen, on every target

**Status: DONE — integrated 2026-09-01.** Part of the [useful-defaults batch](../useful-defaults/README.md).
Evidence: [PRD-290 verification](../../verification/prd-290-2026-08-31.md).

**Goal: when a scaffolded game cannot boot, the surface the player is looking at says what failed,
instead of holding the launch card forever.** The framework already carries the message; it is
covered by its own loading screen and, on native, has nowhere to go at all.

## The gap, verified in this tree

`packages/ui/src/GameCanvas.tsx:38` does the right thing — a rejected `game.start()` is caught, the
message is put in the DOM under `data-threenative-canvas-error`, and the comment says why:

> A rejected start must be visible, not an unhandled promise rejection that nobody renders.

Three things then hide it:

1. **The launch card outranks it.** `templates/*/index.html` renders
   `<div id="threenative-launch" data-threenative-launch>` and `src/style.css:58` gives it
   `position: fixed; inset: 0; z-index: 9999`. Nothing else on the page comes close.
2. **The card is dismissed by a poll for a canvas that may never exist.**
   `templates/*/src/main.ts` runs `removeLaunchSurfaceAfterPaint()`, which re-schedules itself
   through `requestAnimationFrame` until `document.querySelector("canvas")` is non-null. A boot that
   fails *before* the renderer is constructed never appends a canvas — `game.ts:691` is the append —
   so the loop never terminates and the card never leaves. **The player sees the game's name,
   centred, forever.**
3. **The error has no presentation.** `grep -rn "canvas-error" packages/ create-threenative/` returns
   exactly one hit, the `GameCanvas.tsx` element itself. No template's `style.css` styles it. When
   the card *does* dismiss — a failure after the renderer exists — the result is unstyled black text
   over a body-appended canvas that `host.current.replaceChildren(canvas)` never reached.

On native there is no `GameCanvas` and no launch card in the DOM sense, and this PRD does not assume
the failure surface there is the same one. **What the native host does with a rejected boot is Phase
0's first measurement, not an assumption.**

## Scope

**In:** dismissing the launch surface on failure as well as on success; a default presentation for
the failure message that a template can restyle; the same behaviour on the native host, or a named
reason it differs; an assertable hook so a playtest can grade "the game said why".

**Out:** recovering from the failure, retrying the boot, or classifying error causes; changing what
`game.start()` throws; the loading screen's appearance when boot succeeds; error reporting to any
remote service.

## The question Phase 0 answers before anything is built

Three counts, from real runs rather than from reading:

1. Force a pre-renderer failure (no adapter) on browser and record what the page shows after 10
   seconds. The prediction is the launch card, unchanged, and no visible message.
2. Force a post-renderer failure (a scene `load()` that throws) and record what the page shows.
3. Do both on the native host and record what the window shows.

**If any lane already surfaces the message, that lane is out of scope and the PRD narrows.** Naming
which lanes are actually broken before fixing all three is the difference between a fix and a
rewrite.

## Acceptance criteria

- [ ] **AC0 — the three lanes are characterised.** Phase 0's screenshots and text for each of the
      three runs above, with the exit path each one took.
- [ ] **AC1 — the launch surface always ends.** The card is removed when the game is running **or**
      when the boot has failed, on every template. *Mutation:* restore the canvas-only poll and a
      spec driving a pre-renderer failure hangs on a visible card and fails.
- [ ] **AC2 — the message reaches the screen.** After a forced failure the rendered page contains
      the thrown message, visible — not merely present in the DOM behind an opaque overlay. The
      assertion reads what a screenshot would show, because "in the DOM" is what this defect
      already satisfies.
- [ ] **AC3 — it is styled by default and restyleable.** The failure element has a default
      presentation in generated source, not in a package, and a template can change it without
      editing package code. *Mutation:* remove the default rule and the visual assertion fails.
- [ ] **AC4 — native is proven or named.** The same forced failure on the native host either shows
      the message or the PRD records, with the run, exactly which target does not and why. An
      unexecuted target is `UNVERIFIED` and is not inferred from the browser lane.
- [ ] **AC5 — a playtest can grade it.** One scenario in `packages/create-threenative/templates/`
      drives a boot failure and asserts the message, so the behaviour is re-run on every later
      change rather than proven once.
- [ ] **AC6 — every gate.** `pnpm typecheck && pnpm lint && pnpm test` exits 0 and
      `pnpm test:templates` runs all seven.
- [ ] **AC7 — the record.** One dated file in `docs/verification/` with the three Phase 0 runs, the
      three after runs, and the commands.

## What not to do

- Do not fix this by lowering the launch card's `z-index`. The card is correct to be on top while
  the game is booting; what is wrong is that it never learns the boot ended.
- Do not swallow the error to make the screen look better. The message is the deliverable.
- Do not put the failure's appearance in `packages/ui` beyond the element and its hook. What it
  looks like is generated source, at any size.
- Do not assert on `document.querySelector('[data-threenative-canvas-error]')` alone and call AC2
  met — that assertion passes today, on a screen showing nothing.
