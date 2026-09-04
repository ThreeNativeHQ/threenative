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

## Six defects found by trying to use it, two of them by review

The count kept going up, and that is the finding. Every one is the same mistake in a different
place: **a citation scan sees the sources that *name* a file, and a script that opens a directory
names nothing.** Three were found by using the scanner, a fourth by CI, and two more by an
adversarial review that ran probes rather than reading — including one where a comment in this
very commit asserted something demonstrably false.

## The first four, found by trying to use it

The citation scan was built in Phase 1 and never used to delete anything. Deleting with it exposed
three ways a by-name scan condemns a live artifact — and Phase 4 exposed a fourth, in the
assumption that an evidence tree is either documentation or build output. It was both. **All three were fixed in the scanner rather
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

## Phase 4 — the generated arm sources leave the grep path; the measurements stay

### Defect 4 — untracking the whole tree, caught only by CI

The first attempt ran `git rm -r --cached docs/benchmark/sweeps`: 5,292 files, 199 MB. Every
local gate passed, because the archives were still on this machine's disk. **CI failed three
suites**, because they were not on its:

```
FAIL scripts/__tests__/sweep-ledger.spec.ts > should validate both recorded sweeps and match their archived measurements
Error: sweep-endless-runner-2026-08-05.md: live ledger requires committed proof.json:
       ENOENT ... docs/benchmark/sweeps/endless-runner-2026-08-05/proof.json
FAIL scripts/__tests__/sweep-delta.spec.ts > matches the committed delta record to recomputed archives
FAIL packages/playtest/__tests__/capture.spec.ts > a real archived frame remains accepted by the package guard
```

The word **committed** is in two of those three test names. A sweep archive is not build output;
it is *half* build output. The measurements are the benchmark record and the suite asserts they
are in git.

**The first narrowing was still wrong, and the same review caught it.** Ignoring those four
directories everywhere still failed two suites on a clean tree, because `sweep-delta.spec.ts` and
`sweep-ledger.spec.ts` do not read the recorded measurement — they **recompute** it with
`measureSandbox` and diff it against the committed record. That is the regression ratchet working
as designed, and the arm source is its *input*: `measure-sandbox.ts:306` needs the archive's
`src/`, `:216` its frozen `starter-baseline/src/`, `:102` the `framework-types/` declarations.

Final shape — the three measurable directories are kept for the **13 archives a
`docs/verification/sweep-*.md` ledger names**, and ignored for the other 94:

| | Untracked | Kept tracked |
|---|---|---|
| Files | 3,498 | 1,794 |
| `.ts` files | 2,589 | 374 (the 13 measured archives) |
| Measurements | none | `sweep.json` ×107, `proof.json` ×100, `proof-artifacts/` ×379, `playtests/`, `captures/`, `screenshots/`, `brief.md`, `reference.png` |

Tracked `.ts` under `docs/` lands at **376, down from 2,965 — an 87% cut** rather than the 99.9%
the broken version showed. Making the specs compare a recorded manifest instead of re-measuring
would reclaim the rest and weaken the ratchet, which is a worse trade for 374 files.

### The instrument was wrong, twice, and that is the lesson

Both bad narrowings were checked with `git ls-files` — "the artifacts the specs read are tracked,
therefore CI will pass." **That proves nothing.** All 13 ledgers had their `proof.json` tracked in
the version that still failed two suites, because the dependency was on a directory `git ls-files`
was never asked about.

The instrument that answers the question is a clean-tree run:

```
$ git archive HEAD -o head.tar && tar -x -C <tmp> -f head.tar
$ ln -s <repo>/node_modules <tmp>/node_modules   # and each package's
$ cd <tmp> && npx vitest run \
    scripts/__tests__/sweep-delta.spec.ts \
    scripts/__tests__/sweep-ledger.spec.ts \
    packages/playtest/__tests__/capture.spec.ts

 ✓ scripts/__tests__/sweep-delta.spec.ts (7 tests)
 ✓ packages/playtest/__tests__/capture.spec.ts (7 tests)
 ✓ scripts/__tests__/sweep-ledger.spec.ts (7 tests)
 Test Files  3 passed (3)   Tests  21 passed (21)
```

The **full** suite was then run in that clean tree: 371 files pass, 8 fail. Those 8 also fail in a
clean tree built from `origin/main` — they need a real checkout (`.git`, `git ls-files`, built
output) rather than an archive — so they are the harness, not this change. Running that control
before attributing them is the difference between a finding and a false alarm.

Every reader resolves this tree through the filesystem, never through git:
`sweep-archive.ts:219`, `make-sandbox.ts:309-314`, `sweep-capture`, `sweep-judge`, `sweep-pair`.
`check-doc-links.ts:265` had already been filtering the tree out as a link *source*.

