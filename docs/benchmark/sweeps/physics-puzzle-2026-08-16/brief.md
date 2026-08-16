# Physics-puzzle sweep brief

Build a small, playable 3D physics puzzle from the supplied `reference.png`.

- Create a compact room with at least 30 dynamic bodies that stack, topple, collide, and
  come to rest after the initial drop.
- Give the controlled character a visible controller that can push solid bodies and cannot walk
  through them.
- Include one body class that the controlled character passes through and another that blocks the controlled character;
  make the distinction visible in the scene.
- Reach the destination only through simulated contact with the controlled character or a pushed body. A distance
  check or scripted timer is not a valid win condition. When it is reached, some gameplay state
  must read the literal `won`; the proof compares against that word and cannot infer it.
- Run the same input sequence twice with a fixed seed and fixed-step simulation, and expose
  whether the final state matched on both runs.
- Use an angled camera and a readable HUD so the controlled character, stack, pass-through body, and destination
  remain legible on the first screen.
- Use world seed `6132`; the sealed proof supplies `ArrowRight`, `ArrowDown`, and `ArrowUp` for
  movement and `KeyV` to start the deterministic replay check.
- The direct proof supplies no gameplay entity identifiers; the replay proof reads resource `state`
  paths `state.replayPhase` and `state.replayMatch`.


The first playable screen must be visible without a user account or external asset service.

The sealed proof supplies the input sequence and observes interactions, settled bodies, movement,
the terminal state, deterministic replay, and runtime diagnostics. Do not edit or copy that proof
into the project.
