# Scene-heavy exploration sweep brief

Build a small, playable 3D exploration game from the supplied `reference.png`.

- Use a third-person camera and a compact hub that leads to at least two distinct areas. Name the
  starting area the literal `hub`; the proof compares `state.area` against that word.
- Let the player walk, inspect three points of interest, and return to the hub.
- Load or reveal a different arrangement of props in each area, with a clear transition.
- Keep a journal or objective panel that records the inspected points of interest.
- Make the world readable through deliberate lighting, landmarks, and a restrained palette.
- The sealed proof uses `KeyE` to inspect and `ArrowUp`/`ArrowDown` to travel between areas.
- The sealed proof reads resource `state` paths `state.area`, `state.inspections`,
  `state.inspectedPoints`, `state.objectiveComplete`, and `state.returns`.

The first playable screen must be visible without a user account or external asset service.
