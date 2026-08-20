# Where the strategy contradicts CHARTER.md

**Status:** open decisions, 2026-08-02. The charter wins wherever this file disagrees with it.

The product strategy in `docs/strategy/` was written from the outside in — market
first. `CHARTER.md` was written from the inside out — founding constraint first. They
collide in nine places. Each row below is a decision someone has to make; none is
made here.

| # | Strategy wants | `CHARTER.md` says | Proposed resolution |
|---|---|---|---|
| 1 | ThreeNative Studio: a local dashboard with inspector, profiler, asset browser | No editor in v1: "An editor — not in v1. The Studio dogfood found Share and Export did literally nothing." | **Resolved, 2026-08-16.** Amended by the owner on 2026-08-12 to let Studio proceed as an agent editing plain TypeScript, with a scene-writing GUI still closed. It then left this repository entirely (PRD-129): Studio is proprietary, its source is in a private repository, and this repository ships no editor. Nothing here contradicts the charter any more. |
| 2 | `threenative doctor` as the acquisition funnel | Only **4 CLI commands, ever** (`dev`, `build`, `test`, `ship`) | Ship it as `threenative test --doctor`, or as a mode of the existing `threenative-playtest` bin. A fifth top-level command is a cap breach. |
| 3 | 10 packages (`runtime`, `renderer-three`, `platform-web`, `platform-native`, `assets`, `input`, `audio`, …) | Package count follows dependency boundaries; subpath exports avoid needless packages | Keep only packages that carry a dependency boundary. The workspace currently has seven package directories. |
| 4 | `defineGame({ targets: { 'mobile-mid': { fps: 60, maxDrawCalls: 180 } } })` | Config options are a ceiling; the API fits on one page | Budgets live in playtest scenarios and CI, not in `defineGame`. See [../product/PERFORMANCE-BUDGETS.md](../product/PERFORMANCE-BUDGETS.md). |
| 5 | An asset compiler (glTF Transform, KTX2, LODs, collider generation) | The 15,000 LOC review trigger, currently ~1,600 | Out of the framework. It is a build-time tool with its own release lane, like the published, MIT `asset-mcp` release lane. Not started until a stranger has played a ThreeNative game for five minutes. |
| 6 | Prefab/behaviour API (`definePrefab`, `chasePlayer()`) as the default surface | No recipe/preset system: "0 of 7 presets ever reproduced their genre" | Rejected. Prefabs are template code in `src/entities/`, which the scaffold already generates. See [../architecture/ENTITY-MODEL.md](../architecture/ENTITY-MODEL.md). |
| 7 | Marketplace, multiplayer, live ops | No marketplace, multiplayer or live ops in v1; budgets stay bounded | Not before the benchmark resolves. Each is a separate company. |
| 8 | Cloud builds, device lab, store submission | The mobile gate is *resolved on paper, unrun in practice* | Every cloud claim is downstream of Phase 0a/0b running on a physical phone. Do not sell what has not booted. |
| 9 | A shipping bar reached without physical hardware — [ROADMAP.md](ROADMAP.md)'s Tier 1 | The product promise includes web, desktop and mobile, and the device matrix is the definition of done; neither admits a tier that stops at the emulator | **Stage, do not repeal.** Tier 1 licenses one sentence — browser, desktop, Android emulator, iOS packaging — and no mobile-readiness claim. The device matrix stays the definition of done; Tier 2 restarts when a stranger has played a ThreeNative game for five minutes. Owned by [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md). **Open decision:** whether the charter should be amended to name the tiers, or keep the tension recorded here. |

## Phase 2 capability gate and the paired sweep — PRD-079

The old Phase 2 wording asked a paired vanilla arm to fail to match a capability while the
benchmark deliberately gave both arms the same `playtest` bridge. That is a strategy/instrument
conflict, not evidence that the framework capability is absent. Round 4's functional tie was
specifically two real arms that exited `0/1` before assertion evaluation, so its cost and visual
columns remain untouched and its history is not rewritten.

Owner decision by Joao Paulo Furtado, 2026-08-19: adopt a three-part replacement gate — consumer-visible capability,
an instrument whose control does not receive that capability, and a same-subject negative control
observed red. The paired sweep stays in the loop as the cost-and-polish ratchet; it is not rerun
for this question. The first execution is recorded as red in
[`phase-2-2026-08-19.md`](../verification/phase-2-2026-08-19.md), because the platformer proof
was already shipped by PRD-081 and cannot be counted as new post-adoption evidence. This keeps
the gate honest without claiming that vanilla lost a capability column.

## Package count and budget status

`pnpm budgets` currently reports seven framework packages and five example workspaces. The
package count is informational; the enforced hard invariants cover native-runtime placement,
vendored dependencies, and generated bundles, while framework and native LOC are review triggers.

The package rule remains the useful decision boundary: add a package only when it carries a
dependency the others must not inherit. Do not revive the retired eight-package-cap argument or
use a count to justify a package that belongs behind an existing subpath export.

## The one thing strategy and design already agree on

Both say the durable value is *after* "make it playable": maintainable → portable →
performant → shippable. The charter calls it "what vanilla structurally cannot do."
The strategy calls it stages 2–6. Same claim, and it is the only claim that survives
both documents intact.
