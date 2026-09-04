# PRD-324 Phase 3 — the second-consumer check, and the decline of Phases 3–7

**Date:** 2026-09-04. **Engine HEAD:** `55fbd74b`. **Wildwood HEAD:** `d535f51`.

> **SUPERSEDED AND RETRACTED, 2026-09-04 — this record's conclusion is wrong.** It declined
> Phases 3–7 for want of a second consumer. Three exist: `wildwood`, `threenative-hq` and
> `fps-framework`, each its own workspace in `../sandbox`, each hand-writing the same
> clone → normalise → animate dance. The error is in §"The search": it re-ran PRD-321's search
> **with PRD-321's scope** — templates and examples — and never searched the sandbox repository,
> while elsewhere correctly noting that the sandbox is separate and that Wildwood lives there.
> Re-running a search inside an inherited boundary inherits the conclusion. Kept rather than
> deleted, because the reasoning is sound and only the scope was wrong, which is the more useful
> thing to be able to read back. Replacement:
> [`PRD-324-second-consumer-census.md`](PRD-324-second-consumer-census.md).

**Outcome (as recorded, and wrong): Phases 0–2 stand as DONE and shipped. Phases 3–7 close as
DECLINED**, on AC2 and on Phase 0's decline check. No product code was written for them.

---

## What the PRD requires before Phase 3

> **Phase 0 — the decline check.** Name the second consumer and confirm it needs the same pieces.
> … Not smaller across two real consumers → this PRD closes as DECLINED.

> **AC2 — two real consumers.** At final review the surface has two non-test callers in different
> projects and `count-loc.ts` scores it smaller than plain Three.js at both. **One consumer fails
> this PRD.**

> Ledger row 6 — *A second, unrelated consumer* … **Rejects a one-consumer abstraction. Only one
> caller at final review fails this PRD.**

Three statements of the same gate, in the strongest terms the document uses.

---

## The search, run fresh rather than inherited

`docs/PRDs/AGENTS.md` says to attempt a blocked reason before believing it, so PRD-321's finding
was not taken on trust. Re-run today:

```
$ grep -rln "SkeletonUtils\|SkinnedMesh" packages/create-threenative/templates/*/src examples/*/src
examples/prd140-picking/src/game.ts
examples/prd314-clip-audit/src/rig.ts

$ grep -rln "AnimationPlayer" packages/create-threenative/templates/*/src examples/*/src
examples/fps-friction/src/scenes/Range.ts
examples/prd314-clip-audit/src/game.ts
```

Four hits, and **not one of them is an imported rig**:

| Candidate | What it actually does | Needs `SkeletalMesh3D`? |
|---|---|---|
| `examples/prd140-picking/src/game.ts:174` | `new SkinnedMesh(skinGeometry, new MeshBasicMaterial())` — a skinned mesh built by hand so raycasting has `skinIndex`/`skinWeight` to read | No. Nothing is loaded, cloned, normalised or posed from a file |
| `examples/prd314-clip-audit/src/rig.ts` | Constructs a rig from `Bone`, `Skeleton`, `CylinderGeometry` and hand-written `QuaternionKeyframeTrack`s | No. A diagnostic fixture, and a deliberately synthetic one |
| `examples/fps-friction/src/scenes/Range.ts:151,171` | `new AnimationPlayer({ clips: [deathClip()], root: enemyProxy })` — a hand-authored clip on a proxy object | No. No skeleton, no import |
| `examples/prd314-clip-audit/src/game.ts` | Drives the fixture above | No |

**No template and no example imports a rigged glTF, clones a skeleton, normalises a bind pose, or
measures anatomical forward.** Ten shipped templates, sixteen example workspaces, zero consumers.
`sandbox/wildwood` remains the only one — the same result PRD-321 recorded on 2026-09-02, confirmed
independently two days later.

---

## Why that closes Phases 3–7 rather than deferring them

The kill switch says one consumer is not an abstraction, and this PRD says so three separate
times. Building `SkeletalMesh3D` for a single caller would put a surface in `packages/core` whose
shape is decided entirely by one game's needs, which is the failure mode
`scripts/count-loc.ts` exists to score out afterwards and the Phase 0 check exists to prevent
beforehand.

The batch README names this outcome directly: *"That outcome is a success for this batch, not a
failure — it is the kill switch working before the code lands."*

Nothing here is a judgement that the pieces are wrong. They are the right pieces; there is one
game that needs them. **If a second game needs them, re-file with that consumer named** — Phases
0–2's evidence and the surface sketch in §5 are still good starting material.

---

## What Phases 0–2 already shipped, and keeps

The valuable half of this PRD landed on 2026-09-02 and is untouched by this decline. It did not
need a second consumer, because it is a **bug fix and an instrument**, not an abstraction:

| Landed | Where |
|---|---|
| The pose fix — clips z-mirrored against their own bind | `reconcileMirroredClips`, exported from `@threenative/core` (`packages/core/src/index.ts:731`) |
| The bone-length invariance instrument | `boneLengths`, `boneLengthDeviations` (`packages/core/src/bone-lengths.ts:82,98`), fail-closed on a bad tolerance or a bone that left the root |
| The framed harness view, validated against `?corruptAnimalForward=fox` | Wildwood |
| Evidence | `docs/verification/PRD-324-phase1-phase2.md` |

That is the answer to the defect that opened the PRD: every animated animal in Wildwood rendered
with its skeleton folded, and it now does not. AC0 and AC1 were met there.

---

## Acceptance criteria, final state

- [x] **AC0 — the instrument comes first.** Met in Phase 1. `boneLengths` /
      `boneLengthDeviations` name a bone numerically; the harness view was proven against the
      `?corruptAnimalForward=fox` negative control.
- [x] **AC1 — the deformation is fixed, red-green.** Met in Phase 2 (`reconcileMirroredClips`).
- [ ] **AC2 — two real consumers.** **Not met, and not meetable today.** One consumer. This is the
      criterion that declines Phases 3–7.
- [ ] **AC3 — the audit fails closed.** Not built (Phase 3).
- [ ] **AC4 — measurement is skin-aware.** Not built (Phase 3).
- [ ] **AC5 — Wildwood has no copy left.** Not done (Phase 4); Wildwood keeps its own code,
      which is the correct state for a one-consumer feature.
- [ ] **AC6 — findable.** Not applicable; no new surface was added.
- [ ] **AC7 — native.** Not applicable; no new surface was added. `reconcileMirroredClips` and the
      bone-length instrument are portable core code with no platform seam.

## Open question §9, answered

The PRD asked three questions for its executor. Two are now moot and one has an answer worth
keeping:

1. *Class or free functions?* Moot — no surface was built.
2. *Where does the Phase 2 fix belong?* **Answered in Phase 2: the engine loader.** It went into
   `@threenative/core`, not the game and not the external importer, so no re-import was needed.
3. *Should the clip audit run in production?* Moot — not built. The reasoning stands for whoever
   re-files: load-time either way.
