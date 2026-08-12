---
prd_contract: v1
---

# PRD-082 — `input.vector()` inverts the Godot convention it borrowed, documents nothing, and every caller re-derives the fix by hand

**Status: PROPOSED, 2026-08-12. Nothing here is executed.** §1 is a code read of the tree at
commit `5a5604e` and of `grep` output taken 2026-08-12. No run has been performed. No
mobile-readiness, device or iOS claim is made.

**The smallest item in the night batch and the one with the clearest user story.** A user
binds `move`, presses W, and the character walks toward the camera. Nothing in the type, the
signature or a doc comment tells them why.

```ts
// packages/core/src/input.ts:110-124 — the entire public surface. No JSDoc.
vector(name: string): Vector2 {
  ...
  if (this.#isHeld(binding.up)) vector.y += 1;   // "up" → +y
  ...
}
```

World-space forward in Three.js is **−z**. So every caller must negate. Godot — the only
sanctioned source for node and input vocabulary — returns **−y for up** from
`Input.get_vector(…, "ui_up", "ui_down")`, which is exactly why its documented 3D movement
line is `Vector3(input_dir.x, 0, input_dir.y)` with no negation. **ThreeNative borrowed the
name and flipped the sign.**

**What that costs, measured by `grep` at `5a5604e`:**

| Call site | What it does with `move.y` |
|---|---|
| `templates/starter/src/entities/Player.ts:57` | `-move.y`, with the comment *"input.vector("move").y is +up; world-space forward is negative z."* |
| `templates/minimal/src/entities/Player.ts:49` | same negation, same hand-written comment |
| `templates/platformer/src/entities/Character.ts:84` | `new Vector3(move.x, 0, -move.y)` |
| `examples/abyss-framework/src/entities/Player.ts:25` | **`z: move.y * dt * 2` — no negation** |

Three call sites carry the correction; two of them ship the same comment as generated user
source. **A comment repeated in two templates explaining a framework sign convention is the
framework failing to state its own contract** — a line the user has to write that the
framework promised to ship.

The fourth is the shape that shipped as a real character-walks-backwards bug in a bare-sandbox
build on 2026-08-03, caught only by a playtest. **That run left no tracked evidence** — the
sandbox is wiped and recreated on every `pnpm sandbox` — so it is cited here as the motivation
for the measurement, not as a result. Whether `abyss-framework:25` is also wrong depends on
that scene's camera, and **Phase 0 measures it rather than guessing.**

**Complexity: 3 → LOW mode.** No new API, no new package surface, no option. A documented
contract, a test that pins it, and one measurement.

**The 20-line rule applies to the tempting fix and forbids it.** Converting a `Vector2` to a
world-space `Vector3` is two lines a model writes correctly on the first try. This PRD adds
**no helper, no `moveVector3()`, no option**. It states the contract and proves it.

**Blast radius (candidate, phase-gated).**
Phase 0: `examples/abyss-framework/playtests/` (a scenario, no source edit).
Phase 1: `packages/core/src/input.ts` (doc comment only),
`packages/core/__tests__/input.spec.ts`.
Phase 2: `examples/abyss-framework/src/entities/Player.ts`, **only if Phase 0 measured it
wrong.**

**Depends on:** nothing. **Unblocks:** nothing. It removes a footgun.

---

## 1. Why this is user value and not tidying

The framework's rule is that vocabulary is borrowed from Godot, in camelCase, semantics and
all — *"a new name is a discovery cost for every model."* A borrowed name whose sign is
inverted is worse than a new name: the model does not know it must look, so it writes the
Godot line from its weights and gets a character that walks backwards. The failure is silent,
it looks like a game bug, and it costs a debugging session per project.

**This is an engine bug.** The framework is wrong — either in its sign or in its silence — and
fixing it inside a game or a template comment is the workaround shape, not the fix.

## 2. Solution

Two candidate resolutions. **Phase 1 picks one and records why; it does not ship both.**

| | A — document `+y = up`, keep the sign | B — flip to Godot's `−y = up` |
|---|---|---|
| Breaks existing games | no | **yes**, silently, at runtime |
| Matches the borrowed vocabulary | no | yes |
| Cost | a doc comment and a test | a migration and four call-site edits, plus every user's game |
| The templates' hand-written comments | can be deleted, the contract now lives in the type | can be deleted |

**Recommendation: A.** A silent runtime inversion in every shipped game is a far larger user
cost than a documented deviation, and `Vector2.y = +up` is defensible on its own terms
(screen-space maths, gamepad `-axes[1]` at `input.ts:121` already normalises to it). The
deviation is then **stated once, in the place a model reads** — the JSDoc on `vector()` — and
pinned by a test so it cannot drift.

**Key decisions:**

- [ ] No new export. No helper. No option. The 20-line rule.
- [ ] The contract lives in JSDoc on `vector()` where an editor and a model both see it, not
      only in a template comment.
