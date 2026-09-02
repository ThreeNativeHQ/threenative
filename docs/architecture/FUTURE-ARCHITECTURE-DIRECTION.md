# Future architecture direction — keep the three.js API, delete what it costs

**Status:** proposal, 2026-08-31. Not binding. [`CHARTER.md`](CHARTER.md) wins on any conflict.
Numbers read from this tree on 2026-08-31 — `pnpm budgets`, the alpha bar,
[`runtime-perf-state`](../verification/runtime-perf-state.md),
[`tier-1-2026-08-29`](../verification/tier-1-2026-08-29.md). Anything unmeasured says so.

---

## The goal

ThreeNative is a game **framework** for three.js, not an engine. v1 died trying to be an engine —
an IR, a compiler, a second renderer, an ECS, an editor, a preset system, its own CLI language —
~790k lines in seven weeks, never having run the experiment that would have said whether any of it
worked. We are not repeating that.

> **Somebody who knows three.js should never have to leave it because it is too slow.**

**The rule every item below obeys:** *your game code does not change — only what it costs to run.*
If a proposal needs you to write your scene differently, annotate meshes, or learn a new type, it is
out, however fast it is.

---

## Where we actually are

**Batched work is already fast.** Against Godot 4.7.1, 65,536 instanced objects: web **3.5×**,
desktop **2.9×**, Pixel 8 **3.2×** faster. A scaffolded template, never tuned, on an unplugged
Pixel 8, three runs: **59.99–60.02 fps at full 2400×1080**, game work **6.39–8.49 ms** of 16.67,
Android's compositor confirming **zero dropped frames**.

**Unbatched work is 2× off and the code is not ours.** ~**11.3 µs of CPU per object** against
Godot's ~5.3 — all inside three.js's own WebGPU submission path.

**A real game runs out of GPU, and everything expensive is content.** Bayview, cool Pixel 8, 720p:
**53 fps.** CPU finishes in **9.3 ms**; the GPU needs **18–19 ms**. Turning one thing off at a time:

| Turned off | GPU time | Cost of that thing |
| --- | ---: | --- |
| nothing (control) | 27.57 ms | — |
| the sun's shadow | 27.89 ms | **free** |
| + fancy town materials | 24.22 ms | ≈ 3.3 ms |
| + the whole town | 13.55 ms | ≈ 11.5 ms |
| + sky and soldiers | 6.66 ms | ≈ 6.9 ms |
| + reflections (`scene.environment`) | **0.35 ms** | **6.31 ms staged nearly-empty ablation upper bound (`6.66 − 0.35`); the −0.37 ms static-versus-none inversion is the observed resolution/noise-floor control, not a bakeable delta. Environment sampling is not bakeable, and the bakeable steady-state benefit is unresolvable in this control** |

Browser agrees: RTX 2080, five-stage post chain — **all on 14.7 ms GPU, all off 2.2 ms.** The post
chain is 12.5 of the 14.7.

Already tested and **not** worth re-testing: smaller shadow map, softer shadow filtering, cutting
texture lookups 24 → 10 (moved nothing), removing 224 decals (0.6 ms).

---

## The three moves

| # | Move | Why | Evidence |
| --- | --- | --- | --- |
| **1** | **Bake it before the game ships.** three.js computes at runtime what engines compute at build time — reflections prefiltered on-device every launch, shaders compiled mid-frame, the bundle parsed as source every launch, no LODs unless hand-made | The GPU is doing work it could have been handed | Environment ablation upper bound: **6.3 ms of an 18–19 ms frame**; PRD-307 found no ≥2 ms steady-state bakeable win |
| **2** | **Stop running the frame on one thread.** The frame is already recorded in JS and replayed in C++ with a packed buffer between them — that buffer is the hand-off a render thread needs | CPU and GPU currently run one after the other | **9.3 ms CPU then 18–19 ms GPU**, in series |
| **3** | **Send the GPU fewer things.** Extend `SceneRenderProjection` to objects that move; add LOD switching | three.js charges a fixed CPU cost per object | One game cut draws **780 → 315**: 34.6 → 53 fps, **0 of 921,600 pixels changed** |

