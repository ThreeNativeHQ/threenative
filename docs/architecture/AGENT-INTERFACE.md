# Agent interface

**Status:** proposal, 2026-08-02. The public CLI stays limited to four familiar commands,
with no bespoke vocabulary.

## The workflow this replaces

```mermaid
flowchart LR
    ask["User asks for a feature"] --> rewrite["model rewrites random files"]
    rewrite --> game["game may or may not run"]
    game --> find["user manually finds the breakage"]
```

What it should be:

```mermaid
flowchart TB
    outcome["User describes an outcome"]
    inspect["agent inspects the project and live game state"]
    plan["small plan, bounded patch"]
    verify["typecheck + unit tests + gameplay scenario"]
    launch["launch, capture telemetry and screenshots"]
    compare["compare against performance and visual budgets"]
    result["present result, diff, one-click rollback"]

    outcome --> inspect --> plan --> verify --> launch --> compare --> result
```

Steps 3 and 4 are the ones nobody else has, and both are half-built here already:
`pnpm typecheck`, `pnpm test`, and `@threenative/playtest` scenarios that drive a real
browser through a bridge.

## Model-agnostic by construction

The business must not depend on one provider. Expose ThreeNative through MCP, the CLI, a
stable tool protocol, editor extensions, bring-your-own key, and optional integrated
credits. Codex, Claude Code, Cursor and whatever comes next then drive the same
framework.

**The MCP layer is not the moat.** Unity and Roblox are both shipping agent access to
editor state; it is becoming an expected integration, like LSP. The value is the semantic
capability underneath it.

## Semantic tools, not just filesystem access

Every tool below must map onto surface that already exists, or onto surface a PRD is
committed to. Inventing agent-only vocabulary would repeat v1's worst mistake — 178
command forms and a 2,477-word root help, in a product whose founding constraint is that
models are bad at discovering novel APIs.

| Tool | Backed by | Exists? |
|---|---|---|
| `scene.inspect()` | `Registry.snapshot()`, `window.__THREENATIVE__` | **Yes** (PRD-006) |
| `tests.runScenario(name)` | `@threenative/playtest` runner + bridge | **Yes** |
| `profile.assertBudget(...)` | playtest observations + frame timing | Partly — see [../product/PERFORMANCE-BUDGETS.md](../product/PERFORMANCE-BUDGETS.md) |
| `scene.addEntity(...)` | writes an entity class into `src/entities/` | No — and it should stay a **file edit**, not a runtime mutation |
| `assets.import(...)` | asset compiler | No — [../product/ASSET-PIPELINE.md](../product/ASSET-PIPELINE.md) |
| `release.build(...)` | `threenative ship` | No — Cloud, ROADMAP Phase 4 |

The rule: an agent tool is a **stable, validated, auditable name for an operation the
user could do by hand**. When the operation is "write a TypeScript file," the tool writes
a TypeScript file. It does not introduce a scene format to mutate — the charter rejected
the IR, the compiler and the serialized scene format, and 25,898 LOC of compiler bought
nothing a model cannot do with a `.ts` file.

## Every change is a checkpoint

A generated change should carry:

- the requested outcome
- files changed
- scene and asset changes
- test results
- performance delta
- screenshots or captured frames
- a revert button

Far more trustworthy than a conversation transcript, and it produces evaluation data as a
side effect of normal use — without training anything.

## Automated playtesting is the differentiator

The runtime already supports deterministic input recording and replay. A scenario today
is plain data:

```ts
export const playScenario = {
  name: "move to the pickup and score",
  target: "web",
  schemaVersion: 1,
  steps: [
    { kind: "input", press: "ArrowRight", holdFrames: 120, release: true },
    { kind: "wait", waitFrames: 30, release: true },
  ],
  assert: {
    diagnostics: { noConsoleErrors: true, runtimeReady: true },
    hud: [{ id: "score", path: "#root", textIncludes: "1" }],
  },
} as const;
```

`holdFrames` rather than milliseconds is what makes it deterministic: the harness drives
the fixed-step clock instead of racing it.

Questions worth answering automatically, in rough order of value:

1. Can the player reach the exit, and is the level ever unwinnable or trap-able?
2. Did this edit reduce the frame rate, or blow a draw-call budget?
3. Does the game survive ten restarts, backgrounding, and resume?
4. Is a button outside the safe area on an iPhone?
5. Is it still playable on a low-end Android profile?

## The validator trap

The harness history records why this harness needed a fix before it was lifted: 19 validators
returned `undefined` on a wrong-typed value and 13 `.filter()` calls dropped them
silently. A misspelled `equals` type meant the assertion vanished and the scenario
**reported green while asserting nothing**.

That failure mode is the single most dangerous thing in an agent loop, because the agent
optimizes against the report. Any new assertion type must throw on malformed input, never
skip. A silently-inert check is worse than no check — it converts "unverified" into
"verified" without anyone deciding to.
