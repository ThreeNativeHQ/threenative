# PRD-324 Phases 1–2 — the instrument, and the pose defect it named

**Date:** 2026-09-02 (night lane, worktree `.claude/worktrees/prd324-pose-bug`, branch
`prd324-pose-bug`). Game-side lane: `sandbox` repo, branch `main`, wildwood commits `42d8021`
and the tool commit. **Result: the defect is found, fixed in the engine loader, and proven
red-green on all six animals in the real game path.**

## Phase 1 — the instrument

### Shipped in core

- `boneLengths(root)` / `boneLengthDeviations(root, baseline)` — parent→child world distances per
  bone, compared against a captured snapshot, worst first. Unit spec
  `packages/core/__tests__/bone-lengths.spec.ts` — **red first** (`Failed to resolve import
  "../src/bone-lengths.js"`, `Test Files 1 failed`), then **green: 7 passed (7)**. Controls: a
  rigid pose reads rigid at any rotation; a uniform ancestor scale cancels; a clip that scales one
  bone mid-pose names that bone (`head`, ratio 1.5); structural mismatch and bone-free roots throw.
- Wildwood harness (`sandbox/wildwood`): `?only=<id>` spawns one animal at the origin with the
  camera framed on it (sized off its measured metre length); `?roam=0` pins the roster in place
  while the state machine keeps playing. Live report every 0.25 s: bone-length deviations against
  the bind baseline (`TN_BONE_REPORT` once, `window.__TN_BONE_LENGTHS__` for playtests) plus the
  head-minus-pelvis forward probe (`forwardZ`: +1 facing the movement axis, −1 backwards).
- `Animal` captures `bindBoneLengths` after `normaliseToMetres` and before the first clip plays.

### View validated against the negative control

`?corruptAnimalForward=fox` on the then-broken build flipped the probe: `forwardZ −1 → +1`
(uncorrupted fox anatomy points backwards; the corruption yaws it "forward" again). Screenshots:
`wildwood/artifacts/animals/pose-probe/view-*.png`, single framed animal, WebGPU headed under the
capture lock.

### What PRD-314's tools could and could not answer

`clipTrackBindings`/`clipBoneCoverage` were used (Wildwood's `Animal.audit()` prints them every
harness run; the scan prints coverage per clip): **30/30 bound, 0 undriven on every walk clip** —
they answer "does the track bind / does the bone get driven", and both read healthy. They cannot
answer "is the driven pose the one the file means". `clipPoseError` needs a **reference rig/clip
pair**; the Wildwood pack has none — the clip is the only ground truth — so a subject-vs-reference
comparison has nothing to compare against. `boneContact` measures bone-to-object distance; no
contact question exists here. The instrument that does answer it is self-referential: bone-length
invariance (rigidity) and the rig's own bind as the rotation reference. `tools/scan-bone-lengths.ts`
implements both, on the real pack, in Node.

## Phase 2 — the defect, named in numbers

### Red (all six species, broken build)

`node tools/scan-bone-lengths.ts` — raw `AnimationMixer` on the pristine served GLB vs the real
`Animal` game path (clone + strip + normalise + `AnimationPlayer` with `strideRoot`):

| id | raw bindFwdZ | raw walkFwdZ | gamePath walkFwdZ |
|---|---|---|---|
| fox | +1 | −1 | −1 |
| wolf | +1 | −0.9999 | −0.9999 |
| stag | +1 | −1 | −1 |
| doe | +1 | −1 | −1 |
| pig | +1 | −1 | −1 |
| crow | +1 | −0.994..−1 | −1 |

**Raw ≡ game path on every species: the application path (clone, strip, scale, `AnimationPlayer`,
`strideRoot` — hypotheses 1 and 3) is exonerated.** The browser agreed: the live harness reported
`forwardZ = −1` for every uncorrupted animal while the walk clip played. Bone lengths stayed
~rigid everywhere (worst: crow `WingRightF` 90%, stag `R-Thigh` 7%) — the fold is not a length
change, so the length scan alone could not name it; the forward probe and per-bone rotation deltas
did.

### Isolation

`tools/chain-probe.ts` on `ANIM_Fox_Walk`, head ancestor chain, bind vs mid-walk:

```
SK_Root(Group)   worldDelta=0.0   localDelta=0.0
root(Bone)       worldDelta=0.0   localDelta=0.0
Fox_(Bone)       worldDelta=180.0 localDelta=180.0
Fox_-Pelvis      worldDelta=180.0 localDelta=180.0
Fox_-Spine       worldDelta=179.9 localDelta=10.0   (child inherits the flip)
Fox_-Head        worldDelta=30.9  localDelta=120.3  (the head tries to look forward)
```

