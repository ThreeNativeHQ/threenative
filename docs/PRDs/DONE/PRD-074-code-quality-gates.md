---
prd_contract: v1
---

# PRD-074 — Quality signals an agent can act on, and the one convention the repo is split on

**Status: IMPLEMENTED, 2026-08-11.** The quality instrument, baseline, interface rename, and
review repairs are committed. The §2 measurements that describe the starting tree remain
labelled as measurements; the delivered baseline and rename totals are corrected below. This
PRD makes no runtime or device claim: native and physical-device evidence remain outside its
static-analysis scope.

Two things ship here, deliberately different in kind. **Four of the five signals report and
never block** — a threshold that fails a build gets routed around, and a smell is a judgement
call an agent should make with the number in front of it. **The fifth, the interface `I`
prefix, is enforced**, because it is not a judgement call: before implementation, the
repository was split 89-to-0 on it along a line nobody drew. The implementation renamed 112
distinct old names across 116 declaration rows, took the tree to zero violations, and turned
the rule on as an error, so it holds a line instead of nagging about a backlog.

**Complexity: 6 → HIGH mode.** A new script in the shape of two that already exist, plus a
rename across **98 files that reaches the public type surface of `@threenative/core`** —
`Ctx` becomes `ICtx` in 21 template and example files, `PhysicsContext` becomes
`IPhysicsContext` in 29. That half is mechanical but it is not small, and it is a breaking
change for anyone who has typed against these names.

**Blast radius:** `biome.json`, `scripts/check-quality.ts` (new),
`scripts/__tests__/check-quality.spec.ts` (new), root `package.json` scripts,
`docs/verification/quality-baseline.json` (new), `AGENTS.md` + `packages/core/AGENTS.md` +
their generated `CLAUDE.md` mirrors, one step in the existing `budgets` CI job — **plus the
rename: 112 distinct interface names across 116 declaration rows in
`packages/{core,physics,ui,create-threenative,
playtest}/src`, their tests, `packages/create-threenative/templates/**`, and `examples/**`;
98 files in total.** No new dependency, no class renamed, no CI job from green to red, and
**no archived evidence file rewritten** (§9).

**Depends on and does not overlap:**

- `scripts/check-budgets.ts` owns **how many lines the framework spends in total** and the
  hard native-absorption invariants. This PRD owns **the shape of those lines** — per-file and
  per-function signals — and must not add, move, or waive a budget number.
- `pnpm round:deletions` (PRD-021, PRD-063) owns **unreached exports**. This PRD does not
  duplicate dead-code detection.
- `scripts/count-loc.ts` owns the **benchmark** LOC comparison between the two arms. Untouched.
- PRD-073 owns **runtime** performance instrumentation. This PRD is static analysis only and
  produces no runtime claim.

## 1. Why this exists

An agent working in this repository has exactly one static instrument, `pnpm lint`, and it
answers one question: *did you break a rule Biome recommends by default?* It cannot answer the
question that actually precedes a refactor — *where is this codebase getting hard to change?*
— and it is structurally blind in two directions at once.

**It is blind by configuration.** `biome.json:7-8` ignores `packages/playtest/**` and
`packages/runtime-native/**`. Those two directories contain the largest and most tangled
TypeScript in the repository. The single most complex function in the workspace scores **255**
on cognitive complexity, lives in `packages/playtest/src/assertions.ts`, and `pnpm lint` has
never looked at it.

**It is blind by capability.** Biome 1.9.4's default `recommended` set contains no rule about
file length, function length, or complexity — `noExcessiveCognitiveComplexity` exists in the
`complexity` group but is off unless you ask for it. So a 2,290-line file and a 40-line file
are indistinguishable to every gate this repository runs.

The consequence is specific and it is already visible in the tree: **the repository is split
down the middle on interface naming, and nothing reports it.** `packages/playtest` prefixes
89 of its 97 interfaces with `I` (`IAndroidPlaytestDependencies`,
`packages/playtest/src/runner/androidRunner.ts:37`). `core`, `physics`, `ui` and
`create-threenative` prefix **zero of 85** (`AssetLoaderOptions`,
`packages/core/src/assets.ts:3`). Neither convention was decided; the split is an artefact of
which directory Biome happens to ignore. An agent reading one package and writing into the
other has no way to know which house style it is in.

This is the same failure the repository already named once in `check-budgets.ts`: *"A number
that fails the build invites being routed around; a number that is merely loud does not."*
There are no loud numbers here yet for anything smaller than a package.

