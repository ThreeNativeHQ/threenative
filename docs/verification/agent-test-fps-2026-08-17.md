# The agent test on a real game — FPS arena — 2026-08-17

**This is n = 1 per arm.** One framework build and one vanilla build, on one genre, against one
reference. Nothing below is a rate, and no delta in it may be quoted as one.

**Status: complete.** Both arms ran, both passed the sealed proof 2/2, and every row of §3 is
answered. Sections 1 to 4 were written before either build started, which is the only time those
records are worth anything; §6 has the result.

**Then somebody played the game, and §7 is what that found.** It is the most important section in
this file and it was not part of the plan.

PRD: [PRD-137](../PRDs/done/PRD-137-the-agent-test-on-a-real-game.md). Requirements input:
[fps-legacy-requirements.md](./fps-legacy-requirements.md).

## 1. The sealed inputs, hashed before either arm started

| File | SHA-256 |
| --- | --- |
| `docs/benchmark/genres/fps/brief.md` | `434e153fb9d19487df99e83780b2507c48548ef305e497c057963328352c521b` |
| `docs/benchmark/genres/fps/reference.png` | `982e5428620764ae12effe1020b5ad252f6bdf96b9f78d0a665c0cedc5f54515` |
| `docs/benchmark/genres/fps/proof/fps-fire-and-reload.playtest.json` | `28fd962c98bb761e00aca92ce9c12a91128c0a5431f8d42b6a4438d0a2eb6410` |
| `docs/benchmark/genres/fps/proof/fps-move-and-hit.playtest.json` | `332cde7275ea6b614e17911c2a7fa10c4c46e10b15c4df66a85bfbda1258f061` |
| sealed proof roll-up (`sealedProofHash`) | `921cae06752253247a2db15436d548088ecf62c4b9fa0ad9503eb6a296259b9d` |

The reference is `fps-final-local-runtime.png` from the legacy repository, copied unmodified —
its hash is byte-identical to the source file and to the four copies of it that exist across
that repository's worktrees.

**Re-checked after both arms finished: all five identical.** Nothing moved.

### The brief's author did not build either arm

The brief was written from the requirements capture by this session, which stages and measures
but does not build. Both builds are separate sessions that have read neither the legacy
repository nor this one.

### The proof is framework-neutral, and that is checked rather than asserted

Both scenarios assert only through `resources`, `diagnostics` and `visual`. Running them through
the scenario loader's own capability resolver returns, for both:

```text
browser.input, browser.network, browser.screenshot, runtime.diagnostics, runtime.resources
```

No `entity.observe`, no `runtime.components`, no `runtime.states` — nothing that only a
ThreeNative game populates. `installThreePlaytestBridge` supplies `runtime.resources` and
`runtime.diagnostics` to a plain Three.js game, so every assertion is satisfiable by any correct
implementation.

One thing that looks like an asymmetry and is not. The vanilla arm's generated `AGENTS.md` is 28
lines and spells out `resources: { read: () => ({ state: { ...state } }) }`; the framework arm's is
450 lines and never mentions publishing resource state at all. That is not the vanilla arm being
better informed — it is the framework not needing the instruction. A framework game's
`defineGame` store is published as resource id `state` by the `playtest()` plugin with no code
written, which is why round 9's platformer proof read `state.jumps` and `state.coins` off the
framework arm; the vanilla arm has to wire the same thing by hand, and its `AGENTS.md` documents
the wiring because it is work the framework does for you. Checked before the run so that a
resource-observation failure on either arm is read correctly.

The keys the proof drives — `Space` to fire, `KeyR` to reload, `KeyW` to advance — are keys the
legacy game itself binds: `content/input/arena.input.json:11` binds `fire` to `pointer.0` **and**
`keyboard.Space`, and `:13` binds `reload` to `KeyR`. The proof is keyboard-only because pointer
lock cannot be driven reliably, not because the game was bent to fit the harness.

> **This paragraph is wrong, and §7 is the correction.** The harness drives mouse buttons fine —
> `pointerPosition.buttons` produces real pointer events, and a twelve-line scenario written after
> the run separates the two arms cleanly. Keeping the reasoning here as written, because the
> decision it justified is the reason a build whose mouse could not shoot passed 2/2.