`tools/side-probe.ts` raw world positions, bind vs walk: pelvis z −0.162 → +0.162 (mirrored),
spine offset +0.072z → −0.072z (mirrored), **left/right x-signs preserved** (`L-Thigh` +0.0546 in
both). Not a yaw: a **Z-mirror**. Every translation track is `(x, y, −z)` against the bind and
every quaternion track is `(−x, −y, z, w)` — the conjugation of the same mirror. This is exactly
the transform D1 measured on the root bone; D1 failed because it applied it to root tracks only,
and it is needed on **every track**. The file's bind was converted at export; its clips were not.

### Correction variants, measured (`--correct`, fox mid-walk)

| variant | fwd | pelvisOffset | sides | verdict |
|---|---|---|---|---|
| none (broken) | −1 | 0.324 | 18/18 | the defect |
| quatConj at root (D1's) | −1 | 0.324 | 18/18 | reproduces D1's null result |
| zPos (positions only, all bones) | −1 | 0.006 | 18/18 | quats needed too |
| zConjAll (quats only, all bones) | +1 | 0.324 | 18/18 | positions needed too |
| **zBothAll (both, all bones)** | **+1** | **0.006** | **18/18** | **the fix** |
| zBothBreak (both, break bone only) | +1 | 0.006 | 0/18 | insufficient |
| yaw-family variants | mixed | mixed | ≤11/18 | wrong transform |

### The fix (engine)

`packages/core/src/assets.ts::reconcileMirroredClips` — votes per tracked bone on the translation
signature (clip translation Z negated against the bone's bind local Z; ≥4 voting bones, ≥80%),
and only on that overwhelming vote converts every track in every clip: positions negate Z,
quaternions negate X and Y. Wired into the model load next to `widenQuantizedPositions`, logging
`TN_ASSETS_MIRRORED_CLIPS_REPAIRED <path>` when it fires; anything else is left byte-identical.
Unit spec `packages/core/__tests__/mirrored-clips.spec.ts` — **red first** (5 failed), then
**green: 5 passed**; controls: healthy files untouched byte-for-byte, one vote cannot carry it,
bone-free rigs fail closed, repaired clip plays with head in front of pelvis and left still left.

**Mutation (AC1):** revert the `reconcileMirroredClips` call at the `model()` load path
(`packages/core/src/assets.ts`, the `model:` entry next to `widenQuantizedPositions`) and every
green number below returns to its red. The red is the pre-fix record above (browser `forwardZ −1`,
scan `raw walkFwdZ −1`), captured on the same harness before the fix landed.

### Green (all six species, real game path, fresh dev server, headed WebGPU capture lane)

`POSE_PROBE_BASE=http://127.0.0.1:5275/dev-animals.html node tools/pose-probe.mjs …`:

| query | forwardZ | TN_ASSETS_MIRRORED_CLIPS_REPAIRED |
|---|---|---|
| only=fox&roam=0 | **+1** | yes |
| only=fox&roam=0&corruptAnimalForward=fox | **−1** (control flips a healthy rig) | yes |
| only=stag | **+1** | yes |
| only=doe | **+1** | yes |
| only=wolf | **+0.99998** | yes |
| only=pig | **+1** | yes |
| only=crow | **+0.999997** | yes |

Captures `wildwood/artifacts/animals/pose-probe/view-0..6.png`: fox and stag walk with spine
level, head forward, legs planted; the corrupted-fox capture faces the opposite way. Engine unit
suites: **962/962 core tests green** (`pnpm vitest run packages/core`).

### Residual findings (open, not the fold)

- Crow `WingRightF`: bind length 0.198 m → 0.019 m posed, constant across the walk clip. The wing
  bone's translation track collapses it tenfold. Possibly authored wing-folding via translation;
  unexamined.
- Small length deviations persist (fox root 1.4%, stag `R-Thigh` up to 7%): authored non-rigidity
  or quantisation noise; visually invisible in the captures. The instrument reports them honestly
  rather than hiding them.

## Gates

- `pnpm lint` — **PASS**.
- `pnpm vitest run packages/core` — **95 files, 962 tests, all passed.**
- `pnpm typecheck` — **red on a pre-existing base failure**: `game-pixel-ratio.spec.ts(62,24)`
  (`void` vs `Promise<void>`), a file untouched by this branch's diff (`git diff --name-only HEAD`
  names only the two changed files); it predates this lane (commit `fb1b34be`'s file, mtime at
  checkout).
- `pnpm test` — **blocked at `check:docs` before vitest runs**: `docs/verification/prd-249-fluid-field-2026-08-29.md`
  links `assets/prd-249-fluid-field/{smoke,fire}.png` which were never committed (commit
  `fae18b28`, pre-existing). Not this branch's diff.

## Lane hygiene notes

The fix's in-browser verification initially read stale (forwardZ −1, no repair line) twice:
the running vite server prebundled the old `@threenative/core` tarball, and mid-run another
lane's dev server took port 5173. Verified installed bytes, killed by port, cleared
`node_modules/.vite`, and ran on a dedicated port (5275) before trusting the green above.