### Two kinds of rule, and why the naming one is the exception

**A threshold is a judgement, so it reports.** Nobody can say from outside whether a 610-line
file or a complexity-30 function is wrong; it depends what the function does. A gate that
*blocks* on a number like that is the rigid instrument that gets a `biome-ignore` stapled to
it and stops meaning anything. Signals 1, 2, 4 and 5 in §5 therefore never fail a build.

**A convention is a coin flip, so it enforces.** There is no argument that `AssetLoaderOptions`
is better or worse than `IAssetLoaderOptions`; there is only an argument that a codebase
should pick one. This one has picked both, in different directories, by accident. Reporting
that costs an agent a decision on every new interface it writes, forever, and the count drifts
either way. **So this PRD renames to `I*` everywhere and turns the rule on.** Once the tree
is at zero violations the rule costs nothing to hold, which is exactly the condition under
which a blocking rule is honest.

The rename is the expensive half; §2.3 and §2.4 price it before §6 spends it.

## 2. What was measured, and what shipped

The starting-tree measurements below were produced by running the pasted commands. Full JSON
outputs are reproducible; nothing here is a code read. Delivered counts are called out where
the implementation changed the measured tree.

### 2.1 Cognitive complexity — 39 functions over the default threshold

```sh
pnpm exec biome check --config-path=<tmp> --reporter=json --max-diagnostics=none \
  packages/{core,physics,ui,playtest,create-threenative}/src
# tmp config: complexity/noExcessiveCognitiveComplexity = warn, maxAllowedComplexity 15
```

39 functions exceed 15. Distribution and worst offenders:

| Score | Count | | File | Score |
| --- | --- | --- | --- | --- |
| 16–19 | 9 | | `packages/playtest/src/assertions.ts` | **255** |
| 20–29 | 18 | | `packages/playtest/src/scenario.ts` | 92 |
| 30–49 | 6 | | `packages/playtest/src/scenario.ts` | 86 |
| 50+ | **6** | | `packages/core/src/collapse.ts` | **74** |
| | | | `packages/playtest/src/runner/androidRunner.ts` | 63 |
| | | | `packages/physics/src/plugin.ts` | 52 |

By package: playtest 26, physics 6, core 5, create-threenative 2. **Two of the five worst are
in packages Biome lints today** (`collapse.ts` at 74, `plugin.ts` at 52) — this is not only a
salvage problem.

`collapse.ts` is uncommitted work in progress at the time of writing. That it lands at 74
without any gate noticing is the entire argument for this PRD in one file.

### 2.2 Interface naming — a clean split along the lint-ignore boundary

```sh
grep -rn "interface [A-Z]" packages/<pkg>/src --include="*.ts" | wc -l
grep -rn "interface I[A-Z]" packages/<pkg>/src --include="*.ts" | wc -l
```

| Package | Interfaces | `I`-prefixed | Linted by Biome today |
| --- | --- | --- | --- |
| playtest | 97 | **89** | no |
| core | 50 | 0 | yes |
| physics | 31 | 0 | yes |
| create-threenative | 3 | 0 | yes |
| ui | 1 | 0 | yes |

### 2.3 The cost of enforcing the `I` prefix with Biome, measured both ways

`style/useNamingConvention` can express the prefix, but in 1.9.4 enabling it for one selector
also activates its default conventions for **everything else** — variables, properties, import
namespaces. Measured on `core`, `physics`, `ui`, `create-threenative`:

| Config | Interface-prefix diagnostics | Collateral diagnostics |
| --- | --- | --- |
| `conventions: [{ selector: interface, match: "I(.*)" }]` | 90 | **92** (64 of them "two consecutive uppercase") |
| same, plus `strictCase: false`, `requireAscii: false` | 82 | **14** |

`strictCase: false, requireAscii: false` is therefore the configuration this PRD adopts: it
keeps the prefix rule and drops 78 of the 92 collateral diagnostics, which are almost entirely
Biome objecting to acronyms this repository uses on purpose (`GPUParticles3DOptions`,
`WebGPU`, `TSL`). The remaining 14 are fixed by hand in Phase 2 and listed in the commit.

### 2.4 What the rename actually costs, enumerated

