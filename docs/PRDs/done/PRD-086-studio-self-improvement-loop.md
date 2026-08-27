---
prd_contract: v1
---

# PRD-086 — The standing brief for an agent left iterating on Studio

**Status: STANDING, from 2026-08-12.** This file is not finished and then archived. It is the
instruction the unattended loop hands to an agent every iteration, and it changes only when the
bar changes. The harness it describes is `scripts/studio-probe.ts`,
`scripts/studio-inspect.ts` and `scripts/studio-loop.ts`; the defects that motivated it are in
[PRD-085](./PRD-085-studio-wiring.md) and
[`studio-wiring-2026-08-12.md`](../../verification/studio-wiring-2026-08-12.md).

**You are reading this because the loop gave you one failing check.** Fix that one thing. Not
the architecture, not the file you happened to open, not a refactor you think is overdue. One
check, one small diff, judged mechanically the moment you stop.

---

## 1. Run the thing before you reason about it

Studio is a server plus one self-contained HTML page. Almost every defect ever found in it was
invisible in the source and obvious in thirty seconds of running it. **Reasoning from source
alone is how the last seven defects survived review.**

```sh
pnpm --filter @threenative/studio build          # the probe and inspector run dist/, not src/

pnpm studio:inspect --browser --port 4490        # boot Studio on a throwaway project and report everything it observed
pnpm studio:inspect --port 4490 --json           # the same, machine-readable
pnpm studio:inspect --port 4490 --keep           # leave it running and print the URL, so you can poke it
pnpm studio:inspect --port 4490 --project <path> # point it at a real game project instead of the fixture
pnpm studio:inspect --port 4490 --prompt "…"     # send one real instruction and print every streamed step with timings
pnpm studio:inspect --port 4490 --screenshot out.png

pnpm studio:probe --browser                      # the exact checks the loop judges you by
pnpm studio:probe --json                         # per-check ids and details
```

**Use a port nobody else is on.** `--port N` also takes `N+1` for the preview. An `EADDRINUSE`
crash is your own leftover process, not a Studio defect.

### What each tool is for, and what it is not

| Tool | Answers | Does not |
| --- | --- | --- |
| `studio:inspect` | *What is Studio doing right now?* Status, page controls, console tail, project files, scenarios, working tree, a real agent turn with per-step timings, rendered layout at 1600px and 1100px | Judge. It never says pass or fail. |
| `studio:probe` | *Does Studio still meet the bar?* One line per check, exit `0` pass, `1` fail, `2` nothing observed | Explain. A failing check tells you what broke, not why. |
| `studio:loop` | Runs you, then judges you | Trust you. Every rule below is enforced after you stop. |

**The inspector is where you look; the probe is where you are scored.** Reading `--json` from
the inspector before *and* after your change is the cheapest way to know whether you moved the
thing you meant to move.

---

## 2. What to look for

Every defect below was real, in this file's own subject, and every one shipped past a review.
They are ordered by how often they recur.

### 2.1 A claim Studio did not observe

Studio's entire product claim is that it reports only what it observed. The failure mode is a
sentence that sounds like an observation and is a guess.

- Look for: any UI string asserting state, next to code that never measured it.
- The real one: the browser printed *"Studio status endpoint did not answer"* for a refused
  connection, an HTTP 500, and a well-formed 200 with a missing key. Three causes, one
  sentence, no evidence for any of them.
- The fix shape: report what was tried and what came back. `Studio answered HTTP 500` and
  `Studio could not be reached: Failed to fetch` are different sentences because they are
  different facts.
- **If you cannot observe something, say so in the text.** "not observed" is a correct answer.
  A cheerful guess is not.

### 2.2 A failure that arrives as silence

- Look for: a spawned process with no `error` handler, a `catch {}` that discards, a promise
  nobody awaits, an exit path that prints nothing.
- The real ones: a preview that could not spawn killed the whole server with an unhandled
  `error` event; and Studio's own `bin` exited `0` in silence in every project that installed
  it, because the CLI guard compared a symlink against a real path.
