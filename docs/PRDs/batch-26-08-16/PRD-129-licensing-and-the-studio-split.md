---
prd_contract: v1
---

# PRD-129 — The engine is MIT, the editor is not, and neither is written down anywhere

**Status: NOT STARTED, 2026-08-16. NOTHING IN THIS PRD IS IMPLEMENTED.** Every fact in §1
was measured on this working tree at commit `803906c7`; the commands are pasted beside each
claim and reproduce. The licensing *decision* in §1.1 is the product owner's, taken
2026-08-16, and this PRD implements it — it does not reopen it.

This repository has been public since 2026-08-03 and publishes seven packages to npm. It
contains **no `LICENSE` file**, and six of its seven packages declare **no `license` field**.
Under npm and GitHub defaults that means one thing: *no rights have been granted to anyone,
for anything.* The MIT engine is currently open source in appearance only.

**Complexity: 7 → HIGH mode.** Nothing here is algorithmically hard. The risk is that it is
irreversible in one direction — a licence grant cannot be withdrawn from a version already
published — and that it touches the release lane, which publishes to a public registry on a
tag push. Read §8 before touching anything under `.github/workflows/`.

**Blast radius:** `LICENSE` (new), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`CHANGELOG.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` (all new),
`license` fields in seven `package.json` files, the removal of `packages/studio/` (41 files)
and `hosting/` (74 files) from this repository, five `scripts/studio-*.ts` and
`visual-gate.ts`, eleven spec files, three template manifests, the publish list in
`.github/workflows/npm-release.yml`, and the two strategy documents that currently promise
the opposite of §1.1.

**Depends on:** nothing. **Blocks:** PRD-125 §3.2 step 9, which defers the licence section of
the new README to this PRD. Land this one first if both are in flight.

---

## 1. The decision, and the facts behind it

### 1.1 What was decided

> **The engine is MIT. The editor is proprietary and moves to a private repository. Git
> history is not rewritten.**

- **MIT, permanently:** `@threenative/core`, `@threenative/physics`, `@threenative/ui`,
  `@threenative/playtest`, `create-threenative`, `@threenative/runtime-native`, every
  template, every example, every script that remains.
- **Proprietary, all rights reserved:** `@threenative/studio` and the `hosting/` service that
  serves it. Source leaves this repository. No licence is granted; use requires a written
  agreement.
- **History stays as it is.** No `filter-repo`, no force-push. §1.3 explains why.

### 1.2 Why the split is cheap

The coupling is one import, not a web. Verify each line before you rely on it:

| Claim | Command | Result |
|---|---|---|
| No engine package imports Studio | `grep -rn "@threenative/studio" packages/{core,physics,ui,playtest,runtime-native}/src` | no hits |
| `create-threenative` mentions it as a **string**, never an import | `grep -n "@threenative/studio" packages/create-threenative/src/index.ts` | lines 26, 196, 347 — a union member, a name comparison, and a `--studio-package` CLI flag |
| Studio imports exactly one sibling | `grep -rn "create-threenative" packages/studio/src` | `starterKit.ts:1`, `server.ts:10`, `server.ts:165` — `IKitManifest`, `discoverKitManifests`, `createProject` |
| Repo scripts **spawn** Studio, never link it | `grep -n "spawn" scripts/studio-inspect.ts scripts/studio-probe.ts` | child processes only |
| Studio is a **devDependency**, not a dependency | `node -e "…templates/starter/package.json…"` | `devDependencies` in `starter`, `minimal`, `platformer`; absent from the other four |

So a private repository consumes `create-threenative` from npm at `^0.2.2` and the code split
is complete. The arrow points outward, from the paid thing to the free thing, which is the
direction that works.

`hosting/` is a different matter: 10 of its files reference Studio, including
`sandbox/sidecar.ts` and `control-plane/session-proxy.ts`. It **is** the hosted editor. It
moves with Studio (§6.2); leaving it behind would leave 74 files importing a package that no
longer exists.

### 1.3 Why history is not rewritten

