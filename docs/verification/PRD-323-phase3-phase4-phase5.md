# PRD-323 Phases 3, 4 and 5 — the deletion, the untracking, and the line cap

**Date:** 2026-09-04. **Branch:** `batch/2026-09-01-close-out`. **Owner checkpoint:** given for
Phases 3 and 4 (both move tracked bytes) and for Phase 5's scope.

Phases 0, 1, 2 and 6 landed on 2026-09-02. This record closes the three that remained.

---

## The red that forced the issue

The budget gate went red on its own, unprompted, at the commit before this one — a single new
evidence file (`PRD-322-phase0-boundary-audit.md`) crossed the 800-file cap:

```
$ npx tsx scripts/check-evidence-budget.ts ; echo "exit=$?"
evidence docs/verification: 801 tracked file(s), 77.7 MB
evidence docs/benchmark: 5362 tracked file(s), 203.3 MB
evidence tree 'docs/verification' tracks 801 file(s), over the 800 cap
exit=1
```

That is AC2 — "a new bloat commit fails" — observed in the wild rather than staged, and the gate's
own comment names the remedy: *"Tightening them is Phase 3's job, by deletion … do not raise the
cap."*

---

## Three scanner defects found by trying to use it

The citation scan was built in Phase 1 and never used to delete anything. Deleting with it exposed
three ways a by-name scan condemns a live artifact. **All three were fixed in the scanner rather
than worked around in the delete list**, because a hand-maintained exception list is the thing this
repository has repeatedly learned drifts.

They share one root cause, which is the finding worth carrying forward: **a citation scan sees the
sources that *name* a file, and a script that opens a directory names nothing.** Every defect below
is an instance of that, and the third was found only because a test failed — which is why the
enumeration at the end of this section matters more than the three fixes.

### Defect 1 — a tree a script opens as a *directory root*

Two entries in the first delete list read wrong:

```
docs/verification/visuals/shooter.png
docs/benchmark/genres/exploration/proof/exploration.playtest.json
```

`scripts/visual-gate.ts:124` and `scripts/template-baseline.ts:36` open
`docs/verification/visuals` as a directory root and resolve what is inside at run time.
`scripts/exposure-ab.ts` does the same with `docs/verification/exposure-ab-2026-08-30`, and
`scripts/__tests__/sealed-proof-tokens.spec.ts:30` with `docs/benchmark/genres`. No source ever
names those files, so a by-name scan calls every one `uncited` — and deleting them would have
destroyed every visual baseline `pnpm visuals` compares against while the gate went green on the
reclaimed bytes.

Fixed by `SCRIPT_WALKED_ROOTS` in `scripts/evidence-citations.ts`, which names each root and the
reader that walks it. A root is admitted only for a real script, never for a spec working inside a
temporary directory.

**Rescued 40 artifacts, 12.4 MB.** Uncited fell 1,023 → 983 before a byte moved.

### Defect 2 — a write-up's own attachments, found the loud way

This one was not caught by reading. The first deletion ran, and `pnpm check:docs` went red with
**42 broken links across six write-ups**:

```
docs/verification/prd-316-closeout-2026-09-01.md -> assets/prd-316-vfx-gallery/page-1.png
docs/verification/prd-032-rerun-2026-08-30.md -> prd-032-rerun-2026-08-30/brief.txt
docs/verification/capability-discovery-baseline.md -> capability-discovery-baseline-run-1.jsonl
…
```

`citationSources` excludes evidence files from being citation sources — correctly, since a
write-up's prose mentioning another run is not a reason to keep that run's bytes forever. But a
report's own attachments are named *only* by a relative link from the report, so the exclusion
condemned them and the deletion left six live documents pointing at nothing.

Fixed by `linkCitations`: a second pass that reads the evidence `.md` files the first pass skips
and takes **only their Markdown links**, resolved relative to the linking file. Prose mentions
still do not count — that is the negative control in the spec, and loosening it would restore the
keep-everything state PRD-323 exists to end.

**Rescued a further 50 artifacts, 13.0 MB.** Every deleted file was restored, the scanner fixed,
and the deletion re-run from scratch.

### Defect 3 — a glob with a filename pattern, found by a failing test

The second deletion passed `check:docs`. The **root test suite** then failed:

```
FAIL  scripts/__tests__/sweep-delta.spec.ts > matches the committed delta record to recomputed archives
Error: Cannot compare '…/docs/benchmark/sweeps/platformer-2026-08-05-2':
       missing verification ledger for the archive.
  ❯ readSweepLedger scripts/sweep-delta.ts:109:11
```

