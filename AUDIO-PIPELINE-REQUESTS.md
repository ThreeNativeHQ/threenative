# Audio conditioning pass — changes needed outside this lane's paths

The pass landed in `packages/assets/src/passes/audio*.ts`, registered in the built-in registry and
documented in `packages/assets/README.md`. Three things it needs are in files this lane does not
own. None of them is a blocker: the pass works and its gates are green without them.

## 1. The templates' `AGENTS.md` must name the declarations — `packages/create-threenative/**`

A convention missing from the templates' `AGENTS.md` does not exist, and this one is *entirely*
declaration-driven: a game that declares nothing gets its audio measured and reported and nothing
asserted, which is the safe default but not the useful one. An agent building a game has no way to
learn that `loop`, `positional` and `spectrum` are the things to declare unless the template says
so.

The shortest version that would do the job, for each template's `AGENTS.md`:

> Audio is conditioned at build time and every clip is measured, but the checks that matter are
> declared, not guessed. In `threenative.config.ts`, under `assets.audio.overrides`, declare
> `loop: true` for anything that repeats forever (the pass cross-fades it and then fails the build
> if the join is still a click against the steps beside it), `positional: true` for anything that
> plays from a place in the world (mono downmix, which halves the decoded cost), and a `spectrum`
> bound for any clip whose character is the point. The bands are named — `sub` (0-100 Hz), `low`
> (100-500), `mid` (500-2k), `high` (2k-8k), `air` (8k-Nyquist) — and both directions are
> declarable: `{ band: "high", minPercent: 40 }` for a chime that must not come back a hum, and
> `{ band: "sub", maxPercent: 15 }` for a footstep that must not be built out of sub-bass. Those
> two are real defects that shipped, and no seam check would have caught either.

The full surface is the table in `packages/assets/README.md`.

Worth considering alongside it: the templates that ship audio could carry the declarations already
written out, so the convention arrives working rather than as prose.

## 2. `assets.audio` in the scaffolded config's types — `packages/create-threenative/**`

`IAssetSourceConfig` now carries `audio?: IAudioConfig | "none"`, exported from
`@threenative/assets`. If the scaffolded `threenative.config.ts` types the `assets` block against
its own local interface rather than importing that one, a game writing `assets.audio` will
typecheck-fail in its own project while the bake accepts it. This is the seam that has bitten before
(`assets.models.virtual`, validated by one layer and rejected by the next), so it is worth checking
which of the two shapes the templates use.

## 3. Nothing needed in `packages/playtest`, but do not move its metrics without running this spec

Recorded because it was a live question. Both of the inspector's content metrics are now the pass's
metrics too, reimplemented in `packages/assets/src/passes/audio-dsp.ts` rather than imported —
`@threenative/assets` must not drag the harness into a published tarball. That covers the loop seam
(wrap step against the 99th-percentile step within 50 ms of the join, limit 1.5x) *and* the five
named bands, including their edges and the fact that they sum magnitude rather than power.

`packages/assets/__tests__/audio-seam-parity.spec.ts` runs both implementations over the same PCM
across five clip shapes and asserts agreement to eight and ten decimal places, plus that the band
names and edges are identical objects' worth of values. So no change is needed there — but a change
to `AUDIO_BANDS`, to `SEAM_WINDOW_SECONDS`, to `WINDOW`/`TARGET_COLUMNS`, or to magnitude-versus-power
in `analyseSamples` will fail this spec, and that is deliberate: a game declares one bound in one
vocabulary and both tools have to mean the same thing by it.