## 2. Defects found while staging, before either arm ran

Both would have corrupted the measurement silently. Neither is fixed in this PRD — its blast
radius is additive and no package source is touched — so each becomes its own PRD next round.

### 2.1 The second arm's staging overwrites the first arm's manifest

`pnpm sandbox` writes `sweep.json` at the **shared sandbox root**, and the framework arm's
generated `scaffold.sh` copies that root file into the project at scaffold time:

```sh
cp sweep.json "${1:-fps-framework}"/sweep.json
```

So staging the framework arm and then the vanilla arm leaves the root manifest reading
`"arm": "vanilla"`, and the framework builder's own `scaffold.sh` would then stamp its build as
the vanilla arm. Observed directly: after the two staging commands, the root `sweep.json` read
`arm = vanilla`. That label flows into `sweep:archive`, `sweep:proof` and `sweep:pair`.

**Control:** each arm's sandbox is re-staged immediately before that arm starts, so the root
manifest is always the manifest of the arm about to build. The manifest in each finished project
is checked against its arm before archiving.

### 2.2 The shared package staging is wiped by the next arm

`makeSandbox` wipes `<sandbox>/.packages` on every run and re-packs, while `--bare` defers
`pnpm install` to the builder. The vanilla project's `package.json` pins
`@threenative/playtest` by absolute path into that directory, and the framework arm's
`scaffold.sh` embeds five such paths. Staging the second arm therefore deletes the tarballs the
first arm has not yet installed.

**It did not bite here, and that is luck, not design.** The package build is byte-reproducible,
so the re-packed tarballs landed on the same content-hashed names and all five paths still
resolved. Any source change between the two staging runs breaks that.

**Control:** same as 2.1 — re-stage per arm, immediately before it starts.

## 3. Threats to validity — every row answered

| # | Threat | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Builder contamination | **Controlled** | Both arms are fresh sessions in `../sandbox/<arm>/`, outside this repo, with no `AGENTS.md` chain and no pnpm workspace reaching it. `pnpm sandbox` reported `framework source readable: 0 lines` for both — the packages ship no sourcemaps, so the implementation is not on disk. Both prompts forbid reading this checkout by absolute path. **Not airtight:** the repository still exists on the same filesystem, so the control is the instruction plus the archived transcript, not a sandbox boundary. |
| 2 | The bar moves to meet the result | **Controlled** | Five hashes in §1, recorded before either arm started, re-checked after both finish. |
| 3 | Asymmetric information | **Controlled** | Both prompts are generated from one template. The full `diff` is in §4: the scaffold step, and three occurrences of the folder name. Same brief, same reference, same assets, same harness, same 200-call cap. |
| 4 | Judge bias | **Controlled** | Three fresh critics, each a separate cold session, scoring eight shuffled samples. No arm identifier anywhere in the bundle, the filenames or the critic input — `sweep:judge` fails closed on one and accepted all three. The reveal map is written outside the bundle. Artifacts: `docs/benchmark/rounds/prd-137/`. |
| 5 | The visual instrument cannot resolve the change | **Controlled, with a stated floor** | PRD-126 phase 0 measured this on 2026-08-17 with three fresh raters: duplicate-pair spread 0, **between-rater spread 1 point**. So the noise floor is 1. This run uses ≥2 independent raters and records the visual column as **unresolved** unless the arm-to-arm delta exceeds 1 point. A one-point win is not a win. |
| 6 | Capture asymmetry | **Controlled and validated** | Both arms use the same supplied harness: headed Chromium, `--enable-features=Vulkan`, under a virtual display, reading `GPUAdapterInfo` **field by field** because `JSON.stringify` on it returns `{}`. It refuses to save a frame whose adapter fingerprint contains `swiftshader` or `lavapipe`. Validated end-to-end against an installed sandbox game before either arm started: exit 0, adapter `vendor: nvidia / architecture: turing`, non-blank frame. |
| 7 | Off-instrument work uncounted | **Controlled by removal** | The screenshot harness is **supplied**, not authored: `tools/capture.mjs` (94 lines) and `tools/capture.sh` (64 lines), 158 lines total, byte-identical in both arms, and both prompts forbid writing or editing one. Round 9's 151-against-70 asymmetry cannot recur because neither arm writes it. The 158 lines are shipped source and belong to neither arm's authored LOC. |
| 8 | The archive destroys the evidence | **Controlled and verified empirically** | `copyAppShell` was rewritten to archive every root entry after round 9 lost 27 screenshots. Verified rather than read: a synthetic finished build carrying `screenshots/`, `tools/`, `notes/`, `assets/`, `public/` and `playtests/` was archived and the trees diffed — **12 of 12 files preserved, none lost**. Both arms additionally commit and push their own folder as they build. |
| 9 | n = 1 | **Not controlled — stated instead** | The first line of this file. Not solvable at this budget. |
| 10 | Budget asymmetry | **Controlled** | 200 tool calls, stated identically in both prompts, with the instruction that hitting the cap is recorded rather than extended. Final counts recorded per arm. |

