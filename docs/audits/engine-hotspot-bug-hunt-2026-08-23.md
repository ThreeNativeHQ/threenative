# Engine hotspot bug hunt — 2026-08-23

Checkout: `64606751fca79f53fb9a429c88e8e39bc341f887` → `da8cdd69` (fixes landed on top).
Method: hotspot selection by churn × size (`git log --since=6 months --name-only` ranked against
`wc -l`), four parallel bug-hunter lanes over `packages/physics`, `packages/playtest`,
`packages/assets` + core projection, and `packages/core`. Every FIXED finding was proven with a
red→green probe: the failing assertion pasted against unfixed source, then the fix, then the same
suite green. Test and fix share a commit per finding.

Related earlier report from a separate session on the same date: `docs/bug-hunt-2026-08-23.md`
(native `decodeAudioData` thenable defect — still open there; see A5 below).

## Scoreboard

| # | Finding | Lane | Status | Commit |
|---|---|---|---|---|
| P1 | Native adapter reached freed C++ world after `dispose()` on 10 surfaces | physics | **FIXED** | `94b088f8` |
| P3 | `Area3D` mutated a shared `CollisionShape3D` into a sensor | physics | **FIXED** | `f0c88c11` |
| P2 | Native seam forwarded non-finite/negative mass to Rapier | physics | **FIXED** | `1fcacf07` |
| P4 | `syncFromPhysics()` silently no-op'd on native | physics | **FIXED** | `c49172c4` |
| PL1 | `report.frames` undercounted hold+wait steps → inflated velocity, false green | playtest | **FIXED** | `a3459a44` |
| PL2 | Camera assertion with no binding predicate passed on zero observations | playtest | **FIXED** | `432d9ef2` |
| C1 | Update/render ran the incoming scene before `enter()` during async `goto` | core | **FIXED** | `ed34f79d` |
| A1 | `advancedFrames` grew forever on a held once-clip pose → vacuous greens | core | **FIXED** | `972ea530` |
| A4 | Normalized ushort joint weights decoded with the ubyte scale (~257× heavy) | assets | **FIXED** | `ab168b14` |
| A2 | Projection light mirror froze spot/point cone and falloff params | core | **FIXED** | `da8cdd69` |
| C2 | Default picking feed passes window-relative pointer into canvas-relative NDC math | core | CONFIRMED by inspection — needs browser-lane proof | — |
| C3 | Invalid play options permanently orphan a pooled audio voice | core | CONFIRMED by inspection, low | — |
| C4 | Scheduler can fire a mid-tick `after()` callback in the same tick after a cancellation | core | CONFIRMED by inspection, low; deterministic so replays unaffected | — |
| P5 | Plugin render buffer sized from registry, validated against simulation body count | physics | SUSPECTED — fail-closed fires, error points wrong; deprecated-path judgment call | — |
| A5 | Native `decodeAudioData` thenable chain breaks on the second link | runtime-native | CONFIRMED by two independent sessions; needs native lane + C++ fix | — |
| PL3 | Blank capture emits visual rows as `pass: true, reason: "not-evaluated"` | playtest | DISPUTED — pinned test names this deliberate ("infrastructure-red while visual assertions stay not evaluated"); flagged for a ruling | — |

## Fixed findings — evidence per finding

### P1 — post-dispose use-after-free on the native physics adapter (`94b088f8`)

The web adapter opens every one of its 19 step/read/query surfaces with `requireLive()`; the native
adapter guarded only `createBody`, `createJoint`, `removeBody`, `readBodySleepStates` and the
actuation paths. `step`, `setBodyTransform`, `configureCharacter`, `intersectRay`,
`intersectShape`, `intersectPoint`, `readVisibleTransforms`, `drainCollisionEvents`,
`readCharacterState` and `areaIntersections` all reached `raw.*` — freed C++ memory once
`dispose()` had run.
RED: `expected [Function] to throw an error` — `native.step(1/60)` post-dispose called
`raw.step` on the freed host. GREEN: `dispose-contract.spec.ts` 2/2 (native fake asserts no
`raw.*` call after dispose; real-Rapier web twin pins the shared message); suite 153 pass.

### P3 — Area3D turned a shared shape into a sensor (`f0c88c11`)

