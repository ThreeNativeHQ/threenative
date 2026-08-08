# PRD-042 — Playtest operator ergonomics: make the harness legible to the agent driving it

**Status: proposed.** Evidence gathered 2026-08-07 from 131 Codex CLI sessions with
`cwd = /home/joao/projects/threejs-webgpu` (`~/.codex/sessions/2026/**`), 128 of which
touch playtest. Nothing here changes what the harness *asserts*; it changes what the
harness *tells the operator* when a run does not reach an assertion.

**Complexity: 3 → LOW mode** (4 files, no new state, single package, no protocol change)

**Depends on:** `done/PRD-007-playtest-bridge.md` (the runner and its diagnostic shape),
`PRD-033-playtest-semantic-depth.md` (the assertion surface this leaves untouched).
**Charter authority:** `AGENTS.md` "Verification honesty" (fail closed, and a check that
cannot run must say why), rule 1 (the 20-line rule — every change below is under it), rule
6 (never claim a green gate you did not run).

## 0. What this is not

This wins no benchmark point. `CHARTER.md` §3 gives `playtest` to the vanilla arm too, so
both arms get every improvement here. The return is that the agent driving the harness
stops burning turns on the harness instead of on the game. Do not write this up as a
benchmark item.

## 1. Context — how Codex actually performed against this harness

**Corpus:** 131 sessions, 1,637 playtest-related tool calls, 2,791 tool outputs
containing `playtest`, 89 invocations of `packages/playtest/dist/runner/cli.js` across 21
sessions.

### What Codex did well — do not "fix" these

| Behaviour | Evidence |
|---|---|
| **It never weakened an assertion to get green.** Zero sessions match `removed the assertion` / `relaxed` / `narrowed the scenario` / `dropped the assertion` in any assistant message. | regex sweep over 117 assistant messages mentioning playtest |
| **It reported "unverified" rather than claiming a pass.** 7 sessions explicitly recorded a blocked browser leg as not-a-pass, including one that killed a 3-minute CPU-bound Chromium and wrote it up as unverified rather than waiting it out. | `rollout-2026-08-07T09-17-13`, `2026-08-03T00-50-02`, `2026-08-04T22-55-42` |
| **It distinguished environment blockers from product failures.** 21 sessions named the sandbox (`listen EPERM`, `sandbox_host_linux.cc:41`, `.vite-temp` write blocked) as the cause instead of editing the test. | same sweep |
| **It used the harness's own error codes as the unit of work.** 26 distinct `TN_PLAYTEST_*` codes appear in outputs and Codex routed on them. | code census below |

The fail-closed design is doing its job, and the honesty rule is being followed by the
model without supervision. **The failures below are all the harness's, not Codex's.**

### Where the turns actually went

Error-code census across all 2,791 outputs:

| Code | Occurrences |
|---|---|
| `TN_PLAYTEST_RUNNER_FAILED` | 57 |
| `TN_PLAYTEST_BRIDGE_MISSING` | 38 |
| `TN_PLAYTEST_CAPABILITY_MISSING` | 17 |
| `TN_PLAYTEST_OBSERVATION_UNAVAILABLE` | 13 |
| `TN_PLAYTEST_RUNTIME_NOT_READY` | 12 |
| every gameplay assertion code combined | 41 |

**The single most common thing the harness says is the one thing it says nothing with.**

### Gap 1 — `TN_PLAYTEST_RUNNER_FAILED` is a catch-all with a static four-way hint

`packages/playtest/src/runner/cli.ts:16-27` wraps the entire run in one `catch` that emits
one code and one fixed instruction: *"Check the scenario, URL, browser installation, and
managed-server output."*

Causes observed in the corpus, all wearing that same code and that same hint:

| Real cause | Sample `message` |
|---|---|
| Chromium crashed at launch | `browserType.launch: Target page, context or browser has been closed` |
| Chromium never launched | `browserType.launch: Timeout 180000ms exceeded` |
| CLI misuse | `Missing scenario path. Run: threenative-playtest --scenario …` |
| Page-side error | `page.evaluate: Error: Cannot advance …` |
| App never served | `page.goto: Timeout …` |
| Wrong path | `ENOENT: no such file or directory` |
| Scenario load failure | `Playtest scenario 'playtest/boot-to-play…' …` |

A fix instruction that names four subsystems for a `ENOENT` is worse than no instruction:
it is four wrong leads. This is the same failure the "19 validators returning `undefined`"
story warns about, one level up — the diagnostic is present, is shaped correctly, and
carries no information.

### Gap 2 — the CLI has no `--help`, so agents read its source instead

There is no help handling anywhere in `runner/cli.ts` or `runner/config.ts`. `--help`
starts with `-`, so `positional()` (`config.ts:87-89`) skips it and the run dies on
`Missing scenario path`, wrapped in `TN_PLAYTEST_RUNNER_FAILED`:

```console
$ node packages/playtest/dist/runner/cli.js --help
{ "diagnostics": [ { "code": "TN_PLAYTEST_RUNNER_FAILED",
  "fix": { "instruction": "Check the scenario, URL, browser installation, and managed-server output." },
  "message": "Missing scenario path. Run: threenative-playtest --scenario …" } ], "pass": false }
```

Measured consequence: **9 sessions ran `--help` and got that. 17 sessions then read
`runner/cli.ts` / `runner/config.ts` with `rg`/`nl`/`sed` to recover the flag list.** One
session (`rollout-2026-08-07T14-25-25`) did it three separate times in a single run, e.g.
`node …/cli.js --help 2>&1 | sed -n '1,220p'; rg -n "browser-recipe|webgpu|webgl" packages/playtest/src`.
Eleven flags exist and are enumerated in `config.ts:69-72`; none is discoverable from the
binary a scaffolded user gets.

### Gap 3 — the managed server and browser survive the CLI's own death

`stopManagedServer` (`runner.ts:615-619`) and `browser.close()` (`runner.ts:150-153`) run
only in the `try/finally`. There is no `process.on("SIGINT" | "SIGTERM")` anywhere in
`packages/playtest/src` — the only signal reference in the package is the `SIGTERM` it
sends outward. The server is spawned `detached` with `shell: true` (`runner.ts:580-588`),
so its process group outlives a killed CLI.

Measured consequence: **4 sessions hand-hunted orphans**, e.g.

```sh
kill 482156 482220 482236 482737 482971 484717 484825 484939 485668 2>/dev/null || true
ps -eo pid,etime,cmd | rg 'sweep-proof|playtest/dist/runner/cli.js|vite.js --host 127.0.0.1 --port 5190|chrom'
```

3 sessions had already wrapped runs in `timeout 60s` — which is precisely the kill the
harness does not survive. Leaked Vite holds the port, so the *next* run fails with
`--strictPort`, and the failure it reports is a server failure, not the truth.

### Gap 4 — headless WebGPU blankness is rediscovered by trial, every time

Headless Chromium renders WebGPU as a blank canvas on this class of machine. The harness
knows nothing about this. It is recorded in 8 PRDs (`done/PRD-015:156`, `done/PRD-017:148`,
`done/PRD-020:66`, `done/PRD-030:41`, `PRD-033:369`, `PRD-034:621`, `PRD-038:490`,
`PRD-040:405`) and in **zero** places an agent reads before running: not `AGENTS.md`, not
`packages/playtest/AGENTS.md`, not the CLI, not the runner.

Measured consequence: **17 sessions independently arrived at**
`xvfb-run -a -s '-screen 0 1600x900x24'`, after spending a full `--timeout` on a run that
was going to produce a blank frame. `TN_PLAYTEST_REGION_BLANK` fires *after* that cost, and
its message does not mention `DISPLAY` or `xvfb`.

### Gap 5 — the documented WebGPU invocation is the obsolete one

