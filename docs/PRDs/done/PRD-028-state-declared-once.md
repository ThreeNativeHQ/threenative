# PRD-028 — State declared once, and a scene that is not mostly ceremony

**Complexity: 5 → MEDIUM mode** (4-8 files +2, existing systems +0, public API shape change
+2, templates and arm ported +1)

**Depends on:** PRD-025 (ratchet and normalised count).
**Blocks:** nothing.
**Charter authority:** `AGENTS.md` rule 1, rule 2, rule 4 (Godot's `_ready` / `_process` /
`_exit_tree` shape is what `Scene` already borrows); `CHARTER.md` §3.

## 1. Context

**Problem:** the framework arm declares its HUD state **three times** — a TypeScript type, a
literal `initialState` in `main.tsx`, and a hand-written `publish()` that copies ten fields
into the store every frame — and wraps the whole scene in a class whose fields exist only to
carry a closure from `enter` to `update`. None of it is gameplay. The vanilla control pays
none of it: it writes to the DOM directly, in the loop, where the value is computed.

**Files analyzed:** `examples/abyss-framework/src/scenes/Abyss.ts:24-55,235-302,385-407`,
`examples/abyss-framework/src/main.tsx:11-24`, `packages/core/src/state.ts:1-43`,
`packages/core/src/scene.ts:11-53`, `packages/core/src/loop.ts`,
`packages/ui/src/index.ts`, `examples/abyss-vanilla/src/main.js:387-402`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| `AbyssState` is declared as a type, then again as a literal | `Abyss.ts:24-35` (12 lines) and `main.tsx:11-24` (12 lines), field for field |
| `publish()` rewrites all ten fields every frame | `Abyss.ts:265-278` (14 lines), called from the frame function |
| `state.set` already accepts a **partial** patch | `state.ts:3` — `StatePatch<T> = Partial<T> \| ((state: T) => Partial<T>)`; the arm passes a full object anyway |
| FPS is hand-sampled in `render()` because the loop is fixed-step | `Abyss.ts:389-397` (10 lines) plus two private fields, with a comment explaining why `update` cannot do it |
| The class carries a closure through a private field | `Abyss.ts:50` `#frame`, assigned at `303`, invoked at `386`, nulled at `405` |
| `exit` is four lines of setting fields back to `undefined` | `Abyss.ts:401-407` |
| The count classifies `#field` lines as plumbing but the rest as game | `count-loc.ts:83-89` — so most of this ceremony is counted **against** the framework as game code |

**Measured:** 12 + 12 + 14 + 10 + ~20 (class shape, private fields, `update`/`render`/`exit`
overrides that only forward) ≈ **68 lines**, none of which is the game.

## 2. Solution

Three changes, in decreasing order of confidence. Each is measured separately, and any that
does not pay its own lines is dropped in the same round — that is rule 2, applied to this
PRD's own output.

- **`ctx.fps`, owned by the loop.** The fixed-step loop already knows the render cadence;
  the arm reconstructs it with an EMA and a comment apologising for where it had to live.
  Every HUD in every game wants this number. Deletes 10 lines and two fields per game.
- **State is declared once, in the scene, and `defineGame` takes it from there.**
  `Scene` gains a static `initialState`, and `GameConfig.initialState` becomes optional when
  the start scene provides one. The type is inferred from the value — one declaration, no
  literal-vs-type drift, and the failure mode where a field exists in the type but not the
  literal stops being possible.
- **`enter` may return the per-frame function.** `enter(ctx)` returning
  `(ctx, dt) => void` deletes the private field, the `update` override that forwards to it,
  and the `exit` lines that null it. Returning nothing keeps today's behaviour exactly —
  every existing scene, template and test compiles untouched. This changes the *shape* the
  framework imposes, not its vocabulary: `enter`/`update`/`exit` keep their Godot-borrowed
  names and meanings.
- **`publish()` is a template and docs fix, not a framework change.** `state.set` has taken
  partials since day one; the arm rewrites ten fields because nothing showed it otherwise.
  The starter template and `templates/*/AGENTS.md` get the partial-patch pattern, and the arm
  is ported to it. **No framework code is added for this** — rule 1.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| A `bind`/`selector` API that pulls HUD fields from the scene each flush | Reactive plumbing nobody asked for, and it hides *when* a value is read. `state.set` with a partial is already the answer |
