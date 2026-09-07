# PRD-359 template instructions — minimal and platformer — 2026-09-06

This records the second template-instruction pair. The shared regression remains red until the
remaining pairs are updated; this pair's source and mirror checks are green.

## Caller and source

- `packages/create-threenative/templates/minimal/AGENTS.md:94-110` and
  `packages/create-threenative/templates/platformer/AGENTS.md:90-106` document the optional
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

Exit `1`, `/tmp/prd359-template-minimal-platformer-gate.log`; after pair 1 it correctly identified
`puzzle/AGENTS.md` as the next missing contract.

## Green for this pair

Commands:

```sh
pnpm sync:agents
pnpm sync:agents --check
```

Both exited `0`; sync reported 19 mirrors and 2 written, then the check confirmed all mirrors were
in sync (`/tmp/prd359-green-template-minimal-platformer-sync.log` and
`/tmp/prd359-green-template-minimal-platformer-sync-check.log`). The all-template regression is
still intentionally open for `puzzle`, `racing`, `runner`, `sailing`, `shooter` and `starter`.
