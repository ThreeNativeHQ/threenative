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

## Diagnose the operation you intend to run

```sh
pnpm exec threenative doctor --text
pnpm exec threenative doctor --target web --mode debug --text
pnpm exec threenative doctor --target android --mode debug --text
pnpm exec threenative doctor --target desktop --mode release --text
```

Omitting `--target` keeps the broad project/authoring/playtest report, including the existing
`--capture <path>` delegation. A capture cannot be combined with target scope; run those checks separately. `--target` scopes the report to web, desktop or Android build
prerequisites; `--mode` requires a target and defaults to `debug`. Unknown, missing and repeated
scope flags fail before any machine probes. JSON remains the default and `--text` renders the
same checks. Exit 1 means at least one required check failed; exit 0 does not prove an executed
build, working game, activated editor, signed artifact or accepted store submission.

A scoped request fails on an absent or incompatible prerequisite instead of calling a target
available merely because its packager script exists. Web does not require the optional native
runtime, Android tooling, iOS, MCP setup or playtests. Native checks reuse the build config/UI
preflights and the installed runtime's release-manifest validator and artifact selection.
Android checks the supported JDK 17 and SDK platform 35. Its manifest and artifact availability
probe has one five-second deadline; an HTTP failure or timeout remains a failure with its URL.
No runtime/application binary is downloaded by doctor. Desktop verifies installed runtime bytes
against their recorded checksum, without requiring a network request to reuse a valid install.
Blender-dependent source assets, including nested sources, respect the asset compiler's exclusion
globs. A required missing converter blocks the scoped build; an unused converter stays optional.

The current native build path does **not** implement release packaging/signing. Consequently
native `--mode release` reports that limitation and exits 1 even on a healthy debug machine;
installing signing credentials cannot turn an `assembleDebug` path into a release build. Use
`pnpm exec threenative build --target android` or `--target desktop` for the supported path.
Doctor does not ask for keys, claim store readiness, or require iOS for these requests.
Signing/submission and actual build/runtime execution remain `PENDING` until separately observed.

## Authoring tools are separate observations

The broad report distinguishes installed packages and configuration from the real MCP
`initialize`/`tools/list` transport probe. A successful Blender MCP transport does not install
Blender or prove a conversion succeeded. The `blender` row reports external executable detection,
conversion availability and the still-pending operation proof. Doctor does not launch your editor
or observe its tool list; editor activation and discovery therefore remain `PENDING` even when
the project config is valid.

Core's project-scoped host table supplies these paths:

| Host | Project file |
| --- | --- |
| Claude Code | `.mcp.json` |
| Codex | `.codex/config.toml` |
| Cursor | `.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` |
| Gemini CLI | `.gemini/settings.json` |
| opencode | `opencode.json` |
| Zed | `.zed/settings.json` |

Doctor preserves malformed or unwritable files and prints their exact location. JSON configs are
checked against the common server table. Codex's MCP section declarations are reported separately
from TOML parsing and editor activation, which are not observed by this check. Open the game root
in your editor, approve the project servers and inspect its actual MCP tool list. Windsurf, Cline,
Amp and JetBrains assistants need manual host setup; installing a game dependency never edits
machine-wide configuration for them.

When package-manager script policy prevented the project setup, review that policy first rather
than disabling safeguards globally. With pnpm 10, review `pnpm approve-builds`, then run
`pnpm rebuild @threenative/core @threenative/runtime-native` in the game root. Review and repair
any named config conflict before rebuilding: existing unrelated settings are not disposable.
For npm, check the project's `ignore-scripts` policy before running `npm rebuild` for those
packages. Blender's row gives the platform-specific application installation command when needed;
run it yourself, then repeat doctor. No engine checkout or source override is a consumer repair.
