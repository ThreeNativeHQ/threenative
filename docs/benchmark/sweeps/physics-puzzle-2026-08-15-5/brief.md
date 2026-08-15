# Physics-puzzle sweep brief

Build a small, playable 3D physics puzzle from the supplied `reference.png`.

- Create a compact room with at least 30 dynamic bodies that stack, topple, collide, and
  come to rest after the initial drop.
- Give the player a visible character controller that can push solid bodies and cannot walk
  through them.
- Include one body class that the player passes through and another that blocks the player;
  make the distinction visible in the scene.
- Reach a goal only through simulated contact with the player or a pushed body. A distance
  check or scripted timer is not a valid win condition.
- Run the same input sequence twice with a fixed seed and fixed-step simulation, and expose
  whether the final state matched on both runs.
- Use an angled camera and a readable HUD so the player, stack, pass-through body, and goal
  remain legible on the first screen.

The first playable screen must be visible without a user account or external asset service.

The sealed proof supplies the input sequence and observes contacts, settled bodies, movement,
the goal state, deterministic replay, and runtime diagnostics. Do not edit or copy that proof
into the project.
