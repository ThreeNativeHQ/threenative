---
name: build-on-sandbox
description: Point at a reference screenshot and build a game that matches it, in a clean sandbox where ThreeNative is installed like it would be on a user's machine. Use when the user gives a reference image and wants a game built to it, or wants to test whether the framework helps or hurts on a real build.
---

# build-on-sandbox

The user gives a genre and one reference image. You build a game that looks like it, in a
sandbox where the framework is a dependency rather than a repository.

## Why the sandbox

Measured on this repo: an agent working inside the monorepo wrote its first line of game
code at tool call **#38 of 135**, at **297k** context. The same model in a bare folder wrote
it at call **#5 of 36**, at **108k**, and the result looked better. The first 37 calls went
to reading `packages/*/src`, PRDs, agent docs and the charter — none of which a user has.

The sandbox removes those files from disk, so they cannot be read. It is not a style
preference; it is the difference between the two outcomes.

## Steps

1. **Build the sandbox** from the repo root:

   ```sh
   pnpm sandbox --bare --genre <genre>
   ```

   Wipes and recreates `../threenative-sandbox` with the sealed `brief.md`, its
   `reference.png`, and `scaffold.sh`. It refuses an unknown genre, a missing brief or
   reference image, and any `--out` inside this repo. It also refuses to wipe a prior
   sandbox until `pnpm sweep:archive` has preserved it.

2. **Scaffold**, from the sandbox directory:

   ```sh
   ./scaffold.sh <name>
   ```

3. **Look at the reference.** Read the image file before writing anything. Name what you
   are matching — palette, light direction, silhouette scale, camera height and angle, prop
   density. You cannot match what you have not described.

4. **Build the game**, then loop until it matches: run `pnpm dev`, drive it in the browser,
   screenshot, compare against the reference, fix the largest visual gap, repeat.

5. **Archive and measure** the completed build from the repo root:

   ```sh
   pnpm sweep:archive
   pnpm sweep:measure docs/benchmark/sweeps/<genre>-<date>
   ```

   Copy the JSON result into a dated `docs/verification/sweep-<genre>-<date>.md` ledger,
   including every framework API that blocked the build and the workaround used.

6. **Report the visual result**: at which tool call you first wrote game code, whether the
   result matches, and the committed ledger path. The comparison and the friction record
   are the point of the exercise.

## Rules

- **Work only inside the sandbox.** Do not read `packages/`, `docs/`, `CHARTER.md`, or any
  `AGENTS.md` in the monorepo. Everything you need is the generated `AGENTS.md`, your own
  `src/`, and the `.d.ts` files in `node_modules/@threenative/` — about 1,065 lines of types.
- **The implementation is not on disk.** The packages ship types plus bundled JS and no
  sourcemaps, so there is nothing to spelunk — the same as a real install. If the types do
  not answer a question, write plain Three.js instead and record that the types were not
  enough. That is a finding about the framework, and it is worth more than a workaround.
- **The framework is not the subject.** If an API blocks you, write plain Three.js instead
  and note what blocked you. A workaround in user space is a finding; contorting the game
  to flatter the framework destroys the measurement.
- **Nothing in the toolchain can see the game.** `typecheck`, `lint` and every playtest pass
  on grey boxes on a black screen. Only your eyes on a screenshot close the loop.
- **Headless Chromium cannot render WebGPU** — the canvas comes back blank or black and it
  looks exactly like a bug in the scene. Use browser automation against the user's real
  Chrome. Failing that, headed Chromium under `xvfb-run -a -s "-screen 0 1600x900x24"` with
  `--enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist`. If a screenshot is
  black, suspect the capture before rewriting materials.
- **Spend the budget on pixels.** In the run that worked, 58% of tool calls wrote game code.
  In the runs that did not, 23–27% did. If you are more than a few calls deep without having
  written any, stop and start building.

## When you think you are done

Put your screenshot next to the reference and ask whether a player would screenshot yours.
If not, name the single largest difference and fix that one thing. Repeat until the answer
is yes, or until the user stops you.