| Replacing the `Scene` class with a `defineScene({ enter, update })` object form | Two ways to write a scene, forever. The returned-frame-function form removes the ceremony without adding a second vocabulary |
| Deriving `initialState` from the type via a codegen step | A build step to save twelve lines is worse than the twelve lines |
| An automatic ECS-shaped state store | `CHARTER.md` §2: code-first ECS is a closed question, decided against |
| `ctx.fps` as a smoothed *and* raw *and* percentile surface | One number. Games that want a histogram can keep their own |
| Making `GameConfig.initialState` an error when the scene also declares one | A scene-level default that a game overrides is normal. Config wins, and a test pins that |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `ctx.fps` from the loop | `Abyss.ts` HUD publish; starter template HUD | `Abyss.ts:389-397` and its two fields | yes | drive the fake loop at a known cadence → value converges; freeze it → value decays, never `NaN` or `Infinity` |
| 2 | `static initialState` on `Scene` | `Abyss`; starter and platformer templates | `main.tsx:11-24` literal | yes | a scene with neither static nor config state → `defineGame` throws at construction |
| 3 | `enter` returning a frame function | `Abyss`; starter template | `#frame` field, `update` forwarder, `exit` nulling | yes for the arm; other scenes unchanged | a scene returning a non-function non-undefined → throws; an existing void-returning scene keeps working, pinned by an untouched test |
| 4 | Partial-patch HUD pattern in templates and `AGENTS.md` | `templates/*/src/main.ts`, `templates/*/AGENTS.md` | the full-object rewrite | yes in the arm | none needed — this is documentation of an existing tested API, and `sync:agents --check` covers drift |
| 5 | Lowered `loc-baseline.json` | CI ratchet | pre-change baseline | n/a | forget it → CI red |

**Reachability:** a scaffolded project declares its HUD fields once in the scene, reads
`ctx.fps` for the frame counter, patches only what changed, and its scene file has no
private fields at all.

## 4. Phases

#### Phase 1: `ctx.fps`

**Files:** `packages/core/src/loop.ts` EDIT · `packages/core/src/game.ts` EDIT ·
`packages/core/src/scene.ts` EDIT · `packages/core/__tests__/loop.spec.ts` EDIT.

Sample at render, expose on `Ctx`. Tests drive a fake clock: steady cadence converges,
a stalled frame decays, and the value is finite from the first frame.

#### Phase 2: state declared once

**Files:** `packages/core/src/scene.ts` EDIT · `packages/core/src/game.ts` EDIT ·
`packages/core/__tests__/game.spec.ts` EDIT.

`static initialState`, config precedence, throw when neither exists. The throw is the point:
a game whose store silently starts empty renders a HUD full of `undefined`.

#### Phase 3: the frame function

**Files:** `packages/core/src/scene.ts` EDIT · `packages/core/src/game.ts` EDIT ·
`packages/core/__tests__/scene.spec.ts` EDIT.

Accept a returned function, validate the return type, keep the void path byte-identical. The
existing scene tests are **not edited** in this phase — if they need changes, the change is
not backward-compatible and the phase is wrong.

#### Phase 4: port the callers

**Files:** `examples/abyss-framework/src/scenes/Abyss.ts` EDIT ·
`examples/abyss-framework/src/main.tsx` EDIT ·
`packages/create-threenative/templates/{starter,platformer,minimal}/src/**` EDIT ·
`packages/create-threenative/templates/*/AGENTS.md` EDIT · `CLAUDE.md` REGENERATED ·
`README.md` REGENERATED.

Run `pnpm sync:agents`. The templates' own playtest scenarios are the proof that the ported
scenes still behave — they are re-run, not re-written.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus the scaffold smoke test,
plus template playtests green, plus `count-loc` showing the normalised framework total **down
by ≥40 lines** with the baseline lowered. Any of the three changes that did not pay for its
own framework lines is reported with its measured delta and reverted in this phase.
