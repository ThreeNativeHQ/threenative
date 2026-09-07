# PRD-359 template instructions — shooter and starter — 2026-09-06

This records the fifth and final template-instruction pair. The shared all-template regression is
green; independent review and the required external networking sandbox remain separate closure
requirements.

## Caller and source

- `packages/create-threenative/templates/shooter/AGENTS.md:98-114` and
  `packages/create-threenative/templates/starter/AGENTS.md:98-114` document the optional
  `@threenative/core/net` transport, Go reference server, limits, delivery semantics and
  unsupported behavior.
- The generated mirrors are the corresponding `CLAUDE.md` files.
- `packages/create-threenative/__tests__/template.spec.ts:194-217` is the shared regression for all
  ten templates.

## Red

Command:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t "optional multiplayer transport"
```

Exit `1`, `/tmp/prd359-template-runner-sailing-gate.log`; before this pair, the test correctly
identified `shooter/AGENTS.md` as the remaining missing contract.

## Green

Commands:

```sh
pnpm sync:agents
pnpm sync:agents --check
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t "optional multiplayer transport"
```

All exited `0` (`/tmp/prd359-green-template-shooter-starter-sync.log`,
`/tmp/prd359-green-template-shooter-starter-sync-check.log`, and
`/tmp/prd359-green-template-networking-final.log`). The final focused run passed 1/1 selected test
across all ten discovered templates. The source instructions retain offline transport-free use,
ordered reliable delivery, bounded unreliable delivery, named limits and explicit
`TN_NET_UNAVAILABLE` behavior without fallback.
