---
prd_contract: v1
---

# PRD-125 — The README a stranger reads, and the docs tree behind it

**Status: NOT STARTED, 2026-08-16. NOTHING IN THIS PRD IS IMPLEMENTED.** Every number in
§1 was measured on this working tree today at commit `803906c7`; the commands that produced
them are pasted beside each claim and reproduce. What is *not* measured: whether a better
README moves adoption. That is unmeasurable here — no stranger has read this repository yet
— so §8 keeps the acceptance criteria to things a script can check.

The repository went public in commit `ac386b65` and publishes seven packages at `0.2.x`. Its
front door still opens on the word **VOID** and an internal LOC regression table, tells the
reader to run a `pnpm dev` script that does not exist, and never once mentions
`pnpm create threenative`. Behind it, `docs/` is **189 MiB of the repository's 199 MiB
tracked bytes** and 6,013 of its 7,171 tracked files, and 18 relative links point at files
that moved.

**Complexity: 4 → MEDIUM mode.** No new dependency, no package added or removed, no runtime
behaviour changed. One script's output path moves, one new check script lands, and a large
volume of prose is rewritten. The risk is not difficulty — it is deleting evidence, which §6
gates behind an explicit owner decision rather than doing by default.

**Blast radius:** `README.md` (rewritten), `docs/README.md` (rewritten),
`scripts/count-loc.ts` (output target), `scripts/check-doc-links.ts` (new),
`scripts/__tests__/check-doc-links.spec.ts` (new), root `package.json` (one script),
`.github/workflows/ci.yml` (one step), `docs/benchmark/LOC.md` (new), plus the link and
status corrections in §4. **No PRD file's status is rewritten, no verification file's numbers
are edited, no archived evidence is deleted without §6.**

**Does not overlap:**

- PRD-074 owns static **code** quality signals. This PRD touches no `packages/*/src` file.
- `scripts/check-budgets.ts` owns LOC budgets. This PRD moves where the benchmark LOC table
  is *rendered*, never what it counts or what the budget is.
- `pnpm sync:agents` owns the `AGENTS.md` → `CLAUDE.md` mirroring. **Do not hand-edit any
  `CLAUDE.md`.** If §4 changes an `AGENTS.md`, run `pnpm sync:agents` in the same commit.

---

## 1. What is actually wrong, measured

### 1.1 The README

`README.md` is 61 lines. Read in order, it says: this is a framework (3 lines) → the
benchmark is **VOID** (6 lines) → a generated LOC comparison table against a frozen control
(19 lines) → five commands (10 lines) → three doc links (7 lines).

Five specific defects:

| # | Defect | Evidence |
|---|---|---|
| 1 | No install, no quickstart, no `create-threenative` mention — the only shipped way in | `grep -c 'create threenative' README.md` → `0`; `packages/create-threenative/package.json` is version `0.2.2` and published |
| 2 | `pnpm dev` is documented and does not exist at the root | `node -e "console.log(require('./package.json').scripts.dev)"` → `undefined` |
| 3 | The second heading a stranger reads is **"Benchmark status: VOID"** — an internal measurement failure, not a product fact | `README.md:7-12` |
| 4 | 19 of 61 lines are a machine-generated regression table aimed at this repo's own agents | `README.md:19-33` |
| 5 | Nothing states what runs where. "Runs on web and native" is the entire premise and the word "native" appears once, in a command name | `grep -c -i native README.md` → 3, all incidental |

The README never says: what you install, what you type, what you get, what works today, what
does not.

### 1.2 Stale facts and broken links

18 relative markdown links resolve to nothing. Reproduce with the loop in §7 (which this PRD
turns into a script). The cause in 14 of the 18 is one move: PRD-078 and PRD-080 went from
`docs/PRDs/alpha-readiness/` to `docs/PRDs/BLOCKED/requires-hosted-run/` and
`docs/PRDs/BLOCKED/requires-external-person/`, and their referrers were not updated.

