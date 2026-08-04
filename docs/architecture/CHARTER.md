# ThreeNative — Charter

**Status:** binding, 2026-08-02. §7 is resolved; everything here holds until amended here.
**Supersedes:** `~/projects/threejs-to-bevy` (abandoned 2026-08-02, ~790k lines, 7 weeks).

---

## 1. What it is

**The application framework for Three.js games.** WebGPU by default, web and native
mobile from one codebase, Godot-shaped conventions, React/Tailwind for UI, and vanilla
Three.js on every surface underneath.

**We ship the plumbing. The user's AI agent ships the gameplay.**

ThreeNative is to Three.js what Next.js is to React and NestJS is to Express. You don't
hand-roll SSR, routing and SEO on bare React — you write pages. You shouldn't hand-roll a
render loop, a physics bridge, an input map and a mobile build on bare Three.js either.

**It owns the wiring, never the work — and never the look (§5b).**

Two promises, both testable:

1. **Zero plumbing.** The 42% of every game that is identical boilerplate (§3) is
   already written, on web and on device.
2. **Good-looking by default.** A freshly scaffolded game looks good before anyone
   touches it — delivered as editable generated source, never as framework config
   (§5b, §9b).

One line: *R3F gives you a scene. ThreeNative gives you a game — on web and on device.*

**Framework, not engine.** A library you call (`three` — you own the loop); a framework
calls you (it owns loop and lifecycle, you fill in scenes and entities); an engine adds an
authoring environment — editor, asset pipeline, scene format — which §2 rules out. Godot's
*vocabulary* is borrowed (§11.4), never its architecture. The test: **your game lives in
`.ts` files you edit, not in a project a tool opens.**

---

## 2. What it is not

Every item here is something the previous attempt built, and something that helped kill it.

| Not building | Why |
|---|---|
| An IR, a compiler, a serialized scene format | Your game is TypeScript. The compiler was 25,898 LOC and bought nothing a model can't do with a `.ts` file. |
| A second runtime (Bevy, native rendering) | 32% of 1,707 commits went to a runtime no benchmark ever measured. Parity is a permanent ~2x tax on every feature. |
| A JSON/structured-source ECS | Cost **14x vanilla Three.js** on greenfield work (8.27x cost-weighted) *and* scored lower on playability and visuals. |
| An editor | Not in v1. The Studio dogfood found Share and Export did literally nothing. |
| A bespoke CLI vocabulary | 178 command forms, a 2,477-word root help. Models are worst at discovering novel API surfaces; that was the business model, inverted. |
| A recipe/preset/genre system | 0 of 7 presets ever reproduced their genre. H1–H4 of the recipe benchmark: all fail. |
| A code-first ECS (miniplex, bitECS) | Entities are plain classes (§9b). An ECS is gameplay architecture, and gameplay is the model's job. It also inverts §3's floor: it pays off *only* if the model adopts it. The part worth keeping — introspection — is PRD-006, at 1% of the cost. A game that wants one runs `pnpm add miniplex`; the framework neither ships nor fights it. |

> An LLM's greatest strength is writing code in languages already in its weights.
> Its greatest weakness is discovering bespoke API surfaces.
> — `threejs-to-bevy/docs/audits/ASSESSMENT-2026-07-24.md`

**This is the founding constraint.** Everything below is downstream of it.

---

## 3. Win condition

Not "cheaper than vanilla." That fight cannot be won — Opus is trained on vanilla
Three.js and gets better at it every release. v1 picked that fight and lost 14x.

**Three criteria instead:**

1. **Zero tax on the way in.** Writing a game in ThreeNative costs *the same* as
   vanilla. Parity is the target; any discount is a bonus.
2. **Same or better output.** The model's budget goes to gameplay and feel instead of
   bootstrapping, and — critically — the framework never constrains what it can
   express (§5b).
3. **What vanilla structurally cannot do.** Ships to iOS. Still works after the 20th
   change. Has proof it isn't broken.

### The property that makes this unloseable

**The framework must win even when the AI ignores it.**

If a model writes raw `THREE.Mesh` calls and never touches `RigidBody3D`, it still got
the loop, the platform adapters, the asset pipeline, and playtest for free. The
framework's floor is vanilla. Design for that and the benchmark stops being a threat.

