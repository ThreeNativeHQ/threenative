# PRD-052 — pathfinding on mobile: close the gate PRD-046 opened

**Status: PROPOSED (2026-08-09). Not started. Phase 0 is a measurement, not an implementation.**

`@threenative/physics/navigation` is built on `recast-navigation`, which is WASM.
**Android runs QuickJS and iOS runs JSC with `--no-webassembly`, so it is dead on both.**
PRD-046 §255 and PRD-047 §282 both name this as "a separate open gate" and neither owns it.
This PRD owns it.

**The concrete consequence, measured 2026-08-09:** the shipped `platformer` template imports
navigation in `src/main.ts`, `src/scenes/Level.ts` and `src/entities/Chaser.ts`. So **one of
the three templates a user can scaffold cannot be built for Android or iOS at all** — today
silently through a WASM bundle that would fault at startup, and after PRD-050 loudly through
`TN_NATIVE_WASM_ON_MOBILE`.

**Depends on:** PRD-050 (which turns this from a startup fault into a named build error).
**Blocks:** any claim that a scaffolded template ships to mobile.
**Related:** PRD-046 (native physics, the pattern this would follow), PRD-049 (the parity
harness any second backend would have to satisfy).

**Charter authority:** `CHARTER.md` §11 rule 4 (Godot for node names —
`NavigationAgent3D`, `NavigationRegion3D`, `NavigationObstacle3D` already borrow correctly and
must not change), rule 5 (no new package), §10 (the 50,000-line native LOC trigger, which a
vendored Recast would move).

**Complexity: unknown until Phase 0.** A native Recast port and a template change differ by an
order of magnitude; scoring before measuring would be theatre.

---

## 1. What is actually blocked

| Surface | Today | After PRD-050 |
|---|---|---|
| web | works — `recast-navigation` WASM under Vite | unchanged |
| desktop native (V8) | **unverified.** V8 has WASM, but no gate has ever loaded `recast-navigation` inside the host, and its `.wasm` fetch path through the embedded VFS is untested | unchanged, still unverified |
| Android (QuickJS) | fails at runtime, no build error | `TN_NATIVE_WASM_ON_MOBILE` at build time |
| iOS (JSC, `--no-webassembly`) | fails at runtime, no build error | `TN_NATIVE_WASM_ON_MOBILE` at build time |

Note the second row. **"Navigation is web-only" is the pessimistic claim; "navigation works on
desktop" is an unproven one.** Phase 0 settles which is true, and that answer alone changes
the size of the rest of this PRD.

---

## 2. Candidates

| # | Answer | Cost | Notes |
|---|---|---|---|
| **A** | **Native Recast behind the same coarse ABI as physics.** Compile Recast/Detour into `packages/runtime-native`, reach it through a bulk typed-array ABI (`buildNavMesh`, `readAgentPositions`), selected by the `threenative-native` export condition — exactly the shape PRD-046 established for Rapier. | high; a C++ dependency, a second ABI, and PRD-049's parity burden | the only answer that keeps `NavigationAgent3D` write-once |
| **B** | **A mobile-safe template path.** The platformer's chaser uses steering or a grid instead of a navmesh; navigation stays a web/desktop feature and says so. | low; template source only, no package code | narrows the promise, in writing, where a user can see it |
| **C** | **A JS Recast for mobile only.** Two implementations of the same behavior, selected by target. | medium build cost, permanent divergence cost | two live implementations of one behavior is the anti-pattern this repo's PRD process exists to prevent |
| **D** | Leave it open and keep the loud error. | zero | honest, but leaves a scaffoldable template that cannot ship |

**Working recommendation, subject to Phase 0: B now, A only if evidence demands it.** A native
Recast port is a large, permanent commitment; it is worth making only after the desktop row
above is settled and after someone actually wants navmesh pathfinding on a phone. Nothing in
`docs/benchmark/sweeps/` shows that demand yet — Phase 0 checks.

---

## 3. Phase 0 — measure the three unknowns

Ships nothing. Answers three questions, in this order, and stops when one of them makes the
rest moot.

1. **Does `recast-navigation` work on desktop native at all?** Build the platformer for
   desktop (after PRD-050 Phase 1), run it, and either watch an agent path or record the exact
   failure. If it fails, the feature is browser-only today, not merely mobile-blocked, and
   candidate B gets much stronger.
2. **How much of the corpus actually uses it?** Census `docs/benchmark/sweeps/` and
   `examples/` for `NavigationAgent3D`, `NavigationRegion3D` and `NavigationObstacle3D`
   consumers. `pnpm round:deletions` already reports exports unreached across rounds — read it
   rather than guessing.
3. **What does the platformer's chaser actually need?** Read
   `templates/platformer/src/entities/Chaser.ts`. If steering over the existing physics
   character controller reproduces the behavior in under ~40 lines of template source, B is
   done and A becomes a later, evidence-backed decision instead of a speculative port.

**Deliverable:** the three answers, appended here, plus a decision recorded in
`docs/verification/PRD-052.md`. **No package code changes in Phase 0.**

---

## 4. Acceptance criteria (consumer-scoped)

Whichever candidate wins, all four must be true when this PRD closes:

- [ ] Every template a user can scaffold **either builds and runs for Android** or states in
      its own README, at scaffold time, which target it does not support and why.
- [ ] The build error for an unsupported combination names the file and the alternative — no
      silent WASM fault at startup on any platform.
- [ ] If candidate A is chosen: an agent reaches the same goal position on web and on the
      Android emulator from the same seed, measured through PRD-049's parity harness, not
      asserted.
- [ ] If candidate B is chosen: `docs/PRDs/native/README.md` and `/AGENTS.md` say plainly that
      navmesh navigation is a web (and possibly desktop) feature — the promise is narrowed in
      writing, not quietly.