`--browser-recipe webgpu` exists (`config.ts:29-45`) and bundles `WEBGPU_BROWSER_ARGS`.
`AGENTS.md` still teaches the hand-rolled form: `--browser-arg --enable-unsafe-webgpu`.
Corpus split: **13 sessions used `--browser-arg`, 8 used `--browser-recipe`.** Agents
follow the doc, and the doc is behind the code.

### Explicitly out of scope

`BRIDGE_MISSING` (38), `CAPABILITY_MISSING` (17) and `OBSERVATION_UNAVAILABLE` (13) are
the harness being right about an unbridged or under-instrumented project. They are
`PRD-033`'s subject and are not touched here. Sandbox blockers (`listen EPERM`, Chromium
unavailable) are environment, not product.

## 2. Requirements

**R1. Every throw out of the runner carries a code that names its cause.**
Replace the single `catch` in `cli.ts` with a classifier. `TN_PLAYTEST_RUNNER_FAILED`
survives only for a genuinely unrecognised error, and its `fix` says so rather than
listing four subsystems. Minimum new codes, each with a single-lead fix instruction:

| Code | Triggered by | `fix.instruction` |
|---|---|---|
| `TN_PLAYTEST_CLI_USAGE` | `parseStandalonePlaytestArgs` throwing | run `threenative-playtest --help` |
| `TN_PLAYTEST_BROWSER_UNAVAILABLE` | `message` starts `browserType.launch` | install/repair Chromium; under a headless Linux session run via `xvfb-run` |
| `TN_PLAYTEST_PAGE_UNREACHABLE` | `message` starts `page.goto` | start the app at `--url` by hand and confirm it answers |
| `TN_PLAYTEST_SCENARIO_UNREADABLE` | `ENOENT`/read failure on the scenario path | the resolved absolute path, printed |

`TN_PLAYTEST_SERVER_FAILED` and `TN_PLAYTEST_SCENARIO_INVALID` already exist and already
carry real instructions; they must not be re-wrapped by the catch-all.

**R2. `--help` prints usage to stdout and exits 0.** All eleven flags from
`PLAYTEST_FLAGS`, each with its default, plus `init`, plus the exit-code contract
(`0` pass, `1` assertions failed, `2` the run never reached assertions). Sourced from the
same list `config.ts` validates against, so a new flag cannot be added without appearing
in help.

**R3. The CLI cleans up on `SIGINT` and `SIGTERM`.** Both signals run the same teardown as
the `finally` — kill the managed server's process group, close the browser — then exit
`2`. A `timeout 60s`-wrapped run must leave no `vite` and no `chrom*` process behind.

**R4. Headless WebGPU is diagnosed before the run, not after.** When the platform is Linux,
`headless` is true, `DISPLAY` and `WAYLAND_DISPLAY` are both unset, and the run will take a
screenshot or evaluate a `visual` assertion, emit a `warning`-severity diagnostic naming
`xvfb-run -a -s '-screen 0 1600x900x24'` before launching the browser. Warning, not error —
a scenario with no visual assertion is unaffected, and the operator may know better.

**R5. The docs teach the current invocation.** `AGENTS.md` and
`packages/playtest/AGENTS.md` show `--browser-recipe webgpu`, name the `xvfb-run` prefix
for visual assertions on a headless Linux box, and state the exit-code contract. The
`--browser-arg` escape hatch stays documented as the escape hatch.

## 3. Non-goals

- No new assertion kind, no observation field, no protocol version bump.
- No retry, no auto-`xvfb`, no port allocation, no server auto-discovery. The harness
  reports; the operator decides. Auto-anything here would hide the environment, which is
  the opposite of R4.
- No change to `report.ts`'s JSON shape beyond the codes in `diagnostics[]`.
- No `--quiet`/`--json`/`--verbose` surface. Output is already JSON.

## 4. Success criteria — runnable, not aspirational

Each is a command with an asserted result. A criterion that cannot run is a failure, not a
skip.

