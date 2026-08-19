# create-threenative

Scaffold a ThreeNative game:

```sh
pnpm create threenative my-game
```

The default template is `starter`. Choose `minimal`, `platformer`, `action-rpg`, `defense`,
`racing`, or `shooter` for a different starting point:

```sh
pnpm create threenative my-game --template minimal
pnpm create threenative my-game --template starter
pnpm create threenative my-game --template platformer
pnpm create threenative my-game --template action-rpg
pnpm create threenative my-game --template defense
pnpm create threenative my-game --template racing
pnpm create threenative my-game --template shooter
```

Inside a generated project, `npx threenative doctor --text` reports what would break a build:
missing or version-mismatched `@threenative` packages, a portable entry with no default game
export, no web entry, no scenario, no capability search for your agent.
