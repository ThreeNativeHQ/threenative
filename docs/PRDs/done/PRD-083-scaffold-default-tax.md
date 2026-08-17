---
prd_contract: v1
---

# PRD-083 — The default scaffold is the expensive one: `pnpm create threenative` hands a small game 1,073 lines when 483 would do

**Status: COMPLETE, 2026-08-12.** Resolution B kept `starter` as the default and added one
line that names all template choices. Executed evidence is recorded in
[`scaffold-default-2026-08-12.md`](../../verification/scaffold-default-2026-08-12.md). Browser
template playtests ran; no native host or device ran, so no desktop, mobile, Android, or iOS
readiness claim is made.

**The first command a user runs picks a template for them, and picks the one the project's own
value ledger says is a net loss at small sizes.**

```ts
// packages/create-threenative/src/index.ts:185
const template = options.template ?? "starter";
```

There is no prompt and no printed alternative. `--template` is a flag a user has to already
know exists.

| Template | `src/` LOC (`wc -l`, 2026-08-12) |
|---|---:|
| `minimal` | 483 |
| `starter` | **1,073 ← the default** |
| `platformer` | 1,455 |

And the project's own scoring, on axis 1 *"there is something to run in a minute"*:

> **16/20** — gated and green, but the starter is a net *cost* below ~500 LOC (+442 on the
> endless-runner arm)

Both halves of that sentence are ours. **We measured the default as a tax and left it as the
default.** Every user building something small starts 590 lines behind, and the deletion is
work they do before they write a line of their own game.

**Complexity: 4 → STANDARD mode.** The change itself is one line. The hazards are that the
number justifying it is inherited rather than re-measured, and that "improve the scaffold"
turns into a template redesign nobody asked for.

**This PRD does not redesign, trim, or refactor any template.** Templates are generated user
source; a line there is the user's to keep or delete, and template LOC is reported, never
capped. The subject is **which one a user gets when they do not choose**, and whether they are
told there is a choice.

**Blast radius (candidate, phase-gated).**
Phase 0: nothing — measurement only, into `docs/verification/`.
Phase 1: `packages/create-threenative/src/index.ts`,
`packages/create-threenative/__tests__/`, `packages/create-threenative/README.md`, root
`README.md` if it names the default.

**Depends on:** nothing. **Unblocks:** the 4 points docked from axis 1.

---

## 1. What is actually known, and what is not

**Known.** The default is `starter` (`index.ts:185`). `starter` is 1,073 lines of `src/` and
`minimal` is 483. All three templates scaffold and playtest green on every CI run; this is not
a quality problem with any of them.

**Inherited, not re-measured here.** The `+442` figure comes from the endless-runner sweep arm
recorded in axis 1. It is one genre, one brief, and it is the reason this PRD exists rather
than evidence that closes it. **Phase 0 re-measures on a fresh scaffold** — because a 2026-08
default should not be changed on a number nobody re-ran.

**Not known, and Phase 0 answers it:** of the starter's 1,073 lines, how many survive contact
with a small game? A template whose lines are mostly deleted is a tax. A template whose lines
are mostly kept is a head start, and this PRD is then rejected on its own evidence.

## 2. Why this is user value

Axis 1 is *"start a project"* — the first sixty seconds. The framework's promise is that the
scaffold saves work. For the smallest and most common first project, the default measurably
does the opposite, and the cheaper option exists, ships, and is CI-green today. **The user is
not being offered a bad template; they are being offered no choice at the one moment the
choice is cheap.**

This is a framework defect, not a template defect. The fix belongs in
`packages/create-threenative/src/`, not in any `templates/` directory.

### The no-regression constraint — binding

**Nothing that works today may behave differently after this PRD except which template a
no-flag scaffold produces.** A default is a silent input to every caller that omits it, so the
census comes before the change, not after.

The planning census at `fd6dc38` claimed every existing caller was explicit. The execution
rerun found an existing implicit test caller and one omitted explicit production caller:

| Caller | Passes `template`? |
|---|---|
| `scripts/verify-template-playtests.ts:25` | yes, per template |
| `scripts/visual-gate.ts:278`, `:361` | yes, per template |
| `scripts/profile-starter.ts:321` | yes, `"starter"` literal |
| `scripts/make-sandbox.ts:486` | yes, `readFlag("--template", "starter")` — its own default, unaffected |
| `.github/workflows/ci.yml:101`, `:243` | yes, `--template starter` / `--template platformer` |
| `.github/workflows/native-platforms.yml:177`, `:238` | yes, `starter` / `minimal` |
| `.github/workflows/native-release.yml:302`, `:446` | yes, `--template minimal` |
| `packages/runtime-native/tests/starter-desktop.test.mjs:44` | asserts the workflow text contains `--template starter` |
| `packages/create-threenative/__tests__/scaffold.spec.ts` | no; existing test-only call |
| `packages/runtime-native/scripts/profile-production.mjs` | yes, `platformer` |