1. `pnpm --filter @threenative/playtest test` green, including new unit tests in
   `packages/playtest/__tests__/`:
   - `cli-usage.spec.ts` — `--help` exits `0`, stdout names all 11 flags in
     `PLAYTEST_FLAGS` plus `init`; a flag added to `PLAYTEST_FLAGS` without a help entry
     fails the test.
   - `cli-classify.spec.ts` — table-driven over the seven real `message` strings in Gap 1,
     asserting each maps to its R1 code and that only an unrecognised message yields
     `TN_PLAYTEST_RUNNER_FAILED`.
   - `preflight-display.spec.ts` — R4 fires with `DISPLAY`/`WAYLAND_DISPLAY` unset and a
     visual assertion present; stays silent without one.
2. `node packages/playtest/dist/runner/cli.js /nonexistent.playtest.json` emits
   `TN_PLAYTEST_SCENARIO_UNREADABLE` containing the resolved absolute path, exit `2`.
3. **Orphan gate (R3), the one that must run in a browser.** Start a run with
   `--server-command`, `timeout 5s` it, then assert cleanup:
   ```sh
   timeout 5s node packages/playtest/dist/runner/cli.js \
     --scenario examples/abyss-framework/playtests/smoke.playtest.json \
     --project examples/abyss-framework --url http://127.0.0.1:5199 \
     --server-command 'pnpm dev --host 127.0.0.1 --port 5199 --strictPort'
   sleep 2; ps -eo cmd | rg 'port 5199|chrom' && exit 1 || echo "no orphans"
   ```
   Ships as `packages/playtest/__tests__/orphan-cleanup.sh`, invoked from the package's
   `test` script only when a Chromium is present; **absent Chromium fails the gate as
   `unverified`, it does not skip it.**
4. `pnpm typecheck && pnpm lint && pnpm test` green.
5. `pnpm budgets` green. Headroom at time of writing: 3,006 / 15,000 framework LOC,
   9 / 10 PRD files (this file takes the tenth — **a PRD must move to `done/` before the
   next one is written**).
6. Re-run of the corpus check after adoption: a fresh session driving the CLI reaches a
   first successful run without reading `runner/cli.ts`. Recorded in the round ledger as
   the friction measurement, not asserted in CI.

## 5. Implementation sketch

Four files, each change under the 20-line rule.

| File | Change | Est. LOC |
|---|---|---|
| `packages/playtest/src/runner/cli.ts` | `--help` branch; replace the `catch` body with `classifyRunnerError(error)`; register the signal handlers | +18 |
| `packages/playtest/src/runner/config.ts` | export `PLAYTEST_FLAGS` with per-flag `{ default, summary }`; `formatUsage()` derived from it; tag parse errors so R1 can see them | +26 |
| `packages/playtest/src/runner/runner.ts` | extract the `finally` body into `teardown()` the signal handlers can call; add the R4 preflight before `browser.launch` | +14 |
| `AGENTS.md` + `packages/playtest/AGENTS.md` | R5 | docs |

Net framework LOC ≈ +58 against 11,994 of headroom.

**Sequencing.** R2 first (it is standalone and unblocks every later session), then R1
(R2's error tagging feeds the classifier), then R3, then R4, then R5. R1 and R2 are worth
landing alone if R3's browser gate cannot run in the working environment — say so and
record it, do not delete the gate.

## 6. Risks

- **The classifier matches on Playwright message prefixes**, which are not a stable API.
  Mitigation: prefix matching only, unknown falls through to `TN_PLAYTEST_RUNNER_FAILED`
  as today, and the unit test asserts the fallthrough. A Playwright upgrade degrades this
  to current behaviour, never to a wrong lead.
- **R4 could nag on a machine where headless WebGPU works.** It is `warning` severity and
  does not affect `pass`. If it proves noisy, gate it behind the visual-assertion check
  alone rather than removing it.
- **R3's gate needs a real browser.** In an environment without one it must report
  `unverified` and block the "done" claim, per rule 6.
