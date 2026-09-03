# PRD-338 — the harness can see the room, and the feet

Status: DONE (2026-09-02)
Owner: playtest / core
Round: [round 13](../../verification/round-13-2026-09-02.md), gaps 1–3

## The problem

Two things this repository already measures, and nothing outside the game could read.

**The room.** `doctor --url` ended every report with two lines:

```
  not observed lights, materials and textures — the bridge reports entities, not renderer resources
  not observed camera framing beyond its entity transform
```

So an agent looking at a black frame, a washed-out frame, or a frame missing its horizon had
nothing between *the bridge answered* and *here is a screenshot* — and a screenshot is the one
instrument that cannot say **why**. Round 9 lost its visual column to a sky dome of radius 90
sitting behind `Fog(bottom, 18, 80)`: a fog far plane in front of the thing it fogs, rendering the
authored gradient as one flat wash. The critic saw it. No gate could.

**The feet.** `AnimationPlayer` has measured the *feet meet the floor* convention since it
shipped — `clipGroundSpeed`, `groundSpeed`, `rate`, `synced`, `overridden` — precisely so that a
game which turns the convention off still learns what that cost. That report never crossed the
playtest bridge. `gameplayObservations` published `{advancedFrames, clip, finished}` and dropped
it, so no scenario could catch a character skating across a floor, and `strideSync: false` turned
the measurement off as far as any instrument was concerned. The repository's own rule is that
turning a convention off must not turn its measurement off.

## What changed

### The room crosses the bridge

`observeSceneResources(scene, camera)` (`packages/playtest/src/three/scene-observation.ts`) walks
the scene once and reports `observations.scene`:

- **lights** — type, colour, intensity, visibility, per light
- **materials** — counted per *distinct* material by constructor name, not per mesh
- **fog** — linear `near`/`far` or `FogExp2` `density`, by its own fields
- **background** — `none`, `color:#rrggbb`, or the background object's type
- **camera** — type, world position, unit forward, `fov`, `near`, `far`
- **worldExtent** — the scene's world bounding box
- **objects** / **truncated** — the walk's size, and whether it hit `SCENE_WALK_OBJECT_CAP` or
  `SCENE_LIGHT_CAP`

It lives in the plain-Three.js tier, so a project with no `@threenative/core` gets it too.
Advertised as the `scene.observe` capability, registered in `src/capabilities.ts`.

A value the scene does not carry is **absent**, never zero: a bare `Camera` reports no clip
planes, an orthographic camera no `fov`, a light with no readable intensity none. A capped walk
reports `truncated: true` so a floor is never read as a total.

### `doctor --url` reads it back, and names what kills a frame

Three lines replace the two "not observed" ones, and the residue shrinks to what is genuinely
still dark:

```
  lighting     2/2 visible — 1× AmbientLight, 1× PointLight · background color:#04080d · no fog
  materials    2× SpriteNodeMaterial, 2× MeshBasicNodeMaterial (0 lit) across 13 objects
  camera       OrthographicCamera at 0, 0, 6000 · orthographic · clip 5000..7000
  not observed texture contents and shader graphs — the bridge counts materials, it does not read them
```

Three warnings, each naming a way a frame dies while every other number stays healthy:

1. **lit materials and no visible light** — everything wearing one renders black.
2. **a fog far plane in front of the scene it is fogging** — round 9's loss, as a number.
3. **a camera far plane inside the scene** — geometry past it is clipped, not drawn small.

### A scenario bounds the room, not just `doctor`

`assert.scene` carries the same three frame-destroying cases into a proof, plus a light floor:

| Field | Fails when |
| --- | --- |
| `minVisibleLights` | fewer lights are visible to the renderer than the floor |
| `litMaterialsAreLit` | lit materials are mounted and no light is visible |
| `fogClearsScene` | a linear fog goes opaque in front of the scene's furthest corner |
| `cameraClearsScene` | the camera's far plane cuts the world it is pointed at |

A run with no scene observation fails once as `scene.observed` (`TN_PLAYTEST_SCENE_UNOBSERVED`)
rather than failing each bound against nothing; an `assert.scene` setting no bound throws at load;
and an unmeasurable comparison — no world extent, no far plane — fails rather than counting as
cleared.

### The stride crosses the bridge, and a scenario bounds it

`gameplay.animation.<entity>.stride` now carries the report, and `assert.animation[]` gains:

| Field | Means |
| --- | --- |
| `maxFootSlide` | ceiling on \|feet − ground\| / ground, feet being `clipGroundSpeed × rate` |
| `strideSynced` | require the convention applied (`true`) or deliberately overridden (`false`) |

Both fail closed, and each failure names which kind:

