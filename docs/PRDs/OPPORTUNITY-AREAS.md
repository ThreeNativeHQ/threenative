# Opportunity areas — where abstraction pays and where it taxes

**Status:** proposal, re-audited 2026-08-09. Scores are historical prioritization inputs,
not current completion states. `CHARTER.md` wins on any conflict.
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

`pnpm budgets` on 2026-08-09: **5,815 / 15,000 framework LOC**, **53,851 / 50,000 native
runtime LOC**, **6 framework packages**, and **3 example workspaces**. The native review
trigger is exceeded by 3,851 LOC; it is reported, not silently routed around.

**LOC is not the scarce resource. Package boundaries are dependency boundaries.** Rule 5 no
longer defines a numeric slot: any new package still has to carry a dependency the others must
not inherit. Score `Cost fit` against that rule and the current native LOC trigger.

---

## Prerequisite — this gates everything below

**Gate 0 closed on 2026-08-08.** Round 2 ran both arms and moved the work from speculative
scoring to measured PRDs. Use the current round ledger and each area's PRD status below;
do not treat this original score table as an execution queue.

---

## Tier 1 — build these

| # | Area | Score | Gap | Ceiling | Agent | Cost |
|---|---|---:|---:|---:|---:|---:|
| 1 | Asset discovery & licensing | **94** | 30 | 25 | 23 | 16 |
| 2 | Agent self-verification (playtest depth) | **90** | 30 | 25 | 25 | 10 |
| 3 | Navigation & pathfinding | **86** | 30 | 22 | 22 | 12 |
| 4 | Hot reload with state preservation | **80** | 28 | 24 | 12 | 16 |
| 5 | Save/load & deterministic replay | **82** | 30 | 18 | 20 | 14 |

### 1. Asset discovery & licensing — 94 · live gate failed; kill switch pending

Three.js ships a `GLTFLoader` and nothing that tells you *where a legally usable model
lives*. All three current templates now contain `.mcp.json` and install the external asset
MCP; no server code is vendored. The live surface is still 32 tools, not the bounded eight-tool
profile proposed by PRD-032. The 2026-08-09 live-agent gate completed: the positive arm
downloaded and credited real Poly Haven and Kenney assets, but a blind critic preferred the
no-MCP control `4/5` to `3/5` overall because its authored crate was clearer and fit the scene
better. PRD-032's predeclared kill switch fired. Deletion of the generated asset-MCP surface
is pending explicit confirmation; the smaller-profile publication is no longer the next move.

It also attacks the "looks good" axis without violating §5b. Real assets are the biggest
visual delta available, and shipping *discovery* is not shipping *the look* — the agent
still writes its own materials and lighting around what it found.

**Ceiling: none.** It is a tool call, not an API surface the model must learn.
**Watch:** the legacy server is 10,847 LOC and 25+ tools. That is a maintenance surface
even outside the budget, and 25 tools is a discovery cost of its own. Ship the subset that
the paired arm actually reaches for.

### ✅ 2. Agent self-verification — 90 · shipped; arm-neutral diagnostics repaired

`packages/playtest` already drives a real browser and asserts what happened. Vanilla
Three.js has no answer at all — an agent building vanilla cannot tell whether its game
runs. This is the framework's most defensible capability and it is *not* where the
remaining effort has gone.

**Ceiling: none.** Assertions observe; they do not constrain what the game may be.
**The strategic catch:** `CHARTER.md` §3 gives the harness to the vanilla arm too, so it
wins no benchmark comparison even though it is enormously valuable to a real user. That is
a scoring artifact, not a reason to underinvest — it just means the points show up in
adoption rather than in the pair.
**2026-08-09 proof repair:** browser and device transports now advertise the runtime-error
evidence they actually capture; core no longer supplies a never-written empty diagnostics
provider. `sweep:proof` persists runner stdout/stderr to artifacts behind a 16 MiB fail-closed
limit, so the round-3 vanilla replay retained a 4.08 MB report and reached all five sealed
assertions instead of truncating JSON at Node's default 1 MiB child-process buffer. Replaying
both unchanged arms produced a valid functional tie at 0/1.
**Highest-value next move:** widen semantic assertions (what the *game* did) rather than
diagnostics (what the *page* did). `TN_PLAYTEST_BRIDGE_MISSING` failing closed is the
harness being right; more of the game surface should be observable through it.

### ✅ 3. Navigation & pathfinding — 86 · retained browser-only; live caller verified

Three.js ships nothing. Godot ships `NavigationAgent3D`, `NavigationRegion3D`,
`NavigationObstacle3D` — names already in every model's weights, so rule 4 is satisfied
for free. Recast/Detour (`recast-navigation-js`) is the substrate, exactly as Rapier is
for physics, so the binding stays thin.

Every brief with an enemy, an NPC or a follower needs this, and what a model writes
without it is an ad-hoc A* on a grid it invents — which is precisely the "hundreds of
lines nobody wants to write" shape that made physics worth wrapping.

**Cost is the honest problem:** Recast is WASM, so it remains behind
`@threenative/physics/navigation` and is browser-only. PRD-052 measured zero corpus demand
and replaced the platformer's Recast caller with 31 lines of portable steering. On 2026-08-09
a new web-only `abyss-framework` caller and a temporary direct-Recast control ran the same
headed WebGPU route-around-blocker playtest. Both passed; the framework caller was 127
nonblank source lines versus 187 direct lines, a 60-line/32.1% reduction. The direct arm was
then removed and the framework caller retained at `?navigation`, leaving the portable
platformer and native entry Recast-free. The surface may stay, but further framework growth
still requires measured caller demand.

