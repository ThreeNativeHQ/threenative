# Batch — the gates that assert nothing, 2026-08-17

**Status: PARTIAL, 2026-08-18.** PRD-132, PRD-134, PRD-135 and PRD-136 are complete and archived
individually in [`../done/`](../done/). PRD-133 remains active because its required
`pnpm publish:check` still exits 1 on five stale published-version findings. No mobile, iOS,
performance or visual-quality claim is made anywhere in this batch.

## The one thing they have in common

Every item below is a check that **reports success while asserting nothing**, or a document that
says a check exists when it does not. That is the failure mode this repository was built
downstream of: v1's harness silently dropped malformed assertions, so a scenario asserting nothing
reported pass. Five instances of it are sitting in the tree right now, and each was found by
reading the tree rather than by a gate telling anyone.

| Found | Evidence, read on 2026-08-17 |
| --- | --- |
| `AGENTS.md` says every package's `test` runs `publint` | **zero of six do** |
| Three published packages have READMEs | **three have none, and two could not ship one if written** |
| `pnpm check:docs` guards the docs | **it was red, on a sentence describing its own bug, and no gate runs it** — the parser is fixed as of 2026-08-17; the wiring is not |
| The suite cleans up after itself | **205 `mkdtemp` call sites across 68 files; ~30 files never remove anything** |
| A scaffolded project ships ten passing gates | **one of them breaks on the user's first level edit** |

## The work

Two lanes. They do not block each other and can be done in either order.

### Lane A — what a stranger receives

| PRD | What it closes | Complexity |
| --- | --- | --- |
| [136](../done/PRD-136-scaffolded-gate-survives-first-edit.md) | **DONE, 2026-08-18.** `seed.playtest.json` no longer pins an internal RNG float, so a user's first level edit does not turn their own `pnpm test` red | 3 |
| [133](./PRD-133-published-packages-have-readmes.md) | **PARTIAL, 2026-08-18.** The three READMEs, tarball inclusion and README guard are complete; the publish preflight still reports stale package versions | 3 |

### Lane B — gates that do not gate

| PRD | What it closes | Complexity |
| --- | --- | --- |
| [132](../done/PRD-132-publint-in-every-package-gate.md) | **DONE, 2026-08-18.** Every publishable package test runs strict `publint`, with a fails-closed manifest guard | 2 |
| [134](../done/PRD-134-doc-link-gate.md) | **DONE, 2026-08-18.** The checker skips code spans and `check:docs` runs inside `pnpm test` | 1 |
| [135](../done/PRD-135-temp-directory-leak.md) | **DONE, 2026-08-18.** Test-owned temp directories register failure-safe cleanup and the guard rejects bare `mkdtemp` | 4 |

## Order

The historical execution order was PRD-134, PRD-132/133/136, then PRD-135. Four items are now
archived; PRD-133 stays in this active folder until its publish preflight is green.

Every PRD carries executable acceptance criteria and names the evidence file its output goes into.
**Four of them require watching a guard fail** — PRD-132 step 3, PRD-134 step 3, PRD-135 step 3,
PRD-136 step 5 — because a guard nobody has seen fail is a guard nobody has tested, and that is the
exact defect this batch is about.

## Judgement, not mechanics

One thing here is writing rather than a command with an expected exit code: the three package
READMEs in PRD-133 §2. Read those before they land. Everything else in the batch is a fix with a
test that proves it.

One decision is the owner's: PRD-134 §3.3, whether `check:docs` goes into `pnpm test` or into the
CI chain only. Local loop speed against catching it before push. Either is defensible; the reason
belongs in the commit message.

## Deliberately left out

Recorded so the next round does not rediscover them, and so their absence is a decision.

1. **Round 11's paired blind visual A/B.** `scripts/visual-ab.ts` landed with PRD-126 and has
   never been run with independent raters. Round 10 withdrew its own mean and floor count because
   an untouched template moved a full point between two critics, so **the template visual floor is
   currently unknown** — 5 of 7 below it is a withdrawn figure, not a live one. This is the highest
   value item in the repository right now and it is not in this batch, because it is a round with
   raters and a budget ask, not a day of local work.
2. **Template visual quality.** Downstream of item 1 by construction. Changing a template's look
   before the instrument can resolve the change is how round 10 traded a measured 4 for a measured
   2 on `starter`.
3. **`docs/PRDs/alpha-readiness/` says `EXECUTED, 2026-08-16`** while still sitting in the active
   set with nothing but a `README.md` in it. By the lifecycle rule it should have been archived to
   `done/` in the commit that closed its last PRD. One `git mv`, and it is not worth a PRD.
4. **`docs/PRDs/batch-26-08-16/README.md` still says `PROPOSED … nothing in this folder has run`**,
   which stopped being true on 2026-08-16 — the low lane landed in `cc63a26`, PRD-130 in `8f1b69e`,
   PRD-131 in `26e4373`. Its "deliberately left out" item 1, the `sweep-archive` data loss, was
   **fixed** by `6613ad7` and the entry is stale. Correct the status line when that batch is
   archived.
5. **The nine other playtests a scaffolded project ships.** PRD-136 fixes the one instance its
   audit finds. Whether the other nine survive a user editing their own game has never been
   measured, and this batch does not measure it.

Items 3 and 4 are docs hygiene and cost minutes; they are excluded because they are not defects
anyone hits, not because they are hard.

## What this batch does not claim

**Not that the packages install correctly** — `publint` reads a manifest, it does not run a clean
install. **Not that the npm pages are good** — nobody outside this project has read one, and
whether a page makes a stranger install anything is unmeasurable here. **Not that the docs are
correct** — a link that resolves can still point at the wrong file. Each PRD repeats the limit
that binds it.