`ledgerFiles` at `scripts/sweep-delta.ts:90` reads every `sweep-*.md` **directly under
`docs/verification`** and matches each one's `Archive:` field against the archive being compared.
Same root cause as defect 1, but the root is `docs/verification` itself — so an entry naming only
the root would have exempted the whole tree and gutted the policy.

Fixed by giving `SCRIPT_WALKED_ROOTS` an optional `basenamePrefix`/`basenameSuffix`, so an entry
claims exactly the reader's own glob and nothing else. Its spec asserts both halves: the
`sweep-*.md` ledger is cited, and a sibling `.md` in the same directory stays `uncited` and
deletable.

### The enumeration, done properly

Three defects of the same shape, each found by a different gate, is a bad way to find the fourth.
So the walkers were enumerated rather than discovered — every script that both walks a directory
and touches an evidence tree. Two more turned up:

- **`scripts/round-ledger.ts`** globs `round-*.md` here and parses each one; the self-improvement
  loop resumes from them. Added to `SCRIPT_WALKED_ROOTS` with its pattern.
- **`scripts/alpha-bar.ts`** opens `docs/verification` and reads **every** `.md`, acting only on
  the ones carrying an `alpha-bar` block. It is deliberately **not** in the list: the dependency
  is on content, not on a path shape, and an entry would exempt every Markdown file in the tree.
  AC3 guards it instead — `pnpm alpha:bar` must print byte-identical output either side of any
  deletion, which catches a removed block directly rather than by proxy. That reasoning is
  recorded beside the list so the omission reads as a decision rather than an oversight.

### Reds, observed

Three mutations, each failing exactly the spec it should and leaving its negative control green.

Root rule disabled (`files.add(walker)` removed):

```
× should classify a tree a script opens as a directory root as cited by that reader
  AssertionError: expected 'uncited' to be 'cited-by-script'
× should leave an artifact outside every walked root uncited
  AssertionError: expected 'uncited' to be 'cited-by-script'
  Tests  2 failed | 3 passed (5)
```

Link rule disabled (`for (const linker of links.get(artifact) ?? []) files.add(linker);` removed):

```
× should classify an artifact a sibling evidence write-up links to as cited
  AssertionError: expected 'uncited' not to be 'uncited'
✓ should leave an artifact only mentioned in evidence prose uncited
  Tests  1 failed | 6 passed (7)
```

Line cap disabled (`if (lines > lineCap)` → `if (false && lines > lineCap)`):

```
× should fail an evidence file over the line cap
✓ should not apply the line cap to an exempt file
  Tests  1 failed | 4 passed (5)
```

All restored: `evidence-citations.spec.ts` 8 passed, `evidence-budget.spec.ts` 5 passed.

The pattern rule has its own spec and its own negative control
(`should claim only the reader's own glob when a walked root names a basename pattern`), which
fails if an entry over-claims the tree it sits in.

---

## Phase 4 — `docs/benchmark/sweeps` leaves the grep path

Run before Phase 3, because 771 of the uncited artifacts were inside this tree and deleting them
individually would have double-counted work the untracking does wholesale.

`git rm -r --cached docs/benchmark/sweeps` — **5,292 files untracked, 199 MB, still on disk.**

Every reader resolves this tree through the filesystem, never through git, so nothing broke:
`sweep-archive.ts:219`, `make-sandbox.ts:309-314`, `sweep-capture`, `sweep-judge`, `sweep-pair`.
`check-doc-links.ts:265` had already been filtering the tree out by hand, which is its own
evidence that it was noise.

`.gitignore` replaces four piecemeal subpath ignores with one whole-tree rule, keeping the reasons
the old entries recorded (third-party pack terms on `*/vendor/` and `*/assets/`, ~8 MB gzipped
transcripts carrying absolute machine paths). Root `AGENTS.md` gains the rule beside the existing
`.worktrees/` one.

**Ledger row 4 needed less than it claimed.** `scripts/arm-census.ts` does not reference the sweep
tree at all — `grep -n "sweep" scripts/arm-census.ts` returns nothing — and
`docs/benchmark/PROTOCOL.md` documents the `sweep:*` commands, not the archive location. No path
update was required in either.

### AC4 — the grep measurement

| | Before | After |
|---|---:|---:|
| Tracked `.ts` files under `docs/` | **2,965** | **2** |
| Tracked files, whole repository | **9,070** | **3,623** |
| Files crossed by `git grep -l renderer -- 'docs/**'` | **1,199** | **251** |

A repo-wide grep under `docs/` now crosses 79% fewer files, and the 2,963 generated arm sources
every agent's search used to walk are gone from the index.