All three are invisible to the game. `SceneRenderProjection` already works this way — no flags, no
annotations, and it does nothing if it cannot reproduce the scene exactly.

**Move 1 is not the IR coming back.** The test, which every baking pass must pass: **delete the
entire baked output and the game runs identically, just slower.** v1's IR could never pass that,
because deleting it deleted the game. Half of this already exists — `@threenative/assets` is 3,482
lines and already bakes lightmaps and compresses textures.

**Moves 1 and 2 multiply; neither reaches 60 fps alone.** Overlapping threads cannot beat an 18–19 ms
GPU frame. We have twice shipped half of a two-part change and got nothing for it.

---


## What to do — quick wins first

Sorted by impact against effort. **🟢 a day or two · 🟡 days to a week · 🔴 weeks.**

### Band 1 — quick wins, start this week

| # | Task | | Impact | Depends on |
| --- | --- | --- | --- | --- |
| 1 | ✅ **Ship `src/render/quality.ts` in all 8 templates** — done, PRD-304, [`mobile-look-was-black-2026-09-01`](../verification/mobile-look-was-black-2026-09-01.md). Proving its last criterion uncovered and fixed a defect that made **the shipped mobile look of 7 templates a black screen on real phones** | 🟢 | **Every game built from a template gets a cheap-vs-pretty switch for free**, on by default, deletable. Allowed under §5b today and **missing from all 8 templates**. The numbers it needs are already measured | nothing |
| 2 | ✅ **Confirm `gpuMs` actually reports on Android** — done, PRD-305, [`gpu-meter-on-android-2026-09-01`](../verification/gpu-meter-on-android-2026-09-01.md). A Pixel 8 (Mali-G715) grants `timestamp-query` and reports **`gpuMs 0.19`**; the host now prints `TN_WEBGPU_FEATURES` on every backend branch. **Unblocks #5 and #8** | 🟢 | Tiny, and it unblocks #4. The meter is already portable and honest — it reports *nothing* rather than zero when it cannot measure — but has never been tried on Android | nothing |
| 3 | ✅ **CI check: delete every baked file, prove the game is identical** — done, PRD-306, [`delete-test-passes-2026-09-01`](../verification/delete-test-passes-2026-09-01.md). Green, and chained onto `pnpm test:templates` — the lane that has hardware. Not a CI job: the delete-test compares captured frames and CI's template runner has no GPU, which it reports as `frames: 0`. It landed **red** and the red was the finding: the loader's no-manifest fallback resolved the *base* path, not the *source* path, so no compiled game survived losing its bake | 🟢 | Makes the delete-test a gate before there is a second baking pass to get it wrong. Cheap now, expensive to retrofit | best landed with #5 |

### Band 2 — best value for the effort

| # | Task | | Impact | Depends on |
| --- | --- | --- | --- | --- |
| 4 | ✅ **Bake prefiltered reflections into `@threenative/assets`** — **refuted 2026-09-01, PRD-307** ([record](../verification/environment-cost-attribution-2026-09-01.md)): the static-versus-none result was a −0.37 ms inversion, the observed resolution/noise-floor control; the bakeable steady-state benefit is unresolvable in this control. Forcing PMREM every frame cost +1.61 ms, but Bayview never dirties it. The falsification test fired, so Phases 2–3 were skipped | 🟡 | The earlier **≈6.3 ms** staged environment ablation is an upper bound, not a bakeable steady-state win. The cheaper hemisphere alternative was also visibly darker | nothing |
| 5 | **Measure GPU time per pass, on the phone** — **unblocked**: #2 landed and the meter reports on device | 🟡 | Turns days into minutes. Three separate sessions worked out GPU cost by rebuilding the app once per experiment and pushing a settings file through `run-as`. **Unblocks #8 and #9** — the town pass (9–11 ms) is our biggest cost and is still unattributed | #2 |
| 6 | **Get Android conformance running on every commit** | 🟡 | It last executed **0 of 74 rows** — it stopped before Gradle on a stale dependency pin. Every "runs everywhere" claim rests on a lane that is not running | nothing |
| 7 | **Scene projection that works on moving objects** | 🟡 | Extends a lever already worth **780 → 315 draws** (34.6 → 53 fps, zero pixels changed). Today it only covers meshes that never move | nothing |
| 8 | **GPU cost per pass in `diagnostics`** | 🟡 | Lets an agent see #5's numbers without owning a phone | #5 |
| 9 | **Timeboxed `shermes` AOT spike** | 🟡 | The only idea that would stop iOS's no-JIT rule being permanent. Currently filed as *"a spike, not a plan"* and owned by nobody. Timebox it, then close the branch either way | nothing |

