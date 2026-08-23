# Charter performance-default audit — 2026-08-22

**Audited:** the three amendments in the working tree of `docs/architecture/CHARTER.md`
(branch `audio-voice-pooling`, HEAD `198b0f49`) — §1's performance default, §11 rule 8, and
the header amendment line — checked against the engine as it stands.

**Method:** static read only; nothing was executed. Three parallel auditors: playtest
assertion inventory, core/physics/ui hot paths, and all seven templates. Every claim cites
`file:line` from a direct read. The one CI wiring claim (golden-path runs template tests)
was verified by reading `.github/workflows/ci.yml:252` and `scripts/verify-golden-path.ts`,
not by running it — no green/red is claimed for that job today.

**One-line result:** the header passes; pooled/batched/culled holds; **"free of per-frame
allocation" fails on the two hottest surfaces a game touches**, six of seven scaffolded
templates ship per-frame garbage, and rule 8's proof exists exactly once — reference
workload, web lane only.

## Verdicts

| # | Amendment | Verdict | In one line |
|---|---|---|---|
| 1 | §1 — performance is a shipped default | **VIOLATED IN PART** | Pooling, batching, culling hold. "Free of per-frame allocation" fails on `ctx.input.vector` and `ctx.state.set` (both HOT), plus 7 warm feature paths. 6/7 templates allocate per frame in generated code. |
| 2 | §11 rule 8 — proven by a `performance` assertion | **PARTIAL** | Real budgets exist exactly once (platformer, web lane, CI-executed via golden-path). starter/minimal carry `"performance": {}`, which bounds nothing — an intention by rule 8's own definition. Four templates, every example except abyss-framework, and every native lane have none. |
| 3 | Header — dated amendment line | **PASS** | `**Amended 2026-08-22:** §1 and §11 — …` matches the 2026-08-17 entry's format exactly (bold label, date, section list, em-dash summary). Still uncommitted. |

---

## 1. §1 — "pooled, batched, culled and free of per-frame allocation"

### Clean rows — where the claim holds

- **Fixed-step loop** (`packages/core/src/loop.ts:108-145`): accumulator arithmetic only;
  render metrics strictly opt-in (`collectMetrics` default false, capped at 1024).
- **Scheduler** (`packages/core/src/schedule.ts:92-104`): bounded direct Set iteration;
  snapshot-copy-per-tick deliberately removed.
- **Update dispatch** (`packages/core/src/game.ts:566-578`): stable arrays, direct scene-frame
  invocation, no per-frame closure or iterator construction; Registry sweep early-returns.