---

## Phase 3 — deletion by citation, with the owner's checkpoint

After Phase 4 and both scanner fixes, the uncited set was **155 artifacts, 12.7 MB**.

Removed with `git rm --pathspec-from-file`, reading an explicit list the corrected scanner
generated. **No path was built from a shell variable and no `rm` ran against a generated path**
(AC11); every deletion is an explicit tracked path in this commit's diff.

```
$ npx tsx scripts/check-evidence-budget.ts ; echo "exit=$?"
evidence docs/verification: 661 tracked file(s), 65.9 MB
evidence docs/benchmark: 55 tracked file(s), 17.5 MB
evidence budget: ok
exit=0

$ pnpm check:docs
Checked 1376 relative documentation links across 911 Markdown files.
```

Zero broken links after the re-run — the check that caught defect 2 is the check that clears it.

### AC3 — the self-improvement loop is unharmed

All three commands captured before the first deletion and after the last:

```
round-next:      IDENTICAL
round-deletions: IDENTICAL
alpha-bar:       IDENTICAL
```

`diff -q` clean on all three. Two of them exit non-zero at baseline and still do, for reasons this
PRD did not touch and did not fix: `round:deletions` throws on a malformed round-13 archive name
(`Round 13 names missing archive '… unmeasured — no build ran this round'`), and `alpha:bar` fails
A1 because three publishable packages are absent from the registry. AC3 asks for identical output,
not for a green exit; both were red before and are red in exactly the same way after.

### A cascade the single-pass scan does not close

Eighteen artifacts are uncited *after* the deletion that were cited before it, seven of them the
`prd-222-resume` device evidence whose only citer,
`docs/verification/prd-222-return-from-background-2026-08-25.md`, was itself uncited and was
deleted.

**They were kept.** Deleting cascade-orphans in the same pass that removed their citer is how
evidence gets lost silently: the classification that condemns them is a consequence of this
commit, not an independent judgement about them. The generated index reports all 18, so the next
retention pass sees them with fresh eyes and the owner decides then.

Recorded rather than papered over: **classification is single-pass, so a deletion can orphan
artifacts that were cited when the scan ran.** Running the scan to a fixed point would close it.
That is not done here.

---

## Phase 5 — the rule and the line cap, not a consolidation of `PRD-251-phase0.md`

Phase 5 proposed consolidating the 4,050-line `docs/verification/PRD-251-phase0.md`. **Its own
gate forbids it**, and that gate is why the phase is written the way it is: *"Every result cited
from `PRD-251-phase0.md` by a round ledger must still resolve afterwards — that grep is the gate."*

The file is 128 lines of evidence and **3,922 lines of third-party source** pinned from
`imsarah/threejs-world@398320e9` under MIT — `README.md`, `Heightfield.ts`, `TerrainTiles.ts`,
`MacroMap.ts`, five GPU passes, `WorldConst.ts` and the licence. PRD-251 is at **PHASE 1 COMPLETE
with phases 2–6 unexecuted**, and its §5 borrow map addresses line ranges *into* that dump
(`Heightfield.ts:49-194,197-271`, `TerrainTiles.ts:55-493`, `Scatter.ts:1-841`, …) under the
sentence *"the complete files are preserved in the Phase 0 verification record."* Upstream is a
third-party repository; this snapshot is the only copy under this repository's control.

Consolidating it would break a live PRD's borrow map to reclaim lines that are not narrative in
the first place. So Phase 5 lands its **general** deliverable instead:

1. **The rule**, in `docs/PRDs/AGENTS.md` (AC8) — the live → cited → deleted lifecycle, citation
   rather than age as the test, the directory-root caveat, the three caps, the owner checkpoint
   and the byte-identical round-loop requirement. The `runtime-perf-state.md` exception is
   rewritten as *one case of* the rule rather than a one-off. Mirror regenerated by
   `pnpm sync:agents`.
2. **The cap**, in `scripts/check-evidence-budget.ts` — `EVIDENCE_LINE_CAP = 1000`, with the
   third-largest evidence file at 910 lines, so it is a growth stop that is green today rather
   than a reclamation target.
3. **Two exemptions**, each carrying its reason in the code beside it: `PRD-251-phase0.md` (a
   pinned third-party source snapshot a live PRD addresses) and `runtime-perf-state.md` (capping
   the file the consolidation policy consolidates *into* would invert the policy).

---

## AC9 — the numbers moved