### Band 3 — big rocks, weeks each

| # | Task | | Impact | Depends on |
| --- | --- | --- | --- | --- |
| 10 | **Render thread over the frame buffer we already build** | 🔴 | Up to **9.3 ms of a ~28 ms phone frame**, and **owed anyway** — `Worker` currently runs worker code on the main thread, which is a correctness bug that only shows on native | **re-plan after PRD-307 refuted the former #4 precondition** |
| 11 | **LOD baking + LOD switching** | 🔴 | Drawing the town: **9–11 ms**, the biggest GPU cost we cannot yet explain | #5 |
| 12 | **Job system; make `Worker` a real worker** | 🔴 | Correctness first, speed second | #10 |
| 13 | **Push fixes upstream to three.js** — per-object submission cost, indirect/multi-draw, render bundles | 🔴, no schedule | The **11.3 µs vs Godot's 5.3 µs** per-object gap is three.js's code. Fixed there it speeds up web *and* native, forever, for everyone. We have the best measurement rig of any three.js user — that is the contribution | nothing |

### Two sequencing rules

**Do not ship #10 against the former #4 precondition.** PRD-307 refuted the bakeable steady-state
win, so the #10 gate must be re-planned before the render-thread work is filed; do not silently
treat the refuted #4 as satisfied. Overlapping threads cannot beat an 18–19 ms GPU frame, and we
have twice shipped half of a two-part change and got nothing for it (F12, and PRD-227's second
change).

**Stop-gate on #5.** If it lands and the GPU numbers in *Where we actually are* do not reproduce,
**stop and re-plan** before starting #11. Our model of what is slow has been wrong twice. This gate
does not block the now-refuted #4; any replacement for #10's former #4 precondition needs fresh
evidence.

### Alongside — not speed, but it decides whether speed matters

| Task | Why | State |
| --- | --- | --- |
| **Capability search** (PRD-297…301) | **11 of 46 (24 %)** of the mechanics in our own sealed briefs return **nothing**. `tower defense game` returns nothing while `templates/defense/` ships. `@threenative/assets` has **zero** entries — a baking pipeline nobody can find is one nobody uses | Filed, not started |
| **Codebase size** | **40,198 lines against a 15,000 trigger** (2.7×); **115,951 against 100,000** native. §10b: going over *"is a signal to run the kill switch over what was added"* | Reported every run, into an empty room |
| **Get published (A1)** | Two of eight publishable packages are not on the registry; A6 — *one stranger has used it* — is stuck behind it, and it is the only criterion *"that cannot be gamed by the team that wrote it"* | PRD-302 filed, depends on nothing |

---

## Why we are not writing a renderer

**Not because it would look different per platform — it would not.** v1 had two renderers reading
one IR (three.js and Bevy genuinely disagree about materials, lights and transforms), so it was
always going to draw two pictures. Today there is **one renderer**: upstream three.js, unmodified,
everywhere. Our host implements WebGPU underneath it and replays exactly what it was handed. Same
API in, same commands out, same picture.

