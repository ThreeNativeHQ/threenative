# Engine hotspot bug hunt — 2026-08-23

Checkout audited: `64606751fca79f53fb9a429c88e8e39bc341f887`; fixes landed through `8f02d33b`.
Method: hotspot selection by churn × size (`git log --since=6 months --name-only` ranked against
`wc -l`), four parallel bug-hunter lanes over `packages/physics`, `packages/playtest`,
`packages/assets` + core projection, and `packages/core`. Every FIXED finding was proven with a
red→green probe: the failing assertion pasted against unfixed source, then the fix, then the same
suite green. Test and fix share a commit per finding.

Note on hashes: the first ten fixes were squashed into the landing batch `cc6bbd56`
("Squashed from 61dc03cf..6785cf08…", originals recoverable in that reflog); the six later
fixes carry their own commits in the current chain.

Related lane: `docs/bug-hunt-2026-08-23.md`, from a second session working this tree the same
day — it filed and then **fixed** A5 (native `decodeAudioData`) with red→green executed on the
native V8 lane (`e1908a3d`, plus `audio_decode_promise_test.cpp`).

## Scoreboard — every finding resolved

| # | Finding | Lane | Status | Evidence |
|---|---|---|---|---|
| P1 | Native adapter reached freed C++ world after `dispose()` on 10 surfaces | physics | **FIXED** | squashed in `cc6bbd56` |
| P3 | `Area3D` mutated a shared `CollisionShape3D` into a sensor | physics | **FIXED** | squashed in `cc6bbd56` |
| P2 | Native seam forwarded non-finite/negative mass to Rapier | physics | **FIXED** | squashed in `cc6bbd56` |
| P4 | `syncFromPhysics()` silently no-op'd on native | physics | **FIXED** | superseded by `5a7cff98`: native seam implements `readBodyTransform` |
| PL1 | `report.frames` undercounted hold+wait steps → inflated velocity, false green | playtest | **FIXED** | squashed in `cc6bbd56` |
| PL2 | Camera assertion with no binding predicate passed on zero observations | playtest | **FIXED** | squashed in `cc6bbd56` |
| C1 | Update/render ran the incoming scene before `enter()` during async `goto` | core | **FIXED** | squashed in `cc6bbd56` |
| A1 | `advancedFrames` grew forever on a held once-clip pose → vacuous greens | core | **FIXED** | squashed in `cc6bbd56` |
| A4 | Normalized ushort joint weights decoded with the ubyte scale (~257× heavy) | assets | **FIXED** | squashed in `cc6bbd56` |
| A2 | Projection light mirror froze spot/point cone and falloff params | core | **FIXED** | squashed in `cc6bbd56` |
| PL3 | Blank capture emitted visual rows as `pass: true` "not-evaluated" | playtest | **FIXED — ruled fail-closed** | `4c0e2ede` |
| C3 | Invalid play options permanently orphaned a pooled audio voice | core | **FIXED** | `bedf4163` |
| C4 | Scheduler fired mid-tick additions same-tick after a cancellation | core | **FIXED** | `25071734`, pin repaired in `2de34249` |
| P5 | Simulation owning unregistered bodies killed plugin.update every frame | physics | **FIXED** | `abac8aa9`, cleanup `61b8675b` |
| C2 | Default picking feed fed window-relative pointer into canvas-relative NDC math | core | **FIXED** | `fd62e9e7`, typing `8f02d33b` |
| A5 | Native `decodeAudioData` broke on the second chained link | runtime-native | **FIXED** on the native lane, executed on V8 and QuickJS | `e1908a3d` — see `docs/bug-hunt-2026-08-23.md` |
| A6 | QuickJS never overrode `processMicrotasks`, so the runtime's per-frame pump was a no-op on the Android rollback engine | runtime-native | **FIXED** — found by running A5's proof on QuickJS | see `docs/bug-hunt-2026-08-23.md` |

## Fixed findings — evidence per finding

### P1 — post-dispose use-after-free on the native physics adapter

The web adapter opens every one of its 19 step/read/query surfaces with `requireLive()`; the
native adapter guarded only four. `step`, `setBodyTransform`, `configureCharacter`,
`intersectRay`, `intersectShape`, `intersectPoint`, `readVisibleTransforms`,
`drainCollisionEvents`, `readCharacterState` and `areaIntersections` reached `raw.*` after
`dispose()` had freed the C++ world.
RED: `expected [Function] to throw an error` — post-dispose `native.step(1/60)` called
`raw.step`. GREEN: `dispose-contract.spec.ts` 2/2; physics suite green at the time.