| | Phase 0 (2026-09-01/02) | Now (2026-09-04) |
|---|---:|---:|
| `docs/` on disk | 289 MB → 369 MB by 09-02 | **293 MB** |
| Tracked bytes, `docs/benchmark` | 203.3 MB | **17.5 MB** |
| Tracked files, `docs/benchmark` | 5,362 | **55** |
| Tracked bytes, `docs/verification` | 77.7 MB | **65.9 MB** |
| Tracked files, `docs/verification` | 801 | **661** |
| Tracked `.ts` under `docs/` | 2,965 | **2** |
| Tracked files, whole repository | 9,070 | **3,623** |
| Uncited artifacts | 1,023 | **18** |

**Tracked evidence fell from 281.0 MB to 83.4 MB — a 70% reduction — across 6,163 → 716 files.**

Stated plainly, per AC9's instruction to report a shortfall as such: **`du -sh docs` fell 369 MB →
293 MB, a 21% reduction — far less than the tracked figure**, because Phase 4 untracks the sweep
archive rather than deleting it and its 199 MB stays on disk. What fell hard is what git carries
and what a grep crosses. Packed history is unchanged for the same reason, and Phase 6 already
declined the rewrite that would reclaim it (194.01 MiB measured, declined 2026-09-02).

The reclaimed byte figure is also **smaller than the first pass claimed**, and deliberately: the
two scanner fixes put 97 artifacts and 25.4 MB back that a by-name scan had condemned. A larger
number here would have meant deleted visual baselines and six documents with broken links.

---

## Acceptance criteria

- [x] **AC1 — the gate was red first.** Observed 2026-09-02 at a tight cap; and again unprompted
      here at 801/800 files, pasted above.
- [x] **AC2 — a new bloat commit fails.** Demonstrated in the wild: one added evidence file
      crossed the cap and failed the gate, naming the tree.
- [x] **AC3 — the self-improvement loop is unharmed.** `round:next`, `round:deletions`,
      `alpha:bar` byte-identical before and after.
- [x] **AC4 — an agent's repo-wide grep no longer crosses generated sweep sources.** 1,199 → 251
      files; tracked `.ts` under `docs/` 2,965 → 2.
- [x] **AC5 — every cited result still resolves.** `pnpm check:docs` green: 1,376 relative links
      across 911 Markdown files, zero broken. This is the criterion that caught defect 2.
- [x] **AC6 — classification fails closed.** Unchanged from Phase 1 and still covered:
      `should throw when a citation source is unreadable rather than defaulting`. The new link
      pass defers to that check rather than throwing a competing message for the same file.
- [x] **AC7 — the index is generated, not maintained.** `--check` in `pnpm budgets`; hand-edit red
      observed in Phase 2.
- [x] **AC8 — the rule is written where filing decisions are made.** `docs/PRDs/AGENTS.md`, mirror
      regenerated.
- [x] **AC9 — the numbers moved.** Table above, with the `du -sh docs` shortfall stated as such.
- [x] **AC10 — the history decision is recorded.** Declined 2026-09-02 on 194.01 MiB measured;
      unchanged, and Phase 4's untracking does not alter it.
- [x] **AC11 — no `rm` in a generated path.** `git rm --pathspec-from-file` against an explicit
      scanner-generated list; every deletion is a tracked path in the diff.
- [x] **AC12 — gates.** `pnpm lint` 0 errors / 575 warnings, `pnpm typecheck` exit 0,
      `pnpm budgets` exit 0, `pnpm sync:agents --check` exit 0, `pnpm check:docs` 1,376 links
      across 911 files, root suite **379 files / 3,990 tests passed, 0 failed**. Full output in
      the commit body.

## Known limitations

- Classification is **single-pass**; a deletion can orphan artifacts that were cited when the scan
  ran. Eighteen such artifacts exist now and the index names them. Running the scan to a fixed
  point would close this and is not done here.
- `SCRIPT_WALKED_ROOTS` is a hand-maintained list. Nothing detects a *new* script that opens an
  evidence tree as a root, so adding one without adding its entry re-opens defects 1 and 3. The
  walkers were enumerated by hand here; a gate that keeps the list honest is **not** written, and
  it is the obvious next piece of work on this scanner.
- `scripts/alpha-bar.ts` reads every `.md` under `docs/verification` and is not in that list, by
  the reasoning recorded beside it. AC3's byte-identical check is the only thing standing between
  a deletion and a silently changed alpha bar.
- An artifact linked from an evidence write-up classifies `cited-by-script`, which is the closest
  existing class rather than an accurate one. Its `citedBy` list names the real linking document,
  so the index tells the truth even though the class label is approximate.
- `du -sh docs` fell only 21%. Only tracked bytes fell hard.
