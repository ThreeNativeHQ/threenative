# PRD-361 — Shared Character Setup Verification Record

**Date:** 2026-09-06; verification refresh **2026-09-07**
**PRD:** PRD-361 — Two games share correct character setup  
**Parent:** PRD-354 — An imported rig instances and poses correctly, once  

## 1. Summary

Shipped `SkeletalMesh3D` in `@threenative/core` to solve the four traps every character setup repeated. The class extends `AnimationPlayer`, so the prepared rig and its playback state are one object; there is no separate `prepareSkeletalMesh` export:
1. **Skeleton-safe cloning:** uses Three.js `SkeletonUtils.clone` so cloned skinned meshes do not share bone instances with the source or sibling instances.
2. **Skin-aware normalisation:** scales character rigs using `normaliseToMetres` which measures rendered skin vertices rather than bind-pose bounding boxes.
3. **Fail-closed clip validation:** verifies requested/required clips at load time against the clip map and enforces that each required clip binds tracks to the rig, eliminating silent bind-pose mannequin traps.
4. **Two-object stride-root structure:** configures `AnimationPlayer` with `strideRoot` set to the game-moved body, preventing root-motion feedback loops.

Replaced private repeated plumbing in two independent live consumers:
- **Wildwood:** `sandbox/wildwood/src/entities/animals/Animal.ts`
- **HQ:** `sandbox/threenative-hq/src/office/Worker.ts` and `sandbox/threenative-hq/src/office/Visitor.ts`

## 2. Consumer Anchors (file:line)

| Consumer | File | Line Anchor | Replaced Plumbing |
|---|---|---|---|
| Wildwood Animal | `sandbox/wildwood/src/entities/animals/Animal.ts` | `:148-154` | Removed inline `cloneSkeleton`, `normaliseToMetres`, manual `AnimationPlayer` |
| HQ Worker | `sandbox/threenative-hq/src/office/Worker.ts` | `:68-74` | Removed inline `cloneSkinned`, `normaliseToMetres`, manual `AnimationPlayer` |
| HQ Visitor | `sandbox/threenative-hq/src/office/Visitor.ts` | `:74-80` | Removed inline `cloneSkinned`, `normaliseToMetres`, manual `AnimationPlayer` |

## 3. Red / Green Evidence

### Red: Before `SkeletalMesh3D` implementation
```
 FAIL  packages/core/__tests__/animation.spec.ts [ packages/core/__tests__/animation.spec.ts ]
Error: Cannot find module '../src/skeletal-mesh.js' imported from packages/core/__tests__/animation.spec.ts
```

### Green: After `SkeletalMesh3D` implementation
```
 RUN  v4.1.10 threenative-engine
 ✓ packages/core/__tests__/animation.spec.ts (31 tests) 37ms
 ✓ packages/core/__tests__/playtest-stride.spec.ts (3 tests) 37ms
 Test Files  2 passed (2)
      Tests  34 passed (34)
```

### Red: real consumer export negative control — 2026-09-07

The installed staged package was left unchanged while each consumer import was temporarily
renamed to `SkeletalMesh3D_missing_export`. Both real consumer typechecks failed with TypeScript's
missing-export diagnostic, proving that the consumers depend on the package surface rather than a
local copy:

```text
HQ_EXIT=2
src/office/Visitor.ts(2,17): error TS2305: Module '"@threenative/core"' has no exported member 'SkeletalMesh3D_missing_export'.
src/office/Worker.ts(1,10): error TS2305: Module '"@threenative/core"' has no exported member 'SkeletalMesh3D_missing_export'.
WILDWOOD_EXIT=2
src/entities/animals/Animal.ts(2,3): error TS2305: Module '"@threenative/core"' has no exported member 'SkeletalMesh3D_missing_export'.
```

The temporary edits were restored immediately; the consumer worktree retained only its seven
intended changes.

## 4. Negative Controls

1. **Plain clone trap:**
   - Test: `negative control: plain Object3D.clone(true) fails independent animation by sharing bones`
   - Observation: Plain `.clone(true)` leaves `skinnedMesh.skeleton.bones` pointing to the source fixture bones. `SkeletalMesh3D` rebinds each skinned mesh to independent cloned bones in its own subtree.