### P3 — Area3D turned a shared shape into a sensor

`options.shape.setSensor(true)` wrote `descriptor.sensor` in place, so a solid body constructed
afterwards from the shared shape fell through the world. Area3D now derives a private descriptor.
RED: crate sharing the area's shape fell to y = −14.66 (solid bodies rest at ~0.5). GREEN:
crate rests, area still fires `bodyEntered`.

### P2 — native mass seam skipped validation the web seam has

Web rejects non-finite/negative mass before Rapier; native forwarded it into the C++ runtime —
throw on web, corrupted body on native from one game source.
RED: NaN/Infinity/−5 reached `raw.createBody`. GREEN: rejected before the host call.

### P4 — syncFromPhysics across backends

Found as a silent no-op on native (`readBodyTransform?.(...)` with the method absent). The fix
evolved one step further on this tree: `5a7cff98` implements `readBodyTransform` on the native
seam from the bulk render read, so the public method works on both platforms instead of merely
throwing symmetrically — with tests pinning single-bulk-read cost and unknown-body behaviour.

### PL1 — report.frames undercount

`buildReport`'s `??` chain stopped at the first defined timing field while `runStep` waits the
sum, so `{holdFrames: 10, waitFrames: 5}` reported 10 frames and `movement.velocity` came out
1.5× high — a false green on `minVelocity`.
RED: `expected 17 to be 22`. GREEN: playtest suite green at the time.

### PL2 — vacuous camera assertions

`assert.camera` accepted `{}`, `{entity}`, `{follows}`, `{targetInViewport: false}` — each
evaluated to pass with zero observations consulted, bypassing the registered-probe backstop.
Camera must now declare `within` or `targetInViewport: true`, matching tags' rejection of
assertions that "pass on a count of zero".
RED: 3 of 4 schema cases loaded vacuous forms. GREEN: 4/4.

### C1 — update/render reached an un-entered scene

During async `goto()`, the fixed-step loop called the incoming scene's `update()` and `render()`
against the cleared graph for the whole load window. Both hooks now gate on `#sceneEntered`.
RED: events during load were `['play.load', 'play.update']`. GREEN: core suite green at the time.

### A1 — advancedFrames counted a frozen pose

three advances `mixer.time` unconditionally, so after a once-clip clamped, idle frames still
incremented `advancedFrames`, which playtest evaluators read as proof of animation. The counter
stops at `#finished`, read before `mixer.update` so the completing frame counts.
RED: `expected 5 to be 3`. GREEN: core suite green at the time.

### A4 — ushort joint weight decode

`evaluateVertex` hardcoded the normalized scale to 1/255; spec-legal UNSIGNED_SHORT weights
decoded ~257× heavy and `reachableStats` reported garbage bounds. Scale now follows the
accessor's component type.
RED: posed-skeleton ushort twin vs float twin bbox differed by 80.64 units. GREEN: twins agree
within 1e-3; assets suite green at the time.

### A2 — projection mirror froze spot/point parameters

angle, penumbra, distance, decay and power kept their first-frame clone values forever while the
game animated them — rendering a frozen cone against the module's own "a scene lit differently
from the way the game lit it is a wrong picture" rule.
RED: mirrored angle stayed 0.4 after the source moved to 0.9. GREEN: core suite green at the time.

### PL3 — blank-capture visual rows fail closed (`4c0e2ede`)

A TN_CAPTURE_BLANK capture emitted declared visual assertions as `pass: true,
reason: "not-evaluated"` rows — the v1 dropped-assertion shape inside machine-readable report
contents, pinned until now by a negative-fixture test as deliberate. Ruled with the maintainer's
instruction to fix everything remaining: agents optimize against report contents, so a missing
observation fails the row (`pass: false` + `TN_PLAYTEST_ASSERTION_NOT_EVALUATED`), mirroring the
sibling target-unsupported branch. The composite verdict was already infrastructure-red and stays
so.
RED: `expected true to be false` on the visual row. GREEN: evaluator-semantics 10/10; updated
pin passes; playtest suite green.

### C3 — audio option validation moved before the voice claim (`bedf4163`)

`play()/playAt()` claimed a pooled voice and only then validated volume/fade/refDistance/
rolloffFactor, so one throwing call orphaned the claim permanently — pool shrank by one per bad
call. The four checks now live in `assertOptions`, run before the claim.
RED: after a NaN-volume throw, the next cue got a freshly minted voice instead of the documented
reuse of the ended one. GREEN: core suite green at the time.

### C4 — scheduler next-tick invariant survives cancellation (`25071734`)