| Fact | Command | Consequence |
|---|---|---|
| `@threenative/studio@0.2.0` is already on npm | `npm --userconfig .npmrc view @threenative/studio version` → `0.2.0` | Unpublish is barred after 72 hours. `deprecate` does not remove it. The built bundle is public and permanent. |
| It shipped with **no `license` field** | `node -e "console.log(require('./packages/studio/package.json').license)"` → `undefined` | Default is all-rights-reserved. **Nobody has ever been granted the right to use it.** |
| 0 forks, 0 stars | `gh repo view --json forkCount,stargazerCount` | Nobody's clone breaks either way. |
| **197 commit SHAs are cited across `docs/`** | see §9 criterion 10 | A rewrite invalidates all 197 citations in PRDs and verification files. |
| 32 of 40 Studio commits also touch non-Studio files | `git log --format=%h -- packages/studio` + per-commit diff | The history does not lift cleanly regardless. |

Stripping source from git while the compiled bundle sits on the public registry is theatre.
**The licence is the protection, not the obscurity** — and that protection already exists by
accident, because 0.2.0 granted nothing. Paying 197 broken citations for a partial measure is
a bad trade. **Do not run `git filter-repo` in this PRD.**

### 1.4 What contradicts the decision today

Two committed strategy documents promise the opposite, in writing:

- `docs/strategy/BUSINESS-MODEL.md:12` lists **"Local Studio"** in the *Never charged for*
  column.
- `docs/strategy/POSITIONING.md:57` lists `studio` inside **"Open-source engine and
  framework"**, and line 61 says the runtime "stays permissively licensed".

§7 reconciles them. Do not quietly delete the rows — record that the position changed and
when.

`docs/architecture/CHARTER.md:75` says only *"An editor | Not in v1."* Removing Studio from
this repository moves **toward** the charter, not away from it. No amendment is needed.

---

## 2. What ships

Five phases, each independently committable, each ending green. **Commit at the end of each
phase** — another agent commits in this repository concurrently and will otherwise sweep this
work into its commits.

1. **§3** — the engine gets an actual licence.
2. **§4** — the community health files.
3. **§5** — the private Studio repository, seeded and building.
4. **§6** — Studio and `hosting/` leave this repository at HEAD.
5. **§7** — the strategy documents stop promising what §1.1 revokes.

**Do §3 first and commit it alone.** It is the only phase that is pure gain and zero risk,
and it is the one that is currently costing you something every day the repo is public.

---

## 3. Phase 1 — licence the engine

### 3.1 The root `LICENSE`

Create `LICENSE` at the repository root: the standard, unmodified MIT text, `Copyright (c)
2026 João Paulo Furtado`. Take the text from `packages/runtime-native/LICENSE`, which is
already correct MIT, and change only the copyright line. **Do not add a carve-out clause** —
after §6 there is nothing in this repository that is not MIT, and a carve-out naming a
directory that no longer exists is worse than no carve-out.

### 3.2 The `license` field in every manifest

Six of seven are missing. Set `"license": "MIT"` in each:

```
packages/core/package.json          currently absent
packages/physics/package.json       currently absent
packages/ui/package.json            currently absent
packages/playtest/package.json      currently absent
packages/create-threenative/package.json  currently absent
packages/runtime-native/package.json      already "MIT" — leave it
packages/studio/package.json        do NOT set MIT; §5.3 handles it
```

Also set `"license": "MIT"` in the root `package.json` (it is `private: true`, so this is
documentation rather than a grant, but it is what tooling reads).

Verify: `for f in packages/*/package.json; do node -e "…"; done` prints `MIT` for all six
remaining packages after §6.

### 3.3 Templates

Each of the seven templates ships as generated user source. Set `"license": "MIT"` in each
template `package.json` **only if it currently has no license field and CI does not assert
its absence** — check `packages/create-threenative/__tests__/scaffold.spec.ts` and
`template-baseline.spec.ts` first. A scaffolded project belongs to the user; if a template
manifest currently omits the field deliberately, leave it and note it in §10.

### 3.4 Third-party notice

`packages/runtime-native/NOTICE` already records the MystralNative fork provenance and MIT
upstream. Leave it exactly as it is. Add a root-level line to `CONTRIBUTING.md` (§4.1)
pointing at it, rather than duplicating it.

---

## 4. Phase 2 — the community health files

All new, all at the repository root except where noted. Keep each one short: a document
nobody finishes is a document nobody follows.

### 4.1 `CONTRIBUTING.md`

Target 60–100 lines. It must contain, and must not contain more than:

1. **Setup** — `pnpm install --frozen-lockfile`, Node 20, pnpm. State that native compilation
   is opt-in and the default gate needs no CMake, NDK or Xcode.
2. **The gate** — `pnpm typecheck && pnpm lint && pnpm test` before any PR. Warn that
   `pnpm lint` prints roughly 215 warnings on a clean tree and that **only errors fail the
   build**; tell the reader to read the error count, not the warning count.