### The benchmark

**Control:** `examples/abyss/` — a real game built 2026-08-02 in vanilla
`three/webgpu`: 90k GPU particles via TSL compute, bloom, arcade loop, HUD.
**~400 lines. It works.**

| Portion | Lines | Kind |
|---|---:|---|
| Renderer init, WebGPU guard, failure UI | ~30 | plumbing |
| Resize / camera layout | ~15 | plumbing |
| Post-processing stack | ~5 | plumbing |
| Input (pointer, keys, capture, blur) | ~30 | plumbing |
| Game state, transitions, HUD sync | ~70 | plumbing |
| Loop scaffolding, dt clamp, fps | ~20 | plumbing |
| **TSL shader, entity behaviour, tuning** | **~230** | **the game** |

**~170 lines (42%) is plumbing identical in every game.** That is the entire
addressable surface. It will not be a 10x reduction; anyone promising that is selling
an engine.

### The kill switch

> **Any abstraction that costs more code than writing it in vanilla Three.js gets
> deleted, no matter how much work it took.**

`examples/abyss/` ships in both forms. CI publishes both line counts in the README.
**If the vanilla column wins a row, that row leaves the framework.** Binding and
non-negotiable — it is the one control v1 had that worked, and the one it stopped
obeying.

---

## 4. Substrate: vanilla Three.js core

**Decision: vanilla core. Zero React dependency in `@threenative/core`.**

1. **React's render model fights game loops.** Reconciliation is for state changes;
   games mutate 60×/sec. R3F's answer is `useFrame` + refs — imperative Three.js
   wearing JSX. The idiom you must teach is *"escape React here."*
2. **One-way door.** A vanilla core can be consumed from R3F. The reverse is impossible.
3. **Mobile is the differentiator and React adds risk there**, not leverage.

R3F genuinely wins on ecosystem — `@react-three/rapier` is already `RigidBody3D`,
`drei` is hundreds of solved problems, Fast Refresh is excellent. **R3F is deferred to
v2**, as a ~200-line `@threenative/react` binding over the same core. We lose nothing
and stay out of the one-way door.

Note this is unrelated to §6b: React renders the **UI**, never the scene graph.

---

## 5. Conventions, borrowed not invented

Godot node names. Every model already knows `RigidBody3D`, `Area3D`,
`CharacterBody3D`, `CollisionShape3D`. **Zero discovery cost** — the founding
constraint, satisfied by not inventing vocabulary.

```ts
import { RigidBody3D, Area3D, CollisionShape3D } from '@threenative/physics';

const crate = new RigidBody3D({
  mesh: crateMesh,                          // a real THREE.Mesh
  shape: CollisionShape3D.fromMesh(crateMesh),
  mass: 8,
});

const trigger = new Area3D({ shape: CollisionShape3D.box(2, 2, 2) });
trigger.on('bodyEntered', (other) => score(other));
```

`RigidBody3D` owns a Rapier body handle and syncs its transform onto the
`THREE.Object3D` you handed it. **~80 lines.** Not a simulation, not an entity, not a
component.

> **The 20-line rule:** if a competent developer could write it in under 20 lines, it
> does not go in the framework.

### The escape hatch is not an escape hatch

There is no wrapper type to unwrap. These *are* the objects:

```ts
ctx.renderer        // THREE.WebGPURenderer
ctx.scene           // THREE.Scene
ctx.camera.raw      // THREE.PerspectiveCamera
ctx.physics.world   // Rapier World
crate.body          // Rapier RigidBody
crate.mesh          // THREE.Mesh
```

Every Three.js tutorial, StackOverflow answer, and model completion from the last
decade applies unchanged inside a ThreeNative scene.

---

## 5b. The ownership boundary — the framework never owns the look

**The correction that matters most, and the one v1 got backwards.**

Legacy ThreeNative's output looked bad while vanilla + Opus looked good. The framework
did not *fail to add* visual quality — it **subtracted** it. The model could only
express what the schema allowed, so its visual repertoire was truncated to the
framework's vocabulary.

> **An abstraction that cannot express what vanilla expresses makes the output
> actively worse — not just costlier.**