```
docs/strategy/ROADMAP.md                      -> ../PRDs/alpha-readiness/PRD-078-…  (×2)
docs/strategy/ROADMAP.md                      -> ../PRDs/alpha-readiness/PRD-080-…
docs/PRDs/done/PRD-084-threenative-studio.md  -> ../alpha-readiness/PRD-080-…       (×2)
docs/PRDs/done/PRD-119-the-alpha-release-train.md -> ../alpha-readiness/PRD-080-…
docs/PRDs/studio-hosting/README.md            -> ../alpha-readiness/PRD-080-…
docs/PRDs/asset-pipeline/README.md            -> ../alpha-readiness/PRD-080-…
docs/PRDs/alpha-readiness/README.md           -> PRD-078-…, PRD-080-…
docs/verification/adopter-pilot-2026-08-14.md -> ../PRDs/alpha-readiness/PRD-080-…
docs/PRDs/BLOCKED/requires-external-person/PRD-080-… -> ../../strategy/ROADMAP.md   (×2)
docs/PRDs/BLOCKED/requires-external-person/PRD-080-… -> ../../product/STRANGER-TEST-PROTOCOL.md (×2)
docs/PRDs/BLOCKED/requires-external-person/PRD-080-… -> ../../strategy/VALUE-PROPOSITION.md
docs/PRDs/BLOCKED/requires-external-person/PRD-080-… -> ../../strategy/METRICS.md
docs/PRDs/BLOCKED/requires-external-person/PRD-080-… -> ../BLOCKED/README.md
docs/PRDs/BLOCKED/requires-hosted-run/PRD-078-… -> ../../verification/consumer-handoff-2026-08-12.md
docs/PRDs/BLOCKED/requires-hosted-run/PRD-078-… -> ../PRD-064-…, ../native-performance-fixes/PRD-070-…, ../done/PRD-048-…
```

Note the second cluster: the two *moved* files kept their own outbound links at the old
depth, so every `../../` in them is now off by one directory. `STRANGER-TEST-PROTOCOL.md`
exists at `docs/product/STRANGER-TEST-PROTOCOL.md` — the target is real, the path is wrong.

### 1.3 Docs weight

```sh
git ls-files -z docs | xargs -0 stat -c %s | awk '{n++;s+=$1} END{print n, s/1048576" MiB"}'
```

| Slice | Files | MiB |
|---|---:|---:|
| whole repository, tracked | 7,171 | 199.3 |
| `docs/` | 6,013 | 189.1 |
| `docs/benchmark/sweeps/` | 5,437 | 145.5 |
| — of which `.png` | 506 | 100.8 |
| — of which `.tgz` | 341 | 29.4 |
| `docs/verification/` | 361 | 32.2 |

`.git` is 190 MiB. **Documentation is 95% of what this repository is, by bytes.** A clone
downloads 100 MiB of playtest screenshots and 29 MiB of npm tarballs before it sees a line of
framework source.

The 341 `.tgz` files are packed copies of `@threenative/*` at version `0.1.0`, four per sweep
archive, written by `scripts/sweep-archive.ts:165`. The 506 PNGs are overwhelmingly playtest
before/after captures: 160 `before.png`, 156 `after.png`, 132 named
`platformer-{run,jump}-proof-{before,after}.png`.

### 1.4 `docs/README.md`

It is a 1,900-word wall with no headings for its first eleven paragraphs, opening on an
instruction to whoever is "picking up the native lane" — an internal handoff note in the file
whose job is to orient a reader. It is accurate; it is not a map.

---

## 2. What ships

Five things, in this order. Each phase is independently committable and each ends green.

1. **§3** — `README.md`, rewritten for a stranger; the LOC table relocated with its generator.
2. **§4** — every stale fact and broken link in §1.2 fixed.
3. **§5** — `docs/README.md` rewritten as a map; no doc files move.
4. **§6** — junk cleanup, with the one destructive step gated on an owner decision.
5. **§7** — `pnpm check:docs`, so §4 cannot silently rot again.

**Commit at the end of each phase.** Another agent commits in this repository concurrently
and will otherwise sweep this work into its commits.

---

## 3. Phase 1 — the README

### 3.1 Move the generated table first

`scripts/count-loc.ts` writes between `<!-- benchmark:loc:start -->` and
`<!-- benchmark:loc:end -->` in a file it resolves at line 381 as `join(root, "README.md")`,
and CI runs it with `--check` (`.github/workflows/ci.yml:270`), so a hand-edited table fails
the build.

1. Create `docs/benchmark/LOC.md`: an H1, two sentences saying this file is generated by
   `pnpm tsx scripts/count-loc.ts` and checked in CI, and the two marker comments with the
   current table between them (copy `README.md:19-33` verbatim).
2. In `scripts/count-loc.ts`, change line 381 to resolve `docs/benchmark/LOC.md`, and update
   the two error strings at lines 370 and 386 to name that path.
3. Run `pnpm exec vitest run scripts/__tests__/count-loc.spec.ts`. Fix any hardcoded
   `README.md` the spec carries; do not change what the script counts.
4. Run `pnpm tsx scripts/count-loc.ts` then `pnpm tsx scripts/count-loc.ts --check` — write,
   then check, must both exit 0.

### 3.2 Rewrite `README.md`

