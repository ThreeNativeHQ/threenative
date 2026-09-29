# PRD-473 — an adventure template, ported from The Verdant Oath

**Status: PARTIAL — phase 1 landed 2026-09-29** · filed 2026-09-29 against `a6397a668` · owner: "refactor `The-Verdant-Oath.html`
and integrate it into the starter pack (PR #376) … polish the main character, the look and feel should
match the reference picture, add it as a zelda-clone starter kit".

## Why

There is no third-person adventure kit. The owner supplied `The-Verdant-Oath.html` (727 KB, of which
623 KB is an inlined three.js r140 and ~100 KB is game code, zero embedded assets): a woodland
adventure with a stone stair, a log bridge, a heightfield with analytic stair collision, three
collectible sigils, a chest, breakable pots, six briarling enemies (idle/chase/windup/recover), sword,
shield block, dodge roll with i-frames, stamina, lock-on, a fairy companion, a keeper NPC with
dialogue, a quest chain (`meet → seek → altar → complete`), a minimap, a heart HUD and a save file.
The reference picture is Ocarina-of-Time-on-Switch-2's Kokiri forest: mist, god-rays through a giant
canopy, mossy log stairs, a fairy and a green-capped child hero seen from behind.

## What changes in the port

- The rules become plain TypeScript in `src/logic/` (no three, no DOM), unit-tested headless. The
  analytic ground height, circle collision and save restore keep their exact numbers; `Math.random`
  and `localStorage` leave the rules.
- Rendering moves to the engine's WebGPU path: `MeshStandardNodeMaterial`/TSL replaces the
  `onBeforeCompile` wind and the raw `ShaderMaterial` water; the canvas-2D textures stay
  (`CanvasTexture` is portable) but the minimap, dialogue, hearts and quest panel move to `src/ui/`
  (React + Tailwind) so every target draws them.
- Mist, shafts and bloom come from the shared `WorldEnvironment` chain (`godrays`, `bloom`) instead
  of additive plane billboards. The look follows the reference: warm desaturated greens, one low sun,
  fog that swallows the far trees, a bright fairy.
- The hero is rebuilt for the reference: child proportions (large head, short legs), a long pointed
  green cap whose tail sways, a shield on the back, brown boots and satchel, and the walk/roll/attack
  poses the original drove by hand.
- Input goes through `ctx.input` bindings, and `window.__VO` becomes the playtest bridge.

## Phases

### Phase 1 — the rules run headless

- [x] `src/logic/` holds terrain, quest, combat, save and stamina rules with no three.js import. proof: `pnpm exec vitest run packages/create-threenative/__tests__/adventure-logic.spec.ts` — 17/17 green in 0.35 s
- [x] The quest chain, i-frame roll, block, enemy state machine and save round-trip are covered, and a seeded 60 s scripted run replays to the same state twice. proof: the same spec — 3600 fixed 1/60 s steps of scripted movement, attacks, rolls and sprints serialise byte-identical on two runs

### Phase 2 — it plays in the engine, and looks like the picture

- [ ] The forest, stair, bridge, hero, fairy, keeper and briarlings render on WebGPU with mist, god-rays and bloom. proof: `docs/verification/visuals/adventure.png` from a 1280×720 `--browser-recipe webgpu` run, judged against the reference by a fresh subagent
- [ ] Move, camera orbit, attack, roll, block, lock-on, talk, collect, open and altar all work from `ctx.input`. proof: `playtests/adventure-quest.playtest.json` (meet → three sigils → altar) green in `TN_TEMPLATE_ONLY=adventure pnpm test:templates`
- [ ] The React HUD (hearts, gems, sigils, item slot, minimap, dialogue, quest, pause, victory) mirrors published state. proof: `playtests/adventure-combat.playtest.json` reads hearts drop on a hit and a kill drop a gem

### Phase 3 — it ships as a kit

- [ ] `templates/adventure` with `kit.json`, AGENTS.md (< 100 lines) and its playtests, plus the CI matrix row. proof: `TN_TEMPLATE_ONLY=adventure pnpm test:templates`
- [ ] Scaffold specs include the kit. proof: `pnpm exec vitest run packages/create-threenative` — the byte-stable scaffold hash is recomputed by the owner

## Decisions

- 2026-09-29: the kit ships `adventure`, not `zelda` — kits are named for the genre (`rts`, `racing`),
  and the fantasy is an original one (the keeper, the sigils, the briarlings), not a franchise's.
- 2026-09-29: no `@threenative/physics`, as in PRD-471. Ground is one analytic function shared by the
  render mesh, the hero and the enemies, and collision is circles on the xz-plane; a Rapier world
  beside it would buy nothing the rules do not already do deterministically.

## Blocked on

- Native desktop / Android run of the kit — needs the native host build; not run here.