- `TN_PLAYTEST_STRIDE_UNOBSERVED` — no stride reported, half a stride reported, or the body
  covered no ground to compare against. A game that does not measure stride has not measured zero
  slide.
- `TN_PLAYTEST_STRIDE_NOT_SYNCED` — names the override when the game set `strideSync: false`.
- `TN_PLAYTEST_FOOT_SLIDE` — both speeds and the ceiling, in metres per second.

A half-shaped stride report is dropped whole rather than filled in, on both sides of the bridge.

## Why this is a framework change and not game code

Rule 1(a): it needs the scene graph at sample time and a channel to the runner — a game cannot
write it portably, and every game would write the same walk. Rule 1(b) does not veto it: the
observation **counts and names** what is mounted and reads no texture and no shader graph, so it
decides nothing about how anything looks. The three warnings report a relationship between numbers
the game itself chose; none of them changes a value.

## Acceptance criteria and their red

Every criterion states the mutation that makes it fail, and the failure was observed.

| # | Criterion | Mutation | Red observed |
| --- | --- | --- | --- |
| 1 | A stride bound passes on agreement, fails on 75% disagreement, and fails closed on absent, half-shaped, and zero-ground reports | `git checkout main -- packages/playtest/src packages/core/src` | 6 red — `TN_PLAYTEST_STRIDE_UNOBSERVED` never emitted |
| 2 | The schema accepts the new keys and throws on wrong-typed ones | same | `Unknown key 'maxFootSlide' at assert.animation[0]` |
| 3 | Stride reaches the bridge with real numbers, and an override reports the rate it declined | same | 2 red — `stride` undefined on the sample |
| 4 | `doctor` warns on no-light, fog-far-plane and camera-far-plane, and prints the room | `roomWarnings` short-circuited to return `[]` | exactly 5 of 14 red, the other 9 green |
| 5 | `assert.scene` bounds all four cases, fails once on an unobserved scene, throws on an empty or wrong-typed assertion | the family registered without an evaluator | `RED observed: registered family has no evaluator for 'scene'` — the package's own completeness gate, which also required the family in the all-families contract and its fail-closed diagnostic pin |

Criterion 4's control is the load-bearing one: a new module's absence gives a module-not-found, not
an assertion red, so the warnings were controlled separately to prove they carry the claim.

**Three tests do not bite on the control and are not counted as evidence for this change.** The
two wrong-typed schema guards pass at `main` for the wrong reason (the key is unknown there, so it
throws on the key), and the "drops a half-shaped stride report" core test passes at `main` because
no stride is published at all. They are this package's required wrong-typed guards and they bite
against a future loosening of `optionalNumber`; they are recorded here so the count is honest.

## Live evidence

- `doctor --url` against `abyss-framework` on a named hardware adapter (`nvidia turing`) — the
  four lines quoted above.
- The same scenario asserts `scene.litMaterialsAreLit` and `scene.cameraClearsScene`, both passing
  with real numbers (`cameraFar: 2000` against a `sceneReach` of `65.19`). A first attempt also
  asserted `minVisibleLights: 1` and **failed, correctly**: `fps-friction` mounts no lights at all
  and its geometry is `MeshBasicMaterial`, so a light floor asserts something that fixture never
  intended. The bound was dropped rather than the game changed — the instrument was right.
- `examples/fps-friction/playtests/animation-death.playtest.json` asserts `strideSynced: false`
  and passes on the real runner, carrying
  `stride: {clipGroundSpeed: 0.333, groundSpeed: 0, rate: 0.15, overridden: false, synced: false}`.
  That is the case `animation.ts` documents in prose — a travelling death clip whose body covers no
  ground would be clamped to the rate floor and hold a corpse upright through its own death — now
  asserted instead of commented.

The same scenario's `diagnostics` assertion fails on this machine for `TN_PLAYTEST_SOFTWARE_ADAPTER`
and two SwiftShader teardown errors. The identical run at `main` fails identically with
`animation.enemy` passing there too, so it is pre-existing and is not repaired here.

## Not done here

- **`maxFootSlide` has no end-to-end proof against a locomoting character.** `AnimationPlayer` has
  two live callers in this repository and neither walks, so the bound has unit and schema proof
  only. `strideSynced` has both. Carried to round 14.
- **`scripts/alpha-bar.ts` reads a file that no longer exists** — it names
  `docs/PRDs/alpha-readiness/README.md` as its batch README, deleted in `ada4c10b`. Found while
  repairing the dead links that were blocking `check:docs`; not fixed here.
- **`pnpm round:next` is stale for the second time in the loop's history**, printing `close round
  12` against a round already closed on disk.