### Two things this staging does not control

- **Model and settings drift between the arms.** Both arms should run on the same model at the
  same reasoning effort. If they do not, the comparison is void; the launch record in §5 must
  name the model for each arm.
- **Asset licensing is not a validity threat but is a publication one.** The legacy `assets/`
  are copied verbatim into both arms, and two of them are not cleared for redistribution: the
  first-person viewmodel records *"user-provided; verify upstream pack terms before
  redistribution"* and the enemy is CC-BY-4.0 with retargeted Mixamo clips. They are gitignored
  in the public examples repository, the same call that repository already makes for
  `reference.png`. They are on disk for both builds; neither build may push them.

## 4. The two prompts, diffed

`docs/benchmark/prompts/fps-2026-08-17-framework.md` against
`docs/benchmark/prompts/fps-2026-08-17-vanilla.md`:

```diff
@@ ## 1. Set up @@
-You are standing in the sandbox root and your project does not exist yet. Create it:
+You are standing in the sandbox root and your project folder already exists. Enter it and
+install:

-./scaffold.sh fps-framework
-cd fps-framework
+cd fps-vanilla
+pnpm install
 cp -r ../fps-kit/assets ../fps-kit/tools .

-That installs ThreeNative from local tarballs, copies `brief.md`, `reference.png` and
-`sweep.json` into `fps-framework/`, and brings in the game assets and the screenshot harness. Read
-the `AGENTS.md` it generates — it is the framework's own documentation and it is the only
-documentation you have.
+That gives you `three`, Vite, TypeScript and the observation bridge, with `brief.md`,
+`reference.png` and `sweep.json` already in `fps-vanilla/`, and brings in the game assets and the
+screenshot harness. Read the `AGENTS.md` beside them — it describes the bridge and it is the
+only documentation you have.

@@ ## 3. Build it @@
-git -C .. add fps-framework && git -C .. commit -m "fps-framework: <what changed>"
+git -C .. add fps-vanilla && git -C .. commit -m "fps-vanilla: <what changed>"

@@ ## 5. Rules @@
-- **Work only inside `fps-framework/`.** The sandbox root and its sibling folders belong to other
+- **Work only inside `fps-vanilla/`.** The sandbox root and its sibling folders belong to other
```

Nothing else differs. Both are 104 lines.

### The template choice, stated because it is arguable

The framework arm scaffolds `--template starter`, which is what `./scaffold.sh` does by default
and what the PRD specifies. A `shooter` template exists in this repository and was **not** used:
at 1,711 lines with `Target`, `damage`, `waves` and `SpawnPoints` already in it, it pre-ships
much of the game under test, and the friction measurement — the primary outcome — would collapse
into measuring a template. Someone scaffolding a real FPS would plausibly reach for it, so this
result does not speak to that path.

## 5. Launch record

Both arms run as fresh non-interactive sessions started from `~/projects/threenative/sandbox`,
which is outside this repository. There is no user-level `CLAUDE.md` on this machine and no
`.claude/` directory in the sandbox, so neither arm inherits project instructions from anywhere;
the only guidance each has is its prompt and the `AGENTS.md` in its own folder.