- **Physics bulk crossing**: kinematic inputs, visible transforms and sleep states move through
  reused Float32Array/Uint32Array records with geometric growth (`packages/physics/src/plugin.ts:68-87,165,189,204`;
  scalar writes with a comment recording that an array literal "was one more thrown-away object
  per body per step"); Rapier-side scratch reused (`simulation.ts:407-417`); collision events are
  a flat reused stride-4 list.
- **AudioBus voice pool** (`packages/core/src/audio.ts`): bounded by `maxVoices` (48),
  oldest-one-shot stealing, flat/positional free lists, one filter node built per voice.
  (This is the `audio-voice-pooling` branch's own work.)
- **TracerPool3D** (`packages/core/src/tracers.ts`): fixed slots, scratch-only update,
  prewarmed visible-at-zero-opacity slots.
- **GPUParticles3D** (`packages/core/src/particles.ts`): GPU-resident instanced buffers;
  process() is one compute dispatch, no per-frame JS allocation.
- **Batching**: default-on above the 200-mesh floor via SceneRenderProjection (wired
  unconditionally, `game.ts:461`) with an honest decline gate (`projection-plan.ts:38,276`).
- **Culling**: frustum-culled defaults intact; only documented exceptions
  (`projection-apply.ts:481` with rationale at `:45-54`, `particles.ts:54`, tracer prewarm).
- **posedBounds / AnimationPlayer / event emits / playtest bridge**: cached envelopes,
  in-place fades, edge-triggered area events, sample-driven observation assembly.

### Violations

HOT = runs every frame for every game by default. WARM = every frame while the named feature is in use.

| Sev | Path | Evidence | Cost |
|---|---|---|---|
| HOT | `ctx.input.vector` | `packages/core/src/input.ts:232,243` — `new Vector2(...)` per call plus `clampLength()` returning a second fresh Vector2; no scratch reuse although the class already reuses `#pointerPosition`. `"move"` is in DEFAULT_BINDINGS. | ≥2 objects/frame, every game |
| HOT | `ctx.state.set` | `packages/core/src/state.ts:31-32` — two object spreads per write (`{ ...pending, ...next }` twice); core docs state set() "is called at loop rate". Coalescing bounds React renders, not allocations. | 2 objects/write, loop rate |
| HOT | loop constants | `packages/core/src/game.ts:558,564` fresh `{}` returned per rendered frame even with diagnostics off; `packages/core/src/loop.ts:165` rAF re-arm closure per frame; `packages/core/src/input.ts:317` find-closure + `?? []` per tick. | ~3 small objects/frame, every game |
| WARM | Scene-mirror steady state | `projection-plan.ts:188-225,253` — per-frame replan while projecting: `new Set`, eligible/lane arrays, recursive walk closure, `[uuid,…].join("|")` array+string per eligible mesh; apply-side copies `projection-apply.ts:256,234,316`. The reconcile gate (`renderProjection.ts:177-185`) throttles only the declined state to 1-in-60. | largest warm garbage source; grows with mesh count |
| WARM | Area3D reconcile | `packages/physics/src/plugin.ts:240` new Map per area per physics step; `simulation.ts:1106` new Set per `areaIntersections` call plus callback closure — even when nothing overlaps. | 3+/area/frame for trigger games |
| WARM | Raycast plumbing (post-PRD-186) | `picking.ts:84-88,123-124` — 1-element roots array on the default path, exclusion Set allocated even when empty, comparator closure + defensive slice in raycastAll. The PRD-186 running-min fix itself is clean. | residual query objects/call |
| WARM | PathFollow3D | `path-follow.ts:89-93` getPointAt/getTangentAt clones + result wrapper; `:128-130` two more clones in project(). | 3+/follower/frame |
| WARM | Viewport projection | `viewport.ts:81,90,94-95` — new Vector2s, `point.clone()`, `world.clone().project(...)`. | 2-3/screen→world call |
| WARM | NavigationAgent3D | `NavigationAgent3D.ts:173-182` clone-returning branches; `:267,271` `{x,y,z}` per syncCrowd while moving. | per agent per steering frame |
| WARM | Web Rapier boundary | `simulation.ts:953-954` — compat bindings return fresh objects from `translation()`/`rotation()`; also `characterState()` record per character per frame. Below the clean JS record layer. | 2/body/frame on web |

### Sharpest breach: by the charter's own test, this convention does not exist

§1 says *"a convention that is not in the templates' AGENTS.md does not exist… is a release
defect, not a docs chore."* **No template AGENTS.md documents pooling, allocation hygiene,
frame budgets or GC discipline** (checked all seven). What exists: the state-bridge throttle
rule (all 7), a superseded-constructs `pnpm budgets` gate, and the 9-FPS war story. The
hygiene was applied piecemeal and never stated as a rule — racing's camera carries the
comment "three Vector clones a frame was pure garbage", proving the discipline was known and
locally applied, but nothing binds it anywhere.

### Templates as scaffolded ("a hitch in a template as scaffolded is an engine defect")

| Template | Verdict | Per-frame cost in generated code |
|---|---|---|
| minimal | PASS | clean except 3 short-lived strings before the HUD unchanged-text early return |
| starter | RISK | Player position clone per frame (`entities/Player.ts:62`); `player.debug()` object + arrays per frame (`scenes/Play.ts:194`); `Object.keys(snapshot())` per frame (`:210`) |
| platformer | RISK | 1 Vector3/frame always (`entities/Character.ts:85`); ~7/frame on the native touch lane (`render/touch-controls.ts:101`, `touch-layout.ts:23-37,57`) |
| racing | RISK — heaviest garbage | ranking rebuild map+spread+sort+map (~7 obj, `track/Ranking.ts:25-34` ← `Race.ts:147`); sector-ray clones (`TrackSector.ts:48-49`); lap-sweep 3 clones × 2 gates (`Lap.ts:74-82`); `.toArray()` + template string per frame (`Race.ts:160-162`) |
| shooter | RISK | spread+filter per frame (`scenes/Play.ts:415,426,438-441`); projectile clones per tick (`weapons/Projectile.ts:57-58`); projectiles spawned unpooled (lifetime-bounded) |
| action-rpg | RISK | up to 5 Vector3/aggro-enemy/frame (`entities/Enemy.ts:78-79,96`); four `.toFixed()` strings/frame (`Play.ts:419,425-427`) |
| defense | RISK | two reduce-spreads/frame (`Defense.ts:135-136`); attackers spawned unpooled per wave (bounded) |

No RED anywhere: no O(n²) over unbounded n, no unbounded growth, no HUD bypassing the
throttled store, no per-frame DOM writes. But six of seven templates put heap garbage on the
ordinary path — which the amendment classifies as engine debt, since templates ship from
this repo.

---

## 2. §11 rule 8 — "proves it with a `performance` assertion rather than an intention"

### The machinery is real and fail-closed

Registry `packages/playtest/src/assertion-schema.ts:315-331`; load-time validation throws on
unknown keys/wrong types/negatives (`scenario/schema-accessors.ts:224-232`). Zero or invalid
samples fail with `TN_PLAYTEST_PERFORMANCE_SAMPLES_MISSING`; exceeded budgets fail with
`TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED` naming expected vs observed
(`evaluators/render-evidence.ts:56-138`); missing capability throws
`TN_PLAYTEST_CAPABILITY_MISSING` (`runner/bridgeClient.ts:135-146`).

### The usage inventory — five rows in the whole repo

| Scenario | Bounds | Status |
|---|---|---|
| `templates/platformer/playtests/performance.playtest.json` | maxDrawCalls 180, maxFrameMsP95 33, maxTriangles 100000, web @1920×1080 | **the only real proof**; budgets pinned by `create-threenative/__tests__/platformer.spec.ts:225-258` |
| `templates/platformer/playtests/jump.playtest.json` | `"performance": {}` | presence-only — bounds nothing |
| `templates/starter/playtests/play.playtest.json` | `{}` | presence-only |
| `templates/minimal/playtests/play.playtest.json` | `{}` | presence-only |
| `examples/abyss-framework/playtests/draw-calls.playtest.json` | maxDrawCalls 5000 | wired to no script or workflow |

action-rpg, defense, racing, shooter: nothing at all. An empty `{}` evaluates only
`performance.samples` (`render-evidence.ts:74-90`) — it proves samples exist and asserts no
budget. That is precisely the "intention" rule 8 forbids, shipped in two templates.

### Who executes it

- **CI golden-path job** (`.github/workflows/ci.yml:252` → `scripts/verify-golden-path.ts`)
  scaffolds every template and runs its full `playtests/*.playtest.json` glob — so the
  platformer budgets execute on every push/PR (wiring read, not run).
- Root `pnpm test:playtest` runs no performance scenario. `pnpm test:templates` mirrors
  golden-path locally but no workflow invokes it.
- **Native lanes**: no budgeted performance assertion in any workflow;
  `native:verify:desktop` contains none; `pnpm profile:production` enforces budgets but is
  manual-only. The assertion kind supports desktop (`supportedOn` includes it); nothing uses
  it there. Rule 8 is therefore held, provably, on one lane of one template.

---

## 3. Header amendment line — PASS

Working tree adds:

> **Amended 2026-08-22:** §1 and §11 — performance is a shipped default bounded by §5b, §11.2 and §10a, not a tuning pass left to each game.

Format matches the 2026-08-17 entry (bold `Amended <date>:` + section list + em-dash summary).
Note: still uncommitted; the amendment text itself is not yet binding history.

---

## Cross-findings surfaced by the audit (owner calls, not part of the three items)

1. **Charter drift:** §10a says platformer "already carries 14 playtest scenarios" — it ships
   22 files today (21 root + native touch-controls). Fix while amending anyway.
2. **Reference-workload wording:** platformer is heaviest by scenario count but not by src LOC
   (shooter 2270 > action-rpg 1956 > platformer 1875 > racing 1648 > defense 1520 > starter
   1439 > minimal 504). "It is the heaviest starter" is true only under one metric.
3. **PRD-186 linkage:** Phase 1 (raycast early-out) has landed (`198b0f49`). Phase 2
   (instanced-write) is open and another lane has a live probe file
   (`packages/core/tmp-probe-instanced-write.mts`) — left untouched here. Phase 3
   (`FrameStats` → core) is the piece that lets scaffolded projects measure hitches at all;
   until it lands, rule 8's in-game proof depends entirely on the playtest runner bridge.
4. **Empty assertions as intentions:** if `{}` is meant to assert "samples flow", it should be
   spelled as such or deleted — as written it reads as a performance proof and isn't one.

## Smallest set of fixes that would make the amendments true

1. Scratch-reuse `ctx.input.vector` and merge `state.set` in place — both tiny, both HOT, every game pays them today.
2. Give action-rpg, defense, racing and shooter budgeted performance scenarios; upgrade the two `{}` placeholders to real bounds (or delete them).
3. One paragraph of allocation/pooling convention in each template AGENTS.md — until then §1's own existence test fails.
4. Reuse the projection replan structures across frames (largest WARM win, bounded scope).
5. Correct §10a's "14 scenarios" → 22 in the same commit as the amendment.

*Audit artifact only — no code was changed, nothing was executed, and the concurrent lane
probing `tmp-probe-instanced-write.mts` was not disturbed.*