The implicit test caller activated the specified safe fallback to Resolution B. Production
callers remain explicit, and `scripts/make-sandbox.ts` retains its separate default.

**Phase 1 re-runs this census before editing `index.ts:185` and stops if a single caller has
become implicit.** An implicit caller is a behaviour change hiding behind a one-line diff.

Also binding, and each is an acceptance criterion:

- [x] `scripts/make-sandbox.ts`'s own `"starter"` default is **not** changed. It is a separate
      knob for a separate job.
- [x] The existing stdout line `Created ${template} project at ${target}` keeps its exact
      shape. Resolution B **appends** a line; it does not reword or reorder an existing one.
- [x] `--template` continues to outrank the default for all three names, proved by a test per
      template, not by one test on the new default.
- [x] `--no-install`, `--core-package` and every other flag parse identically. `parseArgs`
      keeps its current shape and its existing test at
      `packages/create-threenative/__tests__/scaffold.spec.ts:278` passes unedited.
- [x] `ScaffoldTemplate` keeps all three names and `TEMPLATE_NAMES` keeps its order. No
      template is removed, renamed, deprecated or hidden.
- [x] `pnpm test:templates` covers all three templates after the change, not only the new
      default, and CI's `scaffold-smoke` still scaffolds every template it scaffolds today.
- [x] The unknown-template error messages at `index.ts:187` and `:232` keep naming all three.

**If any of the above cannot hold, resolution B (print the choice, keep the default) ships
instead of A.** The user's benefit here is worth one line of code, not one behaviour change
anybody has to debug.

## 3. Solution

Phase 0 produces one number. Phase 1 spends it on exactly one of three resolutions, and
records which and why.

| | A — default to `minimal` | B — keep `starter`, print the choice | C — reject the PRD |
|---|---|---|---|
| When it is right | most of the starter's lines are deleted by a small game | the lines are largely kept, but users do not know `minimal` exists | the starter's lines are kept and users already choose deliberately |
| User cost | a user wanting more types one flag | one extra line of output | none |
| Risk | a first-run experience with less to look at | the line is ignored, nothing changes | axis 1 stays at 16/20 |

**Executed resolution: B.** The file-level measurement retained 15/18 starter paths, and the
implicit test caller independently triggered the safe fallback. `starter` remains the
default; one appended line makes every choice visible.

**Key decisions:**

- [x] **No interactive prompt, no wizard, no new CLI vocabulary.** A bespoke CLI is a closed
      question and this PRD does not reopen it. One printed line and a flag that already
      exists.
- [x] **No template source is edited.** Not trimmed, not merged, not refactored.
- [x] The number in Phase 0 decides between A, B and C. **If it says C, this PRD is closed as
      rejected and that is a successful outcome**, recorded with its evidence.
- [x] Whatever ships, the default is stated in `README.md` where a user reads it, once.

## 4. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | The measured retention number | `docs/verification/scaffold-default-2026-08-12.md`, cited by axis 1 | the inherited `+442` from one sweep arm | no — the sweep figure is retained as history | n/a (measurement); §5 lists the commands |
| 2 | Changed default (A) or printed choice (B) | `packages/create-threenative/src/index.ts:185`, reached by every `pnpm create threenative` with no `--template` | `?? "starter"` | yes, the old default line is replaced | pass `--template starter` explicitly → the user still gets the starter, proving the flag outranks the default |
| 3 | Default-scaffold test | `packages/create-threenative/__tests__/`, run by `pnpm test` | no test asserts which template a no-flag scaffold produces | n/a, an absence | revert the default → the test goes red |

### Reachability

**How is this reached?** `pnpm create threenative my-game`, with no flag. That is the
documented first command.
**Pre-existing files edited:** `packages/create-threenative/src/index.ts`, its README, the
root README if it names a default.
**User-facing?** Yes — which files exist in their new project.

## 5. Execution phases

### Phase 0 — Measure the tax on a fresh scaffold

**Outcome:** one number — the share of the default scaffold's `src/` a small game keeps.

**Files (max 5):**

- `docs/verification/scaffold-default-2026-08-12.md` — NEW

**Method:**