| | framework arm | vanilla arm |
| --- | --- | --- |
| Model | `claude-opus-5` | `claude-opus-5` |
| Prompt | `docs/benchmark/prompts/fps-2026-08-17-framework.md` | `docs/benchmark/prompts/fps-2026-08-17-vanilla.md` |
| Stated cap | 200 tool calls | 200 tool calls |
| Spend ceiling | `--max-budget-usd 40` | `--max-budget-usd 40` |
| Session id | `f9500001-0000-4000-8000-000000000137` | *pending* |
| Started | 2026-08-17 | *pending* |
| Root manifest at launch | `arm: framework` (re-staged immediately before, per §2.1) | *pending* |

The arms run **sequentially**, and the second arm's sandbox is re-staged only after the first
arm's build has been archived — the ordering §2.1 and §2.2 require.

**One asymmetry that is not controlled and is recorded instead:** the spend ceiling is a second
stopping condition beside the 200-call cap. If one arm stops on budget and the other on the cap,
they did not receive equal budgets in practice, and the final counts in §6 say which stopped how.

### Interruption policy, fixed before the outcome was known

The framework arm's first attempt **died on an API 500** after 19 turns and 18 tool calls, having
written no game code (`terminal_reason: api_error`, `$1.50`; the result is kept as
`arm-framework-result.attempt1-api500.json`). A server-side 500 is an infrastructure
interruption, not a result about the builder or the framework, so the rule — set now, applying
equally to both arms — is:

- **An arm killed by an API or transport error is resumed from its own session**, not restarted.
  Restarting would discard the reading it had already done and inflate its "first game code at
  call N" number, because the sandbox is already scaffolded the second time around.
- The resume prompt is the single word `Continue.` and carries no new information.
- **Tool calls are counted from the session transcript**, which accumulates across resumes, not
  from the per-invocation `num_turns`.
- Every interruption and resume is listed in §6 for both arms. An arm that needed three resumes
  and an arm that needed none did not have identical runs, and the comparison has to say so.
- The 200-call cap and the `$40` ceiling are **not** reset by a resume.

## 6. Results

Both arms ran. Per-arm ledgers: [framework](./sweep-fps-2026-08-17.md),
[vanilla](./sweep-fps-2026-08-17-vanilla.md).

| | framework | vanilla |
| --- | --- | --- |
| Sealed proof | **2/2 scenarios, 10/10 rows** | **2/2 scenarios, 10/10 rows** |
| **Friction rows** | **19** | **13** |
| Authored LOC | 1542 | **1393** |
| Final LOC | 1947 | 1393 |
| Source files | 19 | 4 |
| Starter lines survived | 405 of 828 | — |
| Reach rate | 0.47 | — |
| First game-code tool call | **8** of 129 | **10** of 110 |
| Tool calls used | 129 of 200 | 110 of 200 |
| Stopped on | completion | completion |
| Cost | $15.99, plus $1.50 on the crashed attempt | $14.12 |
| Interruptions | 1 API 500, resumed | none |
| Visual (blind, 3 raters) | 2.85 | 2.67 — delta **+0.18, unresolved**, see below |

`pnpm sweep:pair`, verbatim:

```text
arm        proof  authored  final  starter  survived  files  reach
framework  2/2    1542      1947   828      405       19     0.47368421052631576
vanilla    2/2    1393      1393   0        0         4      0
authored cost delta (framework - vanilla): 149 LOC, 5704 bytes
```

**The five hashes re-checked after both arms finished are identical to §1.** Nothing moved.

### Friction rows — the primary outcome

**19 against 13, and the counts do not mean what a reader wants them to mean.** They are not two
measurements of the same quantity. The framework arm's rows are overwhelmingly about ThreeNative;
the vanilla arm's are overwhelmingly about the raw platform — WebGL frames that will not
composite into a screenshot, canvas textures that render black under WebGPU, GLB files with no
stated units, Vite asset paths. Sorted by what is actually at fault:

| Attributed to | framework arm | vanilla arm |
| --- | --- | --- |
| ThreeNative's own surface | 18 | 2 |
| The raw platform (three, Vite, WebGPU, the assets) | 0 | 9 |
| The sealed brief, which is ours | 0 | 2 |
| The supplied capture harness | 1 | 0 |

