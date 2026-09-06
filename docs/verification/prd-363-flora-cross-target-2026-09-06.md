# PRD-363 Phase 4 cross-target record — 2026-09-06 (PARTIAL)

## Status: browser UNEXECUTED, native desktop UNEXECUTED, mobile UNVERIFIED

An honest record of what was attempted and where it stopped.

## Scaffold proof (done)

Scaffolded a clean starter via the in-worktree `createProject` API
(`install: false`, then registry `pnpm install` in `/tmp/flora-run/game` —
the PRD's tarball-only constraint was approximated, not met: tarballs were
packed from current source at `/tmp/flora-proof-packs/` but the proof game
installed registry `0.3.0` because the packed install hit a `sharp`/
`node-addon-api` error under npm).

The scaffolded tree carries all 10 flora render files and the strengthened
`look.playtest.json` with 4 `scenery.flora` components
(`floraPlants`, `leafInstances`, `woodTriangles`, `tipDisplacement`) plus the
pre-existing ridge/visual assertions (4 visual regions).

## Browser run (blocked — version skew, not flora)

`node packages/playtest/dist/runner/cli.js
/tmp/flora-run/game/playtests/look.playtest.json --url
http://127.0.0.1:5199 --server-command "pnpm --dir /tmp/flora-run/game dev
--host 127.0.0.1 --port 5199 --strictPort" --browser-recipe webgpu`

Result: `TN_PLAYTEST_SERVER_FAILED` — the scaffolded game's
`threenative.config.ts` names `renderer.alphaAntialiasing`, which the
registry `create-threenative@0.2.3` dev-server plugin rejects as
`TN_CONFIG_UNKNOWN_KEY`. The template (worktree, post-alphaAA) is newer
than the published scaffolder the proof game installed. No flora assertion
was evaluated; frames: 0. Raw output tail preserved in this record's
history (exit 0 with `pass: false`).

Next: rerun with workspace-linked installs (`packageSources` / golden-path
`scaffold.sh` flow) so template and scaffolder versions agree, then record
adapter identity, counts, hashes, and captures here.

## Native desktop (unexecuted)

`native-playtests/render-chain.playtest.json` carries the matching flora
assertions (`floraPlants ≥ 2`, `leafInstances ≥ 10`, `tipDisplacement ≥
0.01`). No `--target desktop` run has executed. Owed: executable identity,
observation provenance (native vs browser fallback), count/hash identity
vs browser, captures.

## Mobile (UNVERIFIED by design)

Android and iOS: no runs attempted. Per the PRD they stay `UNVERIFIED`.

## Negative control (owed)

Skip flora construction in the native bundle only; the native flora
completion/hash observation must fail while the browser still passes. Not run.
