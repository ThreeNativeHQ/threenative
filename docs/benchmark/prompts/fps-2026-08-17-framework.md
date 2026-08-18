# Build the game in `brief.md`

You are building a 3D browser game in this sandbox. It is a normal folder on a normal
machine: what is installed is installed, and there is no framework repository to consult.

## 1. Set up

You are standing in the sandbox root and your project does not exist yet. Create it:

```sh
./scaffold.sh fps-framework
cd fps-framework
cp -r ../fps-kit/assets ../fps-kit/tools .
```

That installs ThreeNative from local tarballs, copies `brief.md`, `reference.png` and
`sweep.json` into `fps-framework/`, and brings in the game assets and the screenshot harness. Read
the `AGENTS.md` it generates — it is the framework's own documentation and it is the only
documentation you have.

## 2. Read your inputs, in this order

1. `brief.md` — what the game is. It is the specification; build what it says.
2. `reference.png` — what it looks like. **Open the image file and look at it before you
   write a line of code.** Name what you are matching: palette, light direction, camera
   height and pitch, silhouette scale, prop density, HUD layout. You cannot match what you
   have not described.
3. `assets/` — the models, textures and sky the real game shipped with. They are yours to
   use. Loading them is part of the job, not a bonus.

## 3. Build it

Loop: run `pnpm dev`, capture a frame, put it beside `reference.png`, fix the largest
visual gap, repeat. A game that typechecks and asserts nothing is not a game.

Capture frames with the harness supplied in `tools/`. Do not write your own and do not edit
it — it is the same harness both builds use, and a frame captured any other way is not
comparable:

```sh
pnpm dev --host 127.0.0.1 --port 5173 --strictPort &
sh tools/capture.sh node tools/capture.mjs --url http://127.0.0.1:5173 --out screenshots/iter-01.png
```

It opens headed Chromium on the real Vulkan driver, prints the WebGPU adapter it got, and
refuses to save a frame drawn by a software rasteriser. If it reports `swiftshader`, the
frame is not evidence — fix the capture, not the scene.

**Commit and push after every working increment.** This folder is inside a git repository:

```sh
git -C .. add fps-framework && git -C .. commit -m "fps-framework: <what changed>"
git -C .. push
```

Commit your screenshots. Do not commit `node_modules/`, `dist/` or `.pnpm-store/`.

## 4. Keep a friction ledger — this is the primary deliverable

Write `FRICTION.md` in your project folder **as you build**, not at the end. Every time an
API, a type, a document or a tool gets in your way, add a row:

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |

A row is worth more than a feature. If nothing blocked you on a surface, say so — an empty
ledger with one row reading `None` is a result; a missing ledger is a failed run. Do not
soften a row to be polite about the tools, and do not invent one to be interesting. If you
could not find out how something works, that is a row.

**A build that ships nothing and returns twenty well-evidenced friction rows is a success.**

## 5. Rules

- **Work only inside `fps-framework/`.** The sandbox root and its sibling folders belong to other
  builds. Never write a game at the sandbox root.
- **Do not read `/home/joao/projects/threenative/threenative-engine`** or any other checkout
  of the framework's source. If you cannot answer a question from what is installed here,
  that is a finding: write plain Three.js instead and put a row in `FRICTION.md`.
- **Do not edit `brief.md`, `reference.png`, `sweep.json`, or anything in `tools/`.** They
  are sealed inputs and their hashes are recorded.
- **Do not write or run playtest scenarios of your own devising against the sealed proof.**
  Proof scenarios are supplied separately and run after you finish. You may write your own
  scenarios for your own debugging.
- **If an API blocks you, write plain Three.js instead** and record it. A workaround in your
  own source is a finding. Contorting the game to flatter the tools destroys the measurement.
- **Nothing in the toolchain can see the game.** `typecheck`, lint and every assertion pass
  on grey boxes on a black screen. Only your eyes on a screenshot close the loop.

## 6. Budget

You have **200 tool calls**. Spend them on pixels: in the runs that worked, more than half
wrote game code. If you are ten calls deep without having written any, stop reading and
start building. When you reach 200, stop where you are and write your final report — hitting
the cap is a recorded result, not a failure, and it is never extended.

## 7. When you stop

Report, in this order:

1. The tool call number at which you wrote the first line of game code.
2. Your total tool call count.
3. Whether the build matches `reference.png`, and the largest remaining difference.
4. The path to `FRICTION.md` and the number of rows in it.
5. The last commit you pushed.