So the honest reading is not "the framework produced more friction than plain Three.js." It is:
**the framework absorbed nine rows of platform friction the control had to solve itself, and
introduced eighteen rows of its own.** On this one build the trade was roughly two-for-one
against the framework, and it cost 149 more authored lines.

The single most serious row is the framework arm's first: **`InputMap` has no relative pointer
delta and no pointer-lock helper anywhere in its surface.** Building a first-person camera left
no option but raw `document` listeners, which the framework's own portability rules forbid — so
that build's look control is web-only by construction, and `pnpm build --target desktop` would
ship a game you cannot aim. A framework whose stated purpose is one source on web and native has
no mouse-look input.

Four more framework rows are one defect wearing four hats: **the generated documentation
describes a project that does not behave the way it says.** `AGENTS.md` documents
`holdFrames`/`waitFrames`, which the schema accepts and which do not advance the fixed-step clock
— a 198-tick scenario advanced the game 11 ticks. It documents scenarios you "may delete", which
are hard-wired into a `pnpm test` that breaks when you delete them. It names a resource id the
sealed proof does not read. And **the smoke test the template ships cannot pass as generated on
this machine**, because it runs without `--browser-recipe webgpu --headed` — the exact trap the
same document spends a paragraph warning about.

### Visual column: unresolved

| Rater | framework mean | vanilla mean | delta | picked | confidence |
| --- | --- | --- | --- | --- | --- |
| A | 2.85 | 2.70 | +0.15 | framework sample | low |
| B | 2.85 | 2.70 | +0.15 | framework sample | medium |
| C | 2.85 | 2.60 | +0.25 | framework sample | low |
| **pooled** | **2.85** | **2.67** | **+0.18** | | |

Three fresh critics, each a separate cold session, scoring eight shuffled samples with no arm
identifier anywhere in what they could see. All three independently picked the same sample as
best, and that sample is the framework arm's.

**It is still recorded as unresolved, and the unanimity does not change that.** The rule set in
§3 before either arm ran was that the visual column gets no verdict unless the delta exceeds the
measured noise floor of 1 point. The delta is 0.18. A rule that only binds when it agrees with
the result is not a rule.

There is a tempting alternative reading, and it is refused on purpose: between-rater spread
*within this bundle* was at most 0.20, against which +0.18 looks nearly resolvable. That is a
different statistic — a spread on `polishAverage`, a mean of five dimensions, against a floor
measured on single-dimension scores — and adopting it after seeing the result is exactly the
threat-2 failure this file spends its first section preventing. The floor stands where it was
put.

What the scores do say, and this is worth more than the delta: **both arms landed at 2.6–2.9 on
a 1–5 rubric.** Neither built something a rater would call finished.

### Two asymmetries that were not controlled

1. **The framework arm leaked dev servers into the vanilla arm's run.** After it exited, three
   `vite` processes were still alive, one holding **port 5173** — the port both prompts tell the
   arm to use. The vanilla arm ran second, could not use the documented command, and recorded
   losing a capture cycle to it (its friction row 4). This is one-directional and it favours the
   arm that ran first. It did not change the functional result — the vanilla arm moved to another
   port and still passed 2/2 — but the arms did not have identical environments, and sequential
   arms on a shared machine need the previous arm's processes reaped before the next one starts.
2. **A pre-existing process on this machine held port 4173**, which is hard-coded in the
   scaffolded `pnpm test`. That cost the *framework* arm a row (its row 14). Machine state leaked
   into both arms, in opposite directions.

### Defects found in the instrument itself

Four, all before or during the run, none of them in either build. The first three were controlled
by re-staging each arm immediately before it ran; the fourth had to be fixed to measure at all.

1. **Root manifest clobber** (§2.1) — the second arm's staging overwrites the shared root
   `sweep.json`, and the framework `scaffold.sh` copies it. Uncaught, the framework build would
   have been archived and measured as `arm: vanilla`.
2. **Shared package staging wipe** (§2.2) — survived only because the package build is
   byte-reproducible.
