# Batch — the game's name, icon, and first frame, 2026-08-18

**Status: PROPOSED, 2026-08-18. Nothing in this folder has run.** One PRD, PRD-153. It defines
the player-visible branding path from launcher or browser entry through the first playable frame.
No implementation, device result, mobile-readiness claim or platform-parity claim exists yet.

## Why this batch exists today

The engine has the beginnings of an app-shape file, native icon packaging and a generated loading
screen, but they do not form one truthful consumer path. `threenative.config.ts` already carries
app/display settings, while its loading colors, image and bar toggle are accepted without any
renderer reading them. Web identity is separate, desktop never consumes the icon, platform launch
surfaces are generic, and the seven templates do not expose the same loading customization path.

This is one product boundary, not a collection of visual presets: platform-owned brand plumbing
belongs in the config/build/runtime path, while every live loading-screen visual remains generated
game source under `src/render/`.

## The work

| PRD | What it closes | Complexity | State |
| --- | --- | --- | --- |
| [153](./PRD-153-game-branding-from-launch-to-play.md) | Config-driven web/native identity and static boot splash; generated-source loading layout, images, disabling and safe-area placement; verified handoff to play | 7 | PROPOSED |

## Order

PRD-153's phases are the order. First make the accepted config truthful, then prove web and native
packaging consumers, then prove the live loading screen on the platformer, roll the source through
all templates, and finish with the cross-target launch-sequence gate. A later phase does not start
while the prior checkpoint has an unfilled integration-ledger row or an unobserved negative control.

## Batch completion

This folder remains active while PRD-153 is `PROPOSED`, `OPEN`, `PARTIAL`, `BLOCKED` or otherwise
unfinished. Archive the whole folder to `docs/PRDs/done/batch-26-08-18/` in the commit that closes
the PRD, with its executed evidence linked and every acceptance row resolved.

## Deliberately outside this batch

- Store listings, screenshots, trailers, signing, ratings and release credentials.
- Runtime-selectable alternate icons, notification badges, shortcuts and localized app names.
- A loading-screen preset/component library or framework-owned visual style.
- Offline/PWA behavior and physical-mobile claims that were not executed.