`new Area3D({ shape })` called `options.shape.setSensor(true)`, which writes
`descriptor.sensor` in place. A solid `RigidBody3D` constructed afterwards from the same shape
instance came out a sensor: collides with nothing, falls through the world, no error. The
layer/mask branch mutated groups the same way and `bindRaw` rebound the shared handle. Area3D now
derives a private descriptor `{ ...base, groups, sensor: true }`.
RED: crate sharing the area's shape fell through the floor to y = −14.66 (solid bodies rest at
~0.5). GREEN: `area.spec.ts` 12/12 — crate rests, area still fires `bodyEntered`.

### P2 — native mass seam skipped validation the web seam has (`1fcacf07`)

Web rejects non-finite/negative mass before Rapier sees it; native forwarded it into the C++
runtime — throw on web, corrupted body on native from one game source.
RED: NaN/Infinity/−5 reached `raw.createBody` without throwing. GREEN: mass case passes,
`createBody` never called; suite 155 pass.

### P4 — syncFromPhysics silently dropped on native (`c49172c4`)

Both node classes called `readBodyTransform?.(...)`; the method is implemented on web, absent on
native, so the call was a silent stale-object no-op on one platform only. Both now throw
`TN_PHYSICS_READ_TRANSFORM_MISSING`, matching the actuation seams' rule that a dropped call must
never masquerade as success. Unknown-body-id still returns quietly, unchanged.
RED: no throw, position untouched, backend never consulted. GREEN: both cases pass;
suite 156 pass; typecheck clean.

### PL1 — report.frames undercount (`a3459a44`)

`buildReport` summed step timing through a `??` chain that stops at the first defined field while
`runStep` waits `(holdFrames ?? 0) + (waitFrames ?? 0)`. The legal `{holdFrames: 10,
waitFrames: 5}` step was reported as 10 frames, so `movement.velocity = distance / frames` came
out 1.5× high and a game slower than `minVelocity` could exit 0.
RED: `expected 17 to be 22`. GREEN: full playtest suite 50 files / 510 tests pass.

### PL2 — vacuous camera assertions (`432d9ef2`)

`assert.camera` accepted `{}`, `{ entity }`, `{ follows }`, `{ targetInViewport: false }`; the
evaluator's row for those is `pass: true` with separation undefined, bypassed further by the
registered-probe backstop because `base.follow` is always set when camera is declared. Tags
already reject the same shape ("passes on a count of zero"). Camera must now declare `within` or
`targetInViewport: true`.
RED: 3 of 4 schema cases loaded the vacuous forms. GREEN: 4/4; playtest suite 514 pass.

### C1 — update/render reached an un-entered scene (`ed34f79d`)

`#goto` installs the incoming scene and clears the graph, then awaits `scene.load()`. During that
window the fixed-step loop took the frame-undefined branch into `scene.update(ctx, dt)` and
onRender called `scene.render(ctx)` — gameplay code against a cleared graph, repeating every step
of a long asset load. Both hooks now gate on `#sceneEntered`; plugin updates still run, matching
the pre-first-scene startup window plugins already tolerate.
RED: events during load were `['play.load', 'play.update']`. GREEN: core suite 38 files /
387 tests pass.

### A1 — advancedFrames counted a frozen pose (`972ea530`)

three's `AnimationMixer.update` advances `mixer.time` unconditionally, so after a `mode:"once"`
clip finished and clamped, every `update(dt > 0)` still incremented `advancedFrames`. Playtest
animation evaluators read `advancedFrames >= N` as proof a clip animated, so hit/death assertions
passed vacuously on idle frames. The counter stops at `#finished`, read before `mixer.update` so
the completing frame still counts.
RED: `expected 5 to be 3` — two idle updates each counted. GREEN: core suite 387 pass.

### A4 — ushort joint weight decode (`ab168b14`)

`evaluateVertex` hardcoded the normalized scale to 1/255, correct only for UNSIGNED_BYTE; a
spec-legal UNSIGNED_SHORT WEIGHTS_0 decoded ~257× heavy and `reachableStats` reported a garbage
bounding box (x span ~230 units on a ~1 unit model). The compile pipeline itself stayed green
because it preserves the source's weight encoding — both sides of the drift check misdecoded
identically — which is why this never surfaced as a false red. Scale now follows the accessor's
component type, matching `decodeElement` in the same file.
RED: posed-skeleton ushort twin vs float twin bbox differed by 80.64 units. GREEN: assets suite
7 files / 57 tests pass.

