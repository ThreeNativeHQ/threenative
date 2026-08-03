# ThreeNative benchmark protocol

Status: sealed procedure for PRD-005. The prompt is `prompts/game-01.md`; its SHA-256
must be copied into every result file before either arm is run.

## Equal-proof contract

Both arms receive the exact same prompt and must satisfy the same checks:

1. The project installs and builds from a clean directory.
2. The game starts from its visible start control and renders a non-black frame.
3. Arrow-key input changes the player/lure position while the key is held.
4. The primary score changes after the documented interaction.
5. Browser console and page errors contain no unexpected errors.

The operator records the command, build output, browser assertion output, and artifact
commit for each arm. A missing assertion is a proof failure, not a zero-quality score.
The negative control is run independently: break the input assertion in one arm and
confirm that only that arm's proof fails.

## Run order

1. Hash the sealed prompt: `sha256sum docs/benchmark/prompts/game-01.md`.
2. Run the same model and prompt three times with the scaffolded project.
3. Run the same model and prompt three times with an empty directory and `three`.
4. Use `scripts/score-blind.ts` to strip package, folder, arm, and control labels and
   deterministically shuffle the six artifacts.
5. Have one human play every sample and record playability, visuals, and replay intent
   before seeing tokens, steps, or LOC.
6. Reveal authoritative provider usage events and record them after the blind scores.
7. Publish `docs/benchmark/RESULTS-<date>.md`, including failures and void conditions.

Example scorer invocation:

```sh
pnpm tsx scripts/score-blind.ts \
  --prompt docs/benchmark/prompts/game-01.md \
  --expected-hash <sha256> \
  --artifact framework:artifacts/framework-01.txt \
  --artifact vanilla:artifacts/vanilla-01.txt \
  --out blind-bundle.json
```

## Blind scoring rubric

Score each sample before cost disclosure.

| Score | Playability | Visuals |
|---:|---|---|
| 1 | Does not start or cannot be controlled | Broken, blank, or unusable |
| 2 | Starts but interaction is substantially broken | Default/debug output with major defects |
| 3 | Complete loop with friction | Coherent presentation with visible rough edges |
| 4 | Comfortable to play and understand | Deliberate composition, hierarchy, and feedback |
| 5 | Immediately playable and satisfying | Polished, distinctive, and internally consistent |

Also record: **Would you play it again?** `yes` or `no`, with one sentence of evidence.

## Automatic void conditions

The result is `VOID`, not a loss, if any item below occurs:

- equal-proof assertions differ or one arm has no proof;
- the prompt changes after its sealed hash is recorded;
- the scorer sees arm identity before quality scores are written;
- fewer than three completed repeats exist for either arm;
- an arm lacks an authoritative final provider usage event;
- artifacts are not stripped or the blind bundle contains an arm identifier.

Do not replace a void with an estimated token count, inferred model usage, or an
unblinded quality score.
