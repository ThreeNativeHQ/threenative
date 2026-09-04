# PRD-324 — the second-consumer census, and the retraction of a wrong decline

**Date:** 2026-09-04. **Engine HEAD:** `1ea8caa9`. **Sandbox repository:** `../sandbox`, a separate
git repository holding one workspace per game.

**Outcome: the 2026-09-04 decline of Phases 3–7 is RETRACTED.** AC2 is met three times over. This
file replaces `docs/verification/PRD-324-phase3-second-consumer-check.md`, which reached the
opposite conclusion from a search whose scope was wrong.

---

## The census

Every workspace under `../sandbox` with its own `package.json` and a `src/`. Pieces are PRD-324's
own, from ledger rows 1–3 and 5. *Instances* means N objects built from one loaded rig.

| Piece | `wildwood` | `threenative-hq` | `fps-framework` | `ue-static-import` |
|---|---|---|---|---|
| Imports a rigged glTF | `Animal.ts:118` | `Office.ts:101-102` | `Enemy.ts` | `UnrealSkeletalProp.ts:82` |
| Skeleton-safe clone | `Animal.ts:8,129` | `Worker.ts:4,68` | `Enemy.ts:1072` | **no** — single instance |
| Instances many from one load | yes | `Worker` + `Visitor` | `Play.ts:421-424` loop | no |
| `normaliseToMetres` on the rig | `Animal.ts:167` | `Worker.ts:71` | `Enemy.ts:747`, `:962` | static model only |
| Skinned-bounds correction | `Animal.ts:158-167` | no | `Enemy.ts:1072-1204` | `:65` `frustumCulled=false` |
| `strideRoot` two-object structure | `Animal.ts:178-182` | `Worker.ts:88` | via `AnimationPlayer` | `:75-77` |
| Fail-closed clip audit | `Animal.ts:314` | `Office.ts:143-147` | — | — |
| Bone-length invariance | `Animal.ts:172` | no | no | no |
| Mirror reconciliation | core, Phase 2 | no | no | `UnrealSkeletalProp.ts:124` |

**Three consumers of the proposed surface**, in three separate workspaces. AC2 asks for two.

- **`threenative-hq` is the full match.** Every core piece, and it hand-wrote its own fail-closed
  clip audit — ledger row 3 — independently, with a comment naming the failure it prevents: *"A
  missing clip renders as a mannequin frozen in its bind pose, which looks exactly like a worker
  that is simply idle."*
- **`fps-framework` is a full consumer of the clone-and-measure half.** `Enemy.ts:1072` says it
  outright, and `Play.ts:421-424` clones per soldier because *"the class mutates scale and pose."*
- **`ue-static-import` is not a consumer of this surface** — one prop, no skinned clone, no rig
  normalisation. It is counted nowhere above as a third caller. It *is* a live second consumer of
  **Phase 2's shipped work**: `reconcileMirroredClips` at `UnrealSkeletalProp.ts:124`. That is
  worth its own line, because it is independent evidence that shipping Phase 2 without the
  abstraction was the right call.

Excluded: `prd259-bayview-current-20260830` is a dated snapshot of `fps-framework` — identical
`"name"` in `package.json` — so it is one consumer, not two. `fps-vanilla` is the
deliberately-unframeworked control arm.

### The convergence is a trap, not a preference

Two games independently wrote near-identical comments about the same `strideRoot` hazard:

> `wildwood/Animal.ts:178-179` — *"`strideRoot` is the group the AI actually moves: the mixer
> writes the clone, so measuring the clone would read the clip's own motion back as if the body
> had walked."*
>
> `threenative-hq/Worker.ts:40-44` — *"if the thing being moved is also the thing the mixer writes,
> the measurement reads the clip's own root motion back and the legs run at a speed nothing on
> screen is travelling at."*

Three games hitting the same four three.js traps, two of them documenting the same fix in their own
words, is the strongest argument in this PRD that the pieces are mechanism rather than taste.

## Why the decline was wrong