### A2 — projection mirror froze spot/point parameters (`da8cdd69`)

The light mirror synced only matrix/visible/intensity/color/castShadow/layers; angle, penumbra,
distance, decay and power kept their first-frame clone values forever. A flashlight zoom or
muzzle-flash decay changed the authored light every frame while the mirror rendered a frozen cone
— exactly the "a scene lit differently from the way the game lit it is a wrong picture" failure
the module names as its own red line.
RED: mirrored angle stayed 0.4 after the source moved to 0.9. GREEN: core suite 38 files /
388 tests pass.

## Confirmed but not fixed here — with reasons

- **C2 (picking offset)**: the default pointer feed passes window-relative clientX/clientY into
  NDC math assuming canvas-origin coordinates, so `ctx.raycast()` lands off by the canvas page
  offset whenever the canvas is not at the origin (R3F embedding is supported). `replay.ts`
  does full rect math for the same values. Needs a browser-lane proof to pin the displacement;
  fullscreen templates mask it today.
- **C3 (audio voice orphan)**: `play()/playAt()` claim a pooled voice before option validation,
  so one throwing call shrinks the pool permanently. Low severity, easy follow-up.
- **C4 (scheduler same-tick firing)**: a cancellation mid-tick compacts iteration so a freshly
  appended entry can run in the same tick, against the documented next-tick invariant.
  Deterministic on both backends, so replays are unaffected.
- **P5 (render buffer sizing)**: mechanism verified (`plugin.ts:202` vs the simulation-side
  buffer check); reachable only through the deprecated `world:` constructor path or direct
  `simulation.createBody`. Fail-closed works; the error just points nowhere near the cause.
- **A5 (native audio chains)**: `decodeAudioData`'s thenable returns undefined from `then`,
  breaking any second chained link; independently filed at `docs/bug-hunt-2026-08-23.md`.
  Requires the native runtime lane and a C++ edit — left to that lane.

## Flagged for a ruling

- **PL3 (blank-capture visual rows)**: when the screenshot is blank, declared visual assertions
  land in report contents as `pass: true, reason: "not-evaluated"` rows. The composite verdict
  still goes red via the separate TN_CAPTURE_BLANK diagnostic, and a pinned negative-fixture test
  names this deliberate ("infrastructure-red while visual assertions stay not evaluated") — but
  the repo's own threat model says agents optimize against report contents, and green rows for
  unevaluated assertions are the exact v1 shape the doctrine bans. Deliberate contract vs
  doctrine conflict; not resolved unilaterally here.

## Dead ends verified (so nobody spends a round)

Physics: reuse-contract records consumed synchronously by every caller; kinematic map keys parity
pinned; ray units, capsule mapping, slope radians, quaternion order clean. Core: loop accumulator
capped after tab-suspend; input blur clears state; ResizeObserver stopped on dispose; AudioBus
recycling safe against three 0.185 (fresh BufferSourceNode per play); native/host clock epochs
match. Assets: WAV/OGG preflight sniffs magic only and SDL owns parsing; GLB chunk offsets
correct; `hasRenderHook` prototype-aware; viewport updates aspect on resize; no double-draw in
projection bookkeeping; skeleton attachToBone preserves scale. Playtest: entityTransforms guarded
upstream; lone vacuous assertions caught by TN_PLAYTEST_SCENARIO_NO_ASSERTIONS; maxDistance/HUD
changed-guards sound.

## Gates actually run

```text
per-fix: npx vitest run --config vitest.config.ts packages/<pkg>          # red paste → green each
root typecheck at da8cdd69: pnpm typecheck                                # PASS
full-repo suite at c49172c4 (physics fixes): concurrent gate run          # exitCode 0 (unit phase)
full-repo suite at da8cdd69: pnpm test                                    # PASS — 196 files, 1,876 tests
```

Note: a second session worked in this tree concurrently and committed `330fb3b9` (same
syncFromPhysics conclusion) between this audit's commits; net source state at HEAD was verified
equivalent and the suites were re-run after reconciliation.