Target 90–140 lines. Nothing generated, nothing that needs a script to stay true. Sections
in this order:

1. **Title + one paragraph.** What it is and the one claim that distinguishes it: the same
   Three.js source runs in the browser on WebGPU and on an owned C++ runtime for
   desktop/Android/iOS. Godot-shaped node names, React/Tailwind for UI, vanilla `three`
   underneath on every surface.
2. **Quickstart**, as the first code block on the page:
   ```sh
   pnpm create threenative my-game
   cd my-game
   pnpm install
   pnpm dev
   ```
   Verify each line by scaffolding into the scratch dir before you write it — check the
   generated `package.json` actually has a `dev` script and that the template README agrees.
   `packages/create-threenative/README.md` lists the seven templates (`starter` default,
   plus `minimal`, `platformer`, `action-rpg`, `defense`, `racing`, `shooter`); name them
   here with one clause each, and link to that README rather than restating its flags.
3. **A 15–25 line code sample.** The smallest `defineGame` + one scene that a reader can
   recognise as a game. Take it from `packages/create-threenative/templates/minimal/src/`
   so it is real code that a gate already runs — do not compose one by hand.
4. **What you get.** Five bullets, no more: bootstrap and lifecycle; Godot-named nodes
   (`RigidBody3D`, `CharacterBody3D`, `Area3D`, `CollisionShape3D`) over Rapier; React HUD
   bindings; the playtest harness that drives a real browser and asserts what happened; the
   native runtime. One clause each on what the framework deliberately does **not** own — the
   look ships as generated source in your `src/render/`, and gameplay is yours to write.
5. **Packages.** A table of the seven published names with a one-line purpose each, current
   versions read from each `packages/*/package.json` (`@threenative/core` 0.2.0,
   `create-threenative` 0.2.2, `@threenative/physics` 0.2.1, `@threenative/playtest` 0.2.0,
   `@threenative/runtime-native` 0.2.0, `@threenative/studio` 0.2.0, `@threenative/ui`
   0.2.1). Confirm each before writing it.
6. **Status — what is proved and what is not.** The honest paragraph, and the one section a
   reader will hold against us later. It must say, in plain sentences: this is alpha; browser
   WebGPU and desktop native are green; iOS-simulator evidence is produced on a hosted
   `macos-15` runner; the Android emulator is red on the hosted lane; **no physical phone has
   run this and no stranger has played a ThreeNative game for five minutes.** Do not write
   "mobile-ready". Do not soften the Android line. Link
   `docs/verification/engine-load-test-summary-2026-08-15.md` as the one external performance
   control that exists.
