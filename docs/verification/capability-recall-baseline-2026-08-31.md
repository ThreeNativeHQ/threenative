# Capability search recall — baseline measurement, 2026-08-31

**What executed:** two ad-hoc Node one-liners against the committed manifest
(`packages/create-threenative/capabilities.json`, 210 entries) through the built
`packages/engine-mcp/dist/index.js`, at `77a68bec`. Nothing was changed. This is a read-only
baseline, **not a gate** — `docs/PRDs/authoring/PRD-297` is the PRD that turns it into one.

## Run 1 — every mechanic bullet in the sealed sweep briefs

```sh
node --input-type=module -e "
import {searchCapabilities} from './packages/engine-mcp/dist/index.js';
import fs from 'node:fs';
const dir='docs/benchmark/genres';
let total=0,empty=0;
for(const g of fs.readdirSync(dir)){
  const md=fs.readFileSync(\`\${dir}/\${g}/brief.md\`,'utf8');
  const bullets=md.split('\n').filter(l=>l.startsWith('- ')&&!l.includes('sealed proof')).map(l=>l.slice(2).trim());
  for(const b of bullets){
    total++;
    let r=[];try{r=searchCapabilities(b,'packages/create-threenative/capabilities.json','mechanic')}catch(e){}
    if(!r.length){empty++;console.log('MISS ['+g+']',b.slice(0,72));}
  }
}
console.log(empty+' of '+total+' brief mechanics return zero results');
"
```

Output:

```
MISS [endless-runner] Spawn an unbounded-feeling sequence of obstacles and collectibles with i
MISS [endless-runner] Make a collision restart the run without a page reload.
MISS [exploration] Use a third-person camera and a compact hub that leads to at least two d
MISS [exploration] Make the world readable through deliberate lighting, landmarks, and a re
MISS [fps] First person. Eye height 1.66 m, walking 5.6 m/s, sprinting 8.2 m/s whil
MISS [fps] Vertical field of view 70°, narrowing to 22° while aiming down the sight
MISS [fps] Health starts at 100 and never regenerates. There is no jump, no crouch
MISS [fps] Spawns at the firing line facing down the range, with the nearest target
MISS [fps] Magazine 30, reserve 90. Reload moves rounds from the reserve into the m
MISS [platformer] Match the reference's bright sky, saturated green platforms, warm wood,
MISS [topdown-action] Build the arena from a few walls, floor markings, and pickups with a cle

11 of 46 brief mechanics return zero results
```

**24% zero-result** on the repository's own sealed sweep inputs — the exact corpus the
self-improvement loop measures agents against.

## Run 2 — plain-words queries an authoring agent actually types

`scope: "request"`, same manifest:

| Query | Result |
| --- | --- |
| `build a racing game` | `PathFollow3D` |
| `tower defense game` | **(none)** — a `defense` template ships |
| `make an inventory system` | (none) |
| `enemy AI that chases the player` | `NavigationAgent3D, recast, CharacterBody3D, attachToBone` |
| `third person camera follow` | **(none)** |
| `save the player progress` | **8 results, none relevant** — `Area3D, PointerEvents3D, NavigationAgent3D, recast, CharacterBody3D, defineGame, Heightfield, attachToBone` |
| `spawn waves of enemies` | 15 results, unranked mixture including `Buoyancy3D`, `SpectralOcean` |
| `dialogue with an NPC` | `NavigationAgent3D, recast` |
| `pick up an item` | `ClusteredMesh` |
| `multiplayer` | (none) |
| `make a platformer with double jump` | **(none)** — a `platformer` template ships |

## What the numbers say

1. **No confidence signal.** `searchCapabilities` filters on `score > 0` only
   (`packages/engine-mcp/src/index.ts:196`). One shared token after stop-word removal is a
   result, ranked beside a genuine phrase match. `save the player progress` returning eight
   wrong capabilities is worse for an authoring agent than returning none: it teaches a wrong
   abstraction with the same confidence as a right one.
2. **No negative answer exists.** The tool cannot say *the engine does not own this, write it in
   game code* — the outcome the charter's kill-switch rule wants for inventory, save/load and
   dialogue.
3. **One authored phrasing per situation.** 446 `@situation` phrases across 210 entries, matched
   by token overlap. `third person camera follow` misses every camera capability.
4. **Coverage holes.** `@threenative/assets` has **0** manifest entries;
   `CAPABILITY_PACKAGE_DIRECTORIES` (`scripts/build-capability-manifest.ts:18`) is
   `["core","physics","playtest","ui"]`. Template entries exist only for `starter` (3).
5. **No systemic recall gate.** `packages/engine-mcp/__tests__/search.spec.ts` asserts ~20
   hand-picked cases. Each is a real regression guard; none of them measures recall over a
   corpus, so the 24% above was invisible.

## Not measured

- Whether an agent that receives a zero-result answer writes better code than one that receives
  eight wrong ones. Only the retrieval was measured, not the downstream authoring outcome; that
  needs a sweep arm (`pnpm sweep:pair`), which was not run.
- Anything on native, on device, or in a scaffolded project. This is a pure manifest/search
  measurement on the repository checkout.
