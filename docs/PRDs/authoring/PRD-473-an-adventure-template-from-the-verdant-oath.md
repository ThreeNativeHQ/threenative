# PRD-473 — an adventure template, ported from The Verdant Oath

**Status: PARTIAL — phases 1–3 landed 2026-09-29; only the reference-match judge box is open** · filed 2026-09-29 against `a6397a668` · owner: "refactor `The-Verdant-Oath.html`
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

- [x] The forest, stair, bridge, hero, fairy, keeper and briarlings render on WebGPU with mist, god-rays and bloom. proof: `docs/verification/visuals/adventure.jpg` — a real-GPU Chrome capture (1108x879) of the built kit with `TN_RENDER_CHAIN` reporting `ambientOcclusion, godRays, bloom, vignette, antialias` all applied, none dropped. Two fresh judges compared an earlier and a middle capture with the reference (mood 4→6, character 6→4, fairy 4→5 of 10) and both said it does not yet match; this capture was not re-judged, see the box below
- [x] Move, camera orbit, attack, roll, block, lock-on, talk, collect, open and altar all work from `ctx.input`. proof: `playtests/adventure-talk.playtest.json` (walk to the keeper, dialogue pages, stage `meet` → `seek`) and `playtests/adventure-combat.playtest.json` (walk into a briarling's sight, 12 swings, `kills` ≥ 1) green; the sigils, chest, altar and respawn are proved headless in `adventure-logic.spec.ts` — a scripted walk to all three sigils is not a scenario, see `## Decisions`
- [x] The React HUD (hearts, gems, sigils, item slots, minimap, dialogue, quest, pause, victory) mirrors published state. proof: `adventure-talk` reads `prompt`, `stage`, `dialog` and `dialogMore` through the published state at four labelled steps, and `survives` reads `gems` 0 → 1 after walking onto a gem — all four scenarios green together (`pnpm test` in a scaffolded project, 4 of 4)

- [ ] A fresh judge says the capture matches the reference picture: mood, path and hero each at least 7 of 10. proof: a judge subagent run on `docs/verification/visuals/adventure.jpg` against the reference frame
  - Still open: the last judged capture said the frame was too washed out and the hero read as a green blob; the change since (deeper shade, olive tunic, emerald cap, thinner cap tail, dark log risers, no fairy aura) was captured but never re-judged.

### Phase 3 — it ships as a kit

- [x] `templates/adventure` with `kit.json`, AGENTS.md (< 100 lines) and its playtests, plus the CI matrix row. proof: scaffolded from the packed local framework and run with `threenative-playtest --browser-recipe webgpu --headed` — `survives` (170 frames), `adventure-talk` (414), `adventure-combat` (788), `forest-performance` (720, 375 draws, 1.11 M triangles, p95 under 33 ms) green; `.github/workflows/ci.yml` carries `adventure`. `TN_TEMPLATE_ONLY=adventure pnpm test:templates` itself was not run: the same scaffold and scenarios were driven by hand
- [x] Scaffold specs include the kit. proof: `pnpm exec vitest run packages/create-threenative` — 48 files, 825/825 green, including the recomputed `adventure` scaffold hash and the quality, shared-render-source and template-conventions gates. The wider `scripts/__tests__` sweep has 6 reds not caused by this kit (capability-manifest alias corpus, the Charter's platformer scenario count, three starter effect files that do not resolve), and `visual-gate`'s palette cap of six, which this kit did cause and fixed

## Decisions

- 2026-09-29: the original synthesised its music and effects with WebAudio oscillators, which the native
  host does not have, so the kit plays clips through `AudioBus`. The 14 clips (11 one-shots, a wind-and-birds
  bed, a melody; 790 KB) are synthesised by `scripts/adventure-audio.ts`, so they are original and carry no
  licence. Cues are labelled, and `survives`, `adventure-talk` and `adventure-combat` assert `step`, `gem`,
  `talk`, `swing` and `hit` counts. Not heard by a person in this session: only the ledger is proved.
- 2026-09-29: bark, rock and forest floor are three CC0 Poly Haven photographs (bark_brown_02, mossy_rock,
  forrest_ground_01), 1 K diffuse maps resized to 512 px and brightened, 67 + 64 + 66 KB. Nothing else uses a
  photograph: the sprites stay procedural so they run on the native host.
- 2026-09-29: `Heightfield`, `CharacterBody3D`, `WaveField`/`WaterSurface3D` and `TerrainTiles` were searched
  and left unused. `Heightfield.fromSampler` stores a grid and interpolates it, which would round the
  0.65 m log steps the rules walk on; the brook is a lit TSL ripple, not a wave field; the world is
  130 m, so there is nothing to stream. `GPUParticles3D`, `mergeByMaterial`, `InstancedBatch`,
  the `godRays`/`bloom`/`ambientOcclusion` stages and `defineGame` input bindings are used.
- 2026-09-29: the fairy has no glow sprite and no halo emitter. Both drew their quad as a pale square over
  a dark floor (a `GPUParticles3D` is itself a `Sprite`); her body is brighter than white and bloom does the
  glowing, with a dotted wake of twelve small meshes.
- 2026-09-29: the god-rays stage refuses to build until the sun has a rendered shadow map, so `Play.ts`
  builds the chain on the third world draw (`ctx.beforeRender`), not in `enter()`.
- 2026-09-29: there is no scripted walk to all three sigils. The two far sigils sit beside briarlings that
  wake at 7 m, so a fixed key sequence is a fight that depends on the fight; the full quest is one
  headless spec case, and the keeper, a fight and a pickup are playtests.

- 2026-09-29: the kit ships `adventure`, not `zelda` — kits are named for the genre (`rts`, `racing`),
  and the fantasy is an original one (the keeper, the sigils, the briarlings), not a franchise's.
- 2026-09-29: no `@threenative/physics`, as in PRD-471. Ground is one analytic function shared by the
  render mesh, the hero and the enemies, and collision is circles on the xz-plane; a Rapier world
  beside it would buy nothing the rules do not already do deterministically.

## Blocked on

- Native desktop / Android run of the kit — needs the native host build; not run here.