7. **Contributing / development.** The commands from `AGENTS.md` that a contributor needs —
   `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
   `pnpm test:browser`, `pnpm test:playtest` — with the note that native compilation is
   opt-in and the default gate needs no CMake, NDK or Xcode. Every command must exist in the
   root `package.json`; check the whole list, not a sample.
8. **Docs.** Three links, at most: `docs/README.md` as the map, the quickstart or template
   README, and `docs/architecture/CHARTER.md` described as the binding document. Move the
   `docs/strategy/CONFLICTS.md` pointer out of the root README — it is an internal
   reconciliation note and it should not be the third thing a stranger is told to read.
9. **Licence.** One line: MIT, linking `LICENSE`. **PRD-129 §3 creates that file** — if it
   has not landed yet, leave this section out rather than referencing a file that does not
   exist. Do not describe the licence of anything else; PRD-129 owns that boundary.

**The benchmark VOID paragraph leaves the root README entirely.** It is a real result and it
stays where results live: `docs/benchmark/RESULTS-2026-08-02.md` already records it and
`docs/README.md` already labels the benchmark result VOID. Do not delete it, do not restate
it on the front page, and **do not replace it with a claim that the benchmark passed.**

---

## 4. Phase 2 — stale facts

1. Fix all 18 links from §1.2. For the 14 caused by the PRD-078/080 move, repoint at
   `docs/PRDs/BLOCKED/requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md` and
   `docs/PRDs/BLOCKED/requires-external-person/PRD-080-five-minute-stranger-test.md`. For the
   outbound links inside those two moved files, fix the depth (`../../` → `../../../` where
   the target is under `docs/`, verified per link — do not pattern-replace).
2. **Where a link's surrounding sentence asserts the PRD is active, fix the sentence too.**
   Both are BLOCKED; a referrer that says "tracked in alpha-readiness" is now false. Blocked
   is not done and must not be written as done.
3. `docs/README.md` currently points the reader at `verification/round-10-2026-08-16.md`.
   Confirm that is still the newest round ledger (`ls docs/verification/round-*.md`) at the
   time you run, and correct it if a later round landed.
4. Grep the whole tree for `pnpm dev` and check each occurrence resolves in the workspace it
   documents. It is valid inside a scaffolded project and invalid at the repository root.
5. Do **not** touch numbers, dates, or statuses inside `docs/verification/**` or any PRD's
   status header. Fixing a path is repair; editing an archived result is falsification.

---

## 5. Phase 3 — `docs/README.md`

Rewrite as a map. **No file moves in this phase** — the reorganisation is of the index, not
the tree, because every PRD and verification file is cited by path from other PRDs and moving
them multiplies §4's problem.

1. Open with one sentence naming what `docs/` holds and which document binds
   (`architecture/CHARTER.md`, named once, no section number).
2. Keep the folder table. It is the best thing in the current file.
3. Everything else becomes headed sections: **Start here**, **PRDs**, **Verification**,
   **Benchmark**, **Strategy**, **Architecture**, **Product**, **Spikes**.
4. Move the native-lane handoff note and the sweep-tooling paragraphs out of the opening and
   under **Verification** and **Benchmark** respectively.
5. Under **PRDs**, state the lifecycle in four lines: active batches, `done/`, `BLOCKED/<reason>/`,
   and the rule that a PRD moves to `done/` in the commit that finishes it. Give the current
   counts (88 done, 16 blocked, and the active batches) as a sentence, not a table that will
   rot within a week.
6. Under **Verification**, say what a round ledger is, that `pnpm round:next` resumes it, and
   link only the newest one plus the range of earlier ones.
7. Cut every sentence that only tells the *next agent* what to do. This file is read by
   people now.

---

## 6. Phase 4 — junk

Three groups. Two are unambiguous; the third needs an owner decision and **must not be done
on the executor's own judgement.**

### 6.1 Do it — vendored tarballs (29.4 MiB, 341 files)

`docs/benchmark/sweeps/*/vendor/**/*.tgz` are packed `@threenative/*` builds at `0.1.0`.
They are inputs a sweep consumed, not results it produced, and they are reproducible from git
history by `pnpm pack`.

1. Confirm no gate reads them: `scripts/sweep-archive.ts` **writes** them and
   `scripts/__tests__/sweep-archive.spec.ts` and `sweep-pair.spec.ts` build their own
   fixtures in temp dirs. Verify with `grep -rn "vendor" scripts packages/*/src` and by
   running `pnpm exec vitest run scripts/__tests__/` before and after.
2. `git rm -r --cached` them, add `docs/benchmark/sweeps/*/vendor/` to `.gitignore`, and note
   in each affected archive's ledger — or once in `docs/README.md` under **Benchmark** — that
   vendor tarballs are no longer archived and why.
3. Re-run `pnpm test` and `pnpm exec vitest run scripts/__tests__/`.

This shrinks future clones. It does **not** shrink `.git`; history rewriting is out of scope
and is listed in §9.

### 6.2 Do it — agent scratch in the tracked tree

`.linchpin/` (12 tracked files) and `.gauntlet/` (2) are one orchestrator's working notes and
one loop's progress file, committed into a public repository. Neither is referenced by any
script (`grep -rn "\.linchpin\|\.gauntlet" scripts packages .github`). Confirm that grep
returns nothing, then untrack both and add them to `.gitignore`. If the grep *does* return a
consumer, leave them and record it in §9. Leave `.claude/` and `.agents/` alone — those are
skills the repository intends to ship.

### 6.3 **Stop — 100.8 MiB of sweep screenshots**

506 PNGs under `docs/benchmark/sweeps/`, mostly playtest before/after captures. These are
**evidence**, and this PRD does not authorise deleting evidence.

Produce a one-page decision note at `docs/benchmark/SCREENSHOT-RETENTION.md` containing:
the byte and file count per archive, which archives are cited by a round ledger or a `done/`
PRD (grep for each archive directory name across `docs/`), and three options with their
costs — keep all; keep only archives cited by a ledger and drop the rest's captures; keep the
newest run per genre. Recommend one. **Then stop and ask the owner.** Do not delete a single
PNG in this PRD.

---

## 7. Phase 5 — the link gate

Write `scripts/check-doc-links.ts`, exit 0/1, no dependency beyond what the repo has:

- Walk every tracked `*.md` outside `docs/benchmark/sweeps/`.
- **Skip fenced code blocks.** A shell snippet inside ``` fences can contain `](` — this very
  PRD contains one, and the naive version of this checker reports its own example as a broken
  link. Strip fenced blocks before extracting, and add that case to the spec.
- Extract relative markdown link targets; skip `http:`, `https:`, `mailto:`, and pure
  anchors; strip `#fragment` before resolving.
- Resolve each against the containing file's directory. Report `file -> target` for each miss
  and exit 1 if any.
- **Fail closed.** An unreadable file, a malformed link, or an empty target list where the
  file plainly contains links is a failure, not a skip. A checker that silently finds nothing
  is the failure mode this repository has already paid for once.

Add `scripts/__tests__/check-doc-links.spec.ts` with, at minimum: a good link passes; a
broken link fails with the offending path in the message; an anchor-only link passes; an
`http` link passes without a network call; a link with a fragment on a real file passes.

Wire it as `"check:docs": "tsx scripts/check-doc-links.ts"` in the root `package.json`, and
add one step to the existing `test` job in `.github/workflows/ci.yml` — do not create a new
job. Reference implementation for the walk:

```sh
git ls-files '*.md' | grep -v 'docs/benchmark/sweeps' | while read f; do
  d=$(dirname "$f")
  grep -oE '\]\([^)#][^)]*\)' "$f" | sed 's/^](//; s/)$//' | while read l; do
    case "$l" in http*|mailto*|\#*) continue;; esac
    t="${l%%#*}"; [ -z "$t" ] && continue
    [ -e "$d/$t" ] || echo "$f -> $l"
  done
done
```

---

## 8. Acceptance criteria

Each is a command with an expected exit or an output a reviewer can read. **Paste the output.
Never record a gate you did not run.**

1. `pnpm tsx scripts/check-doc-links.ts` exits 0 — zero broken relative links tree-wide.
2. `pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts` passes, and one test
   proves the checker *fails* on a broken link.
3. `pnpm tsx scripts/count-loc.ts --check` exits 0 with the table living in
   `docs/benchmark/LOC.md`, and `README.md` contains neither marker comment.
4. `README.md` contains `pnpm create threenative`, contains no `pnpm dev` outside a block
   labelled as running inside a scaffolded project, and contains no occurrence of `VOID`.
5. Every `pnpm <script>` named in `README.md` exists in the root `package.json`. Check
   mechanically:
   `grep -oE 'pnpm [a-z:%-]+' README.md | sort -u` against
   `node -e "console.log(Object.keys(require('./package.json').scripts).join('\n'))"`.
6. `README.md` states, in a sentence a reader cannot miss: no physical mobile device has run
   this, and no stranger has played a ThreeNative game. A reviewer confirms by reading.
7. `git ls-files 'docs/benchmark/sweeps/**/*.tgz' | wc -l` → `0`, and
   `git ls-files .linchpin .gauntlet | wc -l` → `0`.