`.gitignore` keeps the four pre-existing subpath rules with the reasons they recorded (third-party
pack terms on `*/vendor/` and `*/assets/`, ~8 MB gzipped transcripts carrying absolute machine
paths) and adds the arm-source rules beside them. Root `AGENTS.md` gains the rule beside the
existing `.worktrees/` one, and says which half stays.

**A doc-links exemption was written and then removed.** While the whole tree was untracked, three
Markdown links pointed into it and `pnpm check:docs` went red, so `check-doc-links.ts` gained a
skip for link *targets* under the tree. Narrowing Phase 4 re-tracked those exact artifacts, the
links resolve for everyone again, and the exemption was reverted rather than shipped — an
unjustified exemption in a gate is the thing this PRD spent three defects arguing against.

**Ledger row 4 needed less than it claimed.** `scripts/arm-census.ts` does not reference the sweep
tree at all — `grep -n "sweep" scripts/arm-census.ts` returns nothing — and
`docs/benchmark/PROTOCOL.md` documents the `sweep:*` commands, not the archive location. No path
update was required in either.

### AC4 — the grep measurement

| | Before | After |
|---|---:|---:|
| Tracked `.ts` files under `docs/` | **2,965** | **376** |
| Tracked files, whole repository | **9,070** | **5,427** |
| Files crossed by `git grep -l renderer -- 'docs/**'` | **1,199** | **419** |

A repo-wide grep under `docs/` crosses 65% fewer files, and 2,589 of the 2,963 generated arm
sources are gone from the index. The 374 that stay are the measurable input of the regression
ratchet, and they buy a suite that still recomputes what it claims.

---

## Phase 3 — deletion by citation, with the owner's checkpoint

After Phase 4 and both scanner fixes, the uncited set was **155 artifacts, 12.7 MB**.

Removed with `git rm --pathspec-from-file`, reading an explicit list the corrected scanner
generated. **No path was built from a shell variable and no `rm` ran against a generated path**
(AC11); every deletion is an explicit tracked path in this commit's diff.

```
$ npx tsx scripts/check-evidence-budget.ts ; echo "exit=$?"
evidence docs/verification: 664 tracked file(s), 65.9 MB
evidence docs/benchmark: 1393 tracked file(s), 179.5 MB
evidence budget: ok
exit=0

$ pnpm check:docs
Checked 1379 relative documentation links across 914 Markdown files.
```

Zero broken links — the check that caught defect 2 is the check that clears it.

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
| Tracked `.ts` under `docs/` | 2,965 | **376** |
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
- [x] **AC4 — an agent's repo-wide grep no longer crosses generated sweep sources.** 1,199 → 419
      files; tracked `.ts` under `docs/` 2,965 → 376. Not the 99.9% two earlier drafts claimed —
      each was measured with the wrong instrument and each was red on a clean tree.
- [x] **AC5 — every cited result still resolves.** `pnpm check:docs` green: 1,379 relative links
      across 914 Markdown files, zero broken. This is the criterion that caught defect 2, and the
      one that let the doc-links exemption be reverted once Phase 4 was narrowed.
- [x] **AC6 — classification fails closed.** Unchanged from Phase 1 and still covered:
      `should throw when a citation source is unreadable rather than defaulting`. The new link
      pass defers to that check rather than throwing a competing message for the same file.
- [x] **AC7 — the index is generated, not maintained.** `--check` in `pnpm budgets`; hand-edit red
      observed in Phase 2.
- [x] **AC8 — the rule is written where filing decisions are made.** `docs/PRDs/AGENTS.md`, mirror
      regenerated.
- [x] **AC9 — the numbers moved.** Table above. Three figures came in below an earlier draft's
      claim and are reported as shortfalls rather than reframed: `du -sh docs` −21%, tracked bytes
      −13% (not the −70% a wrong whole-tree untracking would have given), and a deletion count
      deliberately reduced by the scanner fixes.
- [x] **AC10 — the history decision is recorded.** Declined 2026-09-02 on 194.01 MiB measured;
      unchanged, and Phase 4's untracking does not alter it.
- [x] **AC11 — no `rm` in a generated path.** `git rm --pathspec-from-file` against an explicit
      scanner-generated list; every deletion is a tracked path in the diff.
- [x] **AC12 — gates.** `pnpm lint` 0 errors / 575 warnings, `pnpm typecheck` exit 0,
      `pnpm budgets` exit 0, `pnpm sync:agents --check` exit 0, `pnpm check:docs` 1,376 links
      across 911 files, root suite **379 files / 3,990 tests passed, 0 failed**. Full output in
      the commit body.

## Defects 5 and 6 — found by review, with executed probes

An adversarial code review of the committed diff found two more, both verified by running the code
rather than reading it. Both are fixed here.

### Defect 5 — the sweep archive's measurements were `uncited`

`SCRIPT_WALKED_ROOTS` covered `docs/verification/visuals` and three others and **missed the tree
Phase 4 had just re-tracked**. Reproduced on the fixed Phase 4:

