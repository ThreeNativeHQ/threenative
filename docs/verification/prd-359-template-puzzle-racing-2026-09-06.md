# PRD-359 template instructions — puzzle and racing — 2026-09-06

This records the third template-instruction pair. The shared regression remains red until the
remaining pairs are updated; this pair's source and mirror checks are green.

## Caller and source

- `packages/create-threenative/templates/puzzle/AGENTS.md:98-114` and
  `packages/create-threenative/templates/racing/AGENTS.md:93-109` document the optional
  `@threenative/core/net` transport, Go reference server, limits, delivery semantics and
  unsupported behavior.
- The generated mirrors are the corresponding `CLAUDE.md` files.
- `packages/create-threenative/__tests__/template.spec.ts:194-217` is the shared regression for all
  template instruction pairs.

## Red

Command:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t "optional multiplayer transport"
```

Exit `1`, `/tmp/prd359-template-puzzle-racing-gate.log`; after pair 2 it correctly identified
`runner/AGENTS.md` as the next missing contract.

## Green for this pair

Commands:

```sh
pnpm sync:agents
pnpm sync:agents --check
```

Both exited `0`; sync reported 19 mirrors and 2 written, then the check confirmed all mirrors were
in sync (`/tmp/prd359-green-template-puzzle-racing-sync.log` and
`/tmp/prd359-green-template-puzzle-racing-sync-check.log`). The all-template regression is still
intentionally open for `runner`, `sailing`, `shooter` and `starter`.
