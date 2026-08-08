# PRD-038 — Runtime GPU transport and acceleration

**Status:** open. **Gated on Gate 0** of `docs/strategy/ROADMAP.md` — nothing below Gate 0
starts until round 2 runs to completion on `exploration` and the gate exits on its first
outcome. This PRD is written now so the decision is on record; it is not started now.

**Verdict up front: two of three candidates are killed, and the one that survives does not
go in `@threenative/core`.**

| Candidate | Framework code? | Verdict |
|---|---|---|
| KTX2 / Basis transcoding | 5 lines | **CLOSED — WONTBUILD** |
| meshoptimizer decode | 2 lines | **CLOSED — WONTBUILD** |
| `three-mesh-bvh` accelerated raycast | 4 lines | **BUILD — in `packages/create-threenative/templates/starter/`, not in a package** |

**Scope:** runtime decode and acceleration only. The **build-time encode pipeline stays
deferred.** `docs/product/ASSET-PIPELINE.md` defers it behind two measured triggers —
neither has fired — and this PRD does not reopen that deferral, does not ask for it to be
reopened, and does not add anything that only pays off once it is. The answer to "my
textures are too big" remains `gltf-transform` on the command line.

**Budget impact:** zero workspace packages (stays 7/8, 8th reserved for `physics-native`
per `CHARTER.md:426`), **zero framework LOC** (`scripts/check-budgets.ts` counts
`packages/*/src`; `packages/create-threenative/templates/` is not under `src`), zero new
dependency in `@threenative/core`. +1 against the 10-document PRD cap: this takes
`docs/PRDs/` from 6 to 7. Six PRD authors are writing concurrently in this session; if the
count reaches 10, this document is the one to drop, because it kills more than it builds.

---

## 1. Context

**Problem:** three of the standard Three.js runtime GPU-transport wins — KTX2/Basis
texture transcoding, meshopt geometry decode, and BVH-accelerated raycasting — are absent
from ThreeNative, and an agent building a game will not add them unprompted. The question
is whether any of them is *framework* work.

**Files analyzed (all read, all claims below cite what was read):**

- `packages/core/src/assets.ts` (73 lines — the entire loader)
- `packages/core/src/renderer.ts`, `packages/core/src/viewport.ts`, `packages/core/src/input.ts`
- `packages/core/src/game.ts:230–299` (renderer → assets → ctx construction order)
- `packages/core/node_modules/three@0.185.1/examples/jsm/loaders/KTX2Loader.js`
- `packages/core/node_modules/three@0.185.1/examples/jsm/loaders/GLTFLoader.js`
- `packages/core/node_modules/three@0.185.1/examples/jsm/libs/` (contents and byte sizes)
- `packages/physics/src/index.ts`, `packages/physics/src/plugin.ts`
- `packages/playtest/src/assertions.ts`, `packages/playtest/src/scenario.ts`, `packages/playtest/src/runner/runner.ts`
- `packages/create-threenative/templates/starter/` (full tree + `package.json`)
- `CLAUDE.md`, `docs/product/ASSET-PIPELINE.md`, `docs/architecture/CHARTER.md` §2/§5b/§9a/§10/§11, `docs/strategy/ROADMAP.md`

**Read from the installed tree vs. reasoned from docs:** KTX2Loader, GLTFLoader,
`meshopt_decoder.module.js` and the Basis transcoder are all **present in
`node_modules` and were read directly** — every line number below is real.
**`three-mesh-bvh` is NOT installed anywhere in this repo**, so its API is reasoned from
its published documentation; the only facts measured about it are from the npm registry
(`version 0.9.14`, `dist.unpackedSize 2329887`, `peerDependencies { three: ">= 0.159.0" }`).
Phase 1 opens by confirming the export names against the real package before any code is
written, and that confirmation is a listed step, not an assumption.

**Current behaviour:**

- `createAssetLoader` (`assets.ts:38`) is a 36-line cached loader with injectable
  per-kind loaders. `GLTFLoader` is dynamically imported at `assets.ts:63` with no
  decoders attached.
- `createAssetLoader` is constructed at `game.ts:258`, **after** the renderer exists and
  after `await init()` — so a renderer-dependent default is wireable. It is also a
  standalone public export (`index.ts:5`) with no renderer in scope.
