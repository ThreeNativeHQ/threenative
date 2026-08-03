<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — create-threenative

Read `/AGENTS.md` first. This file only covers what is different here.

## The scaffold is the documentation

Models learn an API from the code in front of them, not from a help page. Everything the
framework wants a user's agent to do correctly must be visible in
`templates/starter/src/`. If an API needs explaining, the fix is usually a clearer template
file, not a longer doc.

Each template also ships an `AGENTS.md` and a `CLAUDE.md` into the generated project. Those
are the instructions the *user's* agent reads, and they are part of the product — update
them whenever the template's shape changes.

## `src/render/` is load-bearing

`lighting.ts`, `postprocessing.ts`, `materials.ts` are ordinary Three.js written into the
user's repo. They are a floor the model can rewrite or delete, not a ceiling it must reach
through config. Two hard constraints, both asserted in CI:

- No `@threenative/` import may appear in `templates/*/src/render/`.
- The generated `package.json` must contain no `catalog:` protocol — templates carry real
  versions, kept in sync by hand with `pnpm-workspace.yaml`.

Move any of that into a package and you have rebuilt the v1 mistake that made generated
output look worse than vanilla.

## Templates

- `minimal` — no React, no UI folder. Core + physics only.
- `starter` — adds React 19, Tailwind 4, `src/ui/`, and the default template.

Every file is copied verbatim, then `__PROJECT_NAME__` is replaced everywhere. Any new
placeholder needs the same treatment in `renderTemplate`.

## Keep the tests in sync

Adding, renaming, or deleting a template file means updating `__tests__/scaffold.spec.ts`
(`STARTER_PATHS`), and possibly `looks.spec.ts` and `playtest.spec.ts`. Those tests are the
only thing proving a shipped template still contains what the design promises.

`.github/workflows/ci.yml` also runs a scaffold smoke job: it packs the local packages,
generates a starter project, installs, builds, boots the dev server, and drives it in
headless Chromium. A template that builds locally can still fail there — check it before
claiming the scaffold works.

## CLI surface

Four commands, ever: `dev`, `build`, `test`, `ship`. v1 shipped 178 command forms and a
2,477-word root help, in a product whose founding constraint is that models are bad at
discovering novel APIs. Flags here stay boring: `--template`, `--no-install`, and the
`--*-package` overrides CI uses to test against local tarballs.
