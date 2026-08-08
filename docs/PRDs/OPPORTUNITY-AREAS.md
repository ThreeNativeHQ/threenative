# Opportunity areas — where abstraction pays and where it taxes

**Status:** proposal, 2026-08-07. Not binding. `CHARTER.md` wins on any conflict.
**Companion to:** `ROADMAP.md` (which phase), this doc (which area, and why).

## The rule this whole document applies

Two measured results define the shape of every score below.

- **Abstracting a mature Three.js surface sets a ceiling.** Materials, lights, camera,
  tonemapping, post — v1 owned these and its output scored *worse* than vanilla on the
  blind rubric. The user's agent already knows `MeshStandardMaterial` from its weights;
  a wrapper replaces knowledge it has with an API it must discover. Net negative.
- **Abstracting something Three.js does not ship is 0→1.** Physics is the proof. There is
  no ceiling to set, because the alternative is not "worse physics" — it is *no physics*,
  or 800 lines of hand-rolled Rapier glue per project.

So the question for any candidate area is not "would this be convenient?" It is:
**does vanilla Three.js already answer this, and does wrapping it cap the user?**

## The scoring rubric

Every area is scored out of 100 on four factors. Same inputs, same weights, so the
numbers are comparable rather than vibes.

| Factor | Max | What earns the maximum |
|---|---:|---|
| **Gap** | 30 | Vanilla Three.js ships nothing for this. 0 = it ships a mature answer. |
| **Ceiling safety** | 25 | A thin binding over a missing capability. 0 = the abstraction decides what the user's game can look like or do. |
| **Agent leverage** | 25 | It makes an agent's game work, or verify itself, more often. 0 = it only saves a human keystrokes. |
| **Cost fit** | 20 | Free in LOC, package slots and charter conflicts. 0 = it needs a package we don't have, or reopens a closed question. |

### The constraint that actually binds

`pnpm budgets` today: **2,988 / 15,000 framework LOC (20%)** and **7 / 8 workspace
packages**. The counter includes `examples/*`, so the two benchmark examples occupy two of
the seven.

**LOC is not the scarce resource. The package slot is** — there is exactly one left, and
it is only spendable on something carrying a dependency the others must not inherit
(WASM, native binding). Any area below whose cost is "a new package" is competing for that
single slot. Score `Cost fit` accordingly.

---

## Prerequisite — this gates everything below

**Gate 0 of `ROADMAP.md` is unrun.** Two of five axes read `0` because they have *never
been measured*, not because they failed. No area in this document should be started before
round 2 completes on both arms — otherwise we would be adding capability to a framework
whose core claim is still unverified.

Building from this list before Gate 0 closes is how v1 got to 790k lines.

---

## Tier 1 — build these

| # | Area | Score | Gap | Ceiling | Agent | Cost |
|---|---|---:|---:|---:|---:|---:|
| 1 | Asset discovery & licensing | **94** | 30 | 25 | 23 | 16 |
| 2 | Agent self-verification (playtest depth) | **90** | 30 | 25 | 25 | 10 |
| 3 | Navigation & pathfinding | **86** | 30 | 22 | 22 | 12 |
| 4 | Hot reload with state preservation | **80** | 28 | 24 | 12 | 16 |
| 5 | Save/load & deterministic replay | **80** | 30 | 18 | 18 | 14 |

### 1. Asset discovery & licensing — 94 · VOID pending publishable profile (`PRD-032`)

Three.js ships a `GLTFLoader` and nothing that tells you *where a legally usable model
lives*. This is the single largest 0→1 on the board and the only Tier 1 item that costs
zero LOC and zero package slots: it runs as an external MCP server declared in the
scaffolded project's `.mcp.json`, not as package code.

It also attacks the "looks good" axis without violating §5b. Real assets are the biggest
visual delta available, and shipping *discovery* is not shipping *the look* — the agent
still writes its own materials and lighting around what it found.

**Ceiling: none.** It is a tool call, not an API surface the model must learn.
**Watch:** the legacy server is 10,847 LOC and 25+ tools. That is a maintenance surface
even outside the budget, and 25 tools is a discovery cost of its own. Ship the subset that
the paired arm actually reaches for.

### 2. Agent self-verification — 90 · shipped, under-exploited

`packages/playtest` already drives a real browser and asserts what happened. Vanilla
Three.js has no answer at all — an agent building vanilla cannot tell whether its game
runs. This is the framework's most defensible capability and it is *not* where the
remaining effort has gone.

