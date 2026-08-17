# Low-complexity lane — everything here is runnable today, on this machine

**You have been handed this file and nothing else. It is complete.** Do the three tasks
below, in order, and stop where each says stop.

Complexity, as each PRD rates itself: **PRD-129 §3–§4 is 2, PRD-125 is 4, PRD-127 is 4.**
Low here means *relative to the rest of this batch*, which runs 5 to 7. It does not mean
trivial, and two items are judgement rather than mechanics — the README prose in task 2 step 1,
and the retention note in task 2's stop. **Both get read by a human before they land.** Say so
in your report rather than marking them done. Do not look for other work in this folder;
the rest of the batch needs a physical phone and judgement calls this brief does not cover,
and starting one is worse than doing nothing.

Read [`PRD-129`](../done/PRD-129-licensing-and-the-studio-split.md) §3–§4 and
[`PRD-125`](../done/PRD-125-docs-and-readme-overhaul.md) in full before you begin. They are the
specification; this file is only the order, the stops, and the traps.

---

## Task 1 — licence the engine (PRD-129 §3 and §4 only)

**About an hour. Do this first and commit it alone.** The repository is public, publishes
seven packages, and grants nobody any rights, because there is no `LICENSE` file and six of
seven packages declare no `license` field. This is the only task in the batch that is pure
gain with no trade-off.

1. **§3.1** — create `LICENSE` at the root: unmodified MIT text, `Copyright (c) 2026 João
   Paulo Furtado`. Copy the text from `packages/runtime-native/LICENSE`, which is already
   correct MIT, and change only the copyright line. **No carve-out clause.**
2. **§3.2** — add `"license": "MIT"` to the six manifests that lack it, and to the root
   `package.json`. `packages/runtime-native/package.json` already has it; leave it.
   **`packages/studio/package.json` is the exception — do not touch it, do not set it to
   MIT.**
3. **§3.3** — templates, but read the condition: set the field only if the template has none
   *and* no spec asserts its absence. Check `scaffold.spec.ts` and `template-baseline.spec.ts`
   first. If a spec asserts it, leave the template alone and say so in your report.
4. **§4** — create `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`,
   `.github/PULL_REQUEST_TEMPLATE.md`, and three files under `.github/ISSUE_TEMPLATE/`. §4 of
   the PRD says what goes in each. Use the standard texts where it names one — Contributor
   Covenant 2.1 verbatim, Keep a Changelog format — and draft nothing original.
5. Run `pnpm typecheck && pnpm lint && pnpm test`. Commit.

### 🛑 Stop at the end of §4

**Do not start PRD-129 §5, §6 or §7.** They move `packages/studio/` and `hosting/` to another
repository and edit the list that a version tag reads before publishing to npm. A published
licence cannot be withdrawn. That work is assigned to someone else.

---

## Task 2 — the docs (PRD-125, all of it)

**About half a day.** Five phases, in the PRD's own order. Commit at the end of each phase.

1. **§3** — move the generated LOC table out of `README.md` into `docs/benchmark/LOC.md`,
   changing `scripts/count-loc.ts:381` to match, then rewrite `README.md` to §3.2's outline.
   Move the table *first*; the script fails CI if the markers go missing.
2. **§4** — fix the 18 broken links. They are listed in the PRD with their targets. Where a
   sentence around a link claims a PRD is active and it is now BLOCKED, fix the sentence too.
3. **§5** — rewrite `docs/README.md` as a map. **No files move in this phase.**
4. **§6.1 and §6.2** — untrack the 341 vendored `.tgz` files and the `.linchpin/` and
   `.gauntlet/` scratch files, and add both to `.gitignore`. Run the greps the PRD names
   first; if a grep finds a real consumer, leave those files alone and report it.
5. **§7** — write `scripts/check-doc-links.ts` and its spec, wire `pnpm check:docs`, add one
   step to the existing `test` job in CI. **Do not create a new CI job.**

### 🛑 §6.3 is a document, not a deletion

There are 506 screenshots totalling 100 MiB under `docs/benchmark/sweeps/`. **Write the
recommendation file the PRD asks for and delete nothing.** `git ls-files
'docs/benchmark/sweeps/**/*.png' | wc -l` must still print `506` when you are done. That is
an acceptance criterion, not a suggestion.

---

## Task 3 — the device preflight (PRD-127)

**About half a day.** One extraction, three call sites, two new conditions, per that PRD's
own §-numbered plan. Land the code and its tests.

### 🛑 You cannot verify this one

It gates measurement runs on a physical Pixel 8 that is not attached to your session. Land
the code, prove the unit tests pass, and **report it as unverified.** Do not mark it done, do
not claim the preflight works, and do not weaken a condition so that something passes without
the device.

---

## Traps that have already cost this repository time

Every one of these has produced a wrong conclusion here before. They are not hypothetical.

1. **`pnpm lint` prints ~215 warnings on a clean tree and exits 0.** Only **errors** fail the
   build. Read the error count. Three commits went red in one day for a single error buried
   under the warnings.
2. **Never use `xvfb-run`.** It reports failure on a successful run — its cleanup `kill` fails
   after Xvfb has already exited and that status replaces the real one. `xvfb-run -a true`
   exits `1`. Use `sh scripts/xvfb.sh` instead, whatever any older document tells you.
3. **A WebGPU run that does not name its adapter is not evidence.** Without
   `--enable-features=Vulkan`, Chromium silently serves WebGPU from SwiftShader, its CPU
   rasteriser, with healthy-looking limits. If you see `swiftshader` in `adapter.info`, the
   run failed.
4. **`/tmp` is a 32 GB tmpfs and the suite leaks into it.** Set `TMPDIR` to a real disk path
   before anything that scaffolds a project, or you will hit a disk-full error that reads like
   a test failure.
5. **Another agent commits in this repository while you work.** It reverts uncommitted files
   and sweeps stray edits into its own commits. **Commit each phase as soon as it is
   coherent** — do not carry a large uncommitted tree.
6. **A failure that moves is the machine, not your diff.** If the same commit fails in three
   different places, stop bisecting your change and check the environment.

## The rules that get your work rejected here

- **Never claim a gate you did not run.** Paste the failure. "Unverified" is an acceptable
  answer; "verified" without a run is not.
- **Never edit an archived result to make something pass** — no number, date, or status
  inside `docs/verification/**`, and no PRD status header. Fixing a broken path is repair;
  changing a recorded result is not.
- **`CLAUDE.md` files are generated.** Edit `AGENTS.md`, then run `pnpm sync:agents`. CI
  reverts a hand-edited mirror.
- **Add the test in the same commit as the change**, in `<package>/__tests__/*.spec.ts`.
- **Fail closed.** A checker that finds nothing because it silently skipped its input is the
  exact failure this repository has already paid for once. If input is malformed, throw.

## Done means

`pnpm typecheck && pnpm lint && pnpm test` green, plus each PRD's own numbered acceptance
criteria run and pasted — PRD-129 §9 criteria 1–3, and PRD-125 §8 criteria 1–9. Report the
three stops above as deliberately not done, not as failures.