tick()'s size bound kept mid-tick additions firing next tick only while nothing cancelled; a
cancellation deleted from the Set and shifted later entries down a visit, letting an entry
appended during the tick fire inside it. Entries now carry monotonic registration order and tick()
skips anything added at or after the tick's cutoff — no per-tick allocation. The PRD-173 pin
still passes.
RED: `expected [] to deeply equal [1]` — fired same-tick. GREEN: core suite green at the time.
(The initial commit left typecheck/lint red — missing type import, biome-rejected let; repaired
in `2de34249`.)

### P5 — update loop survives unregistered simulation bodies (`abac8aa9`)

The plugin sized its bulk transform buffer from its own registry while the simulation validated
against every body it owned. One body outside registration — the deprecated raw-world node path
or direct `simulation.createBody` — made every `plugin.update` throw: "buffer is too small" on
native, "unknown visible body id" on web. The read now retries with a grown buffer on
small-buffer refusal, and visible ids outside the registry are skipped instead of thrown on.
RED: 24 registered bodies + one deprecated-path body crashed update with the unknown-id error.
GREEN: physics suite green; dead branch removed in `61b8675b`.

### C2 — default picking feed made canvas-relative (`fd62e9e7`)

Input reports window-relative clientX/clientY; the picker's NDC math assumed canvas-origin
coordinates. Every pick landed displaced by the canvas page offset whenever the game ran
embedded (R3F consumption is a supported mode) — replay.ts already did full rect math for the
same values. The feed subtracts the bounding rect; raw input state stays window-relative for
other readers.
RED: canvas at page offset (100, 50), pointer at page x=180 (canvas x=80, NDC −0.5): ray landed
at world x=+2.57, the wrong half of a full-width wall. GREEN: core suite green at the time;
config-boundary typing corrected in `8f02d33b`.

### A5 — native decodeAudioData Promise contract (fixed on the native lane)

Filed independently by two sessions: the hand-rolled thenable returned undefined from `then`,
so any second chained link threw TypeError, contradicting its own comment. Fixed by the parallel
session as a real Promise with red→green executed through the installed JS engine — see
`docs/bug-hunt-2026-08-23.md` and `audio_decode_promise_test.cpp`.

### A6 — QuickJS had no microtask pump (found by running A5's proof on a second engine)

The A5 proof passed on V8 and, on QuickJS, never reached its report at all. `Engine::processMicrotasks`
has an empty default body and QuickJS never overrode it, so the per-frame checkpoint the runtime
calls did nothing on the engine that is the documented Android rollback. Promise jobs still drained
as a side effect of `evalScript`, `evalScriptWithResult` and `call`, which is why games appeared to
work — but a Promise settled from a native callback outside a JS call waited for the next one, and a
binding handing back a settled Promise is exactly that shape.

The lesson generalizes past audio: a proof that only ever runs on the default engine cannot see a
per-engine gap. The proof now enumerates every engine the build carries and fails when a build
carries none, so a skipped engine can never read as a pass.

## Dead ends verified (so nobody spends a round)

Physics: reuse-contract records consumed synchronously by every caller; kinematic map keys parity
pinned; ray units, capsule mapping, slope radians, quaternion order clean. Core: loop accumulator
capped after tab-suspend; input blur clears state; ResizeObserver stopped on dispose; AudioBus
recycling safe against three 0.185 (fresh BufferSourceNode per cue); native/host clock epochs
match. Assets: WAV/OGG preflight sniffs magic only and SDL owns parsing; GLB chunk offsets
correct; `hasRenderHook` prototype-aware; viewport updates aspect on resize; no double-draw in
projection bookkeeping; skeleton attachToBone preserves scale. Playtest: entityTransforms guarded
upstream; lone vacuous assertions caught by TN_PLAYTEST_SCENARIO_NO_ASSERTIONS; maxDistance/HUD
changed-guards sound; server-ready ordering, exit-code mapping and p95 inclusivity checked.

## Gates actually run

```text
per-fix:   npx vitest run --config vitest.config.ts packages/<pkg>     # red paste → green each
final:     pnpm typecheck                                              # PASS at 8f02d33b
final:     pnpm lint                                                   # PASS
full repo: pnpm test                                                    # PASS — 198 files, 1,882 tests
```

A concurrent session worked this tree throughout (squashed the first landing batch, fixed A5 on
the native lane, repaired two gate-reds this audit's early commits left). History was replayed
twice under it; every fix above is present at HEAD and the final gates ran at `8f02d33b`. One
full-suite run reported a leaked temp directory that a clean re-run did not reproduce — the
leaked path belonged to that session's parallel suite.