The actual reasons:

1. **Most expensive path to the smallest win.** Months of C++ against a term we have not attributed,
   while the environment ablation (~6.3 ms) was initially treated as a days-sized asset-pipeline
   win; PRD-307 refuted that steady-state attribution.
2. **It only helps one arm.** Half the product is the browser. Native-only culling gives the same
   game two performance profiles, and tuning decisions get made against whichever platform the
   developer tested on.
3. **Upstream helps both, forever** — that is P4.1.

---

## What would prove this wrong

1. P0.1 lands and the GPU numbers above do not reproduce.
2. Baked reflections land and the phone frame does not move ≥2 ms (our standing threshold; five
   ideas have already died against it). **FIRED 2026-09-01 (PRD-307):** the set-once environment
   result was a −0.37 ms resolution/noise-floor inversion, while the only resolved repeated-prefilter delta was
   +1.61 ms on the named desktop adapter; Bayview has no per-frame dirty path. See the
   [attribution record](../verification/environment-cost-attribution-2026-09-01.md).
3. A second real game turns out CPU-bound, not GPU-bound — one game and one template carry this
   whole argument.
4. The render thread lands and the frame is flat: then the GPU wait is not overlappable and P2.1
   goes back to being only a correctness fix.
5. A baking pass cannot pass the delete-test — then it is an IR and it does not ship.
   **Triggered 2026-08-31, cleared 2026-09-01** — the fallback was fixed and the gate is green
   ([`delete-test-passes-2026-09-01`](../verification/delete-test-passes-2026-09-01.md)); #4 may
   start. The account of what fired it, kept because the false green is the lesson: `pnpm bake:delete-test` now runs, and the starter does not survive
   losing its bake: the loader's no-manifest fallback resolves `<basePath>/<logical path>`, which
   in a compiled project points at nothing. The first version of the gate reported a green because
   the dev server re-baked what it had just deleted. Record:
   [`bake-delete-test-2026-08-31`](../verification/bake-delete-test-2026-08-31.md). **#4 does not
   start until the existing pass passes.**

---

## Closed — do not re-propose without new measurements

| Closed | Why |
| --- | --- |
| An IR, a scene format, a compiler of game meaning | v1's compiler: 25,898 lines, bought nothing a `.ts` file cannot do |
| A code-first or structured ECS | **14× the cost of plain three.js**, and scored *worse* on playability and looks |
| Presets / genres / recipes | **0 of 7 ever reproduced their genre** |
| Forking three.js or optimising its internals in our host | Graveyard #15. Fixes belong upstream, where both arms get them |
| Fixed-shape wrapper objects as a speed fix | Tried, **worse than doing nothing** (graveyard #12). The cost is three.js's material system and **Chrome pays it too** |
| Bevy / compile-to-IR / QuickJS-as-control-plane (an untracked scratch proposal, never committed here) | Describes a codebase we do not have. Three of its ideas are already in the graveyard; four it proposes already shipped. Its one good idea — *a table of who owns each runtime property and what writing to it does* — is worth writing |

---

## Questions for you

1. **Is the ceiling right?** This gets us to *"nobody leaves three.js because of frame rate."* It does
   not get us Nanite. If Nanite-class geometry is the goal, that needs a renderer.
2. **If only one thing gets staffed: baked reflections (P1.1) or the render thread (P2.1)?** P1.1 is
   smaller, measured, needs no new subsystem. P2.1 is bigger, owed anyway, and makes P1.1 worth more.
3. **Does §5b need amending, or is P1.2 enough?** A generated `quality.ts` is already legal and
   absent from all 8 templates — that is most of "looks good by default, for free" with no amendment.
   The only thing needing one is the framework changing appearance *at runtime*, and the latest blind
   visual scoring is unresolved (framework 2.85, vanilla 2.67, noise floor 1.0), so there is no
   evidence either way yet.
4. **Who runs the kill switch over the existing 40,198 lines?**