### ✅ 4. Hot reload with state preservation — 80 · shipped and leak-controlled (`PRD-035`)

Vite gives you module reload; nothing gives you "the player is still standing where they
were." The shipped boundary preserves JSON-shaped store state and rebuilds the world. On
2026-08-09 the final two negative controls were observed red and restored, teardown gained a
scene-release postcondition, and the browser gate passed ten reloads plus the specified
5% fall-cadence comparison.

**Scored down on agent leverage only.** An agent restarts the process cheaply and does not
feel the pain a human does. This is the strongest *human-adoption* item on the list and a
weak benchmark item — worth building, worth not expecting the pair to reward.

### ✅ 5. Save/load & deterministic replay — 82 · shipped (`PRD-036`)

Three.js has `toJSON` for the scene graph and nothing for game state. A seeded RNG already
ships (`createRandom`), which is half of determinism.

The compounding reason to want this: **deterministic replay is a verification
multiplier.** A replay that reproduces a bug is a playtest scenario that costs nothing to
write, which feeds directly into area 2.

The fixed-step bridge now reports the loop's cumulative update count and fails when a
requested advance differs from actual updates, so wall-clock ticks cannot be hidden behind a
scripted counter.

**Ceiling risk is the real one here (18/25):** a save format is one refactor away from a
serialized scene format, and that is a closed question in §2 with 25,898 LOC of evidence
behind it. Scope it to *game state the user declared*, never to the scene graph. If the
design starts describing entities generically, stop.

**Phase 0 measurement (2026-08-08):** Rapier 0.19.3 produced identical 9,757-byte
`World.takeSnapshot()` results for a five-box stack on a floor after 300 fixed ticks, both
twice in one process and in a fresh worker. Moving the first box from `y=0` to `y=1e-9`
changed the bytes. This supports same-machine, same-runtime replay; it does not support
cross-browser, cross-OS, or cross-version portability, so the ceiling score remains 18.
The agent-leverage score rises from 18 to 20 because the measured replay oracle can feed a
fail-closed playtest scenario; the package cost remains 14.

---

## Tier 2 — bounded, only after Tier 1

| # | Area | Score | Note |
|---|---|---:|---|
| 6 | Spatial audio buses | **64** | Partly shipped (`AudioBus`). A fresh no-MCP starter control naturally called `playAt`, so the API is discoverable. On 2026-08-09 the Linux native mixer gained a real source → panner → gain graph: compiled samples proved gain `0.5`, inverse-distance right pan `0.1`, and listener-relative left flip `0.1`; the actual V8/SDL host then ran `AudioBus.playAt()`, dispatched `onended` on the JS main thread, and proved the bus released its ended voice. ✅ The unchanged proof then passed on Android QuickJS/SDL via `emulator-5556`, including the audio callback and ended-voice release. Core still fails closed on hosts without `createPanner`. iOS, arm64, and physical audible output remain unexecuted, so no portable template caller yet; buses/ducking remain premature. |
| 7 | Mobile & on-device | **61** | Score is stale. Linux, Android emulator, iOS simulator, macOS, and Windows have executed evidence. ✅ The Android source-emulator gate now models generated assets as Gradle outputs and verifies the APK's exact bundled bytes before install; two runs on `emulator-5556`, including an `UP-TO-DATE` asset merge, reached 300 frames with clean logs and a nonblank screenshot. The first release run passed all desktop builders but failed before publication because its Android dependency set omitted SDL's Java glue; `0.1.9` fixes and locally proves that boundary. Corrected released-consumer and physical-hardware evidence remain open. Re-score against `docs/PRDs/native/README.md`. |
| 8 | Animation state machines | **57** | **Conditionally closed — PRD-039 is WONTBUILD.** `AnimationMixer` already ships and is decent. Godot's `AnimationTree` is opinionated — real ceiling risk. Reopen only if the round-2 ledger names crossfade/root-motion as a measured gap. |
| 9 | Perf: instancing, LOD, streaming | **48** | `InstancedMesh` and `LOD` both ship. Owning batching caps what the user can render. Ship as template source, not package code. |
| 10 | React/UI bindings | **49** | 22 LOC of `useGameState` is the 20-line rule working correctly. React and Tailwind are already in every model's weights. **Do not grow this.** |

---

## Tier 3 — do not build

| Area | Score | Why |
|---|---:|---|
| Materials, shaders, TSL, lighting, camera, post | **8** | The measured negative. v1 owned these and scored *worse* than vanilla blind. §5b makes this permanent. |
| GPU particles as package code | **30** | Reviewed and bounded by PRD-027: core owns dispatch, buffer lifetime and release; generated `src/render/particles.ts` owns material, TSL behavior and the look. Do not grow the node without a new measured caller. |
| Multiplayer / netcode | **25** | Gap is genuinely 30/30, cost fit is ~0. Explicitly off the roadmap because it can absorb the entire company. |
| Tweens, timers, event bus, math helpers | **5** | The 20-line rule. A model writes each of these correctly on the first try. |
| Scene format · editor · ECS · presets · genre recipes · bespoke CLI | **0** | Closed questions in §2, each decided against *with evidence*. Reopening one needs new evidence, not a new argument. |

---

## How to use this list

1. Read the latest completed round ledger; an area the ledger never names remains a hypothesis.
2. Execute the named PRD's next unmet criterion, not this score table.
3. For navigation, restore a real browser caller and direct comparison before adding API.
4. Re-score inputs that moved; mobile, package count, LOC and shipped status all moved here.
