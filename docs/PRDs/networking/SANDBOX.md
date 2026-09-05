# Required local networking game

**Closure requirement added by the owner:** validate the public API with a small game in
`../sandbox/networking-proof`, outside the engine workspace. The in-repo native-smoke
fixture and protocol tests do not satisfy this requirement. This is implementation work
to execute after the shared client and Go adapter exist, not a claim the game exists now.

## Exact product

A flat arena with two colored players and a fixed camera. Each player can move with
WASD or on-screen directional buttons. A button sends one numbered action; a visible
counter changes only after server acknowledgement. Show Connecting, Connected or
Disconnected and Retry. Do not add combat, assets, terrain, matchmaking or persistence.
Render positions received from the authoritative Go server. A local animation must not
stand in for a remote player's movement. Interpolation is optional game code.

The game uses `@threenative/core/net` from installed tarballs. No workspace dependencies,
symlinks, direct monorepo source imports, modified node_modules or fake transport. The
same client source runs in two browser instances and browser + native desktop locally.
Physical Android qualification remains required by the parent PRD; iOS remains deferred.

## Setup, without overwriting other games

1. From engine root inspect `../sandbox/networking-proof` before creation. If it exists,
   reuse its completed work or stop before a tool would erase it. Never delete another
   game or run a whole-sandbox cleanup. This is a game folder, not a Git worktree.
2. Use the existing tarball sandbox tool:

   ```sh
   pnpm sandbox --genre topdown-action --template minimal --name networking-proof
   ```

   This is the non-bare mode and already scaffolds/installs the game. Do not run
   scaffold.sh again. `topdown-action` supplies the tool's existing required genre inputs;
   this task is a networking proof, not a scored run of that genre's visual brief.
   Leave its sealed brief/reference untouched and state the networking objective in
   the game's README. Do not manufacture a benchmark score or require a new reference image.
3. Record installed package versions, tarball SHA256 hashes and engine commit. Run
   `pnpm exec tsc --noEmit` and `pnpm build` inside the game before adding gameplay.
   Verify resolving `@threenative/core/net` reaches installed package dist, not workspace src.
4. Launch the game's agent from the game directory so installed MCP is registered.
   Search capabilities and read their constraints before writing entities. Use generated
   instructions and installed types. If the engine is wrong, fix its owner in the engine
   repository, rebuild tarballs and reinstall in this same game folder; record both hashes.
5. Run the existing Go server/issuer and point both clients at it. Use PROTOCOL.md and
   EXECUTION.md runtime grant staging. Two browser contexts must have distinct player
   configs/grants; serve each with a separate Vite process/config, not one overwritten
   shared credential asset. Capture and commit the small game in its owning sandbox repo;
   local validation does not require publishing or pushing it.

## Bounded game tasks

All paths below are relative to `../sandbox/networking-proof`. Each task owns at most
five authored files. Preserve generated files unrelated to networking.

| Task | Exact files | Pass condition |
| --- | --- | --- |
| S1. Installed scaffold and arena | Existing `src/scenes/Play.ts`, `src/state.ts`; new `src/networking.ts`, `src/render/arena.ts`, `README.md` | Two cubes and floor render using installed packages; networking wrapper only adapts game input/state to public connect/send/poll/close. No duplicate protocol parser. Keep the existing src/game.ts → Play scene wiring. Extend GameState with measured networking fields and initialize them in Play.initialState. |
| S2. Runtime configuration and controls | Existing `src/scenes/Play.ts`, `src/networking.ts`, `README.md`, `vite.config.ts`; new `networking.config.example.json` | Both input methods move a server-owned player; configure distinct player IDs via the documented build/runtime config split. Credential grant is an ignored runtime asset. Retry obtains a fresh token. No dependency on browser globals in game networking code. |
| S2b. Portable HUD and touch | Existing `src/render/hud.ts`, `src/render/touch-controls.ts`, `src/scenes/Play.ts`, `src/state.ts`, `src/networking.ts` | Adapt the scaffold's existing scene HUD/touch controls to show connection state, Retry and acknowledged actions. Both native and browser consume the same input path. No separate DOM-only gameplay UI. |
| S3. Local proof | Existing `README.md`; new `playtests/networking.playtest.json`, `proof/local-run.json`, `proof/browser-pair.png`, `proof/browser-native-pair.png` | Existing runner executes real clients and state assertions; images show the two-player result. JSON identifies commands, hashes, peers, observed movement/actions and failure controls without credentials. |

The screenshot paths are evidence artifacts, not images to synthesize. Only S3 may
record passing results, and only after the actual runs. Keep node_modules, dist, temporary
credentials and package staging untracked. Do not remove or recreate this game to pick
up an engine change: reinstall the new tarballs and rerun proof in place.

## Mandatory local tests

| Case | Action | Required observation |
| --- | --- | --- |
| Browser + browser | Two isolated browser contexts, separate authenticated players; move A, then B; send an action from each | Each sees the other's server-owned movement ≥1 metre and its own distinct acknowledged action. Server identities match both clients. |
| Browser + native desktop | Package the exact same game source; run browser A with native B against the same Go server | Same movement/action assertions pass; native executable and package hashes are recorded. A second browser never substitutes for native. |
| Sender disabled | Suppress A's outgoing input for the movement step | B's expected remote-movement assertion fails. Restore send and rerun green. |
| Server stopped/restarted | Stop the Go server while clients are connected, restart, press Retry | Both report disconnect, then new sessions and fresh state; no replayed action increments. |
| Missing installed export | In an isolated package fixture, remove the core/net export or install the pre-feature tarball | Game build fails resolving the public API. Restore the correct tarball and rerun green. Never mutate shared node_modules in place. |

Run the standalone game's `pnpm dev`, `pnpm build:web` and `pnpm build:desktop` scripts
from its generated package.json, not the in-repo native-smoke bundle. These scripts exist
in the inspected minimal template. Verify they still resolve to installed CLI commands
and paste exact invocation/output paths in README and evidence; do not invent flags.
Use the existing playtest runner with `--browser-recipe webgpu`; name adapter.info.
No xvfb-run, mock transport, loopback echo-only success or screenshots without assertions.

## Closure evidence

Record the run in `docs/verification/prd-359-sandbox-<YYYY-MM-DD>.md` in the engine repo.
Include sandbox repository commit, game path, package/server/native hashes, exact commands,
exit codes, positive/negative assertion output and screenshot references. The networking
PRD cannot move to done without both local pairs and their negative controls passing.
The sandbox proof does not waive remaining Windows/macOS/browser/Android release lanes.
