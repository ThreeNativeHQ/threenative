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
export, no web entry, no scenario, no capability search for your agent.
