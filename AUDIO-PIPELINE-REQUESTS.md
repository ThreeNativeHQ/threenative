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
> if the join still clicks), `positional: true` for anything that plays from a place in the world
> (mono downmix, which halves the decoded cost), and
> `spectrum: { bandHz, minFraction }` for a clip whose character is the point — a chime that comes
> back as a hum is a generation failure the pipeline can catch only if the game says what the clip
> is for.

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

## 3. Nothing needed in `packages/playtest`

Recorded because it was a live question. The audio inspector's seam metric is now the pass's seam
metric, reimplemented in `packages/assets/src/passes/audio-dsp.ts` rather than imported —
`@threenative/assets` must not drag the harness into a published tarball — and
`packages/assets/__tests__/audio-seam-parity.spec.ts` runs both implementations over the same PCM
and fails if the window, the percentile or the definition of the wrap drift apart. No change to
`packages/playtest` is required; the parity spec is what keeps the copy honest, and it will fail
loudly if that file's metric moves.
