# PRD-011 — Good-looking by default: the generated render layer

**Complexity: 5 → MEDIUM mode** (6-9 files +2, no new system, single package +1, visual
proof needs a new gate +2)

**Depends on:** nothing. **Blocks:** nothing.
**Charter authority:** `CHARTER.md` §3 promise 2, §5b, §9b; `AGENTS.md` rules 1 and 3.

## 1. Context

**Problem:** `CHARTER.md:26` promises "a freshly scaffolded game looks good before anyone
touches it." That promise is currently **31 lines**, every dynamic object in the scene is
rendered with the rainbow debug material, and the shadow configuration is paid for and
never drawn.

**Files analyzed:** `packages/create-threenative/templates/starter/src/render/{lighting,
materials,postprocessing}.ts`, `templates/starter/src/scenes/Play.ts`,
`templates/starter/src/entities/{Player,Crate}.ts`, `templates/minimal/src/render/`,
`packages/core/src/renderer.ts`.

**Current behavior:**

| Fact | Evidence | Consequence |
| --- | --- | --- |
| Player and Crate use `MeshNormalMaterial` | `entities/Player.ts:9`, `entities/Crate.ts:7` | every moving object is rainbow debug shading — the first thing a user sees |
| `materials.ts` returns exactly one material | `render/materials.ts:5-9` | the floor is the only surface anyone art-directed |
| **`shadowMap.enabled` is set nowhere in the repo** | `grep -rn "shadowMap" packages/` → no hits; `render/lighting.ts:9-10` sets `castShadow` + a 2048² map | a 2048² shadow map is allocated and **zero shadows render** |
| No mesh sets `castShadow` / `receiveShadow` | `grep` → only the two light lines | even with `shadowMap.enabled`, nothing would cast or receive |
| `setupPost` does tonemapping only | `render/postprocessing.ts:5-8` | the file is named for a thing it does not do |
| Camera is two hardcoded lines | `scenes/Play.ts:22-23` | no framing, and PRD-009 will want this file |

The shadow row is not a taste question. It is dead configuration: the cost is paid in the
generated source and the pixels never arrive.

**Why this is safe to run in parallel:** `AGENTS.md` rule 3 requires the look to live in
`templates/`, never in a package. This PRD touches only
`packages/create-threenative/templates/` and cannot collide with PRD-007 through PRD-010,
all of which work in `packages/core`, `packages/physics` and `examples/`.

## 2. Solution

Raise the generated render layer from "compiles" to "shippable screenshot", entirely as
generated source the user owns.

- **Delete `MeshNormalMaterial` from the templates.** `materials.ts` grows a small named
  palette — floor, player, crate — as ordinary `MeshStandardMaterial`s.
- **Make the shadows real, or delete them.** `renderer.shadowMap.enabled = true` plus
  `castShadow` / `receiveShadow` on the generated meshes, in the generated source. If the
  WebGPU path cannot honour it, the shadow config comes out instead — dead settings do not
  ship.
- **`postprocessing.ts` either post-processes or is renamed.** Decide in Phase 2 with a
  measured frame cost; a tonemapping-only file named `setupPost` is a lie either way.
- **A screenshot gate.** `pnpm test:browser` gains one scenario that boots the scaffolded
  starter and takes a screenshot assertion, so a regression to flat-grey is caught by CI
  rather than by a user.

**Key decisions:**

- **No new package code, and no `defineGame` option.** `AGENTS.md` rule 3 and
  `packages/core/AGENTS.md` both forbid it; `postprocessing: ['bloom']` is named there as a
  v1 mistake. Everything here is generated `.ts` under `templates/*/src/render/`.
- **The 20-line rule is the ceiling per file.** If a generated file grows past it, the
  content is wrong, not the rule.
- **`minimal` stays minimal.** It gets the shadow fix and loses `MeshNormalMaterial`; it
  does not get the palette. The two templates must stay visibly different or `minimal` has
  no reason to exist.

