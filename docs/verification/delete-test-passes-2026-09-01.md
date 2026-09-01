<!-- schemaVersion: 1 -->

# The delete-test passes — PRD-306 closes, 2026-09-01

**Delete every file the bake produced and the starter still runs, on the same pixels.** The rule
that separates a baking pass from v1's IR is now a green command and a CI step, not a paragraph.

Base: `origin/main` at `0a8b750d`. Linux, Chromium through Playwright 1.62.1 under the runner's
private Xvfb, scaffolded starter installed from locally packed tarballs.

## The red and the green, on the same commit

**With the fallback as it shipped:**

```
starter: deleted 5 baked file(s); same-code band mean |Δ| 0.290/255, unbaked run 0.000/255
TN_DELETE_TEST_UNBAKED_RUN_FAILED: 'starter' could not complete 'playtests/play.playtest.json'
after 5 baked file(s) were deleted. First file it asked for and did not find:
native-proof.76e567c1.glb.
```

`0.000/255` is not a small difference — it is no frame at all. The page never booted.

**With the source-directory fallback:**

```
starter: deleted 5 baked file(s); same-code band mean |Δ| 0.293/255, unbaked run 0.288/255
  — the game runs identically without its bake
```

The unbaked run differs from the baked one by **0.288/255**, *inside* the same-code band of
**0.293/255** measured in the same run from two identical baked runs. The picture did not move; only
the bytes behind it did — uncompressed sources instead of KTX2 output, which is the "just slower"
half of the rule.

Both runs were taken with the same binary and the same scaffold, switching only
`packages/core/src/assets.ts`. That is the negative control PRD-306 asked for and could not produce
when it was filed.

## What was wrong

`resolveUrl` resolved a logical path to `<basePath>/<logical path>` when no manifest was served —
`/native-proof.png` for the starter. Nothing serves that in a compiled project: the sources live in
`assets/` and the compiled outputs are content-addressed in `public/`. The fallback was real, and it
was for a different game — one with no asset pipeline at all, whose author put the files straight
into `public/` under their own names.

So the documented behaviour, *a manifest that is absent falls back to the source path*, was true of
the code and false of the sentence: it fell back to the **base** path, not the **source** path.

## The fix

`resolveCandidates` returns an ordered list instead of one url, and `loadFirst` takes the first that
loads:

1. **Verbatim** (`/rock.png`) — a project with no pipeline keeps working and pays nothing extra.
2. **Source directory** (`/assets/rock.png`) — a project whose bake was removed finds its sources.

With a manifest there is still exactly one candidate, and a path the manifest does not list is still
an error rather than a search: a served manifest is authoritative, and probing behind its back would
hide a build mistake. `sourcePath` defaults to the compile step's own default (`assets`) and is an
option for a project that moved its sources.

When nothing loads, one error names **every** url tried. The failure this replaces reported only the
last one, so "the game cannot find its texture" read as one missing file rather than as two places
that were looked at and neither had it.

## Green

| Gate | Result |
| --- | --- |
| `pnpm bake:delete-test --template starter` | **pass** — band 0.293, unbaked 0.288 |
| `pnpm exec vitest run` | 3160 passed, 1 skipped |
| `pnpm typecheck` / `pnpm lint` / `pnpm budgets` | pass |

Six new unit cases in `packages/core/__tests__/assets.spec.ts` cover: the source-directory fallback,
the verbatim path not paying for it, a project that moved its sources, the combined error naming
every url, and — the one that keeps the fix honest — **a manifest miss staying an error rather than
becoming a search**.

## Where the gate runs, and why not in CI

It is chained onto **`pnpm test:templates`** — the repository's hardware lane — not into a CI job.

That was decided by two runs, not by preference. The gate was first wired into
`golden-path-template`, where the scaffold it needs already exists, and the starter half failed
twice with the same signature:

```
"frames": 0, "pass": false, "scenario": "play"
##[error]Process completed with exit code 1.
```

The **baked** run failed — before any deletion — because that job runs only the scenarios
`non-visual-scenarios.mjs` selects, and its own comment says why: *a runner with no GPU cannot serve
the scenarios that capture frames*. The delete-test compares captures, so it needs frames by
construction. A green there would have been impossible and a red there is the runner, not the game.

So it lives beside `pnpm test:templates`, which the repository already documents as the gate "which
has hardware". `--template` and `--scenario` drive any other template.

## A note on the harness, recorded because it cost time

Three of five attempts tonight failed in the **baked** run — before any deletion — with the page
closing after one navigation, once as `TN_DELETE_TEST_BAKED_RUN_FAILED` and once as
`TN_DELETE_TEST_BAND_RUN_FAILED`. The same command passed on the fourth and fifth attempts with
nothing else running on the machine. The starter at tier `high` runs a four-stage TSL chain through
a software adapter under Xvfb, and this machine was compiling an Android runtime at the time. The
gate's own guard is what made this legible: it refuses to measure anything when the baked run fails,
so a flaky harness reports as a flaky harness rather than as a deletion that broke the game.

## Not executed

- No Android, iOS, macOS or Windows run. The change is in portable TypeScript with no platform seam,
  but native resolves assets through the host's own fetch shim and **that path was not exercised
  here**; a native game that loses its bake is unproven either way.
- `--all` was not run: seven more templates would exercise the same two candidate urls, and the
  starter establishes the property.
