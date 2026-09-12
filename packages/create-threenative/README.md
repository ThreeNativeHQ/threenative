# create-threenative

Scaffold a ThreeNative game:

```sh
pnpm create threenative my-game
```

The default template is `starter`. Choose `minimal`, `platformer`, `action-rpg`, `defense`,
`racing`, `sailing`, or `shooter` for a different starting point:

```sh
pnpm create threenative my-game --template minimal
pnpm create threenative my-game --template starter
pnpm create threenative my-game --template platformer
pnpm create threenative my-game --template action-rpg
pnpm create threenative my-game --template defense
pnpm create threenative my-game --template racing
pnpm create threenative my-game --template sailing
pnpm create threenative my-game --template shooter
```

Prerequisites are Node.js 20.19.0 or newer and pnpm 10 or newer. npm is also supported for the
same clean-room workflow:

```sh
npm create threenative@latest my-game -- --template starter
cd my-game
npm install
```

The published package declares those Node and pnpm minimums. Its asset pipeline reaches `sharp`
through `@gltf-transform/functions` → `ndarray-pixels` → `sharp`; `@threenative/core` also brings
the asset MCP's `sharp` copy. On a machine whose system has an incompatible global libvips, let
sharp use its supported prebuilt binary instead of changing the project or bypassing install
scripts:

```sh
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install
SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm install
```

This is an environment repair, not a default flag. Do not use `--ignore-scripts`: core's
postinstall wires the project-scoped MCP configuration. The registry verification records the
Node-version warning from transitive packages and runs the dependency audit separately; neither is
hidden by the install recipe.

Inside a generated project, `npx threenative doctor --text` reports what would break a build:
missing or version-mismatched `@threenative` packages, a portable entry with no default game
export, no web entry, no scenario, no capability search for your agent. Naming the build you
intend — `--target web|desktop|android|ios`, optionally with `--mode debug|release` — makes that
build's prerequisites decide the verdict instead of warning beside "available".

Tool discovery reports four separate facts, because three of them are routinely mistaken for the
fourth:

| Check | The fact it reports | What it does **not** claim |
| --- | --- | --- |
| `capability search` | each configured MCP server starts and advertises tools | that any application its tools drive is installed |
| `editor activation` | which project-scoped host configs carry the servers | that an editor loaded one — that is not observable from a CLI |
| `model conversion` | Blender is on this machine and the server is up | that a conversion has ever run |
| `model conversion` detail | what the bake manifest records as converted | anything, when no manifest exists |

Every repair is one you run in your own game, and doctor performs none of them:

- **A host config is unreadable or missing servers.** Doctor names the exact file and stops. The
  file is yours: reinstall `@threenative/core` to rewrite the configs its postinstall owns, or fix
  the named file by hand. Doctor never edits it, so a config holding servers of your own survives.
- **Your host is not listed.** Windsurf, Cline, Amp and the JetBrains assistants read a
  machine-wide config only. Installing a library into one game must never edit a file that governs
  every other project on your machine, so those are wired by hand, once, in that host's own
  settings.
- **Conversion is unavailable.** Install Blender with the command doctor prints. A project with no
  `.fbx`, `.blend`, `.obj` or `.dae` in it needs none, and stays green without it — the hard
  failure lives in the build, where the source is actually read.