**Data changes:** none.

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | named material palette | `templates/starter/src/entities/{Player,Crate}.ts` | `new MeshNormalMaterial()` | **both lines deleted** | restore `MeshNormalMaterial` → screenshot gate fails |
| 2 | `shadowMap.enabled` in generated source | `templates/starter/src/render/lighting.ts` | nothing — it never existed | n/a | remove it → shadow assertion fails |
| 3 | `castShadow`/`receiveShadow` on meshes | `templates/starter/src/scenes/Play.ts` | unshadowed meshes | n/a | drop `receiveShadow` on the floor → no contact shadow in the screenshot |
| 4 | screenshot scenario | `pnpm test:browser` | no visual gate at all | n/a | flatten lighting to ambient-only → gate fails |

**Reachability:** `pnpm create threenative` → `pnpm dev` → the first frame a user sees.

## 4. Phases

#### Phase 1: no debug materials, and the shadows are real

**Files:** `templates/starter/src/render/materials.ts` EDIT ·
`templates/starter/src/render/lighting.ts` EDIT ·
`templates/starter/src/entities/{Player,Crate}.ts` EDIT ·
`templates/starter/src/scenes/Play.ts` EDIT · `templates/minimal/src/render/lighting.ts`
EDIT · `templates/minimal/src/entities/*` EDIT ·
`create-threenative/__tests__/looks.spec.ts` EDIT.

**Wiring:** `MeshNormalMaterial` is deleted from both templates in this phase, not
deprecated. `shadowMap.enabled` is set in generated source, next to the light that already
declares `castShadow`.

| Check | Assertion | Negative control (observe red) |
| --- | --- | --- |
| `grep -rn "MeshNormalMaterial" packages/create-threenative/templates` | no output | restore one → grep gate fails |
| shadow config is live | `renderer.shadowMap.enabled === true` in the scaffolded app | delete the line → assertion fails |
| shadow config is honest | if WebGPU cannot honour it, `castShadow` and `shadow.mapSize` are gone too | leave `castShadow` with the map disabled → fails |
| every generated render file | under 20 lines | — |

#### Phase 2: a screenshot gate, and `setupPost` earns its name

**Files:** `templates/starter/src/render/postprocessing.ts` EDIT ·
`playtests/starter-look.playtest.json` NEW · `playwright.config.ts` EDIT.

**Wiring:** the scenario runs against the scaffolded starter over the existing standalone
runner — **screenshot assertions need no bridge** (`AGENTS.md`: screenshot and diagnostics
work "against any URL, with no adapter"), so this phase does not wait on PRD-007.

| Check | Assertion | Negative control |
| --- | --- | --- |
| screenshot scenario | matches the committed reference within tolerance | replace the palette with `MeshNormalMaterial` → fails |
| `setupPost` | either applies a post pass, or the file is renamed to what it does | leave it named `setupPost` doing only tonemapping → review rejects |
| frame cost | the added passes are recorded as a number in the verification doc | an unmeasured "it's fine" → fails |

**User verification:** `pnpm create threenative demo && pnpm dev` — the first frame has no
rainbow objects and a visible contact shadow under the crate.

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets && pnpm test:browser

# The debug material is gone, not shadowed
grep -rn "MeshNormalMaterial" packages/create-threenative/templates   # expected: no output

# The shadow config is not dead
grep -rn "shadowMap.enabled" packages/create-threenative/templates    # expected: a hit

# Rule 3: no look leaked into a package
grep -rn "toneMapping\|MeshStandardMaterial\|DirectionalLight" packages/core/src \
  packages/physics/src packages/ui/src                                # expected: no output
```

## 6. Acceptance (consumer-scoped)

- [x] A freshly scaffolded starter renders with no `MeshNormalMaterial` anywhere.
- [x] A shadow is visible under the crate in the first frame, or the shadow configuration
      is deleted — no dead settings ship.
- [x] A screenshot assertion fails when the render layer regresses, proved by observing it
      red once against a deliberately flattened scene.
- [x] Every file under `templates/*/src/render/` is under 20 lines.
- [x] No render or material code entered `packages/`.
- [x] Every gate observed red once, recorded in `docs/verification/PRD-011.md`.
