---
prd_contract: v1
---

# PRD-292 — a fast body does not pass through a wall

**Status: DONE — verified 2026-09-02; see the recovery evidence below.** Part of the
[useful-defaults batch](../useful-defaults/README.md).

**Goal: a game that fires a projectile, drops a body from height, or drives fast at a barrier gets
the collision it obviously expects — and when the framework declines to pay for it, the game can
turn it on by name.** Today it cannot turn it on at all.

## The gap, verified in this tree

```sh
grep -rn 'ccd\|Ccd\|continuous' packages/physics/src/   # no matches
```

`IRigidBody3DOptions` (`packages/physics/src/RigidBody3D.ts:12`) carries `object`, `position`,
`entity`, `physics`, `world`, `shape`, `mass`, `type`, `collisionLayer` and `collisionMask`. There
is no continuous-collision option, no default, and no passthrough to either backend. Rapier supports
continuous collision detection per body; the framework's physics surface does not expose it, so **a
game built on ThreeNative cannot enable it on web or on native without editing package code.**

This lands squarely in the charter's first question. Could the game write this portably itself? No —
it would have to reach past `RigidBody3D` into a backend-specific world handle, and the deprecated
`world` option is documented as *"a raw web world is backend-specific"*. Does it decide how anything
looks? No: tunnelling is not an appearance, it is a wrong answer. The framework owns it.

The failure it produces is the expensive kind: silent, intermittent, and reproducible only at speed.
An agent building a shooter sees a bullet reach a wall and score no hit, and has no reason to
suspect the physics step size rather than its own raycast, its own layer mask, or its own spawn
position.

## Scope

**In:** a continuous-collision option on `RigidBody3D`, honoured on both backends; a default,
chosen from a measurement; the reporting clause — whatever the default is, the effective setting is
observable; a template-level proof that a fast projectile registers its hit.

**Out:** speculative contacts, sub-stepping the whole world, changing the fixed step, character
controller sweep behaviour (`CharacterBody3D` already sweeps), soft bodies, and any change to
`PhysicsDirectSpaceState3D`'s query surface.

## The question Phase 0 answers before anything is built

**At what speed does a body tunnel, and what does not tunnelling cost?** One scenario, one wall of
known thickness, a body swept across a speed range, on both backends:

1. The speed at which passthrough first occurs, per backend, at the shipped step.
2. The frame cost of the same scenario with continuous collision on, at a body count a real game
   would have.

**These two numbers pick the default and this PRD does not pick it in advance.** On by default for
every body is defensible only if (2) is small; on above a speed threshold, or off with a named
option, are the other two answers. What is not defensible is the current state, where the answer
cannot be chosen at all.

## Acceptance criteria

- [ ] **AC0 — the tunnelling speed and the price are measured.** Both numbers above, both backends,
      recorded before any option is added. If no body tunnels at any speed a game would use, this
      PRD closes as DECLINED with its numbers and the surface is still added under AC1 — the
      framework should not be the reason a game cannot ask.
- [ ] **AC1 — the option exists and reaches both backends.** One name on `IRigidBody3DOptions`, one
      meaning, honoured on the web backend and on the native host. *Mutation:* drop the native
      passthrough and the native conformance case fails, not only the web spec.
- [ ] **AC2 — the default is the one AC0 argues for, and it is written down.** The chosen default is
      stated with the number that chose it.
- [ ] **AC3 — turning it off does not turn the measurement off.** The effective setting is
      observable per body, whichever way the default went. *Mutation:* stop reporting it and the
      spec that reads it fails.
- [ ] **AC4 — a game proves it.** One template or example playtest fires a fast projectile at a
      wall and asserts the hit, and it runs on both a browser lane and a native lane. A red first:
      the same scenario at HEAD misses.
- [ ] **AC5 — no frame regression.** The physics templates' performance proofs pass at their
      current thresholds, and the delta from AC0's cost measurement is stated rather than assumed
      to be zero.
- [ ] **AC6 — the capability manifest and the templates' `AGENTS.md` say it exists.** A convention
      missing from the templates' `AGENTS.md` does not exist; the situation line is plain words —
      *"a bullet passes through a wall"*.
- [ ] **AC7 — the record.** One dated file in `docs/verification/` with both backends' numbers, the
      chosen default, and every command. Native numbers name the target that ran them.

## What not to do

- Do not turn continuous collision on for every body and call it a default without AC0's cost
  number. A default that halves the physics budget of every game is not free value.
- Do not solve this by shrinking the fixed step. That pays for one wall with every frame of every
  game, and `FixedStepLoop`'s `maxSteps` cap (`packages/core/src/loop.ts:71`) turns the extra work
  into dropped simulation under load, which is a second bug wearing the first one's clothes.
- Do not expose Rapier's own option name or type through `@threenative/physics`. Vocabulary is
  borrowed from Godot for nodes and from Rapier for physics concepts, in camelCase — not by
  re-exporting a backend's surface, which is what the deprecated `world` option already teaches.
- Do not claim native works because web does. AC1's mutation exists because that inference has been
  wrong here before.