```sh
# 1. Current sizes, recorded verbatim rather than quoted from this PRD
for t in minimal starter platformer; do
  echo -n "$t "; find packages/create-threenative/templates/$t/src -name '*.ts' -o -name '*.tsx' \
    | xargs wc -l | tail -1
done

# 2. Scaffold both candidates into the scratch dir and diff what a small game would keep
pnpm create threenative /tmp/tn-default --template starter --no-install
pnpm create threenative /tmp/tn-minimal --template minimal --no-install

# 3. The repo's own LOC classifier, which is what the value ledger uses
pnpm tsx scripts/count-loc.ts
```

**The retention judgement must not be an opinion.** Use the archived endless-runner framework
arm under `docs/benchmark/sweeps/` — a real small game built on a real scaffold — and count
which scaffolded `src/` files survived into it and which were deleted. That is a file-level
count from tracked evidence, reproducible by anyone, and it is the whole of Phase 0.

**Fail-closed condition:** if the archive does not record its starting template, Phase 0
reports **unmeasured** and Phase 1 does not run. It does not substitute a guess.

### Phase 1 — Spend the number

**Runs only if Phase 0 produced a number.** Files (max 5):

- `packages/create-threenative/src/index.ts` — EDIT: the default, and/or one printed line
  naming the other templates
- `packages/create-threenative/__tests__/scaffold.spec.ts` — EDIT: pin the default
- `packages/create-threenative/README.md` — EDIT: state the default and the flag
- `README.md` — EDIT only if it names a default today

**Tests required:**

| Test file | Test name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `create-threenative/__tests__/scaffold.spec.ts` | `should scaffold the documented default with no --template` | the produced project matches the documented default | revert `index.ts:185` → red |
| `create-threenative/__tests__/scaffold.spec.ts` | `should honour --template over the default for each of the three templates` | `minimal`, `starter` and `platformer` each scaffold themselves when named | make the default unconditional → red for the two non-default names |
| `create-threenative/__tests__/scaffold.spec.ts` | `should keep the existing created-project stdout line unchanged` | the `Created … project at …` line matches its current shape | reword that line → red, proving B's extra line was appended and not substituted |

**Regression gate for Phase 1, run before the edit and again after:**

```sh
# Every scaffold caller must name its template. An implicit one means the
# one-line default change is a behaviour change somewhere else.
grep -rn "createProject(" scripts packages/*/src packages/*/__tests__ | grep -v node_modules
grep -rn -- "--template" scripts .github packages | grep -v node_modules
# Expected: the eight explicit call sites listed in §2, unchanged. A caller that
# omits `template` stops Phase 1.
```

**User verification:**

- Action: `pnpm create threenative demo` with no flags
- Expected: the documented default, and output that names the alternatives in one line

## 6. Verification strategy

```sh
# 1. The default is stated once and matches the code
grep -rn "starter\"" packages/create-threenative/src/index.ts
grep -rn "default" packages/create-threenative/README.md

# 2. No template source moved
git diff --stat packages/create-threenative/templates
# Expected: empty. A non-empty diff here means the PRD grew a template redesign and must stop.

# 3. CI's scaffold-smoke still covers all three
grep -rn "template" .github/workflows/*.yml | head
```

**Evidence required:**

- [x] `pnpm typecheck && pnpm lint && pnpm test` green
- [x] `pnpm test:templates` green — all three templates, not only the new default
- [x] `pnpm budgets` green; template LOC reported, never capped
- [x] Phase 0's number recorded with the commands that produced it
- [x] Both Phase 1 negative controls observed red with their commands

## 7. Acceptance criteria

Consumer-scoped.

- [x] **A user who runs `pnpm create threenative my-game` with no flags gets the template the
      evidence supports**, and the choice is named in the output.
- [x] **Reverting the default turns a test red**, proved by running it.
- [x] **`git diff --stat packages/create-threenative/templates` is empty.** No template source
      was edited by this PRD.
- [x] **No functionality regression.** Every box in §2's no-regression constraint is checked,
      the caller census was re-run before the edit, its mismatch selected Resolution B, and
      `pnpm test`,
      `pnpm test:templates` and CI's `scaffold-smoke` cover the same three templates they cover
      today. Any single failure here downgrades the change to resolution B.
- [x] **Phase 0's number is in a dated verification file**, and axis 1 in
      `VALUE-PROPOSITION.md` cites it rather than the inherited sweep figure.
- [x] Resolution C was not selected; its no-code closure condition was not applicable.

**What this PRD may not claim:** that any template is better, that axis 1 is now 20/20, or
that scaffold time improved. It changes which files a user starts with, and says how many.
