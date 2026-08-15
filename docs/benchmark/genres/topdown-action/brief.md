# Top-down action sweep brief

Build a small, playable 3D top-down action game from the supplied `reference.png`.

- Use an angled camera that keeps the player and the arena readable at once.
- Let the player move in four directions, aim toward the pointer, and fire a visible attack.
- Include three enemy targets, a short cooldown or reload feedback, and a win condition.
- Build the arena from a few walls, floor markings, and pickups with a clear color hierarchy.
- Show health, score, and the current objective in a readable HUD.
- The sealed proof uses `ArrowRight` for movement and `Space` for firing while aiming at the
  supplied pointer position.
- The sealed proof reads resource `state` paths `state.shots`, `state.reload`, `state.score`,
  `state.enemiesRemaining`, and `state.objective`.

The first playable screen must be visible without a user account or external asset service.