- `Viewport.projectPosition` (`viewport.ts:60`) projects a screen point onto a **plane**.
  That is the framework's entire picking surface today. There is no mesh raycast anywhere
  in `packages/core/src`.
- `@threenative/physics` exposes the raw Rapier `world` (`plugin.ts:110` uses
  `world.intersectionsWithShape`), so `world.castRay` is available to any game using the
  plugin — but it hits **colliders**, not visual geometry.

---

## 2. The measurement that decides all three

`CLAUDE.md` rule 1: *"If a competent developer could write it in under 20 lines, it does
not go in the framework. Write it in the example or the template instead."*

Here is every line a user writes, measured against the installed API.

### KTX2 / Basis — 5 lines

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer.raw as never);
const gltf = new GLTFLoader().setKTX2Loader(ktx2);
defineGame({ assets: { model: (url) => gltf.loadAsync(url) } /* … */ });
```

Plus copying `three/examples/jsm/libs/basis/` into `public/basis/` — one `cp`, or one line
of Vite config.

### meshoptimizer — 2 lines

```ts
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
```

Both together, sharing one `GLTFLoader`: **6 lines.**

### three-mesh-bvh — 4 lines

```ts
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;
```

Plus `geometry.computeBoundsTree()` per pickable mesh.

**All three fail the 20-line rule as framework code. There is no argument to be made
here — the numbers are 5, 2 and 4.** The rest of this document is only about test #2 (does
it survive as a *default*, where the value is that the agent gets it without knowing to
ask?) and test #3 (does it belong in generated template source?).

---

## 3. The capability-detection question — already answered upstream

The one part of this area that looks genuinely framework-shaped is *which KTX2 format a
given device supports*, because that is real branching rather than boilerplate.

**It is already written, in `three`, for both backends.** `KTX2Loader.js:230–270`:

- `KTX2Loader.js:232` branches on `renderer.isWebGPURenderer === true`
- `:235–241` probes WebGPU via `renderer.hasFeature('texture-compression-astc' | 'etc1' | 'etc2' | 's3tc' | 'bc' | 'pvrtc')`
- `:247–255` probes WebGL2 via `renderer.extensions.has('WEBGL_compressed_texture_astc' | …)`, including the ASTC-HDR profile check and the `WEBKIT_` PVRTC alias
- `:261–270` carries the Firefox-Android workaround

ThreeNative's `createRenderer` already produces exactly the two renderer kinds this code
branches on (`renderer.ts:106`, `:116`). **There is nothing left to detect.** Re-deriving
this in `packages/core` would duplicate ~40 lines of upstream code that `three` maintains
against a moving WebGPU spec, and would go stale the first time a compression feature name
changes. The framework-shaped part of candidate A does not exist.

The only real friction found: `RendererLike.raw` is typed `unknown` (`renderer.ts:9`), so
`detectSupport(renderer.raw)` needs a cast. That is one cast, and the template already
does the same thing twice for other reasons (`Play.ts:34`, `Play.ts:36`). Not worth an API
change; noted so nobody rediscovers it as a finding.

---

## 4. CLOSED — WONTBUILD: KTX2 / Basis transcoding

**Test 1 (20-line rule):** fails. 5 lines.

**Test 2 (default inside `createAssetLoader`):** fails, on three independent grounds.

1. **Nothing in the toolchain emits `.ktx2`.** The build-time encode pipeline is deferred
   (`docs/product/ASSET-PIPELINE.md`) and this PRD keeps it deferred. A default decoder
   for a format the project never produces decodes nothing. The only way a user gets a
   `.ktx2` today is by running `gltf-transform` themselves — and a user already running
   `gltf-transform` can write 5 lines.
2. **The failure is already loud and self-teaching.** `GLTFLoader.js:1478` throws
   `"THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures"`, and
   `KTX2Loader.js:379` / `:411` throw `"Missing initialization with .detectSupport(renderer)"`.
   This is `three` failing closed with the exact fix in the message. The "agent never
   learns why" argument — the only thing that justifies a default — does not apply.
3. **Cost gate.** The Basis transcoder measured on disk is **584,862 bytes**
   (`basis_transcoder.wasm` 527,333 + `basis_transcoder.js` 57,529). It is fetched lazily
   on first `.ktx2` parse, so the *download* cost to a non-KTX2 game is zero — but the
   files must be served from `public/`, so a default would put 585 KB of dead weight into
   every scaffolded repo for a format none of the three templates use.

**Test 3 (template source):** also fails, for reason 1. Generated source wiring a decoder
for a format the template's assets do not contain is dead code the user has to read and
delete. Worse than nothing.

**What the user writes instead:** the 5 lines in §2, when and only when they have actually
produced a `.ktx2`. The right home for that snippet is a paragraph in
`docs/product/ASSET-PIPELINE.md` beside the existing `gltf-transform` pointer — not a
change to any package or template, and out of scope for this PRD.

---

## 5. CLOSED — WONTBUILD: meshoptimizer decode

**Test 1 (20-line rule):** fails, harder than any other candidate. 2 lines, and the
decoder already ships inside `three` (`examples/jsm/libs/meshopt_decoder.module.js`,
29,256 bytes measured, WASM inlined as base64 — no external file to serve, unlike Basis).

**Test 2 (default inside `createAssetLoader`):** fails.

This is the *strongest* of the three on cost — 29 KB, no `public/` asset, no new
dependency, one line — and `EXT_meshopt_compression` is what `gltf-transform optimize`
emits by default, so unlike KTX2 it is a format a user following
`ASSET-PIPELINE.md`'s standing advice would actually have. If any candidate were going to
survive on the "without knowing to ask" argument, it would be this one.

It still fails, on the same decisive ground as KTX2: **`GLTFLoader.js:1621` throws
`"THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files"`.**
Loading a meshopt-compressed GLB through `ctx.assets.model()` today does not silently
produce a broken mesh or a slow one — it raises an exception naming the one-line fix. An
agent hits it once, fixes it in one line, and is done. A default would buy that agent
about thirty seconds, once, at the price of a permanent 29 KB in every bundle and a
behaviour `createAssetLoader` does not visibly declare.

**Test 3 (template source):** fails for the same reason as KTX2 — none of the three
templates ship a meshopt-compressed asset, so the wiring would be dead generated source.

**What the user writes instead:** the 2 lines in §2, prompted by the error message they
will already have seen.

---

## 6. BUILD: accelerated raycasting — in the template, not in a package

**Test 1 (20-line rule):** fails. 4 lines. It does not go in `@threenative/core`.

**Test 2 (default inside `createAssetLoader`):** **fails**, and this is the answer I
expected to come out the other way. The case *for* a default is strong and real:

> Unlike KTX2 and meshopt, **there is no error.** Raycasting a 100k-triangle mesh with
> the stock `Mesh.raycast` does not throw, warn, or fail — it just walks every triangle,
> every pointer event, forever. An agent writing mouse-picking ships something that
> stutters and never finds out why. That is exactly the silent-bad-outcome shape that
> justifies a framework default, and neither of the other two candidates has it.

It still fails as a default, on the gate this PRD was given:

1. **A decoder that ships to games not using it is a regression** — and a BVH default is
   the worst offender of the three. `three-mesh-bvh` is `dist.unpackedSize 2,329,887`
   bytes in `node_modules` for every ThreeNative game. The tree-shaken bundle cost of
   `MeshBVH` + `acceleratedRaycast` is **not measured here** (the package is not
   installed) and is estimated in the tens of KB; Phase 1 measures it before anything
   ships. But the load-time cost is the real problem: building a BVH is 100–300 ms of
   main-thread work per 100k-triangle geometry. Doing it by default on every loaded mesh
   makes startup slower for the large majority of games that never raycast a mesh.
2. **Prototype patching is a global side effect from a package import.**
   `Mesh.prototype.raycast = acceleratedRaycast` changes raycasting for every mesh on the
   page, including meshes `@threenative/core` never touched. `packages/core/CLAUDE.md`
   requires core to stay consumable from R3F; silently rewriting a `three` prototype from
   inside `createAssetLoader` violates that boundary in a way the user cannot see or
   opt out of.
3. **An opt-in `defineGame` option buys nothing.** `assets: { bvh: true }` costs the agent
   the same discovery it would cost to write the 4 lines, and adds an option to a surface
   `CHARTER.md` §10 caps at one page. Rejected on `CLAUDE.md` rule 2.

**Test 3 (generated template source): PASSES.** This is the destination rule 1 names by
name, and every objection above dissolves there:

- The dependency lands in the **generated project's** `package.json`, not in
  `@threenative/core`. Zero packages, zero framework LOC, zero core dependency, and games
  that delete the file pay nothing.
- The prototype patch is **visible, in a file the user owns**, next to the code that needs
  it — not a hidden effect of importing a framework.
- The BVH is built for the one mesh that is actually picked, not for every mesh loaded.
- The agent gets it **without knowing to ask**, because it is already there in `src/` when
  the project is scaffolded, which was the entire point of test #2.

**Incumbent census.** Two things already do something adjacent, and neither covers this:

- `Viewport.projectPosition` (`viewport.ts:60`) — screen point onto a **plane**. Cannot
  pick geometry. Stays as-is; this replaces nothing in it.
- Rapier `world.castRay` via `ctx.physics.world` — hits **colliders**. The starter's
  pickable art has no collider, and giving every pickable prop a `CollisionShape3D` to
  make it clickable is more code and more physics cost than a BVH. Stays as-is.

So this is genuinely new behaviour, with a named reason why no incumbent covers it.

---

## 7. Complexity

```
+1  Touches 1-5 files per phase (6 total across two phases)
+1  External API integration (three-mesh-bvh, new to the repo)
```

**Complexity: 2 → LOW mode.** Sections marked MEDIUM/HIGH in the standard template are
skipped: no architecture diagram, no sequence diagram, no data migration. The Integration
Ledger, negative controls, and consumer-scoped acceptance criteria are kept regardless of
mode.

**Template scope: `starter` only.** `minimal` is deliberately minimal; `platformer` has no
picking interaction. Adding this to all three would be speculative breadth (`CLAUDE.md`
rule 2, simplicity first).

---

## 8. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `pickAt()` in `templates/starter/src/pick.ts` | `templates/starter/src/scenes/Play.ts:TBD` (per-frame `update`, on pointer move) | nothing — `Viewport.projectPosition` is plane-only, Rapier `castRay` is collider-only (§6) | n/a, new behaviour | deleting the `computeBoundsTree()` call drops `fastPicks` below the gate |
| 2 | `sculpture()` high-poly mesh in `templates/starter/src/render/shapes.ts` | `templates/starter/src/scenes/Play.ts:TBD` (`enter`, `ctx.add`) | nothing | n/a | removing it makes `hovered` unreachable and the scenario fails |
| 3 | `hovered` + `fastPicks` in `GameState` | `templates/starter/src/scenes/Play.ts:TBD` via `ctx.state.set` | nothing | n/a | `triviality: reject-initial-value` (`packages/playtest/src/assertions.ts:148`) rejects the assertion if the initial value satisfies it |
| 4 | `playtests/pick.playtest.json` | `templates/starter/package.json` `test` script | nothing | n/a | scenario must be observed red on the pre-Phase-1 tree |

Every `TBD` is a real `file:line` filled in during implementation. A `TBD` remaining at
phase end means the phase is incomplete.

---

## 9. Reachability

**How is this reached?**
- Entry point: the fixed-step loop — `Play.update(ctx)` each frame, reading
  `ctx.input.raw.pointer.position` (`packages/core/src/input.ts:68–71`).
- Pre-existing file edited to call it: `templates/starter/src/scenes/Play.ts`.
- Registration: none needed. `Play` is already the scaffolded game's main scene.

**Is it user-facing?** YES. The hovered object's name renders in the existing HUD
(`templates/starter/src/ui/Hud.tsx`), which is how a human sees it work.

**Full flow:**
1. User moves the mouse over the sculpture.
2. Triggers `Play.update`, already called every frame by `FixedStepLoop`.
3. Reaches the new code via the `pickAt(ctx)` call added to `Play.update`.
4. Observable in the HUD, in `ctx.state`, and in `window.__THREENATIVE__` — which is what
   the playtest `resources` assertion reads.

**What does this replace?** Nothing. See the incumbent census in §6.

---

## 10. Execution phases

### Phase 0 — verify the dependency before writing a line

Not a code phase. Three claims in this document are reasoned from documentation rather
than measured, because `three-mesh-bvh` is not installed. Each is confirmed here, and if
one fails, the phase stops and this PRD is revised rather than worked around.

- [ ] Install `three-mesh-bvh@0.9.14` in the starter template. Confirm the exports are
      named `acceleratedRaycast`, `computeBoundsTree`, `disposeBoundsTree`. **If the names
      differ, correct §2 and §6 in this document before continuing.**
- [ ] Confirm it works against `three@0.185.1` (peer range claims `>= 0.159.0`) and against
      a mesh rendered by the **WebGPU** renderer. Raycasting is CPU-side and should be
      renderer-independent; confirm rather than assume.
- [ ] Measure the tree-shaken production bundle delta from `vite build` with and without
      `pick.ts`. **Record the number in this document.** §6 estimates "tens of KB" and that
      estimate is explicitly unverified. If the real number exceeds 150 KB, the cost/benefit
      in §6 is re-argued before Phase 1 proceeds.
- [ ] Record the **no-BVH baseline**: worst-case ms for a single `Raycaster.intersectObject`
      against the Phase-1 sculpture. The `fastPicks` threshold in Phase 2 is fixed from this
      measured number, not invented.

### Phase 1 — hovering a 100k-triangle mesh names it in the HUD

**Files (5) — `src/render/shapes.ts`, `src/scenes/Play.ts`, `src/state.ts` and
`package.json` all already exist:**

- `packages/create-threenative/templates/starter/package.json` — EDIT: add
  `"three-mesh-bvh": "0.9.14"` to `dependencies`. A literal version, not `catalog:` —
  template `package.json` files are the documented exception (`CLAUDE.md`, Code
  conventions), and CI asserts no `catalog:` survives scaffolding.
- `packages/create-threenative/templates/starter/src/render/shapes.ts` — EDIT: add a
  `sculpture()` returning a ~100k-triangle `BufferGeometry`. Geometry is render-layer, so
  this is the correct home under `CHARTER.md` §5b.
- `packages/create-threenative/templates/starter/src/pick.ts` — NEW: the prototype patch,
  a lazy `computeBoundsTree()` on first pick, the raycast, and the elapsed-ms measurement.
  Target ~25 lines of readable, deletable, user-owned source.
- `packages/create-threenative/templates/starter/src/state.ts` — EDIT: add
  `hovered: string` and `fastPicks: number` to `GameState`.
- `packages/create-threenative/templates/starter/src/scenes/Play.ts` — EDIT: add both to
  `Play.initialState` (currently `Play.ts:20–28`), `ctx.add(...)` the sculpture in `enter`,
  and call `pickAt(ctx)` from `update`.

**Proof subject:** a ~100,000-triangle mesh. **Real target:** an imported 100k-triangle
GLB. **Why the substitute is legitimate and not a toy proof:** raycast cost is a function
of triangle count and BVH structure, not of file provenance — a 100k-triangle
`TorusKnotGeometry` exercises the acceleration path identically to a 100k-triangle import.
**What it does not exercise:** multi-mesh GLB hierarchies, indexed-vs-non-indexed
variation, and skinned meshes (`three-mesh-bvh` does not accelerate `SkinnedMesh`).
**Closing:** none of those are in scope; they are recorded here so nobody later reads this
gate as broader than it is. Using a procedural mesh also keeps a multi-MB binary out of
the scaffolder, which ships to every user.

**Implementation:**

- [ ] Patch `BufferGeometry.prototype` and `Mesh.prototype.raycast` once, at module scope
      in `pick.ts`, with a comment saying it is a global effect and how to remove it.
- [ ] Build the BVH lazily on the first pick against a geometry, not at load time. This is
      the design that makes the default free for games that never pick.
- [ ] Time each raycast with `performance.now()`; increment `fastPicks` when a pick
      completes under the Phase-0 measured budget.
- [ ] Write `hovered` to the object's name, or `""` on a miss.

**Wiring:**
- [ ] Caller edited: `Play.ts:TBD` calls `pickAt(ctx)` from `update`.
- [ ] Registration: none required — `Play` is the scaffolded main scene.
- [ ] Old path: n/a, new behaviour (§6 incumbent census).
- [ ] Ledger rows filled: #1, #2, #3.

**Revert check:** delete `src/pick.ts` → `Play.ts` fails `pnpm typecheck` in the scaffolded
project, and the scaffold smoke gate in CI goes red.

**Tests required:**

| Test | Assertion | Negative control (must be observed red) |
|---|---|---|
| scaffold smoke (existing CI gate) | scaffolded starter typechecks and builds with the new dep | passes only with `pick.ts` present; delete it and typecheck fails |
| Phase 0 bundle measurement | recorded delta is under the 150 KB ceiling | run with `pick.ts` stubbed out to establish the baseline number |

**User verification:** `pnpm --filter create-threenative` scaffold a project, `pnpm dev`,
move the mouse over the sculpture, watch the HUD name it and clear on move-off.

### Phase 2 — the playtest scenario, and the gate that actually proves acceleration

**Files (2) — `package.json` already exists:**

- `packages/create-threenative/templates/starter/playtests/pick.playtest.json` — NEW
- `packages/create-threenative/templates/starter/package.json` — EDIT: append the scenario
  to the `test` script chain alongside the seven existing scenarios.

**The honest problem this phase has to solve.** A "the click registers a hit" assertion
**does not prove the BVH is doing anything** — an unaccelerated raycast against 100k
triangles still returns the correct hit, it just takes ~10–40 ms doing it. An assertion
that passes identically with and without the feature is exactly the silent-pass failure
`CLAUDE.md`'s verification section is about. So the scenario carries two assertions, and
only the second one is load-bearing for the acceleration claim.

**A second constraint, measured, not assumed:** `packages/playtest/src/runner/runner.ts:332–335`
drives `pointerPosition` through `page.mouse.move` only. **There is no mouse-button step
in the harness.** The scenario therefore proves *hover* picking, driven by pointer
movement, which is a real consumer behaviour and needs no harness change. Extending the
harness with a click step is out of scope for this PRD and is not smuggled in.

**Third constraint:** the `resources` assertion supports `equals`, `gte`, `textIncludes`
and `changed` — **there is no `lte`** (`packages/playtest/src/assertions.ts:130–141`). A
"pick took under N ms" assertion is therefore expressed as a counter of fast picks with
`gte`, which the available vocabulary supports honestly rather than by extending it.

```json
{
  "name": "starter-pick",
  "target": "web",
  "schemaVersion": 1,
  "viewport": { "width": 1280, "height": 720 },
  "warmupFrames": 10,
  "subject": "player",
  "steps": [
    { "kind": "wait", "label": "idle", "waitFrames": 30 },
    { "kind": "input", "label": "hover-sculpture", "pointerPosition": { "x": 0.5, "y": 0.5 } },
    { "kind": "wait", "label": "settle", "waitFrames": 60 }
  ],
  "assert": {
    "diagnostics": { "noConsoleErrors": true, "noNetworkErrors": true, "runtimeReady": true },
    "resources": [
      {
        "id": "GameState",
        "path": "hovered",
        "changed": true,
        "atSteps": [
          { "label": "idle", "equals": "" },
          { "label": "settle", "equals": "sculpture" }
        ]
      },
      { "id": "GameState", "path": "fastPicks", "gte": 50 }
    ]
  }
}
```

- The `hovered` assertion proves the pick works, and `atSteps` proves it changed rather
  than started that way.
- The `fastPicks` assertion is the one that proves acceleration. Its `gte` threshold is
  fixed from the Phase-0 measured no-BVH baseline, not from a number invented here.
- `triviality: "reject-initial-value"` on the `resources` kind
  (`packages/playtest/src/assertions.ts:148`) means the harness itself rejects an
  assertion satisfied by the starting value. That is a negative control the harness
  enforces, in addition to the ones below.

**Negative controls — each must be observed red before either gate is recorded as passing:**

1. **Delete the `computeBoundsTree()` call in `pick.ts`, keep everything else.**
   `hovered` still passes (proving the point above). `fastPicks` **must** go red. If it
   does not, the threshold is wrong and the gate measures nothing — fix the threshold, do
   not weaken the assertion.
2. **Run the scenario against the pre-Phase-1 tree.** It must fail with a missing
   `hovered` resource, confirming the gate is not already satisfied by the baseline.
3. **Confirm the runner collected the scenario.** Check that the `test` script's scenario
   count went from 7 to 8 and that `pick.playtest.json` appears in the run output — a
   scenario file that exists but is never invoked is the listed-but-absent failure.
4. **Assert something known false** (`"equals": "definitely-not-a-mesh"`) once, and
   confirm the harness reports a failure rather than skipping the key.

**Environmental honesty.** Per prior sessions on this machine, headless Chromium renders
WebGPU as a blank canvas, and several playtest scenarios already fail on a clean tree at
HEAD for environmental reasons. **Baseline first:** run the existing 7 scenarios before
touching anything, record which already fail, and never attribute a pre-existing failure
to this change. Run headed under `xvfb-run` with `--enable-unsafe-webgpu`. This scenario
asserts no `visual` or screenshot criteria specifically so it does not depend on the
canvas actually painting — `resources` reads `window.__THREENATIVE__`, which populates
whether or not the GPU produced pixels.

**Revert check:** remove the scenario from the `test` script → the scaffolded project's
`pnpm test` scenario count drops from 8 to 7.

---

## 11. Acceptance criteria — consumer-scoped

- [ ] **Hovering the 100k-triangle sculpture in a freshly scaffolded starter project names
      it in the HUD within one frame**, and a human sees it change on move-off.
- [ ] **`starter-pick` passes in the scaffolded project's own `pnpm test`**, and goes red
      when the BVH construction line is deleted while the mesh and the pick call remain.
- [ ] **A scaffolded project that deletes `src/pick.ts` and removes the dependency still
      builds and passes its remaining 7 scenarios** — the acceleration is owned by the
      user and removable, which is the whole reason it is in the template.
- [ ] **`@threenative/core` gains no dependency and no line of code.** `pnpm budgets` shows
      7 packages and unchanged framework LOC.
- [ ] **No `.ktx2` or meshopt decoder wiring ships anywhere**, and
      `docs/product/ASSET-PIPELINE.md` is unchanged — the encode deferral is intact.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, with the pre-existing clean-tree
      failures recorded as a baseline first and excluded by name.

**Integration gates:**

- [ ] Integration Ledger has zero `TBD` cells.
- [ ] Caller census pasted: `pickAt` and `sculpture` each have a non-test consumer.
- [ ] Revert check passed: deleting `pick.ts` breaks the scaffold smoke gate.
- [ ] Every gate has a negative control observed red — specifically control #1, which is
      the only one that distinguishes "picking works" from "picking is accelerated".

---

## 12. Risks

| Risk | Handling |
|---|---|
| `three-mesh-bvh` export names or `three@0.185` compat differ from the docs | Phase 0 confirms before any code is written; a mismatch revises this PRD rather than being worked around |
| Bundle delta larger than the "tens of KB" estimate | Phase 0 measures it and re-argues §6 above a 150 KB ceiling |
| `fastPicks` threshold set too loose, so control #1 never goes red | Threshold derived from the Phase-0 measured no-BVH baseline; control #1 is a hard gate, not a formality |
| WebGPU blank-canvas / pre-existing scenario failures on this machine | Baseline run before any change; scenario deliberately asserts no visual criteria |
| PRD cap (10) reached by concurrent authors | This document is the first to drop — it kills two candidates and builds one small template change |

---

## 13. What this PRD deliberately does not do

- **It does not reopen the build-time encode deferral.** `docs/product/ASSET-PIPELINE.md`
  stands unchanged, both its triggers unfired.
- **It does not add a workspace package.** 7/8, 8th reserved for `physics-native`
  (`CHARTER.md:426`).
- **It does not add a dependency to `@threenative/core`,** or a `defineGame` option, or a
  line to the one-page public API.
- **It does not add a click step to the playtest harness.** The hover path proves the
  behaviour with the machinery that exists.
- **It builds nothing for KTX2 or meshopt.** Two of three candidates are closed, and that
  is `CLAUDE.md` rule 2 working as designed rather than a gap to fill later.
