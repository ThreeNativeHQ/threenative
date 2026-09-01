# AGENTS.md — create-threenative

Read `/AGENTS.md` first. This file covers only what is different here.

## The scaffold is the documentation

Models learn an API from the code in front of them, not from a help page. Everything the
framework wants a user's agent to do correctly must be visible in `templates/starter/src/`.
If an API needs explaining, the fix is usually a clearer template file, not a longer doc.

Each template also ships an `AGENTS.md` and `CLAUDE.md` into the generated project. Those are
the instructions the *user's* agent reads, they are part of the product, and they are the one
place a user's agent learns the web/native rules — update them whenever the template's shape
or a platform's status changes. `pnpm sync:agents` mirrors them like every other pair.

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

- `minimal` — no React, no UI folder. Core + physics, and a camera-parented geometry HUD in `src/render/hud.ts` (no DOM readout, so it survives on native).
- `starter` — adds React 19, Tailwind 4, `src/ui/`. The default.
- `platformer` — adds navigation; its Recast WASM dependency makes it web/desktop only.

Every file is copied verbatim, then `__PROJECT_NAME__` is replaced everywhere. Any new
placeholder needs the same treatment in `renderTemplate`. `pnpm budgets` reports each
template's LOC but no longer caps it.

Reusable workflows live in `agent-files/.agents/skills/` and `agent-files/.claude/skills/`; each
template links both adapters, and the scaffolder copies them unchanged. Long recipes live in
`agent-docs/references/*.md`, not in the templates. The scaffolder copies that bundle to
`<project>/agent-docs/` with placeholder substitution and fails closed when a template names a
page it does not ship. Keep each template `AGENTS.md` under 100 lines; `scripts/instruction-budget.ts`
still bounds rendered words, references, and the `CLAUDE.md` mirror. Keep mandatory rules (first-use
capability search, platform constraints, fail-closed playtest rules) in the root; move detailed
workflows into a named skill or reference and link its generated path.

**A template's platform claims must match what was executed.** The status paragraph under
each template's Commands block is a fail-closed statement, not marketing; narrow it when a
dependency (like Recast WASM on QuickJS) rules a target out.

## Keep the tests in sync

Adding, renaming, or deleting a template file means updating `__tests__/scaffold.spec.ts`
(`STARTER_PATHS`), and possibly `looks.spec.ts` and `playtest.spec.ts`. Those tests are the
only thing proving a shipped template still contains what the design promises.

`.github/workflows/ci.yml` also runs a scaffold smoke job: it packs the local packages,
generates a starter project, installs, builds, boots the dev server, and drives it in
headless Chromium. A template that builds locally can still fail there — check it before
claiming the scaffold works.

## CLI surface

Two `threenative` commands, ever: `build` (`--target web|desktop|android|ios`) and `doctor`
(`--text` prints the person-readable report; it checks rather than builds, borrowed whole from
`npm doctor` and `flutter doctor`). `__tests__/cli.spec.ts` derives the advertised list from the
real executable and rejects anything else, so this document cannot outgrow the binary. A third
command needs the owner decision made again — v1 shipped 178 command forms and a 2,477-word root
help, in a product whose founding constraint is that models are bad at discovering novel APIs.
The scaffolder itself takes a target directory plus `inspect <file.glb> [--json]`; its flags stay
boring: `--template`, `--no-install`, and the `--*-package` overrides CI uses to test against
local tarballs. `pnpm dev` inside a generated project is a package script, never a CLI command.

The MCP servers reach a generated project through the `.mcp.json` that installing
`@threenative/core` writes — asset, sculpt and capability servers, each launching through a shim
inside core. The asset server itself remains the externally pinned `threenative-asset-mcp`;
never vendor it. Its recorded surface is `asset-mcp-tools.json`, updated by running the pinned
server — never by reading its docs.