3. **Tests are not optional** — a unit test in `<package>/__tests__/*.spec.ts` *and*, for any
   change with runtime behaviour, a playtest scenario. Add the test in the same commit as the
   change.
4. **Where a change goes** — reproduce the routing table from `AGENTS.md` ("What you are
   adding" → "Where it belongs"). Do not restate the whole of `AGENTS.md`; link it.
5. **The two rules that get a PR closed** — the 20-line rule, and never owning the look.
   State them in one sentence each, in plain language for someone who has not read
   `CHARTER.md`.
6. **`CLAUDE.md` files are generated.** Edit `AGENTS.md`, run `pnpm sync:agents`. CI reverts a
   hand-edited mirror.
7. **What this project will not accept**: an IR, a scene format, an editor, a preset system, a
   code-first ECS, a bespoke CLI vocabulary. Closed with evidence, not reopened in a PR.
8. **Licence of contributions** — by contributing you agree your contribution is MIT. One
   sentence. **Do not introduce a CLA**; it is a barrier this project cannot yet afford and
   nobody is here to administer it.

### 4.2 `SECURITY.md`

Short. Supported versions (`0.2.x`, the only line that exists). How to report — use GitHub's
private vulnerability reporting on `jonit-dev/threenative`, and give a contact address. State
a realistic response window; **this is a one-maintainer project, so promise best-effort, not
48 hours.** A missed SLA in a public SECURITY.md is worse than an honest one.

### 4.3 `CODE_OF_CONDUCT.md`

Contributor Covenant 2.1, verbatim, with the enforcement contact filled in. Do not draft an
original one.

### 4.4 `CHANGELOG.md`

Keep a Changelog format, newest first. Seed it with what actually happened, reconstructed
from tags and the release commits — do not invent entries and do not backfill releases you
cannot verify from git. At minimum: a `0.2.0` entry covering the version bump in `a98d2717`,
and an `Unreleased` section. If the history does not support a clean set of entries, write
one `0.2.0` entry and say in a leading note that entries before it were not reconstructed.

### 4.5 `.github/`

- `PULL_REQUEST_TEMPLATE.md` — a checklist of exactly four items: gate run and pasted, test
  added, PRD or issue linked, `pnpm sync:agents` run if `AGENTS.md` changed.
- `ISSUE_TEMPLATE/bug_report.yml` — must require: what you ran, what happened, what you
  expected, **platform (browser / desktop / Android / iOS)**, and the WebGPU adapter string
  if the report is visual. That last field is the difference between a reproducible report
  and a week of guessing; `adapter.info` showing `swiftshader` explains most "it renders
  wrong" reports on its own.
- `ISSUE_TEMPLATE/feature_request.yml` — must ask "could a competent developer write this in
  under 20 lines?" and explain that if the answer is yes, it belongs in the user's own
  project, not the framework.
- `ISSUE_TEMPLATE/config.yml` — disable blank issues, link to Discussions if one exists.

---

## 5. Phase 3 — the private Studio repository

### 5.1 Create and seed

1. Create the private repository `jonit-dev/threenative-studio`.
2. Seed it by **copying** the working tree, not by rewriting this repository's history:
   - `packages/studio/` → repository root (its 41 tracked files become the root package).
   - `hosting/` → `hosting/` (74 files).
   - `scripts/studio-probe.ts`, `scripts/studio-inspect.ts`, `scripts/studio-loop.ts` and
     their specs `scripts/__tests__/studio-probe.spec.ts`, `studio-loop.spec.ts`.
   - The Studio-relevant half of `scripts/visual-gate.ts` (`STUDIO_ASSET_ROOT`, line 92) —
     see §6.3, which decides whether the visual gate splits or stays.
3. An initial commit is acceptable. Studio's history is 40 commits over four days
   (`c4dd5328` 2026-08-12 → `a98d2717` 2026-08-16) and 32 of them also touch non-Studio
   files, so a filtered export produces partial commits with little value. **Preserving that
   history is optional and explicitly not required by this PRD.**

### 5.2 Break the workspace link

In the new repository's `package.json`:

- `"create-threenative": "workspace:*"` → `"create-threenative": "^0.2.2"`.
- Keep `monaco-editor`, `react`, `react-dom`, `zustand`, `zod` — resolve each `catalog:`
  entry to the literal version it resolves to here (`pnpm-workspace.yaml` holds the catalog;
  read the resolved version, do not guess).
- `packages/studio/src/server.ts:165` maps `"create-threenative"` to
  `path.join(REPO_ROOT, "packages/create-threenative")`. That path no longer exists. Point it
  at the resolved `node_modules` copy, and **make the failure loud** — if the package cannot
  be resolved, throw at startup with the package name in the message. A Studio that silently
  starts without the scaffolder is the fail-open pattern this project has already paid for
  once.
- Verify the three imports still typecheck: `IKitManifest`, `discoverKitManifests`,
  `createProject` are all exported from `create-threenative@0.2.2`. If any is not part of its
  public export map, that is a real finding — record it in §10 and do **not** work around it
  by deep-importing into `dist/`.

### 5.3 Licence it

`LICENSE` in the new repository, and `packages/studio/LICENSE` in this one until §6 removes
it:

```
Copyright (c) 2026 João Paulo Furtado. All rights reserved.

No licence is granted to use, copy, modify, or distribute this software.
Use requires a written agreement with the copyright holder.
```

Set `"license": "SEE LICENSE IN LICENSE"` in the Studio `package.json`. **Never set it to
`MIT`.**

### 5.4 Prove it builds

The new repository is not done until `pnpm install && pnpm build` succeeds in it from a clean
clone, with `create-threenative` coming from the registry. Paste the output. A seeded
repository that has never been built is a migration that has not happened.

---

## 6. Phase 4 — remove Studio from this repository

**Only after §5.4 is green.** Order matters: the private repository must build before this
one stops being able to.

### 6.1 Delete

```sh
git rm -r packages/studio hosting
git rm scripts/studio-probe.ts scripts/studio-inspect.ts scripts/studio-loop.ts
git rm scripts/__tests__/studio-probe.spec.ts scripts/__tests__/studio-loop.spec.ts
```

A plain deletion commit. **No history rewriting** (§1.3).

### 6.2 Unwire

| File | Change |
|---|---|
| root `package.json` | remove `studio:probe`, `studio:inspect`, `studio:loop`, `hosting:build`, `hosting:up`, `hosting:migrate` |
| `AGENTS.md:132-134` | remove the three `pnpm studio:*` command lines, then run `pnpm sync:agents` |
| `hosting/AGENTS.md`, `hosting/CLAUDE.md` | deleted with the directory |
| `.github/workflows/npm-release.yml:73` | remove `#   @threenative/studio` from the publish list comment — `pnpm publish:check` parses that comment block and asserts every non-private package appears in it |
| `packages/create-threenative/src/index.ts:26,196,347` | remove the `"@threenative/studio"` union member, the name comparison, and the `--studio-package` flag |
| `packages/create-threenative/__tests__/publication.spec.ts:12-13` | drop `"studio"` from the publishable set; its comment ("Every template declares it") stops being true |
| `packages/create-threenative/__tests__/scaffold.spec.ts:505-525` | delete the `--studio-package` cases |
| templates `starter`, `minimal`, `platformer` | remove `"@threenative/studio": "0.2.0"` from `devDependencies` |
| `scripts/make-sandbox.ts` + its spec | remove Studio wiring |
| `scripts/__tests__/release.spec.ts`, `verify-golden-path.spec.ts`, `template-baseline.spec.ts` | drop Studio expectations |

### 6.3 The visual gate — decide, then act

`scripts/visual-gate.ts:92` defines `STUDIO_ASSET_ROOT` as `packages/studio/assets`. Before
deleting anything, run `pnpm exec vitest run scripts/__tests__/visual-gate.spec.ts` and read
what that constant is actually used for.

- If the gate only reads Studio's own assets, **it moves to the private repository** with
  Studio.
- If it also gates engine or template visuals, **it stays** and only the `STUDIO_ASSET_ROOT`
  branch is removed.

Do not guess. Record which it was, in the commit message.

### 6.4 Green again

`pnpm typecheck && pnpm lint && pnpm test` must pass with Studio gone. Then
`pnpm publish:check` — it will fail loudly if the npm-release comment list and the actual
publishable set disagree, which is exactly what it is for. Paste both outputs.

---

## 7. Phase 5 — the strategy documents

Both files in §1.4 currently promise what §1.1 revokes. Fix them **as a recorded change of
position, not a silent edit.**

1. `docs/strategy/BUSINESS-MODEL.md` — move "Local Studio" out of *Never charged for* and
   into *Charged for*. Add one dated line under the table: the position changed on
   2026-08-16, the engine stays MIT and free, the editor is the paid surface.
2. `docs/strategy/POSITIONING.md:57` — remove `studio` from the list of open-source runtime
   packages, leaving six. Line 61's "Runtime stays permissively licensed and fully usable
   offline" is **still true and gets stronger**, because the runtime is now unambiguously MIT
   with no editor attached. Keep it.
3. `docs/strategy/CONFLICTS.md` — if the Studio question is one of its tracked conflicts,
   update that entry to *resolved, 2026-08-16*. If it is not tracked there, do not add it;
   that file tracks charter conflicts, and the charter never promised an open editor.
4. `docs/README.md` and `docs/PRDs/studio-hosting/README.md` — repoint or annotate. The
   studio-hosting PRD series now describes work that lives in another repository; say so at
   the top of its README rather than deleting the series.

---

## 8. The npm state — read before touching the release lane

- `@threenative/studio@0.2.0` **stays published.** It cannot be unpublished after 72 hours.
- Run `npm --userconfig .npmrc deprecate @threenative/studio@0.2.0 "<message>"` with a message
  pointing at where Studio now lives. Deprecation is a warning on install, not a removal.
- **Keep the `@threenative/studio` name.** Publishing future paid versions under the name you
  already own is worth more than the tidiness of abandoning it.
- Version 0.2.0 was published with no `license` field, so it granted nothing. **Do not
  retroactively publish an MIT version of Studio to "clean up" the record.** That would grant
  in perpetuity exactly the rights this PRD exists to withhold.
- Registry commands use the repository-local `.npmrc`. Pass it explicitly, never print it,
  keep it untracked.

---

## 9. Acceptance criteria

Paste the output of each. Never record a gate you did not run.

1. `LICENSE` exists at the root and is unmodified MIT text with the correct copyright line.
2. Every remaining `packages/*/package.json` declares `"license": "MIT"` — verify with a loop
   over all of them, not a sample. Expected count after §6: **six**.
3. `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`,
   `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`,
   `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml` all
   exist and are non-empty.
4. `gh repo view jonit-dev/threenative-studio --json visibility` → `PRIVATE`, and
   `pnpm install && pnpm build` succeeds in a clean clone of it.
5. `git ls-files packages/studio hosting | wc -l` → `0` in this repository.
6. `grep -rn "@threenative/studio" packages scripts templates .github --include='*.ts' --include='*.json' --include='*.yml'`
   returns nothing outside `docs/`.
7. `pnpm typecheck && pnpm lint && pnpm test` green. Read the **error** count from lint, not
   the warning count.
8. `pnpm publish:check` exits 0 with six packages in the publish set.
9. `npm --userconfig .npmrc view @threenative/studio` shows `0.2.0` deprecated with a pointer
   message, and no version above `0.2.0` published from this repository.
10. **`git log --oneline | wc -l` is unchanged and `git log -1 --format=%H` on `main` still
    resolves the pre-existing history.** No SHA cited in any `docs/` file has become
    unresolvable — spot-check ten of the 197 with `git cat-file -e <sha>^{commit}`.
11. `docs/strategy/BUSINESS-MODEL.md` no longer lists Local Studio as never-charged-for, and
    `docs/strategy/POSITIONING.md` lists six open-source packages, not seven.

---

## 10. Out of scope

- **Rewriting git history.** §1.3. Explicitly forbidden in this PRD.
- **Unpublishing `@threenative/studio@0.2.0`.** Not possible; §8.
- **A CLA.** §4.1 point 8 — one sentence in `CONTRIBUTING.md`, no signing infrastructure.
- **Pricing, licence keys, or any paywall mechanism for Studio.** This PRD establishes the
  legal and repository boundary. What gets charged and how it is enforced is a separate
  product decision with no code here.
- **Preserving Studio's 40 commits of history in the new repository.** Optional, §5.1 step 3.
- **Per-package `README.md` files** for `core`, `ui`, `runtime-native`. Still missing, still
  rendering blank npm pages, still a follow-up.
- **Whether the strategy in §7 is right.** The position changed by owner decision; this PRD
  records it, it does not argue it.

PRD-125 §3.2 step 9 defers the README's licence section to this document. Once §3 lands, that
step is unblocked and the new README states MIT plainly.

When every criterion in §9 is met, `git mv docs/PRDs/PRD-129-licensing-and-the-studio-split.md
docs/PRDs/done/` in the same commit that finishes it.
