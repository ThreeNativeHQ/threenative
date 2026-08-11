# Where the strategy contradicts CHARTER.md

**Status:** open decisions, 2026-08-02. The charter wins wherever this file disagrees with it.

The product strategy in `docs/strategy/` was written from the outside in — market
first. `CHARTER.md` was written from the inside out — founding constraint first. They
collide in eight places. Each row below is a decision someone has to make; none is
made here.

| # | Strategy wants | `CHARTER.md` says | Proposed resolution |
|---|---|---|---|
| 1 | ThreeNative Studio: a local dashboard with inspector, profiler, asset browser | No editor in v1: "An editor — not in v1. The Studio dogfood found Share and Export did literally nothing." | **Defer.** What ships today is `DebugOverlay` + `window.__THREENATIVE__.snapshot()`. Studio starts only after a stranger has played a game for five minutes. |
| 2 | `threenative doctor` as the acquisition funnel | Only **4 CLI commands, ever** (`dev`, `build`, `test`, `ship`) | Ship it as `threenative test --doctor`, or as a mode of the existing `threenative-playtest` bin. A fifth top-level command is a cap breach. |
| 3 | 10 packages (`runtime`, `renderer-three`, `platform-web`, `platform-native`, `assets`, `input`, `audio`, …) | The package plan is 8 packages, "modularity comes from subpath exports" | Keep 5. `input`, `assets`, `state` are already subpath exports of `@threenative/core`. |
| 4 | `defineGame({ targets: { 'mobile-mid': { fps: 60, maxDrawCalls: 180 } } })` | Config options are a ceiling; the API fits on one page | Budgets live in playtest scenarios and CI, not in `defineGame`. See [../product/PERFORMANCE-BUDGETS.md](../product/PERFORMANCE-BUDGETS.md). |
| 5 | An asset compiler (glTF Transform, KTX2, LODs, collider generation) | The 15,000 LOC review trigger, currently ~1,600 | Out of the framework. It is a build-time tool with its own release lane, like the published, MIT `asset-mcp` release lane. Not started until a stranger has played a ThreeNative game for five minutes. |
| 6 | Prefab/behaviour API (`definePrefab`, `chasePlayer()`) as the default surface | No recipe/preset system: "0 of 7 presets ever reproduced their genre" | Rejected. Prefabs are template code in `src/entities/`, which the scaffold already generates. See [../architecture/ENTITY-MODEL.md](../architecture/ENTITY-MODEL.md). |
| 7 | Marketplace, multiplayer, live ops | No marketplace, multiplayer or live ops in v1; budgets stay bounded | Not before the benchmark resolves. Each is a separate company. |
| 8 | Cloud builds, device lab, store submission | The mobile gate is *resolved on paper, unrun in practice* | Every cloud claim is downstream of Phase 0a/0b running on a physical phone. Do not sell what has not booted. |
| 9 | A shipping bar reached without physical hardware — [ROADMAP.md](ROADMAP.md)'s Tier 1 | The product promise includes web, desktop and mobile, and the device matrix is the definition of done; neither admits a tier that stops at the emulator | **Stage, do not repeal.** Tier 1 licenses one sentence — browser, desktop, Android emulator, iOS packaging — and no mobile-readiness claim. The device matrix stays the definition of done; Tier 2 restarts when a stranger has played a ThreeNative game for five minutes. Owned by [PRD-064](../PRDs/night-watch-26-08-10/PRD-064-tier-1-native-reliability.md). **Open decision:** whether the charter should be amended to name the tiers, or keep the tension recorded here. |

## The package-cap problem is already live

`scripts/check-budgets.ts` counts `packages/*` **and** `examples/*` toward the cap of 8.

```
packages/: core, physics, playtest, ui, create-threenative   = 5
examples/: abyss-vanilla, abyss-framework                    = 2
                                                       total = 7 of 8
```

The charter still plans `physics-native` and `native`. Those are packages 8 and 9 —
**the cap breaks before the mobile promise ships**, and it breaks because examples are
counted. Three options, none taken yet:

1. Exclude `examples/*` from the count (it is a framework-size budget, not a repo budget).
2. Ship the RN adapter as `@threenative/core/native` subpath, keeping `physics-native` as the 8th package.
3. Raise the cap — which the cost-cap rule explicitly forbids: *"Exceeding a cap is not a signal to raise the cap."*

Option 2 is the only one that respects the package rule ("a package exists only when it
carries a dependency the others must not inherit") *and* the cost-cap rule. The RN adapter carries
`react-native-webgpu`, so option 2 is arguably wrong on that rule and option 1 is the
honest fix. **Decide before Phase 0b, not during it.**

## The one thing strategy and design already agree on

Both say the durable value is *after* "make it playable": maintainable → portable →
performant → shippable. The charter calls it "what vanilla structurally cannot do."
The strategy calls it stages 2–6. Same claim, and it is the only claim that survives
both documents intact.
