# quickwins-2026-09-04 — five closes, none of them needs the phone

**Status: OPEN — filed 2026-09-04 against `3090eb31`. Nothing in this batch has been executed.**
Five PRDs, pulled by reference from four folders. Estimated **10–15 hours of agent time total**,
fastest first.

Selection rule: a PRD is in this batch only if **(a)** its remaining work is bounded and already
decided — no open design question, no owner ruling, no spike — **(b)** every acceptance criterion
is provable by a command that runs on this machine, and **(c)** it does not depend on another
unstarted PRD. Everything that failed one of the three was left where it was, and §"Considered and
left out" says which and why.

## The device question, answered and closed

**No row in this batch touches the Pixel 8.** That is not caution; it is what the gate code says.

1. All four measurement scripts hard-code `requireDischarging: true` —
   `measure-cold-start.mjs:439`, `measure-android-js-engine.mjs:922`,
   `verify-android-physics-parity.mjs:578`, `scripts/engine-load-test/run-android.ts:169`. A
   charging phone is refused by `device-preflight.mjs:399` before any frame is measured.
2. The same preflight configurations require thermal `NONE`, and charging warms the phone into
   `LIGHT` on its own. Even without rule 1, a charging measurement would trip rule 2.
3. `adb shell dumpsys battery unplug` would make Android *report* discharging while the hardware
   keeps charging, which satisfies the gate and measures nothing. That is manufacturing a green
   against a repository whose stated invariant is fail-closed. **Not doing it.**

The phone was also unreachable at filing time — `adb devices` empty, and
`adb connect 192.168.1.192:5555` returned `No route to host`. That is a separate fact from the
above and does not change the ruling.

**So there is nothing here to be bugged about.** If a device lane is wanted later, the honest shape
is: phone on a real charger, `adb tcpip 5555` from USB, then unplug and connect over Wi-Fi — the
charge banked beforehand is what satisfies the discharging preflight. That is a different batch.

Everything below runs headless on this machine: `pnpm test`, `pnpm budgets`, and one desktop
playtest that provisions its own Xvfb.

## What this batch is

| # | PRD | Owning folder | Remaining work | Estimate |
|---|---|---|---|---|
| 1 | [PRD-278 — every template ships the render chain](../useful-defaults/PRD-278-every-template-ships-the-render-chain-and-says-what-ran.md) | `useful-defaults/` | **AC9 only.** AC1–AC8 are met and recorded. | 30–60 min |
| 2 | [PRD-353 — eleven copies of a fail-closed throw](../tech-debt-code-quality/PRD-353-eleven-copies-of-a-fail-closed-throw-drift-silently.md) | `tech-debt-code-quality/` | The whole PRD. Self-scored **2 → LOW**. | 1–2 h |
| 3 | [PRD-296 — three gates hiding behind a red one](../tech-debt-code-quality/PRD-296-three-gates-were-hiding-behind-a-red-one.md) | `tech-debt-code-quality/` | **Item 3 only** — items 1 and 2 already shipped. | 1–2 h |
| 4 | [PRD-265 — the runner never grades a lane it cannot observe](../tech-debt-code-quality/PRD-265-playtest-runner-never-grades-a-lane-it-cannot-observe.md) | `tech-debt-code-quality/` | Three guards, three negative controls. Self-scored **3 → LOW**. | 3–4 h |
| 5 | [PRD-190 — a projected scene reuses its plan](../performance/PRD-190-projected-scenes-reuse-their-plan.md) | `performance/` | Four files. Self-scored **3 → LOW**. | 4–6 h |

Rows are independent — no row depends on another, so they can be run in any order or in parallel
lanes. The order above is shortest-first, so an interrupted session still banks closes.

## Grounding — measured today at `3090eb31`

**Row 1 — PRD-278's AC9 is one run.** The PRD's own status line: *"AC1–AC8 met on browser WebGPU;
AC9 (native) is open — no `--target desktop` run was executed."* AC9 asks that a `--target desktop`
run confirm the chain's stages actually apply there rather than reporting the WebGL refusal. The
runner provisions its own Xvfb on headless Linux, so this is one command and one verification file.
Read `docs/verification/prd-278-render-chain-in-every-template-2026-08-30.md` first — the browser
half is already written up and the native half appends to the same record.

**Row 2 — the eleven-way identity is real and unguarded.**

```
$ for f in packages/create-threenative/templates/*/src/render/quality.ts; do
    sed -n '/^export type QualityTier/,/^  return request.mobile === true/p' "$f" | md5sum; done | sort -u
7f4a7f8f4ccf…   # one hash, 10 templates
$ grep -l "throw" packages/create-threenative/templates/*/src/render/quality.ts | wc -l
10
```