| Framework may own | Framework must never own |
|---|---|
| Bootstrap, render loop, fixed timestep | Materials, shaders, TSL |
| Scene lifecycle, plugin wiring | Lighting, tonemapping, exposure |
| Input mapping, asset loading | Post-processing composition |
| Physics binding, platform adapters | Camera framing, composition |
| Test harness, UI state bridge | **Anything a screenshot shows** |

The visual layer is exactly where the model is strongest. Stay out of it entirely.

### "Looks good by default" and "never owns the look" are the same rule

These sound contradictory. They aren't — and reconciling them is the core design move.

Vanilla Three.js out of the box is untonemapped, flat-lit grey programmer art. A
scaffolded ThreeNative game must look good on the first `pnpm dev`, with no work. But
the moment that good look is *enforced by the framework*, it becomes the ceiling that
made v1's output worse than vanilla.

The resolution is entirely about **where the defaults live**:

- **Generated into `src/render/` = a floor.** The scaffold writes a real
  `lighting.ts` with a three-point rig in ordinary Three.js. The model reads it, edits
  it, deletes it. A starting point, not a constraint.
- **Hidden inside a package = a ceiling.** Now the model reaches it only through
  config options, and everything unanticipated is unreachable.

Same lighting rig, opposite outcomes. `postprocessing: ['bloom']` as a `defineGame`
option is the ceiling version — **that was a v1 mistake reappearing, and it is removed
from §6.**

So: the framework's visual contribution is a **good starting commit**, not a runtime.
`src/render/` is the entire product of "looks good by default", and deleting the
framework would leave that code working.

---

## 6. The whole API

Fits on one page on purpose. When it stops fitting, something has gone wrong.

```ts
// src/main.ts
import { defineGame } from '@threenative/core';
import { rapier } from '@threenative/physics';
import { Boot, Play } from './scenes';

export default defineGame({
  render: { webgpu: true },        // WebGL2 fallback automatic. Nothing visual here.
  plugins: [
    rapier({ gravity: [0, -9.81, 0], fixedStep: 1 / 60 }),
  ],
  scenes: { boot: Boot, play: Play },
  start: 'boot',
});
```

A scene is a class with three optional methods. That is the entire lifecycle.

```ts
// src/scenes/Play.ts
import { Scene, type Ctx } from '@threenative/core';
import { setupLighting } from '../render/lighting';       // generated, yours
import { setupPost } from '../render/postprocessing';     // generated, yours
import { follow } from '../camera/follow';                // generated, yours

export class Play extends Scene {
  async load(ctx: Ctx) { this.hero = await ctx.assets.model('hero.glb'); }

  enter(ctx: Ctx) {
    setupLighting(ctx.scene);
    setupPost(ctx.renderer.raw, ctx.scene, ctx.camera);
    ctx.add(this.hero);
  }

  update(ctx: Ctx, dt: number) {
    const move = ctx.input.vector('move');      // identical on key, pad, and touch
    if (ctx.input.justPressed('jump') && this.hero.body.grounded) this.hero.body.velocity.y = 8;
    this.hero.body.velocity.x = move.x * 5;
    this.hero.body.moveAndSlide(dt);
    follow(ctx.camera, this.hero.mesh, dt, { distance: 12, damping: 0.1 });
    ctx.state.set({ hull: this.hull });         // UI reads this; see §6b
  }
}
```

Four CLI commands, ever: `dev`, `build`, `test`, `ship`.

---

## 6b. UI — React + Tailwind, never the scene graph

React renders the HUD, menus, and overlays. It does not touch `THREE.Scene`. This is
the same split Bone Tide shipped: a shared TypeScript engine, with only the UI in
React Native.

```
Web                          Mobile
─────────────────────        ─────────────────────────
React 19 + react-dom         React 19 + React Native
Tailwind 4                   NativeWind (Tailwind for RN)
```

**The 60fps problem.** React must never re-render on the game loop. The bridge is a
plain external store the game writes to and React subscribes to:

```tsx
// src/ui/Hud.tsx
import { useGameState } from '@threenative/ui';

export function Hud() {
  const { hull, score } = useGameState();     // throttled; ~10Hz, not 60Hz
  return (
    <div className="pointer-events-none absolute inset-0 p-6 font-mono">
      <div className="text-cyan-300 text-4xl tabular-nums">{score}</div>
      <div className="mt-2 h-1 w-24 bg-slate-800">
        <div className="h-full bg-cyan-400" style={{ width: `${hull}%` }} />
      </div>
    </div>
  );
}
```

