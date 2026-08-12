# ThreeNative Studio loop spike — 2026-08-12

**Result: proceed to Phase 1.** A bounded Codex subprocess changed one gameplay constant in a
fresh starter scaffold, Vite hot-reloaded it without losing game state, and the shipped
playtest passed against the still-running server.

No package or dependency was added during this spike. The scaffold and its two disposable
probe scripts lived under `/tmp/prd084-studio-spike.j7zWrb/`; they are not committed.

## The three numbers

| Measurement | Result |
|---|---:|
| State survived the agent's edit | **yes** |
| Sentence to visible change | **13.674 seconds** |
| Sentence to visible change plus proof recorded | **16.994 seconds** |
| Disposable glue | **220 lines** |

The visible behavior was movement speed. Before the edit, 30 fixed ticks moved the player
`1.000002` world units. After the agent changed `MOVE_SPEED` from `2` to `4`, the same input
moved it `1.999974` units. The authoritative `GameState.playerX` value was `-0.999998` before
HMR and `-0.999995` after HMR, a `0.000003`-unit difference. The hot diagnostics counter
advanced from zero to one.

The playtest took another `3.320` seconds and exited zero. Its movement, resource, diagnostics,
and visibility assertions all passed in headed Chromium under Xvfb.

## Subject and command

The subject was a starter scaffold outside the repository, installed from fresh tarballs of
the current workspace packages. This avoided workspace linking and gave the agent only the
generated project. The optional native install reported the known missing `v0.1.14` release
manifest, while pnpm correctly retained the web dependencies used by this web-only spike.

The installed agent was Codex CLI `0.147.0`. The exact bounded instruction was:

```text
Edit exactly src/entities/Player.ts. Change the MOVE_SPEED constant from 2 to 4.
Do not modify any other line or file. This is a bounded gameplay tuning change.
```

It ran as an ephemeral subprocess with a workspace-write sandbox and a 180-second outer
timeout. The resulting project diff changed only the requested literal.

The successful probe command was:

```sh
xvfb-run -a -s '-screen 0 1600x900x24' node .studio-spike.mjs
```

The proof command spawned by that probe was:

```sh
pnpm exec threenative-playtest \
  --scenario playtests/hot-reload.playtest.json \
  --url http://127.0.0.1:4184 \
  --browser-recipe webgpu \
  --headed
```

The first proof attempt used headless Chromium and exited one after the gameplay assertions
passed because the browser produced five WebGPU device errors. Per the night instructions,
that was not counted as a pass. Running headed Chromium inside the existing Xvfb display made
the same scenario pass without console errors.

## Required negative controls

### Hot-state wrapper removed

The control removed `acceptHotUpdate(game, import.meta.hot)` and its import from `src/main.ts`,
then repeated the same agent edit. Vite performed a full reload. The non-default player
position was lost:

```json
{
  "agentExit": 0,
  "fullReloadObserved": true,
  "playerXBefore": -0.23332025110721588,
  "playerXAfter": -1.9999977350234985,
  "stateLost": true
}
```

This is the observed red proving the positive result measured the hot-state wrapper rather
than an unrelated Vite behavior.

### Playtest bridge removed

The control removed `playtest()` from the generated game's plugin list, forced the updated
module to load, and invoked the same semantic scenario. It exited `2`, reported
`TN_PLAYTEST_BRIDGE_MISSING`, set `pass: false`, and emitted no assertion results:

```text
NO_BRIDGE_EXIT=2
Scenario requires semantic capabilities but '__THREENATIVE_PLAYTEST_BRIDGE__' is not installed.
```

The outcome is **not observed**, not a failed gameplay assertion and never a pass.

## Glue accounting and recommendation

The positive driver was 144 lines and the independent no-hot control was 76 lines. That
220-line disposable harness deliberately includes browser launch, subprocess isolation,
authoritative state reads, timing, an explicit shipped-playtest invocation, and failure
diagnostics. It is evidence code, not the proposed Studio implementation.

Proceed to Phase 1. A 17-second verified loop is interactive, state preservation survives an
agent-authored edit, and 220 lines to instrument both the product loop and its adversarial
control supports the hypothesis that the existing Vite, hot-state, and playtest plumbing does
most of the work. Phase 1 should remain only chat, preview, and the bounded subprocess; if its
shipping source expands toward an operation registry or bespoke project format, stop it.