```sh
grep -rho "export interface [A-Z][A-Za-z0-9_]*" packages/{core,physics,ui,create-threenative}/src
grep -rho "^interface [A-Z][A-Za-z0-9_]*"       packages/{core,physics,ui,create-threenative}/src
for n in $names; do grep -rlw "$n" packages/*/src packages/*/__tests__ \
  packages/create-threenative/templates examples --include="*.ts" --include="*.tsx"; done | sort -u | wc -l
```

| Fact | Measured |
| --- | --- |
| Interface names renamed | **112 distinct old names across 116 declaration rows** |
| Files touched | **98** `.ts`/`.tsx` across packages, tests, templates, examples |
| Names on the public one-page API (`index.ts`) | **25** |
| Names referenced from templates and examples | 8 names across **43 files** |
| Heaviest two | `Ctx` (21 files), `PhysicsContext` (29 files) |
| Name collisions with `three`, `zustand`, `@dimforge` imports | **0** — checked, no imported identifier shares a name |
| Collisions with a `THREE.*` class name | **0** |

Zero collisions is what makes a per-symbol mechanical rename safe here rather than merely
fast. The two heavy names are the real cost and the PRD does not soften it: **`ctx: Ctx`
becomes `ctx: ICtx` in every scene a user writes**, and that is the shape a scaffolded game
sees on line one. The owner has taken that trade; Phase 2 executes it rather than re-litigating
it.

### 2.5 File length — three files carry a fifth of the framework

77 TypeScript files in `packages/*/src` outside the native runtime:

| Bucket | Files | |
| --- | --- | --- |
| > 800 lines | **3** | `assertions.ts` 2290, `scenario.ts` 1617, `runner.ts` 868 |
| 501–800 | 3 | `collapse.ts` 609, `simulation.ts` 584, `game.ts` 523 |
| 301–500 | 4 | |
| ≤ 300 | 67 | |

The three files over 800 lines are all in `packages/playtest`, all unlinted, and together are
4,775 lines — roughly a third of the 15,015 lines those 77 files hold, and 8,360 of that total
is `packages/playtest` alone.

### 2.6 Suppression census — nearly clean, and worth keeping that way

```
biome-ignore comments in packages/**/*.ts .............. 1
@ts-ignore / @ts-expect-error in packages/*/src ........ 0
as any in packages/*/src (excl. runtime-native) ........ 0
as unknown as in packages/*/src (excl. runtime-native) . 10
TODO / FIXME / HACK in packages/*/src .................. 0
unused suppression comments (Biome reports one) ........ 1  packages/core/src/scene.ts
```

This is a good number and there is currently no mechanism that would notice it getting worse.
A ratchet costs almost nothing here precisely because the baseline is near zero.

### 2.7 What un-ignoring `packages/playtest` would cost right now

```sh
# repo biome.json with the packages/playtest/** ignore removed
pnpm exec biome check --config-path=<tmp> --reporter=json packages/playtest/src
```

89 diagnostics, **all severity `error`**: `noNonNullAssertion` 38, formatting 25,
`organizeImports` 12, `noForEach` 8, `noParameterAssign` 3, four others. 37 of the 89 are
auto-fixable by `biome check --write`. **This means un-ignoring playtest wholesale turns
`pnpm lint` red**, which is why §6 does it as a warn-severity override and not as a deletion
from the ignore list.

## 3. The four properties the instrument must have

1. **Thresholds report; they never block.** Exactly the split `check-budgets.ts` already draws
   between `budgetErrors` (fatal invariants) and `budgetTriggers` (loud, non-fatal). Every
   *threshold* this PRD adds is a trigger. Verified: Biome exits **0** when the only
   diagnostics are severity `warn` (`--error-on-warnings` is the opt-in, and CI must not pass
   it). The naming convention is the single exception and it earns that by being at zero
   violations when the rule is switched on — a rule with no backlog cannot be routed around.
2. **It ratchets from a baseline.** A signal with 39 pre-existing hits is noise on hit 40. The
   script writes `docs/verification/quality-baseline.json` once, then reports **new** versus
   **inherited** separately. New violations are what an agent acts on; inherited ones are what
   a refactor PRD picks up deliberately.
3. **It fails closed.** A missing baseline is an error telling you to run
   `--update-baseline`, never a silent pass. A malformed baseline throws. A waiver comment
   without a reason string is a violation. This is the same rule the playtest harness exists
   to enforce, applied to itself: *a check that reports green while asserting nothing is the
   most dangerous thing in this repository.*