`ctx.state.set()` writes at whatever rate the game wants; the store coalesces and
notifies React on a throttle. **Zustand** backs it — small, well known, and
`useSyncExternalStore` semantics are already correct for this.

Tailwind is the right call here for the same reason Godot names are: it is
overwhelmingly present in model weights, so HUD work costs nothing in discovery. And
NativeWind means the same class strings work on device.

---

## 7. The gate — mobile physics — **RESOLVED 2026-08-02**

```
Shared TypeScript game code
        ├── browser WebGPU ──────────────► web
        └── react-native-webgpu / Dawn ──► Metal (iOS) / Vulkan (Android)
```

Rapier ships as **WebAssembly**. Researched the state of WASM in React Native's JS
engines. Verdict: **WASM Rapier is not viable cross-platform. Build the JSI binding.**

| Engine | WebAssembly | Evidence |
|---|---|---|
| **Hermes** (RN default) | **No, and never** | `facebook/hermes#429` open since 2020-12-04. Maintainer, 2023-10-04: *"the consensus is that adding a Wasm interpreter or a JIT to Hermes does not fit with the goals of the project."* |
| **JSC on iOS 18.4+** | **Yes** (unverified in RN) | WebKit removed the JIT gate in commit `b01e7b6920` (2025-02-17); wasm now runs on the IPInt interpreter. Documented in *WebKit Features in Safari 18.4*. RN's `React-jsc.podspec` uses `weak_framework "JavaScriptCore"` — the system framework — so RN inherits it free. **Nobody has empirically confirmed it in an RN app.** |
| **JSC on iOS ≤18.3** | No | `safari-7620-branch`: `if (!useWasm() \|\| !useJIT()) disableAllWasmOptions();` |
| **JSC on Android** | **No, deliberately** | `jsc-android-buildscripts/scripts/compile/jsc.sh:62` passes `--no-webassembly`. Pinned to WebKitGTK **2.26.4 (2019)**. Issue #113 still open. |

Three further findings:

- `WebAssembly.instantiateStreaming` does not exist in bare JSC — ArrayBuffer path only.
- Even where it works, it's **interpreter-tier throughput**, not near-native. Wrong for
  a 60Hz physics step.
- Every workaround library is dead or stalled: `react-native-webassembly` (abandoned
  2023-11), `polygen` (stalled, iOS-only), `react-native-wasm` (archived).

**Conclusion.** The best case is "maybe works on iOS 18.4+, definitely not on Android,
at interpreter speed." That is not a foundation. **Option 1 is not a fallback — it is
the only path:**

> **A JSI native binding to Rapier's Rust, shipped as `@threenative/physics-native`.**

v1 already compiled Rapier natively (web `0.19.3`, native `0.33`) — the same trick,
minus Bevy. Since nobody else ships this, it is the single most valuable artifact in
the repo and the strongest reason ThreeNative exists at all.

*Optional 10-line confirmation, if curiosity demands it: on a physical iOS 18.4+ device
in a Release build with `@react-native-community/javascriptcore`, log
`typeof WebAssembly`. It does not change the plan — Android settles it regardless.*

### Phase 0 — de-risk before building anything

Two spikes, in order, both ugly and unstyled. No template, no CLI, no docs, no
framework.

**0a — rendering on device (~1 day).** A spinning cube via `three/webgpu` under
`react-native-webgpu`, on a physical phone. Answers whether three.js's WebGPU path
survives outside a browser at all: `document`, `HTMLCanvasElement`, `Image`, `fetch`,
`TextDecoder`, and `requestAnimationFrame` are all assumed by three and absent in RN.
Cheap, and it gates everything.

**0b — physics on device (~1–2 weeks).** `@threenative/physics-native`: a JSI binding
to Rapier's Rust, enough to drop a cube onto a plane. Same scene as 0a, now simulated.

If 0a fails, ThreeNative is a web framework and §7's mobile promise is deleted. If 0b
fails, mobile ships without physics or not at all. Either way we learn it in three
weeks instead of 790k lines.