Ten in-repo copies, one span hash, all ten carrying the throw. The eleventh copy is
`sandbox/wildwood`, which AC4 correctly puts out of scope. `scripts/template-quality.ts` checks
that the three tier names are present and documented; it compares nothing and asserts no throw.

**Row 3 — two thirds of PRD-296 is already done, and nobody moved its status.** `ci.yml` at
`3090eb31` declares `needs:` five times: four on `build` (artifact production — legitimate under
the PRD's own rule) and one on `golden-path-template` (an aggregator). **No coverage job needs
another coverage job.** `visuals` is not a job any more, and `ci.yml:743-754` writes down why, in
prose, exactly as the PRD's item 2 asks. `native-platforms.yml` is its own workflow with its own
triggers.

What is **not** done is item 3: *"a check that a skipped job is reported as skipped-and-why in the
run summary"*. `GITHUB_STEP_SUMMARY` appears nowhere in `ci.yml`.

The valuable half of this row is a **regression guard, not a summary line** — a spec that parses
`ci.yml` and fails when a coverage job declares `needs:` on another coverage job. That runs under
`pnpm test` in milliseconds and needs no CI round trip. Ship the summary step alongside it; the
guard is what stops the arrangement coming back.

**Rows 4 and 5 are unmodified PRDs at LOW complexity** with their Integration Ledgers and negative
controls already written. Nothing to re-derive: each names its files, its red mutation and its
green.

## Closing this batch

The five PRDs **stay in their owning folders**. This is a deliberate departure from the
`astra-batch-2026-09-04` shape, for two reasons: PRD-278 is already `DONE on browser` and filing it
under a quick-wins folder would misfile a mostly-closed PRD, and `git mv` across four folders
conflicts with any concurrent lane touching them — `docs/PRDs/AGENTS.md` warns that another agent
may be working in this tree at the same time.

So there is no whole-folder `git mv` for this batch. Each row is archived on its own —
`git mv <prd> docs/PRDs/done/` in the commit that finishes it, per the standard rule — and **this
README is deleted in the commit that archives the last row**, with the outcome table pasted into
that commit message. A row that declines is closed citing its decline condition and struck through
in the table above.

## Considered and left out

Named so the survey is not repeated. Each failed the selection rule for the stated reason.

| PRD | Why not |
|---|---|
| [PRD-277 — merged geometry keeps its per-part tint](../useful-defaults/PRD-277-merged-geometry-keeps-its-per-part-tint.md) | LOW and small, but its **AC1 is "a named caller first"** and no template authors merged geometry. Closeable only as an archive-unimplemented ruling, which is the owner's call, not a quick win. |
| [PRD-354 — no unresolvable import](../astra-batch-2026-09-04/PRD-354-the-manifest-never-names-an-import-a-game-cannot-resolve.md) | MEDIUM (5), eight ACs, and it must land in one commit with PRD-301 or the two fight over `build-capability-manifest.ts`. Belongs to `astra-batch-2026-09-04`, where it already is. |
| [PRD-203 — template loading screens stop drifting](../tech-debt-code-quality/PRD-203-template-loading-screens-stop-drifting.md) | MEDIUM (5) and its verification needs per-template visual baselines (`pnpm visuals`), which wants a GPU lane and a judge pass. |
| [PRD-195 — the performance default is discoverable](../useful-defaults/PRD-195-performance-default-is-discoverable-and-factual.md) | LOW, but explicitly *"Depends on: PRD-189 through PRD-194. Land this last"* — all five unstarted. Fails rule (c). |
| [PRD-192 — result-bearing math has reusable targets](../performance/PRD-192-result-bearing-math-has-reusable-targets.md) | Self-scored **6 → MEDIUM**, retained-result semantics across core and physics. |
| `assets/` PRD-349…352 | All READY FOR EXECUTION with spikes answered, but all MEDIUM and all downstream of PRD-349 (599 lines). A good next batch; not a quick-wins batch. |

## Two hazards before starting

**1. PRD numbers collide in this tree.** `PRD-278`, `PRD-324` and `PRD-266` each name two different
documents. Every link above is by path for that reason — **cite by path, never by number alone.**

**2. Row 3's status line is stale and row 1's is accurate.** PRD-296 still reads `PROPOSED` while
two thirds of it shipped; do not paste its §"What happened" table as a Phase 0 red without
re-reading `ci.yml`. Re-measure every number in this README before pasting it as evidence — all of
them are timestamped `3090eb31` and this tree moves under you.