8. `docs/benchmark/SCREENSHOT-RETENTION.md` exists with a recommendation, and
   `git ls-files 'docs/benchmark/sweeps/**/*.png' | wc -l` is **unchanged at 506** — the
   decision is open, not taken.
9. `pnpm typecheck && pnpm lint && pnpm test` green. Note that `pnpm lint` prints ~215
   warnings on a clean tree; only **errors** fail the build — read the error count, not the
   warning count.
10. No file under `docs/verification/` and no PRD status header changed, other than the link
    repairs in §4. Confirm with `git diff --stat` on the branch.

---

## 9. Out of scope, and what this leaves open

- **History rewriting.** `.git` stays 190 MiB. Untracking the tarballs shrinks a fresh
  checkout, not a clone. A `filter-repo` pass is a separate, coordinated, breaking operation
  and is not authorised here.
- **Moving any PRD or verification file.** Cited by path from dozens of places; §5 fixes the
  index instead.
- **Deleting sweep screenshots.** §6.3, owner decision.
- **Per-package READMEs.** `@threenative/core`, `ui`, and `runtime-native` are published to
  npm with no README and therefore render as a blank package page. Real, worth fixing, three
  separate documents — a follow-up PRD, not this one.
- **Licensing and the community health files** — `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.github/` templates. All owned by
  [PRD-129](PRD-129-licensing-and-the-studio-split.md), which also removes `packages/studio/`
  and `hosting/` from this repository. **If PRD-129 lands first, §3.2's package table drops to
  six packages and the §5 docs map loses the studio-hosting series' home** — check which
  landed before writing either.
- **Whether any of this works.** The README's job is to make a stranger able to start. Nobody
  has tried. `PRD-080-five-minute-stranger-test.md` is the gate that would answer it and it
  is blocked on a person, not on this document.

When every criterion in §8 is met, `git mv docs/PRDs/PRD-125-docs-and-readme-overhaul.md
docs/PRDs/done/` in the same commit that finishes it.
