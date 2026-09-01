---
name: prd-creator
description: Turn a ThreeNative game idea or change into an approved game plan and implementation tasks before authoring code.
---

# ThreeNative game PRD

Use this before implementing any game request. The outcome is a small, distinctive, playable plan
the user has explicitly approved, not a generic genre template.

## Plan

1. Inspect the existing game and its instructions. Answer repository questions yourself; ask the
   user one short question at a time only when the answer materially changes the game.
2. Preserve the request's fantasy. Define the smallest playable loop that depends on its setting,
   traversal, combat, or simulation rather than reskinning a generic character game.
3. Specify controls, camera, core mechanics, win/loss states, game state, progression, visual and
   audio direction, asset needs and licences, target platforms, performance risks, and non-goals.
4. Define fail-closed playtest acceptance criteria for the loop, including observable state and a
   real capture for visible changes. Unexecuted platforms remain unverified.
5. Record prerequisites: required tools/MCPs, service access, test users, and environment variable
   names. Use placeholders only; never read or write real secrets into planning artifacts.

Write the concise plan to `.agent/prd/PRD.md`, its short player-facing summary to
`.agent/prd/SUMMARY.md`, and implementation tasks to `.agent/tasks.json`. Tasks must be ordered,
bounded to about 10 minutes each, carry a concrete pass check, and start with `"passes": false`.
The first task verifies prerequisites; later tasks include capability discovery, implementation,
playtest proof, and visual inspection.

## Approval gate

Present the plan and direct the user to approve it or request changes. Do not edit game source,
download assets, authenticate services, or begin implementation while planning. Revise the plan
when the user gives feedback.

Start implementation only after explicit approval and a clear execution instruction such as
"execute", "implement", "build it", or an equivalent phrase. One message may contain both. After
that handoff, follow `AGENTS.md`: search engine capabilities before code, then execute the approved
tasks without silently expanding the scope.