- [ ] The templates' explanatory comments are **deleted** once the contract is documented —
      they are the duplication being retired, and leaving them is leaving the tax in place.
- [ ] Option B is rejected in writing, in this file, with the reason, so it is not
      re-litigated.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | Documented axis contract on `vector()` | `packages/core/src/input.ts:110`, called by all four sites above | two hand-written template comments | **yes** — both comments deleted | n/a (documentation); row 2 is what holds it |
| 2 | Convention test in core | `packages/core/__tests__/input.spec.ts` | nothing pinned the sign | n/a, an absence | flip `vector.y += 1` to `-= 1` → the test goes red |
| 3 | `abyss-framework` movement scenario | `examples/abyss-framework/playtests/`, run by `pnpm test:playtest` | no scenario asserts the sign of forward motion | n/a | reverse the expected axis → the scenario fails |

## 4. Execution phases

### Phase 0 — Measure the one call site that does not negate

**Outcome:** a number that says whether `abyss-framework`'s player walks forward or backward
when `move.y` is positive.

**Files (max 5):**

- `examples/abyss-framework/playtests/movement-axis.playtest.json` — NEW
- `docs/verification/input-axis-2026-08-12.md` — NEW

**Method:** a `movement` assertion — hold `up`, assert the sign of the z displacement relative
to the camera's forward. No source is edited in this phase.

```sh
pnpm --filter @threenative/playtest build
xvfb-run -a -s '-screen 0 1600x900x24' \
  node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/movement-axis.playtest.json \
  --url http://127.0.0.1:5173 --server-command "pnpm --filter abyss-framework dev" --browser-recipe webgpu
```

Headless Chromium renders WebGPU blank on this host; the `xvfb-run` prefix is required, not
optional. A blank canvas is an environment failure, not a red result — if the run cannot reach
its assertions it exits `2` and Phase 0 reports **unmeasured**, never "fine".

**Negative control (required, observed red):** invert the expected axis in the scenario and
re-run. It must fail. A scenario that passes both ways is asserting nothing.

### Phase 1 — State the contract, pin it, delete the duplicated comments

**Files (max 5):**

- `packages/core/src/input.ts` — EDIT: JSDoc on `vector()` stating `+y = up`, that world-space
  forward is `−z`, and that this **differs from Godot's `Input.get_vector`**, which returns
  `−y` for up
- `packages/core/__tests__/input.spec.ts` — EDIT: pin the sign for keyboard and gamepad
- `packages/create-threenative/templates/starter/src/entities/Player.ts` — EDIT: delete the
  comment, keep the negation
- `packages/create-threenative/templates/minimal/src/entities/Player.ts` — EDIT: same

**Tests required:**

| Test file | Test name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `core/__tests__/input.spec.ts` | `should return +y when the up binding is held` | `vector("move").y === 1` | flip the sign in `input.ts` → red |
| `core/__tests__/input.spec.ts` | `should return +y for a forward gamepad stick` | negated `axes[1]` yields `+y` | remove the negation at `input.ts:121` → red, proving keyboard and gamepad agree |

### Phase 2 — Fix `abyss-framework`, only if Phase 0 measured it wrong

**Conditional.** If Phase 0 says the example moves forward, this phase does not run and the
ledger records that the missing negation is correct there because of the camera.

If it runs: one line at `examples/abyss-framework/src/entities/Player.ts:25`, and the Phase 0
scenario flips from red to green on the same command. **`abyss-vanilla` is the frozen
benchmark control and is not touched.**

## 5. Verification strategy

```sh
# 1. The contract is stated where a model reads it
grep -n "Godot\|negative z\|+y" packages/core/src/input.ts
# Expected: a JSDoc block above vector(). Today: zero hits; the method has no comment at all.

# 2. The duplication is gone
grep -rn "is +up; world-space forward" packages/create-threenative/templates
# Expected: no hits.

# 3. Every caller still agrees with the contract
grep -rn "\.vector(" packages/create-threenative/templates examples --include="*.ts"
# Expected: four sites, each consistent with the documented sign.
```

**Evidence required:**

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green
- [ ] Phase 0's scenario recorded with its exit code, and its negative control observed red
- [ ] If Phase 0 exits `2`, the ledger says **unmeasured** and Phase 2 does not run

## 6. Acceptance criteria

Consumer-scoped.

- [ ] **A user reading `vector()` in their editor learns the sign convention without opening
      the source**, including that it differs from Godot's.
- [ ] **Flipping the sign in `input.ts` turns a core test red**, proved by running it.
- [ ] **Neither template ships a comment explaining a framework convention.**
- [ ] **Option B is recorded as rejected, with its reason**, in this file.
- [ ] **No new export, no helper, no option was added.** `git diff` on
      `packages/core/src/index.ts` is empty.

**What this PRD may not claim:** that input is now correct on any device, or that the four
call sites are the only ones a user will write.