```
uncited total: 300
uncited under docs/benchmark/sweeps: 282   72.3 MB
  164 captures
   70 playtests
   37 screenshots
    6 assets
```

Those are exactly the artifacts Phase 4's `.gitignore` deliberately keeps in git, and every one of
their directories is opened as a root by a real script — `sweep-capture.ts:52` (`captures`),
`sweep-proof.ts` (`proof-artifacts`), `sweep-archive.ts:226` (`playtests`), `round-next.ts:26`
(`captures/index.json`), and `sweep-evidence.ts:84-94`, which is the authoritative classifier and
names every component by top-level directory.

A first fix listed one entry per measurement directory, and the review showed **two of those
readers were fiction**: nothing opens `screenshots/` or `assets/textures` — `sweep-evidence.ts:92`
only *classifies a name*. Inventing a reader to justify an entry is the same failure as inventing
a justification for a swallow.

The real reader is stronger than all five. `collectEvidenceFiles` (`sweep-evidence.ts:399`)
recursively walks an archive root and inventories every regular file; `writeEvidenceManifest`
SHA-256s each, and `verifyEvidenceManifest:530` fails on both `evidence file missing from archive`
and `Unlisted evidence file in archive`. **An archive is a hash-sealed unit whose inventory is the
directory**, so one entry rooted at `docs/benchmark/sweeps` is both correct and honest, and the
five hand-written entries were deleted along with the `archiveComponent` matching mode they needed.

Two caveats recorded beside it rather than glossed: the seal protects nothing *today* —
`git ls-files 'docs/benchmark/sweeps/*/evidence-manifest.json'` returns 0 across all 107 archives,
every one "legacy" — and the entry does blanket the tree, which the other entries avoid. It is
defensible because everything still tracked under that root really is read: the measurements by
the inventory walk, and the 374 arm-source files by `measureSandbox` when the ratchet recomputes.

After the fix: **uncited 300 → 23.**

### Defect 6 — the fail-closed justification was false, and a probe proved it

Both `linkCitations` and the budget gate's line cap swallowed a `readFile` error with `continue`,
each carrying a comment claiming the other walk would catch the file. **Neither does.** `stat`
follows symlinks and needs only directory-traverse permission; `readFile` needs read permission on
the file. The review's probe, with a tracked evidence write-up at `chmod 000`:

```
PROBE readFile does fail: EACCES: permission denied, open '.../prd-999.md'
PROBE classifyEvidence:   NO THROW
PROBE attachment:         uncited   citedBy: []
PROBE budget ok:          true  []
```

That is the exact silent-deletion outcome the gate exists to prevent, produced by a comment
asserting it could not happen. Both `continue`s are now `throw`s, and the comments say what the
probe found instead of what was assumed. `citationSources` already threw — but it *excludes*
evidence `.md` unless the path matches `round-\d+`, so ordinary write-ups took only the swallowing
path.

**A third review finding, also correct and also fixed:** the `alpha-bar.ts` exclusion rationale
claimed all three of its walks were content-shaped. Two are path shapes — its `round-*` glob at
`alpha-bar.ts:366` and `PARITY_LEDGER_PATTERN` at `:470` (`tier-1-*`, `parity-*`). Both now have
entries; only `readEvidenceBlocks`, which reads every `.md` and acts on content, stays excluded,
and the comment now says which is which.

### Reds for the review fixes

```
× should treat a sweep archive as cited, because it is inventoried as a whole
  (the sweep root entry removed)                  Tests  1 failed | 9 passed (10)

× should throw when an evidence write-up cannot be read, rather than losing its links
  (throw reverted to continue)                    Tests  1 failed | 9 passed (10)
```

Each mutation fails exactly its own test. The sweep spec carries its negative control in the same
case: a file directly under `docs/benchmark/` that nothing names must stay `uncited`, so the entry
seals sweep archives without eating the policy for the tree they sit in.

## Known limitations

- Classification is **single-pass**; a deletion can orphan artifacts that were cited when the scan
  ran. Eighteen such artifacts exist now and the index names them. Running the scan to a fixed
  point would close this and is not done here.
- **The citation scanner has no opinion on `.gitignore`.** Defect 4 was not a scanner bug at all —
  it was untracking a tree by hand on the assumption it was build output. Nothing checks that a
  path leaving git is still read by a test, and it took three attempts and two independent
  reviewers to get the boundary right. `SCRIPT_WALKED_ROOTS` describes what *scripts* read;
  nothing describes what *specs* read, whether by literal path (`capture.spec.ts:48`) or by
  recomputation (`measureSandbox`). **A gate that runs the suite against `git archive HEAD` would
  have caught every one of these in one step, and is the single highest-value thing left undone
  here.**
- The sweep-archive entry blankets its tree on the strength of a manifest seal that **no archive
  carries yet**. If `evidence-manifest.json` never ships, that entry is protecting the tree for a
  reason that never became true, and should be revisited rather than inherited.
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