3. **`assertCanWipe` cannot re-stage a vanilla sandbox** — `writeVanillaScaffold` always creates
   an empty `src/`, which the guard reads as "this was built", so a staged-but-never-built vanilla
   arm can never be re-staged. Verified the folder was genuinely empty before clearing it by hand.
4. **`assertArchiveResolves` rejected a correct build.** It resolved Vite resource imports
   including the query string, so `../assets/models/rifle.glb?url` was hunted for as a file
   literally named `rifle.glb?url`. The vanilla arm's archive was refused as "unbootable" while
   its assets were archived correctly — and because the archiver deletes its destination on
   failure, that build could not be measured at all. **Fixed** in `scripts/sweep-archive.ts`,
   with two tests that fail without the fix: one that archives a project using `?url` imports,
   one that still refuses a query import whose file is genuinely absent.

Items 1 to 3 are not fixed here and each becomes its own PRD.

### Gates run on this change

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx vitest run scripts/__tests__` | **375 passed, 39 files** |
| `npx biome check` on every file changed here | pass; one pre-existing warn-level complexity diagnostic on `assertArchiveResolves`, unchanged in kind by the fix |
| `pnpm check:docs` | pass |
| `pnpm budgets` | **fails, and not on anything in this PRD.** The native runtime census disagrees with measured native LOC (recorded 72,857, measured 75,937). Reproduced with this session's only two unrelated working-tree files stashed, so it is pre-existing state from other in-flight work. No file under `packages/runtime-native/` was touched here. |

`pnpm test` was not run: it rebuilds every package and runs every package's own suite, and nothing
in this PRD touches package source. The scripts suite covers everything that changed.

**The ledger validator earned its keep.** Both sweep ledgers were written by hand first and
rejected: a missing `Unused exports` field, a `Round` that was prose instead of a positive
integer, and three-column friction tables where four are required. They are now generated from
the archives so every measured field is read rather than retyped — a ledger that disagrees with
its own archive is exactly the failure this repository is downstream of.

### What this run does not claim

Not that ThreeNative is worse for agents. n=1 per arm, one genre, one reference, and the friction
counts measure different things. Not a visual verdict, per the rule above. Not a performance or
platform result: both arms are browser builds on one Linux host with an NVIDIA adapter, and
nothing here touched desktop, Android or iOS. And not a claim about the legacy game, which was
read for its requirements and never scored.

What it does establish is the series. The number at the top of `METRICS.md` — friction rows per
cold-agent build — now has its first two values, **19 for the framework arm and 13 for the
control**, with every row evidenced and attributed, and a procedure that survived four defects in
its own instrument.

---

## 7. What ten minutes of play found that none of the above did

**A human opened both builds and played them. In ten minutes he found nine defects. The sealed
proof, the blind visual panel, `typecheck`, `lint` and every gate in this repository had found
zero of them, and had all reported green.**

That sentence is the finding of this PRD. The paired numbers in §6 are real and stand; this
section is about what the apparatus that produced them cannot see.

The headline case: **the framework build's mouse could not shoot.** Clicking did nothing at all.
Its own HUD rendered "Mouse 1 Fire" while the left button was dead. That build passed the sealed
proof 2/2 with 10/10 assertion rows, and three independent blind raters scored it *above* the
control.

### 7.1 What was actually wrong

Nine defects, and the layer each belongs to. "Engine" means the framework was wrong; "game" means
this build misused it. Naming the layer is the rule, and here it mattered — three of the nine
were engine bugs that no amount of care in game code would have avoided.

| # | Defect | Layer | Root cause |
| --- | --- | --- | --- |
| 1 | Mouse fire dead | **engine** | `IInputAction.buttons` means *gamepad* buttons. The build wrote `fire: { buttons: [0] }` meaning the left mouse button. The option was accepted and silently discarded. |
| 2 | Right-click aim impossible | **engine** | Same field, plus nothing suppressed the browser context menu, so a right-click binding could never fire even if the field had meant the mouse. |
| 3 | Quick clicks dropped | **engine** | `InputMap` sampled device state once per `tick`. A click shorter than one frame — which is a normal click — began and ended between two samples and vanished. Holding the button worked, so it read as random. |
| 4 | **1.2 second freeze on every shot** | game | Muzzle lights toggled `light.visible`, which changes the lighting setup and makes the renderer rebuild material pipelines. Measured: firing p95 225 ms, max 1220 ms. |
| 5 | Enemy walked into cover and vibrated | game | Movement resolved each axis independently and refused a blocked axis; there was no steering, so a soldier that met a barricade head-on never went around it. |
| 6 | Enemy held no weapon | game | The rifle was never attached to the hand bone, and the shipped GLB is authored in centimetres (112 units long), so a naive attach produces a 112-metre AK. |
| 7 | Muzzle smoke read as grey boxes | game | Flat opaque quads, no alpha falloff. |
| 8 | Damage invisible | game | Health was a number that ticked 100 → 91 while you were being shot at. No bar, no direction. |
| 9 | Crosshair beside the red dot | game | The HUD reticle stayed on screen while aiming down an optic, so two aim points disagreed. |

Two more the same session produced, against the instrument rather than the game: the sealed proof
went 2/2 → **0/2** after these fixes because `vite.config.ts` did not ignore `proof-artifacts/`
and `captures/`, so the runner's own writes reloaded the page and detached the canvas; and the
staging defect §2.2 predicted as "luck" duly bit, leaving a dangling tarball path that blocked
reinstalling the engine.

### 7.2 Why every single one survived the gates

Sorted by the reason, because the reasons are few and they repeat.

**The proof asserted state, never the interface.** `resources`, `diagnostics` and `visual` can
express "score went up". They cannot express *which device* made it go up, whether the cursor is
hidden, whether pointer lock engaged, whether the context menu opened, or whether two reticles
coincide. Defects 1, 2, 3, 8 and 9 are all interface properties. The proof was not weak at
finding them; it has no vocabulary for them.

**The proof drove only the keyboard — and said so in the brief.** The sealed brief told both
builders: *"The proof presses `KeyW` to advance, `Space` to fire and `KeyR` to reload."* That
turns the proof into the specification of what must work. Both arms made the keyboard path
correct and passed; only one of them also made the mouse work, and nothing rewarded it. **Writing
the tested inputs into the brief was my error and it is the single most consequential decision in
this experiment.** The harness supported mouse buttons the whole time — `pointerPosition.buttons`
drives real pointer events — and I did not use it.

**Nothing measured frames.** The playtest schema has a `performance` assertion kind. The sealed
proof did not use it, so a 1.2-second stall per shot was invisible to every gate while being the
most obvious defect in the game to anyone holding the mouse.

**Still frames cannot show motion or input.** The three blind raters scored screenshots. A
screenshot cannot reveal a dropped click, a freeze, or an enemy that vibrates against a wall.
This is not a failure of the raters; it is the wrong instrument for those questions, and the
visual column was correctly recorded as unresolved anyway.

**Both builds looked right in the exact frame the harness captured.** The proof screenshots are
taken at spawn and after a scripted burst — the two moments both builds were tuned for.

### 7.3 How to prevent each one

Ordered by leverage. The first two would have caught six of the nine.

| Prevention | Catches | Cost |
| --- | --- | --- |
| **An input-device matrix scenario in every sealed proof set**: the same action driven once per bound device — key, mouse button, and a tap shorter than a frame — asserting the same state change each time | 1, 2, 3 | ~15 lines of JSON per genre |
| **Fail loudly on a binding that cannot fire.** A binding naming only devices that are absent, or a field that the backend ignores, must be a startup diagnostic — the repo already has the rule ("a backend that cannot honour an option throws at construction") and nothing enforced it for input | 1, 2 | small, in `InputMap` |
| **A `performance` assertion in the sealed proof**, with a frame-time ceiling asserted *while firing*, not at rest | 4 | one assertion |
| **Stop naming the tested inputs in the brief.** Describe the game's controls as the game has them; let the proof press what it likes | 1, 2, 3 | free, and it removes a bias |
| **A short scripted play session as a proof step** — 20 seconds of movement, firing and turning, asserting no frame over budget and no entity stuck | 4, 5 | one scenario |
| **A stuck-detector assertion**: an entity that should be patrolling must travel a minimum distance over a window | 5 | one assertion |
| Screenshot *during* motion and while aiming, not only at spawn | 7, 9 | capture timing |

### 7.4 Which abstractions to create, and which to refuse

The instinct after a session like this is to add a `FireWeapon`, a `MuzzleFlash`, a `Smoke`.
**Refuse all three.** Every one of them is something a screenshot shows, and the rule that the
framework never owns the look is not negotiable — a framework-owned muzzle flash means every
ThreeNative game has the same muzzle flash, which is the failure mode this repository was
rebuilt to avoid. The 20-line rule kills most of the rest.

The useful split is that **the plumbing goes in the framework and the appearance ships as
template source the user owns and can delete.**

**Belongs in `@threenative/core` — plumbing, no appearance:**

| Addition | Why it is plumbing | Status |
| --- | --- | --- |
| `IInputAction.mouseButtons` | A device the input mapper simply did not support. Godot has `MOUSE_BUTTON_LEFT/RIGHT`; the vocabulary is borrowed, not invented | **shipped**, with tests |
| Press latching across a tick | Correct edge detection is the input mapper's whole job; dropping sub-frame presses is a bug, not a policy | **shipped**, with tests |
| Context menu suppressed by default | A right-click binding is unusable otherwise. `contextMenu: "allow"` restores the browser default | **shipped**, with tests |
| **`input.mouseDelta()` and a captured/visible mouse mode** | The highest-value remaining gap. Building a first-person camera today requires raw `document` listeners plus `requestPointerLock` — which the framework's *own* portability rules forbid, so every FPS built on it is web-only by construction. Godot's names are `Input.mouse_mode = MOUSE_MODE_CAPTURED` and `InputEventMouseMotion.relative` | **not done — recommended next** |
| A startup diagnostic for unreachable bindings | Enforces a rule the charter already states | **not done — recommended** |

**Belongs in `create-threenative/templates/*/src/render/` — generated source the user owns:**

| Addition | Why it is template source, not framework |
| --- | --- |
| `particles.ts` — the soft-sprite `DataTexture` helper | It is 35 lines and it decides how a puff *looks*. Both arms independently needed a soft sprite and both shipped flat quads instead; giving them the file is the fix, owning the look is not |
| `tracers.ts` — the pooled bullet-trail streak | Same: pooling is trivial, appearance is the point, and hitscan with no visible trajectory is unreadable in every shooter |
| A muzzle-flash pattern — card plus light plus smoke, with the light's **intensity** animated and its `visible` never toggled | The three-part structure is craft worth shipping as an example; the colours and timings are the game's |
| A HUD health bar | Look, entirely. But every shooter needs one and neither arm shipped one |

**Belongs in documentation, not code:**

- **Never toggle a light's `visible` to flash it.** Animate intensity. This one line would have
  prevented a 1.2-second freeze that no gate could see. It belongs beside the existing
  `CanvasTexture`-is-black-under-WebGPU trap in the generated `AGENTS.md`, which is already the
  right shape for it.
- The dev-server watcher ignore list must include everything the playtest runner writes into the
  project — `artifacts`, `proof-artifacts`, `captures`, `screenshots`. Two builds and this
  session all lost runs to the same reload.
- Model units are not knowable from a GLB. A weapon authored in centimetres attached to a hand
  bone produces a 112-metre rifle; normalise by measured bounds before attaching.

### 7.5 The general lesson

**Every automated gate in this repository is blind to the interface.** They prove that state
changes, that types check, that a frame is not blank. A player does not experience state; they
experience a device, a frame time, and a picture in motion. The gap between "2/2 sealed proof,
scored above the control by three blind raters" and "clicking does nothing" is the entire
distance between those two things.

The generated `AGENTS.md` already tells builders that *"nothing in the toolchain can see your
game"* and that a feature is done only when you have looked at it. **Both arms were told this and
neither did it** — the framework arm's own friction ledger even records the sentence. The
instruction is not enough. What is missing is a gate that makes it expensive to skip: an input
matrix, a frame-time ceiling under load, and one scripted twenty-second play session.

Until those exist, the honest reading of any sealed-proof pass in this repository is **"the state
transitions the scenario names are correct"** — and nothing whatsoever about whether the game can
be played.
