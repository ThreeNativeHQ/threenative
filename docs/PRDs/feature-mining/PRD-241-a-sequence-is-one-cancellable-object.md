---
prd_contract: v1
---

# PRD-241 — The game brings its own curve

*(filed under the batch's original title "a sequence is one cancellable object"; the reading below
retired most of that scope before it was written — see "What the survey asked for, and what
survived")*

**Status: PROPOSED, 2026-08-28. Nothing below has been executed. The smallest PRD in the batch, and
the one most likely to end in a refusal.**

Sources read at depth 1 on 2026-08-28:
[`agargaro/three.ez`](https://github.com/agargaro/three.ez) `src/tweening/` (1 069 lines, MIT) and
[`pmndrs/timeline`](https://github.com/pmndrs/timeline) (MIT). **Both are refused as dependencies,
and most of what they offer is refused as scope**, on evidence from this repository.

Parent batch: [feature-mining](./README.md).

**Complexity:** +1 touches 3 files, +1 the surface is public and versioned, +1 timing sits in the
frame budget = **3 → LOW mode.** Minimal template.

## What the survey asked for, and what survived contact with the code

The survey proposed absorbing a composable sequencing system — timelines, parallel branches,
scoped cancellation. Reading `packages/core/src/schedule.ts` and `packages/core/src/game.ts`
removed three of the four reasons to want one:

| Asked for | Already true at HEAD | Evidence |
| --- | --- | --- |
| Sequencing | `ctx.tween` returns a promise. `await a; await b;` **is** a sequence, and `Promise.all` is a parallel branch. A timeline DSL would be a second, worse way to write what the language already does. | `packages/core/src/schedule.ts:49-92` |
| Cancellation on scene change | Done, and done correctly: `goto` calls `scheduler.clear()`, every entry's `onCancel` runs, and a pending tween's promise **settles** rather than hanging a caller forever. | `game.ts:527`, `game.ts:1057`, `schedule.ts:115-116`, `schedule.ts:71-76` |
| Vector targets | `ctx.tween(mesh.position, { x: 5, z: 2 }, 0.4)` already works — `position` is an object with finite numeric fields, which is exactly what the tween accepts. | `schedule.ts:52-63` |
| Easing | **Missing.** Every tween in every game is linear, and there is no way to pass a curve. | `schedule.ts:84` — `start + (end - start) * progress` |

So the whole of this PRD is the fourth row.

## The question, and why the answer is a parameter rather than a library

Rule 3 lists what the framework must never own: *"geometry, material, colour, texture, **curve and
timing** come from the game."* An easing library is a menu of curves — `easeOutCubic`,
`easeInOutQuint`, `easeOutElastic` — and shipping that menu is shipping a look decision, in the same
way that shipping a particle colour ramp would be. three.ez ships 147 lines of exactly that
(`src/tweening/Easings.ts`).

The mechanism, though, is unambiguously the framework's and already is: a per-frame driver that
advances progress in the fixed-step loop, settles a promise, and is cancelled by a scene change.

The split follows `GPUParticles3D`: **mechanism here, curve from the game.**

```ts
// today — linear, and no way to say otherwise
await ctx.tween(door.position, { y: 2.4 }, 0.5);

// proposed — one optional callback; the curve is the game's, written in the game
await ctx.tween(door.position, { y: 2.4 }, 0.5, { ease: (t) => 1 - (1 - t) ** 3 });
```

No easing names ship. No curve ships. The doc comment shows one inline cubic so an agent reading the
manifest can copy it, and the templates that want a feel put their curves in
`src/render/` beside their other look decisions.

## What the sources actually contain

| Claim | Evidence |
| --- | --- |
| three.ez's tweening is 1 069 lines, of which 147 are a curve menu and ~600 are a runner this repository already has | `src/tweening/Easings.ts` (147), `RunningTween.ts` (341), `TweenManager.ts` (140), `Tween.ts` (230), `Actions.ts` (211) |
| Its genuinely interesting part is typed motion over `Vector`, `Quaternion`, `Euler` and `Color`, not over numbers | `src/tweening/Actions.ts:1-15` |
| `pmndrs/timeline` composes async generators into sequential/parallel graphs | `packages/timeline/src/sequential.ts`, `parallel.ts`, `scope.ts` |
| Both MIT | `LICENSE` in each clone |

**Refused, with reasons:** the curve menu (rule 3); the runner (already exists, and a second one
inside the frame budget is a regression waiting to happen); the timeline DSL (`await` and
`Promise.all` already express it, so it fails "could the game write this portably itself"). The
`Quaternion` case is the one part worth reconsidering later — spherical interpolation is not
expressible as per-component numeric tweening — and it is deliberately **not** in this PRD, because
no template needs it today and a surface added for a hypothetical caller is dead by construction.

## Incumbent census

| Existing thing | Relationship |
| --- | --- |
| `Scheduler.tween` — `packages/core/src/schedule.ts:49-92` | **The thing being changed.** No new module, no second tween. |
| `ctx.tween` — `game.ts:746` | Signature gains one optional argument. Every existing call keeps compiling and keeps behaving identically. |
| `packages/core/__tests__/frame-budget-steady-alloc.spec.ts` | The guard: an easing callback must not put an allocation in the steady-state frame. |

## Integration Ledger

| # | Changed thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | `ease` option on `Scheduler.tween` | `packages/core/src/game.ts:746` forwards it | linear-only interpolation | yes — linear becomes the default `ease`, not a parallel branch | pass `t => t*t` and assert the midpoint is **not** the linear midpoint; drop the option and it reds |
| 2 | Updated capability doc tags | `capabilities.json` via `pnpm build` | today's tags | yes | remove `@example` → `pnpm budgets` fails |
| 3 | One template uses a non-linear curve for something visible | a `templates/*/src/render/*.ts` curve + its caller | a linear move | yes | revert the curve → the template's visual baseline shifts |

## Execution Phase (one, because it is one change)

### Phase 1 — a curve the game supplies, proven by a game

**Files (4):** `packages/core/src/schedule.ts` (EDIT), `packages/core/src/game.ts` (EDIT — forward
the option), `packages/core/__tests__/schedule.spec.ts` (EDIT),
one `templates/*/src/render/*.ts` + its caller (EDIT).

- [ ] `ease?: (t: number) => number`, called with `t` in `[0, 1]`, result used as the interpolation
      factor. No clamping of the output — an overshooting curve (`back`, `elastic`) is a legitimate
      thing for a game to write, and clamping it silently would make those curves impossible.
- [ ] Default is the identity, so existing behaviour is unchanged bit for bit.
- [ ] `t === 1` is delivered exactly once and the end value is assigned exactly, not
      `ease(1) * (end - start)` — a curve that does not return exactly 1 at 1 must not leave the
      target short of its destination.
- [ ] No allocation per frame: the callback is stored once, not wrapped per tick.

| Test file | Test name | Assertion | Negative control (must be observed red) |
| --- | --- | --- | --- |
| `schedule.spec.ts` | `should reach the exact end value when the curve does not return 1 at t=1` | strict equality to `end` | multiply by `ease(1)` at the end → short by the curve's error, reds |
| `schedule.spec.ts` | `should interpolate by the supplied curve at the midpoint` | midpoint ≠ linear midpoint | ignore the option → equal, reds |
| `schedule.spec.ts` | `should behave identically to a linear tween when no curve is given` | matches the pre-change values | make the default anything but identity → reds |
| `frame-budget-steady-alloc.spec.ts` | `should allocate nothing per frame while a curved tween runs` | zero steady-state allocation | wrap the callback per tick → reds |

**Revert check:** remove the `ease` forwarding in `game.ts:746` → the template's visual baseline
and the midpoint test both fail.

## Acceptance criteria (consumer-scoped)

- [ ] Something in a shipped template moves with a non-linear feel a player can see, and the curve
      that produces it lives in that template's `src/render/`, not in `packages/`.
- [ ] Every existing `ctx.tween` call in the repository compiles and behaves identically, shown by
      the unchanged pre-existing tests.
- [ ] An overshooting curve overshoots and still lands exactly on the end value.
- [ ] `packages/` contains no named easing function, no curve table, and no easing menu — grep
      pasted.
- [ ] The frame still allocates nothing while a curved tween runs.

## Kill switch, and the honest recommendation

This is roughly ten lines of framework code. `count-loc.ts` will not distinguish it from writing
`ctx.every((dt) => …)` by hand, which is a real alternative a game can already write portably.

**Recommendation: file it, and build it only after 237 and 239 land.** It is the least valuable item
in the batch by a wide margin, and its main worth is that this document now records *why* the
composable-timeline idea was not built — so nobody re-proposes it in three months and re-derives
that `await` already did the job.