4. **It is machine-readable.** `pnpm --silent quality --json` emits one object per finding with
   `file`, `line`, `signal`, `value`, `threshold`, `state: new|inherited|waived`. An agent
   reads that and picks a target; a human reads the text form.

## 4. Tool decision — Biome plus one script, and why not Sonar

| Option | Cost to add | Fit |
| --- | --- | --- |
| **Biome rules at `warn`** (chosen) | zero — 1.9.4 is already the lint and format owner | Covers complexity and rule-shaped smells. Already in CI, already understood by every agent working here. |
| **One repo script** (chosen) | ~150 lines, `tsx`, no dependency | Covers what Biome 1.9 cannot express: file length, naming census, suppression census, lint-coverage holes. Same shape as `check-budgets.ts` and `count-loc.ts`, so it needs no new mental model. |
| SonarQube / `sonar-scanner` | Java runtime, a server or SonarCloud account, a token in CI, a web UI | **Rejected.** SonarLint is an IDE plugin — there is no local CLI that produces a report without a server. Every gate in this repository is offline, local and file-shaped by design, and its ruleset would largely restate Biome's. |
| ESLint + `typescript-eslint` | ~40 transitive packages, a second lint config | **Rejected.** Biome owns lint and format here; two linters means two sources of truth and a rule-precedence argument at every disagreement. Revisit only if a needed signal is expressible in neither Biome nor a script. |
| `knip` / `ts-prune` | one dependency | **Rejected as duplicate.** `pnpm round:deletions` already owns unreached exports with two rounds of evidence behind it. |

**Reopen condition, stated so it does not have to be re-argued:** if three or more wanted
signals turn out to need real type-aware analysis (cross-file taint, exhaustive nullability),
`typescript-eslint` gets reconsidered in a PRD of its own, with the list of three named.

## 5. The five signals

Thresholds live in one `LIMITS` const at the top of `scripts/check-quality.ts`, in the style
of `check-budgets.ts`. Every one is tunable in one line, and every one except signal 3 is a
**review trigger** — the numbers below are starting points chosen from §2, not laws. Signal 3
is the enforced convention and has no threshold to tune.

| # | Signal | Mechanism | Default | Why that number | What an agent does with it |
| --- | --- | --- | --- | --- | --- |
| 1 | Function cognitive complexity | Biome `complexity/noExcessiveCognitiveComplexity`, `warn` | 15 | Biome's own default; §2.1 shows it separates 39 functions from 500-odd | Split the function, or take it as the target of a refactor PRD |
| 2 | File length | script | 400 notice / 800 loud | §2.5: 400 is the top decile, 800 isolates the three outliers | Ask what second concern the file grew; often it is a module boundary |
| 3 | Interface `I` prefix | Biome `style/useNamingConvention`, **`error`** | `match: "I(.*)"` on `selector.kind: interface`, `strictCase: false` | §2.3: zero violations remain after Phase 2, so the rule holds a line rather than reporting a backlog | Name it `IFoo`. There is nothing to decide |
| 4 | Suppressions | script | baseline 1 `biome-ignore`, 0 `@ts-*`, 10 `as unknown as` | §2.6 is near zero and cheap to hold | A new suppression needs a reason in the same commit |
| 5 | Lint-coverage holes | script | any `packages/*/src` path Biome ignores | §2.7: the ignore list is invisible today | Know that `pnpm lint` said nothing about this file |

**Signal 3 is the enforced one, and its scope is exact.** The rule fires on `interface`
declarations only.

- **Classes are never touched.** `RigidBody3D`, `Area3D`, `CharacterBody3D` and every other
  Godot-borrowed node name stays exactly as it is. The borrowed-vocabulary rule governs *what
  a thing is called*; the prefix is a type-level marker on the declaration kind, and applying
  it to a node class would rename vocabulary this repository does not own.
- **Type aliases keep PascalCase**, because `type` is used here for unions and function types
  where an `I` reads as a lie (`type LocKind = "plumbing" | "game"`).
- That leaves one real dodge: declaring an object shape as `type Foo = { … }` to avoid the
  prefix. The script reports object-literal type aliases as `signal: interface-in-disguise`
  — **reported, not enforced**, because a union that happens to be an object is a judgement
  call and rule 1 of §3 applies.

### Waivers, so the instrument stays usable