---

## 8. Salvage from `threejs-to-bevy`

| Package | LOC | State |
|---|---:|---|
| `playtest{,-core,-three}` | 4,582 | Already standalone. `examples/playtest-three-vanilla/` proves it runs on **plain Three.js with zero ThreeNative deps** |
| `asset-mcp` | 15,345 | Already published, MIT, v0.5.0, own release lane, 32 tools verified |
| `shader-portable` | 1,991 | TSL → WGSL/GLSL exporter, naga-validated |

**Blocking fix before lifting playtest.** The misspelled-key hole is closed
(`rejectUnknownKeys`, `scenario.ts:1102`, 17 call sites). But **19 validators
`return undefined` on a wrong-typed value and 13 `.filter()` calls drop them
silently**:

```json
"assert": { "states": [{ "entity": "player", "equals": true }] }
```

`equals` should be a string → the assertion is dropped → the scenario runs with zero
state assertions and reports green. Fix: make those validators `throw
invalidScenario(...)` and delete the filters. ~1 hour, before the lift.

---

## 9. Repository layout

### 9a. Packages — pnpm workspace, deliberately few

pnpm workspace is the right tool; **11 packages was not.** v1 had 27, and package
proliferation was a symptom of the disease. A 15k-LOC framework split 11 ways is
~1.4k LOC per package — all boilerplate, no boundary.

**Seven packages, four of them framework, capped at eight forever.** Modularity comes
from subpath exports, not from more `package.json` files.

```
threenative/
  pnpm-workspace.yaml
  packages/
    core/                  # loop, lifecycle, scenes, input, assets, web platform,
                           #   renderer bootstrap (~40 lines), state store
    physics/               # Rapier binding — separate ONLY because of the WASM dep
    physics-native/        # JSI binding to Rapier's Rust (§7). The crown jewel.
    ui/                    # React bindings — separate ONLY because of the React dep
    native/                # react-native-webgpu adapter — gated on §7
    create-threenative/    # scaffolder
    playtest/              # salvaged
    asset-mcp/             # salvaged, independent release lane
  examples/
    abyss/                 # the benchmark, in both forms
```

A package exists only when it carries a dependency the others must not inherit. That
rule produces exactly this list. `render/` is gone — §5b deleted its reason to exist.

```yaml
# pnpm-workspace.yaml
packages: ['packages/*', 'examples/*']

catalog:
  three: 0.185.1
  '@dimforge/rapier3d-compat': 0.19.3
  react: 19.2.0
  typescript: 5.9.3
  vite: 8.2.0
```

**pnpm catalogs are load-bearing, not style.** TSL's API changes between three releases
with no meaningful deprecation cycle. A catalog pins one `three` across every package
and example, so a bump is one line and one CI run. Packages declare `three: 'catalog:'`.
pnpm's strict peer resolution is also correct for a published framework — phantom
dependencies are a support burden.

### 9b. What `pnpm create threenative my-game` generates

```
my-game/
  package.json
  threenative.config.ts        # renderer + plugins. No visual options.
  index.html
  tailwind.config.ts
  src/
    main.ts                    # defineGame(...)
    scenes/
      Boot.ts
      Play.ts
    render/                    # ← GENERATED, YOURS. Framework never touches these.
      lighting.ts              #   three-point rig, shadows, ambient
      postprocessing.ts        #   bloom + tonemapping, plain three/webgpu
      materials.ts             #   palette + shared material defaults
    entities/
      Player.ts                # RigidBody3D usage, as a readable example
    ui/
      Hud.tsx                  # React + Tailwind
      Menu.tsx
    state.ts                   # game state shape the UI subscribes to
  assets/
  tests/
    play.playtest.ts           # one scenario, green on the scaffold
  public/
```

**`src/render/` is the design's load-bearing folder.** It is ordinary Three.js written
into the user's repo, not framework config. The scaffold gives a good zero; the model
is free to rewrite all of it. That is §5b made concrete.

`entities/Player.ts` and `tests/play.playtest.ts` exist for the same reason: **the
scaffold is the documentation.** Models learn an API from the code in front of them,
not from a help page. v1 required discovery across 178 command forms — the worst
possible shape.

