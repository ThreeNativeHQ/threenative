---
name: threenative-context
description: Use the portable ThreeNative ctx lifecycle, scheduling, randomness, pointer, and raycast APIs.
---

# ThreeNative context surface

These are properties on `ctx`, never imports; use them before writing equivalent game plumbing.
The recipes are in `agent-docs/ctx-cookbook.md` and imports still require
`engine_search_capabilities`.

| Use | Instead of | Contract |
|---|---|---|
| `ctx.goto("<scene-name>")` | hand reset | async scene rebuild |
| `ctx.tween(...)` | `Math.sin`/`lerp` accumulator | timed interpolation with optional `ease` |
| `ctx.after(...)` / `ctx.every(...)` | timer branches in `update` | disposable schedules |
| `ctx.random.range(-1, 1)` | `Math.random()` | reproducible when `seed` is configured |
| `ctx.pointer.on(...)` / `ctx.pointer.drag(...)` | hover/press/drag bookkeeping | web/native pointer-id stream |
| `ctx.raycast()` / `ctx.raycastAll()` | `new Raycaster()` | backend-neutral intersections |
| `ctx.startup.hold(label, work)` | a loading screen that waits past `whenReady()` | the game's own launch work joins the readiness gate |

`ctx.pointer` dispatches entered, exited, pressed, released, tapped, drag-started, dragged, and
drag-ended events. Register a mesh/model root; only registered objects are raycast and events bubble
through parents.

`ctx.goto(name)` rebuilds the scene without resetting state; values in `ctx.state` survive. From a
frame function, `goto` and then `return` immediately because the old scene is torn down. For a full
restart, `game.goto("<scene-name>")` from React resets declared initial state first. A state reset
uses `ctx.state.set({ /* copy this game's initial-state shape */ })` before the goto. `ctx.random` is
deterministic only when `defineGame({ seed })` is configured.

`pnpm budgets` rejects superseded raw constructs such as `new Audio(`, `Math.random(`,
`new Raycaster(`, `.visible = false`, and `new Box3().setFromObject(`; use the named capability or
annotate a genuinely necessary line with a non-empty `// engine-override: reason`.

<!-- generated: superseded-constructs -->

**Reinvention fails CI.** `pnpm budgets` scans this project's `src/` for these raw
constructs and fails, naming the capability instead. The list and the gate are generated
from the capabilities' own doc tags, so they cannot disagree:

| Rather than write | Use instead | Import from |
|---|---|---|
| `new Audio(` | `AudioBus` | `@threenative/core` |
| `Math.random(` | `createRandom` | `@threenative/core` |
| `new Box3().setFromObject(` | `normaliseToMetres` | `@threenative/core` |
| `.visible = false` | `prewarm` | `@threenative/core` |
| `new Raycaster(` | `ScenePicker` | `@threenative/core` |

When the raw construct is genuinely right, annotate that exact line with a non-empty
reason — a bare `// engine-override:` still fails:

```ts
const bounds = new Box3().setFromObject(viewmodel); // engine-override: measuring, not scaling
```

<!-- /generated -->