2. **Missing required clip / bad doe clip map:**
   - Test: `fails at load time when a requested clip is missing, including the historically bad doe clip map`
   - Observation: Throws `SkeletalMesh3D: missing required clip 'ANIM_DeerStag_IdleBreathe'` at load time when doe rig lacks stag clips.
3. **Unbound track failure:**
   - Test: `fails at load time when a requested clip binds 0 tracks to the rig`
   - Observation: Throws `SkeletalMesh3D: clip 'alien_clip' binds 0 tracks to 'source-rig'`.

## 5. Discovery Verification

### Query: "put an animated character in the scene"
- Score: 3.2 (Rank #1)
- Matched Symbol: `SkeletalMesh3D` (`@threenative/core`)
- Example:
```ts
import { SkeletalMesh3D } from "@threenative/core";
const character = new SkeletalMesh3D({
  source: gltf.scene,
  clips: gltf.animations,
  requiredClips: ["idle", "walk"],
  size: { metres: 1.8, axis: "height" },
  strideRoot: body,
});
body.add(character.root);
character.play("idle");
```

### Query: "my imported character renders deformed"
- Score: 3.6 (Rank #1)
- Matched Symbol: `SkeletalMesh3D` (`@threenative/core`)

## 6. LOC Ratchet — audited 2026-09-07

The whole-file check is kept visible because comments and game behavior belong to the consumers.
The three consumer files are `991` normalized lines at `origin/main` and `994` after migration.
The PRD-specific constructor slices are `90` lines before migration and `39` consumer call-site
lines after migration. The complete shared addition is `59` lines in `SkeletalMesh3D` plus `24`
added normalized lines in `AnimationPlayer` for the shared root and mandatory clip validation.
That makes the measured replacement aggregate `122` lines and leaves the ratchet `32` lines over
the direct baseline. The PRD's aggregate reduction checkbox remains open; this record does not
claim that acceptance criterion passed.

The reproducible command is:

```sh
pnpm tsx -e 'import { readFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { countLines, normaliseSource } from "./scripts/count-loc.ts"; const engine=process.cwd(); const consumer="/home/joao/projects/threenative/sandbox/.worktrees/prd-361-consumers-20260907"; const files=["wildwood/src/entities/animals/Animal.ts","threenative-hq/src/office/Worker.ts","threenative-hq/src/office/Visitor.ts"]; const oldRanges=[[129,184],[68,88],[75,87]] as const; const currentRanges=[[143,157],[68,77],[74,87]] as const; const source=(text:string,file:string)=>normaliseSource(text,file,engine).split(String.fromCharCode(10)); const count=(text:string,file:string,range:[number,number])=>countLines(source(text,file).slice(range[0]-1,range[1]).join(String.fromCharCode(10)),()=>"game").total; const oldSetup=files.map((file,index)=>count(execFileSync("git",["-C",consumer,"show",`origin/main:${file}`],{encoding:"utf8"}),file,oldRanges[index])); const currentSetup=files.map((file,index)=>count(readFileSync(`${consumer}/${file}`,"utf8"),file,currentRanges[index])); const mesh=count(readFileSync(`${engine}/packages/core/src/skeletal-mesh.ts`,`utf8`),"packages/core/src/skeletal-mesh.ts",[1,59]); const oldSetupTotal=oldSetup.reduce((a,b)=>a+b,0); const currentCallSites=currentSetup.reduce((a,b)=>a+b,0); const animationPlayerAdditions=24; console.log(JSON.stringify({oldSetup,currentSetup,oldSetupTotal,currentCallSites,skeletalMesh:mesh,animationPlayerAdditions,aggregate:currentCallSites+mesh+animationPlayerAdditions,reduction:oldSetupTotal-currentCallSites-mesh-animationPlayerAdditions},null,2));'
```

The output is:

```json
{
  "oldSetup": [56, 21, 13],
  "currentSetup": [15, 10, 14],
  "oldSetupTotal": 90,
  "currentCallSites": 39,
  "skeletalMesh": 59,
  "animationPlayerAdditions": 24,
  "aggregate": 122,
  "reduction": -32
}
```

The class composes existing cloning, scale, clip-audit, and `AnimationPlayer` mechanisms. The
negative result is recorded so the next pass can reduce the shared path against this measured
baseline rather than silently carrying an unsupported acceptance claim.

## 7. Consumer browser proofs — refreshed 2026-09-07

The sandbox worktree was installed from the staged package files at
`realpath ../.packages` = `/home/joao/projects/threenative/sandbox/.packages`. The exact
files used by the consumer lockfiles were present, and `pnpm install --frozen-lockfile --offline`
exited 0 in both `wildwood/` and `threenative-hq/`. Their package SHA-256 values are:

```text
threenative-core-0.3.0-prd361-size-top-88cc72b41a7c.tgz        88cc72b41a7c713c1ff75d8053e643e6fe0725548736964e3e2fc1970e7271ec
threenative-assets-0.3.0-prd361-native-layout-ef2317901232.tgz  ef2317901232bd385ad86e73b62d05c5fc5a34f9abe3290217100f3daa58e6db
threenative-runtime-native-0.3.0-prd361-source-preflight-3f93bda231cb.tgz
                                                               3f93bda231cbc7157b8328f9ab31187fe235bbd0053266b04e9122ab8b41efa2
threenative-playtest-0.3.0.tgz                                  d5a44fc5137e66101376b2c1c5dc325179aceff2a7d98922fd033b1b8dd5e5e0
```

The ignored FAB output packs were mounted temporarily for the browser run and removed afterward.
Every browser invocation used `tools/capture-lock.sh`, `--browser-recipe webgpu`, and `--headed`.

Wildwood passed `pnpm typecheck`, `pnpm test:render` (15 tests), `pnpm test:audio` (191 checks),
and `pnpm build`. The committed scenario results were:

```text
playtests/startup.playtest.json   pass=true  startup p95 ready=14010 ms
playtests/survives.playtest.json  pass=true  distance=30.75 m
playtests/walk.playtest.json      pass=true  distance=30.75 m, minimum=15 m
playtests/discover.playtest.json  pass=true
playtests/wade-out.playtest.json  pass=true  path=35.76 m, minimum=16 m
```

The browser animal observation at
`sandbox/wildwood/artifacts/animals/browser-observation.json` is version 2 and ready, with six
subjects, positive movement samples, positive head-minus-pelvis forward means, and an NVIDIA
Turing adapter. The recorded displacements were fox 40.12 m, stag 22.86 m, doe 31.80 m, wolf
89.68 m, pig 39.73 m, and crow 11.49 m. The animal validator completed successfully.

HQ passed `pnpm typecheck`, `pnpm test:bridge`, and `pnpm build`. These committed scenarios each
exited 0 against the built preview with the fixture bridge:

```text
playtests/office.playtest.json           pass=true  worker distance=6.43 m
playtests/visitor.playtest.json          pass=true  visitor distance=30.11 m
playtests/office-animation.playtest.json pass=true  required clips advanced
playtests/office-poses.playtest.json     pass=true  sit/stand transitions and clips advanced
```

The live office lane was skipped because no bridge was listening on `127.0.0.1:7373`; it remains
unverified by design. The fixture lane is the deterministic proof of the refactored Worker and
Visitor setup. The observed FAB packs contained 163 manifest entries for Wildwood and 25 for HQ.

## 8. Runner timeout regression — 2026-09-07

The consumer proofs exposed that the browser runner ignored the configured operation timeout when
it connected the bridge. The red targeted test failed with:

```text
TN_PLAYTEST_OPERATION_TIMEOUT: Bridge operation 'describe' exceeded 5000ms.
```

`openPageAndConnectBridge` now forwards `config.timeoutMs` to `connectPlaytestBridge`. The green
targeted run was:

```text
pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts
Test Files  1 passed (1)
Tests  67 passed (67)
```

The package gates also passed sequentially: `@threenative/playtest` typecheck, build, orphan
cleanup, and strict publint.

## 9. Native host evidence — 2026-09-07

The native host gate ran in the engine worktree with V8 and Dawn WebGPU on Linux:

```text
pnpm native:build                         passed; V8 + Dawn configured and linked
SDL_AUDIODRIVER=dummy pnpm native:verify:desktop
desktop core gate passed: 300 frames, 1280x720, artifacts/desktop-core-2026-09-07.png
desktop physics actuation bindings proof passed
desktop physics playtest proof passed: 14 assertions
desktop physics query proof passed
native contract lane passed: 35 of 35 targets
desktop loading playtest proof passed: 913920 startup loading pixels, 0 settled loading pixels
```

The retained native artifacts are under `packages/runtime-native/artifacts/` in the verification
worktree and are ignored by the package boundary. This proves the desktop host and its loading
contract; it does not claim that the two sandbox games executed in the native host.

## 10. Sandbox native behavior evidence — bounded 2026-09-07

The Wildwood native desktop behavior-only probe ran for 600 frames against the built consumer
executable. It observed `movementDistance=26.4476 m`, `odometer=26.7 m`, `valleyReady=true`,
`animalClips=16`, `animalCues=39`, and `clipDrift=[]` on an NVIDIA RTX 2080 using Vulkan. This
supports native startup, movement, and animal animation state through the bridge. The observation
sampled zero draw calls and zero triangles and therefore does not prove rendered character output.

The focused migrated-character scenario then ran against a freshly bundled Wildwood executable
with the real desktop playtest runner and exited 0 (`pass=true`). The scenario starts one Fox in
idle, switches it to `ANIM_Fox_Run` at fixed tick 30, and keeps a second Fox in idle as the
independent rigid-pose control. The exact retained run was:

```sh
SDL_VIDEODRIVER=x11 node packages/playtest/dist/runner/cli.js \
  native-playtests/animal-skeletal.playtest.json --target desktop \
  --executable dist-native/wildwood-animal-proof --project . --no-screenshots \
  --artifacts artifacts/native-animal-proof-pass7 --timeout 30000
```

The report recorded an NVIDIA GeForce RTX 2080 with Vulkan, `ready=true`,
`skeletonsIndependent=true`, `animalA` moving `8.5 m`, and `animalA` changing to `ANIM_Fox_Run`
with `advancedFrames=102`, `strideSynced=true`, `footSlide≈0`, and measured
`maxDeviation=0.01752798798117833`. The idle control reached `advancedFrames=131`,
`rigid=true`, and `maxDeviation=0.005503705608925545`; runtime diagnostics were empty. The
retained artifact has `exit-code.txt=0`, the complete runner output in `run.log`, device response
observations with `drawCalls=0` and `triangles=0`, and no screenshot because the command uses
`--no-screenshots`. The running Fox's small residual deviation is authored root motion in the
source `Fox_.position` track; the scenario therefore checks its measured bound separately from
the idle rigid-pose control.

This bounded behavior probe does not claim native visual output. A separate UI-enabled desktop
attempt remains blocked by the existing compositor report of a 440x64 color attachment against a
1280x720 depth attachment; that invalid command buffer prevents the `uiReady` assertion and
screenshot. Android and iOS were not executed.

## 11. Current engine gates and checkpoint review — 2026-09-07

The current engine worktree gates completed with these exact summaries:

```text
pnpm typecheck                         exit 0; 28 workspaces
pnpm lint                              exit 0; 624 existing warnings
SDL_AUDIODRIVER=dummy pnpm test        exit 0; 396 files passed, 2 skipped; 4412 passed, 7 skipped
pnpm budgets                           exit 0
pnpm quality                           exit 0; 138 report findings
pnpm check:docs                        exit 0; 1554 relative links checked
pnpm sync:agents --check               exit 0; 19 CLAUDE.md mirrors
```

The full test run included the engine build, package checks, docs checks, golden-path checks, and
runtime-native lanes: 104 native files with 809 tests passed and 35 skipped, plus 29 JavaScript
parity checks and 14 Rust unit tests with 2 parity checks. The follow-up Astra review found no
new issue after the package refresh; the LOC ratchet and rendered native proof remain open. PRD-362 remains explicitly partial: its
focused starter checks are green, while the required qualified Android runs and acceptance remain
unverified.

## 12. Platform status

- **Browser:** Wildwood and HQ fixture lanes passed on NVIDIA Turing WebGPU. HQ live office was skipped because its bridge was unavailable.
- **Desktop native:** passed the build, 300-frame core capture, physics, lifecycle, contract, and loading gates above.
- **Native consumer behavior:** Wildwood bounded behavior probe passed; full native UI/visual proof is blocked by the compositor mismatch recorded above.
- **Android:** unverified for this change.
- **iOS simulator and physical devices:** unverified for this change.

Checkpoint review confirmed the delivery matches the PRD boundaries: the framework owns safe rig
instancing and measured preparation, game code still owns source repair, tint, movement, and
appearance, and both independent consumers instantiate the exported class from the staged package.