### 9c. Tech stack

Chosen by one rule: **pick what models already know.** Same constraint as Godot names
and Tailwind.

| Layer | Choice | Note |
|---|---|---|
| Package manager | **pnpm 10** + workspace + catalog | Given; catalogs pin `three` |
| Language | **TypeScript 5.9**, strict, ESM only, Node 20+ | |
| Rendering | **three 0.185.1** `three/webgpu` + TSL | Catalog-pinned; TSL churns |
| Physics | **@dimforge/rapier3d-compat** | `-compat` avoids bundler WASM config |
| UI | **React 19 + Tailwind 4** / NativeWind on device | §6b |
| UI state bridge | **zustand 5** | `useSyncExternalStore` semantics |
| Game build | **Vite 8** | Already proven on `examples/abyss` |
| Package build | **tsup** | esbuild, boring, widely known |
| Unit tests | **Vitest** | Vite-native |
| Playtest | **Playwright** | What the salvaged harness already uses |
| Lint + format | **Biome** | One tool, one config, replaces two + plugins |
| Releases | **Changesets** | Standard for pnpm monorepos |
| Mobile | **react-native-webgpu** + Expo prebuild | **Gated on §7** |
| CI | GitHub Actions | Must be green (§11.5) |

Biome over ESLint+Prettier is the one low-confidence call here — cheap to reverse.

---

## 10. Budgets

Hard caps. v1 had none and added ~250k lines in its final nine days while CI went
0-for-100.

| Budget | Cap | v1 |
|---|---:|---:|
| Workspace packages | **8** | 27 |
| Framework source (excl. examples, salvage) | **15,000 LOC** | 441,811 TS + 129,247 Rust |
| Charter/PRD documents | **10** | 435 |
| CLI commands | **4** | 178 forms |
| Public API surface | **one page** | — |

Exceeding a cap is not a signal to raise the cap.

---

## 11. Rules

1. **The 20-line rule.** If a dev could write it in under 20 lines, it isn't in the framework.
2. **The kill switch.** Any abstraction costing more code than vanilla is deleted.
3. **Never own the look.** §5b. Visual defaults ship as generated source, never as package config.
4. **Vocabulary is borrowed, never invented.** Godot for nodes, Three.js for rendering, Rapier for physics, Tailwind for UI.
5. **A package exists only when it carries a dependency the others must not inherit.**
6. **CI green means something or it means nothing.** No merge while red. (v1: 0 passing in 100.)

---

## 12. Success and failure criteria

v1 spent seven weeks unable to answer whether it was working, because the decisive
experiment (`sustained-iteration-benchmark-2026-07-31.md`) was specified three times
and **never run**.

**ThreeNative succeeds if, and only if:**

1. Phase 0 runs on a physical phone.
2. The ThreeNative port of Abyss is no longer than 400 lines, still reads as ordinary
   Three.js, and **does not look worse than the vanilla control** (§5b).
3. One game is played by **a stranger for five minutes**, with a transcript. v1 never
   once did this — it was the open acceptance item at abandonment.
4. Framework source is under 15,000 LOC when 1–3 are true.

**ThreeNative fails, and is abandoned, if:**

- Phase 0 cannot run on a device and no JSI path is viable within two weeks; or
- The Abyss port is longer than vanilla, or visibly worse; or
- Framework source passes 15,000 LOC before criterion 3 is met.

**This document must be able to lose.** If the vanilla arm wins, the correct response
is to ship `playtest` and `asset-mcp` as standalone tools for vanilla Three.js and stop
there — a real product, and v1's own final recommendation:

> Keeps the moat, deletes the treadmill.

### PRD-005 benchmark status — VOID, 2026-08-02

The apparatus is published and wired into CI: frozen vanilla control, hand-ported
framework arm, deterministic LOC classifier, sealed prompt, blind scoring. The static LOC
comparison says **vanilla wins**; the live numbers are generated into the root README
between the `benchmark:loc` markers, never restated by hand.

The AI head-to-head itself is **VOID** — see `docs/benchmark/RESULTS-2026-08-02.md` for
what was and was not run. A void is neither a win nor a loss, so §12's abandon action is
not claimed. The next valid result keeps the sealed prompt hash and completes all six
repeats before either is declared.