A line-level `// quality-allow: <reason>` suppresses one finding. **The reason string is
mandatory** — an empty or missing reason is itself a violation, reported as
`signal: waiver-without-reason`. A waiver older than the baseline it was written against is
reported as stale. This is the flexibility valve: the answer to a wrong threshold is a waiver
with a sentence, or a one-line threshold change, never deleting the signal.

## 6. Phases

**Phase 0 — build the instrument and freeze the baseline.** `scripts/check-quality.ts` with
signals 2–5, `pnpm quality` and `pnpm --silent quality --json` wired in root `package.json`,
`scripts/__tests__/check-quality.spec.ts` covering: a violation over threshold is reported; a
violation under it is not; a waiver with a reason is honoured; **a waiver without a reason is
itself reported**; a missing baseline throws; a malformed baseline throws. That last pair is
the fail-closed proof and is not optional. Baseline written to
`docs/verification/quality-baseline.json` and committed.

**Phase 1 — turn on the Biome half.** `complexity/noExcessiveCognitiveComplexity` at `warn`
with `maxAllowedComplexity: 15`, plus an `overrides` entry that keeps `packages/playtest/**`
diagnostics at **warn severity**, while the interface-prefix rule remains `error`, so §2.7's
diagnostics surface without turning `pnpm lint` red.
`pnpm lint` must still exit 0 on this tree with no source change; that is the phase's exit
criterion, and it is checked by running it, not by reasoning about it.

**Phase 2 — the rename: 112 distinct names across 116 declaration rows to `I*`, one package per
commit.** This is the phase that spends the §2.4 budget, and it is ordered so that a break is
caught by the narrowest possible gate.

1. **Freeze the worklist.** Write every interface name to rename, with its declaring file and
   its new name, to `docs/verification/interface-rename-2026-08-10.md`. Nothing outside that
   list is renamed. A name that turns out to be unsafe is struck from the list *with a reason*,
   never silently skipped.
2. **Rename package by package, in dependency order** — `ui` (1), `create-threenative` (3),
   `physics` (31), `core` (50), `playtest` (8 stragglers). Each package is one commit that
   contains the declarations, every reference in `src` and `__tests__`, and the package's
   `index.ts` export list. `pnpm typecheck && pnpm test` runs between packages, so a broken
   export map fails on the package that broke it — `publint` is part of each package's `test`.
3. **Mechanical, per symbol, verified by the compiler.** Rename one name at a time across the
   98-file set; `pnpm typecheck` is the oracle. §2.4 measured **zero** collisions with any
   identifier imported from `three`, `zustand` or `@dimforge`, and zero with a `THREE.*` class
   name, which is what makes this safe rather than merely quick. Any collision discovered
   during execution stops the rename of *that* symbol and is recorded in the worklist.
4. **Templates and examples last**, in their own commit: 43 files, dominated by `Ctx` → `ICtx`
   (21 files) and `PhysicsContext` → `IPhysicsContext` (29). `pnpm test:templates` and
   `pnpm test:playtest` are the proof, and both are re-run after this commit specifically —
   a scaffolded project that no longer typechecks is the failure mode this step exists to
   catch.
5. **Fix the 14 collateral diagnostics** §2.3 measured under `strictCase: false`, by hand,
   listed individually in the commit body.
6. **Turn the rule on** at `error` with `strictCase: false, requireAscii: false`, and run
   `pnpm lint` to prove zero violations. The rule lands **after** the tree is clean, never
   before — a rule switched on over a backlog is the thing §1 says gets routed around.
7. **Document the convention** in `AGENTS.md` under code conventions, one clause: *interfaces
   are `I`-prefixed; classes and type aliases are not*, with the class exemption stated so no
   agent renames a Godot node name.

Every commit in this phase is a rename **and nothing else**. A behaviour change smuggled into
a rename commit is unreviewable, and this is the phase where that is most tempting.

**Phase 3 — make it reachable.** One `pnpm quality` step added to the existing `budgets` CI
job (next to `pnpm budgets`, `.github/workflows/ci.yml:319`), and a short section in
`AGENTS.md` under Budgets: what the five signals mean, that signals 1, 2, 4 and 5 never fail a
build, that signal 3 does, and that the first move on a hard change is
`pnpm --silent quality --json`
on the files being touched. `pnpm sync:agents` regenerates the `CLAUDE.md` mirrors — a
hand-edited mirror is reverted by CI.

## 7. Acceptance criteria