- The fix shape: catch it, name it, surface it to `/api/status` so the browser can say it.
- **Test it by breaking it**: strip `PATH`, rename a binary, kill the preview. If Studio's
  answer is a stack trace or nothing, that is the defect.

### 2.3 A control the user cannot reach

- Look for: `display: none` in a media query, a control docked far from what it controls, a
  default value that does not exist in this project, an icon that is a text placeholder.
- The real ones: the Live activity column was deleted below 1180px with no route back; the only
  control that hid the bottom dock sat in the opposite corner of the window; the project tree
  drew `[+]` and `-`; the scenario field defaulted to a file that existed in one template.
- **Only the browser can answer this.** `studio:inspect --browser` reports
  `visibleActivityColumn`, `visibleRunProof`, `visibleDockCollapse`, `treeIcons` and
  `bodyScrollsSideways` at two widths. The served HTML cannot: a hidden column is still in it.

### 2.4 A feature that works on one agent

Studio supports `claude` and `codex`, and `claude` is the default when neither is named.

- Look for: parsing, flags or assumptions that fit one agent's output shape.
- The real one: step streaming was built and verified on Codex's JSONL. Claude Code ran with a
  non-streaming output format and `agentStep` understood none of it, so the default agent
  streamed **zero** steps and the activity column never moved. It looked broken; it was never
  wired.
- The fix shape: one `IAgentStep` vocabulary, one reader per agent, and a real turn measured on
  **both** — `pnpm studio:inspect --prompt "…"` prints the steps, so run it twice.

### 2.5 The agent's context is not the user's project

Studio spawns a coding agent inside the user's game. It must see that game and nothing above it.

- Look for: an agent flag vector that inherits instruction files, memory, hooks, skills or MCP
  from wherever Studio happens to be running.
- The real one: the spawned agent was reading this framework's `CLAUDE.md`, the examples'
  rules, and the operator's personal memory index.
- The probe for it is one word: ask the agent, through `/api/chat`, to answer `POISONED` if a
  phrase from the outer repository is in its context and `CLEAN` otherwise. The game's own
  `AGENTS.md` must still reach it — the fixture's codeword is `ZANZIBAR`.

### 2.6 A number Studio reports that is not the number

- Look for: set membership standing in for change, counters that never reset, a status derived
  from a stale snapshot.
- The real one: changed files were computed as *paths dirty after* minus *paths dirty before*,
  so a file the agent edited twice was reported as untouched the second time.
- The fix shape: compare content, not names. `git hash-object` over the dirty set is cheap.

---

## 3. What one accepted iteration looks like

1. Read the failing check id and detail the loop handed you.
2. Reproduce it. `pnpm studio:inspect` for behaviour, `pnpm studio:probe --json` for the check
   itself. If you cannot reproduce it, say so and stop — a fix for a defect you never saw is a
   guess.
3. Name the layer before you write the fix. Studio's server (`packages/studio/src/server.ts`)
   or Studio's page (`packages/studio/src/app.tsx`). If the honest answer is "neither, the
   probe is wrong", **stop and say so in your summary** — you may not edit the probe, and the
   loop will revert you for trying.
4. Make the smallest change that fixes it.
5. Add or extend a test in `packages/studio/__tests__/studio.spec.ts` that fails without your
   change.
6. Re-run `pnpm studio:probe --browser` yourself. Then stop.

---

## 4. What the loop refuses, before you spend a turn on it

These are not guidance. `scripts/studio-loop.ts` enforces every one after you stop, and any
single failure reverts the **whole** working tree and writes the reason to
`artifacts/studio-loop/ledger.jsonl`.