**Ceiling: none.** Assertions observe; they do not constrain what the game may be.
**The strategic catch:** `CHARTER.md` §3 gives the harness to the vanilla arm too, so it
wins no benchmark comparison even though it is enormously valuable to a real user. That is
a scoring artifact, not a reason to underinvest — it just means the points show up in
adoption rather than in the pair.
**Highest-value next move:** widen semantic assertions (what the *game* did) rather than
diagnostics (what the *page* did). `TN_PLAYTEST_BRIDGE_MISSING` failing closed is the
harness being right; more of the game surface should be observable through it.

### 3. Navigation & pathfinding — 86 · not started

Three.js ships nothing. Godot ships `NavigationAgent3D`, `NavigationRegion3D`,
`NavigationObstacle3D` — names already in every model's weights, so rule 4 is satisfied
for free. Recast/Detour (`recast-navigation-js`) is the substrate, exactly as Rapier is
for physics, so the binding stays thin.

Every brief with an enemy, an NPC or a follower needs this, and what a model writes
without it is an ad-hoc A* on a grid it invents — which is precisely the "hundreds of
lines nobody wants to write" shape that made physics worth wrapping.

**Cost is the honest problem:** recast is WASM, so by §9a's own logic it cannot live in
`core` and would take the **last package slot**. That is the decision this area really
asks for. The alternative — folding it into `@threenative/physics`, which already carries
a WASM dep — is worth pricing before spending the slot.

### 4. Hot reload with state preservation — 80 · not started, named in Roadmap Phase 2

Vite gives you module reload; nothing gives you "the player is still standing where they
were." Look-neutral, several hundred vanilla lines, and it never touches a screenshot.

**Scored down on agent leverage only.** An agent restarts the process cheaply and does not
feel the pain a human does. This is the strongest *human-adoption* item on the list and a
weak benchmark item — worth building, worth not expecting the pair to reward.

### 5. Save/load & deterministic replay — 80 · not started

Three.js has `toJSON` for the scene graph and nothing for game state. A seeded RNG already
ships (`createRandom`), which is half of determinism.

The compounding reason to want this: **deterministic replay is a verification
multiplier.** A replay that reproduces a bug is a playtest scenario that costs nothing to
write, which feeds directly into area 2.

**Ceiling risk is the real one here (18/25):** a save format is one refactor away from a
serialized scene format, and that is a closed question in §2 with 25,898 LOC of evidence
behind it. Scope it to *game state the user declared*, never to the scene graph. If the
design starts describing entities generically, stop.

---

## Tier 2 — bounded, only after Tier 1

| # | Area | Score | Note |
|---|---|---:|---|
| 6 | Spatial audio buses | **64** | Partly shipped (`AudioBus`). `PositionalAudio` exists but is awkward; the gap is buses/ducking, not playback. Keep it small. |
| 7 | Mobile & on-device | **61** | Gap is real, cost is brutal (§7 0b is 1–2 weeks of JSI work) and a failed spike *deletes* a charter promise. High variance, correctly scheduled last. |
| 8 | Animation state machines | **57** | `AnimationMixer` already ships and is decent. Godot's `AnimationTree` is opinionated — real ceiling risk. Only justified if the round-2 ledger names crossfade/root-motion as a measured gap. |
| 9 | Perf: instancing, LOD, streaming | **48** | `InstancedMesh` and `LOD` both ship. Owning batching caps what the user can render. Ship as template source, not package code. |
| 10 | React/UI bindings | **49** | 22 LOC of `useGameState` is the 20-line rule working correctly. React and Tailwind are already in every model's weights. **Do not grow this.** |

---

## Tier 3 — do not build

| Area | Score | Why |
|---|---:|---|
| Materials, shaders, TSL, lighting, camera, post | **8** | The measured negative. v1 owned these and scored *worse* than vanilla blind. §5b makes this permanent. |
| GPU particles as package code | **30** | ⚠️ `GPUParticles3D` is in `packages/core` today and it is the one thing there that a screenshot shows. Worth an explicit §5b review: does it decide the look, or only move the buffers? |
| Multiplayer / netcode | **25** | Gap is genuinely 30/30, cost fit is ~0. Explicitly off the roadmap because it can absorb the entire company. |
| Tweens, timers, event bus, math helpers | **5** | The 20-line rule. A model writes each of these correctly on the first try. |
| Scene format · editor · ECS · presets · genre recipes · bespoke CLI | **0** | Closed questions in §2, each decided against *with evidence*. Reopening one needs new evidence, not a new argument. |

---

## How to use this list

1. Close Gate 0. Nothing here starts first.
2. Read the round-2 ledger. A gap row that names a Tier 2 area promotes it; a Tier 1 area
   the ledger never mentions is a hypothesis, not a finding.
3. Decide the navigation package slot **before** writing navigation code — it is the last
   slot and spending it wrong is unrecoverable under §10.
4. Re-score anything whose inputs moved. The rubric is the point; the numbers are just
   this week's reading of it.