1. `pnpm quality` runs on a clean tree, prints a report, and **exits 0**.
2. `pnpm --silent quality --json` emits one machine-readable record per finding with `file`, `line`,
   `signal`, `value`, `threshold`, `state`.
3. `pnpm lint` exits 0 on this tree after Phase 1, with the playtest diagnostics visible as
   warnings. Both the before and after runs are pasted in the closing commit.
4. `scripts/__tests__/check-quality.spec.ts` proves fail-closed behaviour: missing baseline
   throws, malformed baseline throws, a reasonless waiver is reported.
5. A deliberately introduced violation (a 900-line file, or a function at complexity 30) is
   reported as `new` and disappears when reverted. **Demonstrated by running it**, with output
   in the commit message.
6. `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` green.
7. The baseline file is committed and its counts match §2. If any count differs, §2 is wrong
   and the PRD is corrected rather than the baseline adjusted to fit.
8. **Zero unprefixed interfaces remain**, proved by a command, not a claim:
   `grep -rn "interface [A-Z]" packages/*/src --include="*.ts" | grep -v runtime-native |
   grep -v "interface I[A-Z]"` returns nothing. `pnpm lint` with signal 3 at `error` also
   returns zero — two independent checks, because one grep is not a gate.
9. `pnpm test:templates` and `pnpm test:playtest` green **after** the template rename commit.
   A scaffolded project that compiles is the only evidence that the public rename landed.
10. `docs/verification/interface-rename-2026-08-10.md` lists all 112 distinct old names across
    116 declaration rows with old name, new name, declaring file, and — for anything struck from
    the list — the reason it was struck.
11. **No archived evidence was edited**: `git diff --stat docs/benchmark/sweeps docs/verification/sweep-*.md`
    is empty across the whole PRD. Those files record what the API *was* on the day they were
    written; rewriting them to match today's names would falsify the record.
12. No class, node, or Godot-borrowed name was renamed, and no `type` alias gained an `I`.

## 8. Self-verification

```sh
pnpm quality                       # report, exit 0
pnpm --silent quality --json        # strict JSON-lines output; no pnpm script banner
pnpm lint                          # exit 0: warn-level playtest diagnostics, zero naming errors
pnpm exec vitest run scripts/__tests__/check-quality.spec.ts
pnpm typecheck && pnpm test && pnpm budgets
pnpm test:templates && pnpm test:playtest      # the rename reached a scaffolded project
grep -rn "interface [A-Z]" packages/*/src --include="*.ts" \
  | grep -v runtime-native | grep -v "interface I[A-Z]"   # must print nothing
git diff --stat docs/benchmark/sweeps docs/verification/sweep-*.md   # must be empty
pnpm exec vitest run scripts/__tests__/quality-json.spec.ts
pnpm sync:agents --check           # AGENTS.md edit is mirrored, not hand-written
```

## 9. Scope fence

This PRD ships an instrument, a baseline, and one rename. **The rename is the only refactor
it is authorised to make.** It does not split `assertions.ts`, does not simplify
`collapse.ts`, does not run `biome check --write` across `packages/playtest`, and does not
change a single line of behaviour — each of those is a change with its own review, and a
quality report is not authority to make it. If a signal fires somewhere interesting, the
output is a line in the round ledger and a candidate for a later PRD.

**The rename's own fence.** `interface` declarations only. Classes, node names, methods,
properties, `type` aliases, file names and directory names are untouched. Nothing in
`packages/runtime-native/` is renamed — its TypeScript is a native-host boundary and its C++
is out of scope entirely. Archived sweep and verification artefacts under
`docs/benchmark/sweeps/**` and `docs/verification/sweep-*.md` are **frozen**: they record the
API as it was on the day the evidence was taken, and an evidence file edited to match a later
rename is no longer evidence.

**This is a breaking change to published type names**, and the closing commit says so in one
line rather than letting a consumer discover it: 25 names on the one-page public API of
`@threenative/core` change, `Ctx` among them.

Template source under `packages/create-threenative/templates/**` is **reported and never
capped**, on the same reasoning that retired the template LOC cap on 2026-08-09: a line there
is generated user source, and the user's to keep or delete. The native runtime's C++ is out of
scope entirely — this instrument reads TypeScript.

No threshold — signals 1, 2, 4, 5 — is permitted to become fatal in this PRD. Making one fatal
is a separate decision that has to argue why the loud number was not enough. Signal 3 is fatal
by design and only because Phase 2 leaves it nothing to report.
