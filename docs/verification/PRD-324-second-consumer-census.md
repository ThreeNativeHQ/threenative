# PRD-324 — the second-consumer census, and the retraction of a wrong decline

**Date:** 2026-09-04. **Engine HEAD:** `1ea8caa9`. **Sandbox repository:** `../sandbox`, a separate
git repository holding one workspace per game.

**Outcome: the 2026-09-04 decline of Phases 3–7 is RETRACTED.** AC2 is met three times over. This
file replaces `docs/verification/PRD-324-phase3-second-consumer-check.md`, which reached the
opposite conclusion from a search whose scope was wrong.

---

## The census

Every workspace under `../sandbox` with its own `package.json` and a `src/`, grepped for the three
pieces `SkeletalMesh3D` was specified to own:

| Game | Skeleton-safe clone | Bind-pose normalisation | Clip playback | Counts? |
|---|---|---|---|---|
| `wildwood` | `src/entities/animals/Animal.ts:8` | `Animal.ts:167` | `AnimationPlayer` ×2 | **Yes** |
| `threenative-hq` | `src/office/Worker.ts:4`, `office/Visitor.ts:6` | `Worker.ts:71`, `Visitor.ts:76` | `Worker.ts:88`, with `strideRoot` | **Yes** |
| `fps-framework` | `src/entities/Enemy.ts:1072` | `Enemy.ts:747`, `:962`, `:972`, `Rifle.ts:96` | `AnimationPlayer` ×2 | **Yes** |
| `prd259-bayview-current-20260830` | `Enemy.ts` | `Enemy.ts:747` … | — | No — a dated snapshot of `fps-framework`, identical `"name"` in `package.json` |
| `ue-static-import` | none | 1 call | 1 | No — normalises a static model, no skinned clone |

**Three independent games**, in three separate workspaces, each hand-writing the same
clone → normalise → animate dance. PRD-324's AC2 asks for *two* non-test callers in different
projects.

`threenative-hq` is the cleanest match. Its `Office.ts:101-102` loads two rigged GLBs through
`ctx.assets.model` and its own comment at `:96-98` describes merging two libraries onto one
65-joint skeleton — *"checked here rather than assumed"* — which is exactly the kind of thing a
framework surface should be checking for the game.

---

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
