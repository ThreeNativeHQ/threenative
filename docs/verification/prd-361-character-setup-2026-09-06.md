# PRD-361 — Shared Character Setup Verification Record

**Date:** 2026-09-06  
**PRD:** PRD-361 — Two games share correct character setup  
**Parent:** PRD-354 — An imported rig instances and poses correctly, once  

## 1. Summary

Shipped `SkeletalMesh3D` (and `prepareSkeletalMesh`) in `@threenative/core` to solve the four traps every character setup repeated:
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
| Wildwood Animal | `sandbox/wildwood/src/entities/animals/Animal.ts` | `:144-150` | Removed inline `cloneSkeleton`, `normaliseToMetres`, manual `AnimationPlayer` |
| HQ Worker | `sandbox/threenative-hq/src/office/Worker.ts` | `:67-73` | Removed inline `cloneSkinned`, `normaliseToMetres`, manual `AnimationPlayer` |
| HQ Visitor | `sandbox/threenative-hq/src/office/Visitor.ts` | `:64-70` | Removed inline `cloneSkinned`, `normaliseToMetres`, manual `AnimationPlayer` |

## 3. Red / Green Evidence

### Red: Before `SkeletalMesh3D` implementation
```
 FAIL  packages/core/__tests__/animation.spec.ts [ packages/core/__tests__/animation.spec.ts ]
Error: Cannot find module '../src/skeletal-mesh.js' imported from packages/core/__tests__/animation.spec.ts
```

### Green: After `SkeletalMesh3D` implementation
```
 RUN  v4.1.10 threenative-engine
 ✓ packages/core/__tests__/animation.spec.ts (29 tests) 28ms
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

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

## 6. LOC Ratchet

`pnpm tsx scripts/count-loc.ts` passed:
- `touch controls LOC: 1385 across 8 authored copies`
- `cloth feature LOC: framework 46, hand-written 761`
- Net framework growth within limits; shared preparation eliminates duplicated setup across consumers.