The decline was recorded confidently, and the reasoning inside it was sound. The **scope** was not.

`docs/PRDs/AGENTS.md` says to attempt a blocked reason before believing it, and the earlier record
opens by claiming to honour that: *"PRD-321's finding was not taken on trust. Re-run today."* It
then re-ran PRD-321's search — `packages/create-threenative/templates/*/src` and `examples/*/src` —
and never searched `../sandbox` at all, even while correctly noting that the sandbox is a separate
repository and that Wildwood lives there.

**Re-running a search inside an inherited boundary inherits the conclusion.** The commands were
new; the scope was PRD-321's, and the scope was where the answer lived. Checking the search's
*inputs* is part of not taking a finding on trust — a lesson that generalises past this PRD, and
the same shape as PRD-323's Phase 4, where a boundary was verified three times with an instrument
that could not see the dependency.

A second, smaller error compounded it: the earlier record's scoping note said a second
*wildwood-internal* caller would not satisfy AC2, which is true, and then treated the whole sandbox
as if it were Wildwood. It holds roughly thirty games.

### The PRD itself contains both scopes, and that is worth knowing

The narrow scope was not invented. **Ledger row 6 (`:208`) says the second consumer should be "a
template or example"** — exactly where the failed search looked. **AC2 (`:269`) says "two non-test
callers in different projects"**, and the PRD treats Wildwood, a sandbox game, as caller #1
throughout, so "different projects" plainly reaches the sandbox.

This does not excuse the miss: AC2 is the binding acceptance criterion, the two clauses contradict,
and the right move was to reconcile them rather than follow the narrower one silently. But a reader
deserves to know the contradiction is in the document, because the next executor inherits it.
**Reconciling row 6 to AC2 is filed work for whoever re-opens Phases 3–7.**

---

## What this does and does not change

**Unchanged — Phases 0–2 stand.** The pose defect that opened the PRD is fixed in the engine loader
(`reconcileMirroredClips`), with the bone-length instrument in `packages/core/src/bone-lengths.ts`.
That work never depended on a second consumer: a bug fix and an instrument are not an abstraction,
and AC0 and AC1 were met on 2026-09-02.

**Changed — Phases 3–7 are OPEN, not declined.** `SkeletalMesh3D`, the migration, the manifest
entry and native proof are real remaining work with three named consumers waiting for it.

**Still binding — the kill switch has not been satisfied, only unblocked.** PRD-324 requires
`count-loc.ts` to score the surface smaller than plain Three.js *at both call sites*. Three
consumers make that test possible; they do not pass it. A surface that fits an animal, an office
worker and a soldier only by deciding nothing is a lowest-common-denominator wrapper and is still
a decline — and the three differ in exactly the places rule 3 cares about: Wildwood measures
`axis: "longest"` against a species length, `threenative-hq` measures `axis: "height"` at a fixed
1.8 m, `fps-framework` measures height with an explicit `top:` crown. Whoever picks this up should
expect the *measurement* to be mechanism and every one of those parameters to stay in the game.

**Filing.** PRD-324 moves from `docs/PRDs/done/` to `docs/PRDs/authoring/`, beside PRD-315, which
its §7 names as the owning round. `docs/PRDs/AGENTS.md` forbids archiving a batch while a PRD in it
is partial; `batch-2026-09-01`'s other six PRDs are genuinely closed, so the batch stays archived
and its one open PRD leaves it.

---

## Method note

This census was produced by enumerating every workspace in `../sandbox` rather than by searching
for a name known in advance:

```sh
for d in */; do
  [ -f "$d/package.json" ] || continue
  grep -rl "SkeletonUtils"      "$d/src"
  grep -rl "normaliseToMetres"  "$d/src"
  grep -rl "AnimationPlayer"    "$d/src"
done
```

Five games matched, two were excluded for stated reasons, three counted. The exclusions matter as
much as the matches: a snapshot with the same `package.json` `"name"` is one consumer, not two, and
`ue-static-import` normalising a static model is not this surface at all.