| Refusal | Why it exists |
| --- | --- |
| A file outside `packages/studio/src/` or `packages/studio/__tests__/` | One subject per loop. A diff nobody scoped is a diff nobody reviews. |
| Any edit to `scripts/studio-probe.ts`, `scripts/studio-loop.ts`, `scripts/studio-inspect.ts` or `packages/studio/package.json` | An agent that edits its judge is grading its own work. |
| Fewer assertions than you started with | This repository has already shipped a harness that reported pass while asserting nothing. Green bought by deleting a test is the worst outcome available. |
| A failing gate — typecheck, lint, build, or the Studio unit tests | Same bar as a human change. |
| Fewer probe checks passing, or the same number | An iteration that changed nothing observable is not an improvement. |
| Studio source above the line ceiling (`--line-ceiling`, default 1800) | The kill switch, mechanised. An abstraction that costs more code than plain Three.js gets deleted however much work it took. |
| A dirty tree at the start | The revert has to be exact. |

**Read the ledger before you start.** If your last three iterations were reverted for the same
reason, the fix is not another attempt at the same thing.

---

## 5. When every check passes

The loop stops and says so. That is correct behaviour and not a failure: a probe with a fixed
number of checks measures a fixed bar, and once Studio clears it, more agent turns buy nothing.

Raising the bar is a deliberate act, and it belongs to whoever owns the loop:

1. Run `pnpm studio:inspect --browser --json` against a **real** scaffolded project, not the
   fixture, and read it for something Studio claims but did not observe.
2. Add a check to `scripts/studio-probe.ts` for it.
3. **Observe it red on the current build before you trust it.** A check that has never failed
   is a check that asserts nothing. Reverting the fix and watching the check go red is the only
   proof, and it takes two minutes:
   `git stash && pnpm --filter @threenative/studio build && pnpm studio:probe`.

**Stated limits, rather than pretended coverage.** The probe does not observe: hot-reload state
preservation, the rendered game inside the preview iframe (cross-origin), agent cost, real
device behaviour, or anything Studio does over 15 minutes. `pnpm studio:probe` passing means
Studio met eighteen named checks — it does not mean Studio is good.

---

## 6. Running the loop

```sh
pnpm studio:loop --dry-run                        # print the next action and stop; free
pnpm studio:loop --max-iterations 5               # default: claude, $1 per turn
pnpm studio:loop --agent codex --max-iterations 3
pnpm studio:loop --line-ceiling 2000              # raise the kill switch deliberately, never silently
```

Exit `0` clean, `1` the agent itself failed, `2` the tree was dirty. Every iteration appends one
line to `artifacts/studio-loop/ledger.jsonl` with the action, the before and after scores, the
changed files, and the accept-or-revert reason. Accepted iterations are committed locally, one
commit each, so a bad run is one `git revert` away. **The loop never pushes and never
publishes.**

## 7. Requested Studio feature list

Captured 2026-08-12. All four items are now shipped in the browser Studio.

- [x] **Resizable bottom panels.** Drag the boundaries between the bottom panels; useful minimum
  sizes and the layout preference are persisted.
- [x] **Clickable code inspection.** Clicking a code file in Project files opens an editable Monaco
  editor. Save writes only an existing visible project file; traversal, hidden paths, and oversized
  content fail closed, and unsaved changes prompt before replacement.
- [x] **Code inspections tab.** A dedicated tab lists the files opened from the project tree.
- [x] **Live activity event system.** A shared `/api/events` stream publishes structured agent,
  step, proof, git-checkpoint, and idle lifecycle events; active step history is replayed to late
  connections, the panel shows the latest 18 received events, and polling remains the recovery
  path.
- [x] **Agent progress narration.** Reuse the validated `/api/events` lifecycle stream to show
  what the AI is doing at each game-dev step, including work started outside the current tab, with
  clear current, completed, and blocked states in the Studio flow.
- [x] **Transcript follow control.** The chat follows newly observed steps while the reader is at
  the latest entry, pauses when they scroll up, and offers a visible way to jump back to the latest
  activity.
- [x] **Console duplicate grouping.** Repeated identical console lines collapse into one row with
  a visible count, while distinct warnings and errors remain separate.
